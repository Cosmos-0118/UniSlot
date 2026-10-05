#!/usr/bin/env python3
"""CLI entry for UniSlot CP-SAT solver.

Reads instance JSON from --instance, writes solution JSON to --output.
Progress events are emitted as NDJSON on stderr (solutions + heartbeats).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import threading
import time
import traceback
from typing import Any, Callable

from ortools.sat.python import cp_model
import ortools

from model import BuiltModel, apply_hints, build_model

HEARTBEAT_INTERVAL_S = 0.5


def toolchain_info() -> dict[str, str]:
    vi = sys.version_info
    return {
        "python_version": f"{vi.major}.{vi.minor}.{vi.micro}",
        "ortools_version": getattr(ortools, "__version__", "unknown"),
    }


def emit(event: dict[str, Any]) -> None:
    sys.stderr.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stderr.flush()


def status_name(status: int) -> str:
    mapping = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }
    return mapping.get(status, f"STATUS_{status}")


def integer_gap_closed(incumbent: int | None, bound: int | None) -> bool:
    """True iff an integer minimization objective is proven minimal.

    OR-Tools may return OPTIMAL when ``absolute_gap_limit`` is met even if a
    positive gap remains. For integer objectives a mathematical certificate
    requires ``incumbent - bound < 1``.
    """
    if incumbent is None or bound is None:
        return False
    try:
        inc = int(incumbent)
        bnd = int(bound)
    except (TypeError, ValueError):
        return False
    return inc - bnd < 1


def solver_best_bound(solver: cp_model.CpSolver) -> int | None:
    try:
        raw = solver.BestObjectiveBound()
    except Exception:  # noqa: BLE001 — bound may be unset mid-teardown
        return None
    if raw is None:
        return None
    if raw >= 2**62 or raw <= -(2**62):
        return None
    return int(raw)


def model_stats(model: cp_model.CpModel) -> dict[str, int]:
    proto = model.Proto()
    return {
        "variables": len(proto.variables),
        "constraints": len(proto.constraints),
    }


def phase_label(phase: str) -> str:
    return {
        "minimize_red": "1/3 Minimizing RED students",
        "minimize_clash": "2/3 Minimizing clashes",
        "minimize_balance": "3/3 Balancing weekdays",
    }.get(phase, phase)


def balance_objective_multiplier(built: BuiltModel) -> int:
    """Choose a coefficient larger than every feasible parallel-excess value."""
    variable = built.model.Proto().variables[built.parallel_excess.Index()]
    return int(variable.domain[len(variable.domain) - 1]) + 1


def lex_best(*candidates: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return the best complete incumbent using the active RED-first tuple."""
    present = [candidate for candidate in candidates if candidate is not None]
    if not present:
        return None
    return min(
        enumerate(present),
        key=lambda item: (
            int(item[1]["red_students"]),
            int(item[1]["clash_weight"]),
            int(item[1]["weekday_balance_l1_scaled"]),
            int(item[1]["parallel_excess"]),
            -item[0],
        ),
    )[1]


def validate_time_limit(time_limit: float | None) -> None:
    if time_limit is not None and (
        not math.isfinite(float(time_limit)) or float(time_limit) < 0
    ):
        raise ValueError("time_limit must be a finite non-negative number")


class IncumbentCheckpoint:
    """Atomically retain the best complete schedule seen in a bounded run."""

    def __init__(self, output_path: str, objective_policy: str) -> None:
        self.path = f"{output_path}.incumbent.json"
        self.objective_policy = objective_policy
        self._lock = threading.RLock()
        self._best_score: tuple[int, ...] | None = None
        self._error_reported = False

    def _score(self, result: dict[str, Any]) -> tuple[int, ...]:
        red = int(result.get("red_students") or 0)
        clash = int(result.get("clash_weight") or 0)
        balance = int(result.get("weekday_balance_l1_scaled") or 0)
        parallel = int(result.get("parallel_excess") or 0)
        if self.objective_policy == "clash-only":
            return (clash, red, balance, parallel)
        return (red, clash, balance, parallel)

    def _write_atomic(self, result: dict[str, Any]) -> None:
        directory = os.path.dirname(os.path.abspath(self.path))
        fd, temp_path = tempfile.mkstemp(prefix=".unislot-incumbent-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(result, stream, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_path, self.path)
        except Exception:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise

    def __call__(self, candidate: dict[str, Any]) -> None:
        if not candidate.get("slot_by_course"):
            return
        value = {**candidate, "objective_policy": self.objective_policy}
        score = self._score(value)
        with self._lock:
            if self._best_score is not None and score >= self._best_score:
                return
            try:
                self._write_atomic(value)
            except Exception as exc:  # noqa: BLE001 — checkpoint I/O must not abort search
                self.report_error_once(exc)
                return
            self._best_score = score

    def finalize(self, result: dict[str, Any]) -> None:
        if not result.get("slot_by_course"):
            return
        value = {**result, "objective_policy": self.objective_policy}
        score = self._score(value)
        with self._lock:
            if self._best_score is not None and score > self._best_score:
                return
            self._write_atomic(value)
            self._best_score = score

    def report_error_once(self, exc: Exception) -> None:
        with self._lock:
            if self._error_reported:
                return
            self._error_reported = True
        emit({"type": "warning", "message": f"Could not write incumbent checkpoint: {exc}"})


class ProgressCallback(cp_model.CpSolverSolutionCallback):
    def __init__(
        self,
        built: BuiltModel,
        phase: str,
        workers: int,
        t0: float,
        gap_trace: list[dict[str, Any]] | None = None,
        *,
        prove_plateau_seconds: float | None = None,
        incumbent_sink: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        super().__init__()
        self._built = built
        self._phase = phase
        self._workers = workers
        self._t0 = t0
        self._gap_trace = gap_trace
        self._incumbent_sink = incumbent_sink
        self._balance_multiplier = balance_objective_multiplier(built)
        self._prove_plateau_seconds = (
            float(prove_plateau_seconds)
            if prove_plateau_seconds is not None and prove_plateau_seconds > 0
            else None
        )
        self.best_clash: int | None = None
        self.best_red: int | None = None
        self.best_balance: int | None = None
        self.best_excess: int | None = None
        self.best_slot_by_course: dict[str, int] | None = None
        self.best_bound: int | None = None
        self.solution_count = 0
        self.last_improve_at = t0
        self.last_bound_improve_at = t0
        self.stopped_for_plateau = False
        self._plateau_stop_issued = False
        self._lock = threading.Lock()

    def _bound_value(self) -> int | None:
        try:
            bound_raw = self.BestObjectiveBound()
        except Exception:  # noqa: BLE001 — callback may be mid-teardown
            return None
        if bound_raw is None or bound_raw >= 2**62:
            return None
        return int(bound_raw)

    def _active_incumbent(self) -> int | None:
        if self._phase == "minimize_clash":
            return self.best_clash
        if self._phase == "minimize_red":
            return self.best_red
        if self._phase == "minimize_balance":
            if self.best_balance is None:
                return None
            return int(self.best_balance) * self._balance_multiplier + int(self.best_excess or 0)
        return self.best_clash

    def _record_gap_sample(self, event: str, snap: dict[str, Any]) -> None:
        if self._gap_trace is None:
            return
        self._gap_trace.append(
            {
                "event": event,
                "phase": snap.get("phase"),
                "elapsed": snap.get("elapsed"),
                "incumbent": snap.get("incumbent"),
                "bound": snap.get("bound"),
                "gap": snap.get("gap"),
                "activity": snap.get("activity"),
                "solutions": snap.get("solutions"),
                "seconds_since_improve": snap.get("seconds_since_improve"),
                "seconds_since_bound_improve": snap.get("seconds_since_bound_improve"),
            }
        )

    def snapshot(self) -> dict[str, Any]:
        # Refresh dual bound during heartbeats — bound often moves while proving
        # with no new incumbent (this was previously stale after the last solution).
        bound = self._bound_value()
        with self._lock:
            if bound is not None:
                if self.best_bound is None or bound > self.best_bound:
                    self.last_bound_improve_at = time.time()
                self.best_bound = bound
            elapsed = time.time() - self._t0
            idle = max(0.0, time.time() - self.last_improve_at)
            bound_idle = max(0.0, time.time() - self.last_bound_improve_at)
            if self.solution_count == 0:
                activity = "searching"
            elif idle >= 1.5:
                activity = "proving"
            else:
                activity = "improving"
            incumbent = self._active_incumbent()
            gap = None
            if incumbent is not None and self.best_bound is not None:
                gap = int(incumbent) - int(self.best_bound)
            snap = {
                "type": "progress",
                "phase": self._phase,
                "phase_label": phase_label(self._phase),
                "best_clash": self.best_clash,
                "best_red": self.best_red,
                "best_balance_l1_scaled": self.best_balance,
                "best_parallel_excess": self.best_excess,
                "incumbent": incumbent,
                "bound": self.best_bound,
                "gap": gap,
                "elapsed": round(elapsed, 3),
                "workers": self._workers,
                "solutions": self.solution_count,
                "activity": activity,
                "seconds_since_improve": round(max(0.0, idle), 3),
                "seconds_since_bound_improve": round(max(0.0, bound_idle), 3),
            }
            # Plateau escape: both incumbent and bound flat long enough while proving.
            if (
                self._prove_plateau_seconds is not None
                and self.solution_count > 0
                and idle >= self._prove_plateau_seconds
                and bound_idle >= self._prove_plateau_seconds
                and gap is not None
                and gap > 0
                and not self.stopped_for_plateau
            ):
                self.stopped_for_plateau = True
                snap["stopped_for_plateau"] = True
            return snap

    def maybe_stop_for_plateau(self) -> bool:
        """Call from heartbeat thread; StopSearch is safe from callback object."""
        with self._lock:
            should = self.stopped_for_plateau and not self._plateau_stop_issued
            if should:
                self._plateau_stop_issued = True
        if should:
            emit(
                {
                    "type": "progress",
                    "event": "plateau_stop",
                    "phase": self._phase,
                    "phase_label": phase_label(self._phase),
                    "message": "Stopping prove: incumbent and bound plateaued",
                }
            )
            self.StopSearch()
            return True
        return False

    def _objective_improved(self, clash: int, red: int, bal: int, excess: int) -> bool:
        """True when the active lex objective strictly improved."""
        if self._phase == "minimize_clash":
            return self.best_clash is None or clash < self.best_clash
        if self._phase == "minimize_red":
            return self.best_red is None or red < self.best_red
        if self._phase == "minimize_balance":
            if self.best_balance is None:
                return True
            soft = bal * self._balance_multiplier + excess
            prev = self.best_balance * self._balance_multiplier + (self.best_excess or 0)
            return soft < prev
        return self.best_clash is None or clash < self.best_clash

    def on_solution_callback(self) -> None:
        clash = int(self.Value(self._built.clash_weight))
        red = int(self.Value(self._built.red_students))
        bal = int(self.Value(self._built.balance_l1))
        excess = int(self.Value(self._built.parallel_excess))
        bound = self._bound_value()
        now = time.time()
        with self._lock:
            self.solution_count += 1
            improved = self._objective_improved(clash, red, bal, excess)
            self.best_clash = clash
            self.best_red = red
            self.best_balance = bal
            self.best_excess = excess
            self.best_slot_by_course = {
                code: int(self.Value(self._built.day[code]))
                for code in self._built.course_codes
            }
            if bound is not None:
                if self.best_bound is None or bound > self.best_bound:
                    self.last_bound_improve_at = now
                self.best_bound = bound
            if improved:
                self.last_improve_at = now
        evt = self.snapshot()
        evt["event"] = "solution"
        emit(evt)
        self._record_gap_sample("solution", evt)
        if self._incumbent_sink is not None:
            red_bound = self.best_bound if self._phase == "minimize_red" else None
            red_gap = (
                None
                if red_bound is None or self.best_red is None
                else self.best_red - red_bound
            )
            proven_levels = (
                ["red_students"]
                if self._phase == "minimize_red"
                and not self.stopped_for_plateau
                and integer_gap_closed(self.best_red, red_bound)
                else []
            )
            self._incumbent_sink(
                {
                    "status": "FEASIBLE",
                    "proven_optimal": bool(proven_levels),
                    "proven_levels": proven_levels,
                    "slot_by_course": self.best_slot_by_course,
                    "clash_weight": clash,
                    "red_students": red,
                    "weekday_balance_l1_scaled": bal,
                    "parallel_excess": excess,
                    "red_bound": red_bound,
                    "red_gap": red_gap,
                    "clash_bound": self.best_bound if self._phase == "minimize_clash" else None,
                    "clash_gap": (
                        None
                        if self._phase != "minimize_clash" or self.best_bound is None
                        else clash - self.best_bound
                    ),
                    "objective_policy": "red-first-v1",
                }
            )


def start_heartbeat(cb: ProgressCallback, stop: threading.Event) -> threading.Thread:
    def loop() -> None:
        while not stop.wait(HEARTBEAT_INTERVAL_S):
            evt = cb.snapshot()
            evt["type"] = "heartbeat"
            evt["event"] = "heartbeat"
            emit(evt)
            cb._record_gap_sample("heartbeat", evt)
            if cb.maybe_stop_for_plateau():
                break

    t = threading.Thread(target=loop, name="cpsat-heartbeat", daemon=True)
    t.start()
    return t


def configure_solver(
    time_limit: float | None,
    workers: int,
    seed: int | None = None,
    *,
    prove_mode: bool = False,
    prove_strategy: str = "core",
    absolute_gap: float | None = None,
) -> cp_model.CpSolver:
    """Configure CP-SAT.

    When ``seed`` is set, enables interleaved deterministic multi-worker search
    (``interleave_search``) so the same seed + workers yield the same trajectory
    absent wall-clock escapes.

    prove_strategy (only when prove_mode=True):
      - ``stock``: default OR-Tools 9.15 portfolio (no extra global flags)
      - ``core``: ``optimize_with_core`` only (the live non-default knob)
      - ``core_linear``: core + ``linearization_level=2`` (previous UniSlot default)

    Do not set probing/symmetry/find_multiple_cores: those are already 9.15 defaults
    and broadcasting them can collapse internal subsolver diversity.
    """
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = max(1, workers)
    solver.parameters.log_search_progress = False
    solver.parameters.cp_model_presolve = True
    if time_limit is not None and time_limit > 0:
        solver.parameters.max_time_in_seconds = float(time_limit)
    if seed is not None and seed >= 0:
        # random_seed alone is not enough for multi-worker determinism;
        # interleave_search makes the portfolio search reproducible.
        n_workers = max(1, workers)
        solver.parameters.random_seed = int(seed)
        solver.parameters.interleave_search = True
        solver.parameters.interleave_batch_size = max(1, n_workers * 2)
        solver.parameters.share_binary_clauses = False
    if absolute_gap is not None and absolute_gap >= 0:
        solver.parameters.absolute_gap_limit = float(absolute_gap)
    if prove_mode:
        strategy = (prove_strategy or "core").strip().lower()
        if strategy == "stock":
            pass
        elif strategy == "core_linear":
            solver.parameters.optimize_with_core = True
            solver.parameters.linearization_level = 2
        else:
            # "core" and unknown values: core only, keep the rest of the portfolio stock.
            solver.parameters.optimize_with_core = True
    return solver


def extract_assignment(built: BuiltModel, solver: cp_model.CpSolver) -> dict[str, int]:
    return {code: int(solver.Value(built.day[code])) for code in built.course_codes}


def rehint_incumbent(built: BuiltModel, slot_by_course: dict[str, int]) -> None:
    """Re-seed hints from the current incumbent before the next lex phase."""
    built.model.ClearHints()
    n = apply_hints(built.model, built.day, slot_by_course)
    if n:
        emit(
            {
                "type": "phase",
                "phase": "rehint",
                "phase_label": f"Warm-starting next phase · {n} course hints",
                "workers": 0,
            }
        )


def solve_with_progress(
    built: BuiltModel,
    phase: str,
    *,
    time_limit: float | None,
    workers: int,
    t0: float,
    seed: int | None = None,
    gap_trace: list[dict[str, Any]] | None = None,
    prove_mode: bool = False,
    prove_strategy: str = "core",
    absolute_gap: float | None = None,
    prove_plateau_seconds: float | None = None,
    apply_prove_controls: bool = False,
    deadline: float | None = None,
    incumbent_sink: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[int, cp_model.CpSolver, ProgressCallback]:
    validate_time_limit(time_limit)
    emit(
        {
            "type": "phase",
            "phase": phase,
            "phase_label": phase_label(phase),
            "workers": workers,
            "elapsed": round(time.time() - t0, 3),
            "prove_mode": prove_mode,
            "prove_strategy": prove_strategy if prove_mode else None,
        }
    )
    solver = configure_solver(
        time_limit,
        workers,
        seed=seed,
        prove_mode=prove_mode,
        prove_strategy=prove_strategy,
        absolute_gap=absolute_gap if apply_prove_controls else None,
    )
    plateau = prove_plateau_seconds if apply_prove_controls else None
    cb = ProgressCallback(
        built,
        phase,
        workers,
        t0,
        gap_trace=gap_trace,
        prove_plateau_seconds=plateau,
        incumbent_sink=incumbent_sink,
    )
    stop = threading.Event()
    start_heartbeat(cb, stop)
    try:
        if deadline is not None:
            remaining = max(0.0, deadline - time.monotonic())
            if remaining <= 0:
                status = cp_model.UNKNOWN
            else:
                solver.parameters.max_time_in_seconds = remaining
                status = solver.Solve(built.model, cb)
        else:
            status = solver.Solve(built.model, cb)
    finally:
        stop.set()
    # Plateau StopSearch often surfaces as FEASIBLE / UNKNOWN with an incumbent.
    if cb.stopped_for_plateau and status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if cb._active_incumbent() is not None:
            status = cp_model.FEASIBLE
    final = cb.snapshot()
    final["type"] = "progress"
    final["event"] = "phase_end"
    final["solver_status"] = status_name(status)
    final["proven"] = bool(
        not cb.stopped_for_plateau
        and integer_gap_closed(cb._active_incumbent(), cb.best_bound)
    )
    if cb.stopped_for_plateau:
        final["stopped_for_plateau"] = True
    emit(final)
    cb._record_gap_sample("phase_end", final)
    return status, solver, cb


def analyze_gap_trace(
    samples: list[dict[str, Any]], *, primary_phase: str = "minimize_red"
) -> dict[str, Any]:
    """Classify prove behavior for the selected primary phase."""
    primary = [s for s in samples if s.get("phase") == primary_phase]
    if not primary:
        label = "clash" if primary_phase == "minimize_clash" else "primary"
        return {"diagnosis": f"no_{label}_phase_samples", "samples": len(samples)}

    first_sol = next((s for s in primary if s.get("event") == "solution"), None)
    last = primary[-1]
    incumbents = [s["incumbent"] for s in primary if s.get("incumbent") is not None]
    bounds = [s["bound"] for s in primary if s.get("bound") is not None]
    gaps = [s["gap"] for s in primary if s.get("gap") is not None]

    first_inc = incumbents[0] if incumbents else None
    final_inc = incumbents[-1] if incumbents else None
    first_bound = bounds[0] if bounds else None
    final_bound = bounds[-1] if bounds else None
    final_gap = gaps[-1] if gaps else None
    total_elapsed = float(last.get("elapsed") or 0)

    # Longest stretch where incumbent flat but gap > 0 (bound-stuck prove).
    max_prove_stretch = 0.0
    stretch_start = None
    for s in primary:
        gap = s.get("gap")
        act = s.get("activity")
        elapsed = float(s.get("elapsed") or 0)
        if gap is not None and gap > 0 and act == "proving":
            if stretch_start is None:
                stretch_start = elapsed
            max_prove_stretch = max(max_prove_stretch, elapsed - stretch_start)
        else:
            stretch_start = None

    bound_moved = (
        first_bound is not None
        and final_bound is not None
        and final_bound > first_bound
    )
    incumbent_improved = (
        first_inc is not None
        and final_inc is not None
        and final_inc < first_inc
    )

    # Late-window: last 40% of wall time (or last 10s) — what users feel as "stuck proving".
    late_cut = max(0.0, total_elapsed - max(10.0, 0.4 * total_elapsed))
    late = [s for s in primary if float(s.get("elapsed") or 0) >= late_cut]
    late_bounds = [s["bound"] for s in late if s.get("bound") is not None]
    late_incs = [s["incumbent"] for s in late if s.get("incumbent") is not None]
    late_bound_flat = (
        len(late_bounds) >= 2 and max(late_bounds) == min(late_bounds)
    )
    late_inc_flat = len(late_incs) >= 2 and max(late_incs) == min(late_incs)
    late_gap = late[-1].get("gap") if late else None

    if final_gap is not None and final_gap <= 0:
        diagnosis = "gap_closed"
    elif (
        late_gap is not None
        and late_gap > 0
        and late_bound_flat
        and late_inc_flat
        and max_prove_stretch >= 5.0
    ):
        # Classic UniSlot prove stall: good incumbent, dual barely moves.
        diagnosis = "bound_stuck"
    elif bound_moved and not incumbent_improved and final_gap is not None and final_gap > 0:
        diagnosis = "bound_closing_slowly"
    elif incumbent_improved and final_gap is not None and final_gap > 0:
        diagnosis = "still_improving_incumbent"
    elif not bound_moved and final_gap is not None and final_gap > 0:
        diagnosis = "bound_stuck"
    else:
        diagnosis = "inconclusive"

    return {
        "diagnosis": diagnosis,
        "phase": primary_phase,
        "primary_samples": len(primary),
        "red_samples": sum(s.get("phase") == "minimize_red" for s in samples),
        "clash_samples": sum(s.get("phase") == "minimize_clash" for s in samples),
        "first_solution_elapsed": first_sol.get("elapsed") if first_sol else None,
        "first_incumbent": first_inc,
        "final_incumbent": final_inc,
        "first_bound": first_bound,
        "final_bound": final_bound,
        "final_gap": final_gap,
        "incumbent_improved": incumbent_improved,
        "bound_moved": bound_moved,
        "late_bound_flat": late_bound_flat,
        "late_incumbent_flat": late_inc_flat,
        "max_proving_stretch_seconds": round(max_prove_stretch, 3),
        "phase_end_status": last.get("event"),
    }


def solve_lex(
    built: BuiltModel,
    *,
    time_limit: float | None,
    workers: int,
    seed: int | None = None,
    clash_only: bool = False,
    primary_only: bool = False,
    gap_trace: list[dict[str, Any]] | None = None,
    absolute_gap: float | None = None,
    prove_plateau_seconds: float | None = None,
    full_prove: bool = False,
    prove_strategy: str = "core",
    deadline: float | None = None,
    incumbent_sink: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    validate_time_limit(time_limit)
    t0 = time.time()
    if deadline is None and time_limit is not None:
        deadline = time.monotonic() + max(0.0, float(time_limit))
    proven_levels: list[str] = []
    last_status = cp_model.UNKNOWN
    slot_by_course: dict[str, int] = {}
    timings: dict[str, float] = {}
    clash_bound: int | None = None
    clash_gap: int | None = None
    # Clash-only diagnostics without prove controls: primal-first params.
    # Dedicated prove / clash-only with explicit escapes: dual-oriented params.
    escape_requested = (
        (prove_plateau_seconds is not None and prove_plateau_seconds > 0)
        or (absolute_gap is not None and absolute_gap >= 0)
        or full_prove
    )
    clash_prove_mode = (not clash_only) or escape_requested
    clash_plateau = prove_plateau_seconds
    clash_abs_gap = absolute_gap

    def phase_limit() -> float | None:
        if deadline is None:
            return None
        return max(0.0, deadline - time.monotonic())

    def deadline_expired() -> bool:
        limit = phase_limit()
        return limit is not None and limit <= 0

    def callback_incumbent(callback: ProgressCallback | None) -> dict[str, Any] | None:
        if callback is None or not callback.best_slot_by_course:
            return None
        return {
            "slot_by_course": callback.best_slot_by_course,
            "clash_weight": callback.best_clash,
            "red_students": callback.best_red,
            "weekday_balance_l1_scaled": callback.best_balance,
            "parallel_excess": callback.best_excess,
        }

    def lex_score(candidate: dict[str, Any]) -> tuple[int, int, int, int]:
        return (
            int(candidate["red_students"]),
            int(candidate["clash_weight"]),
            int(candidate["weekday_balance_l1_scaled"]),
            int(candidate["parallel_excess"]),
        )

    if built.bound_notes:
        emit(
            {
                "type": "phase",
                "phase": "bound_cuts",
                "phase_label": "Injecting structural clash lower-bound cuts",
                "workers": 0,
                "notes": built.bound_notes[:5],
            }
        )

    # Primary phase: minimize the count of unique students with any clash.
    if not clash_only:
        built.model.Minimize(built.red_students)
        red_t0 = time.time()
        if deadline_expired():
            return {
                "status": "UNKNOWN", "proven_optimal": False,
                "proven_levels": [], "slot_by_course": {},
                "clash_weight": None, "red_students": None,
                "weekday_balance_l1_scaled": None, "parallel_excess": None,
                "red_bound": None, "red_gap": None,
                "clash_bound": None, "clash_gap": None,
                "solver_time_seconds": round(time.time() - t0, 4),
                "num_workers": workers, "timings": timings,
                "message": "Deadline expired before a feasible RED incumbent was found.",
                "objective_policy": "red-first-v1",
            }
        last_status, solver, red_cb = solve_with_progress(
            built,
            "minimize_red",
            time_limit=phase_limit(),
            workers=workers,
            t0=t0,
            seed=seed,
            gap_trace=gap_trace,
            prove_mode=True,
            prove_strategy=prove_strategy,
            absolute_gap=absolute_gap,
            prove_plateau_seconds=prove_plateau_seconds,
            apply_prove_controls=True,
            deadline=deadline,
            incumbent_sink=incumbent_sink,
        )
        timings["minimize_red_seconds"] = round(time.time() - red_t0, 4)
        if last_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            fallback = callback_incumbent(red_cb)
            if fallback is not None:
                red_bound = solver_best_bound(solver)
                red_gap = None if red_bound is None else fallback["red_students"] - red_bound
                if not red_cb.stopped_for_plateau and integer_gap_closed(fallback["red_students"], red_bound):
                    proven_levels.append("red_students")
                return {
                    **fallback, "status": "FEASIBLE",
                    "proven_optimal": "red_students" in proven_levels,
                    "proven_levels": proven_levels,
                    "red_bound": red_bound, "red_gap": red_gap,
                    "clash_bound": None, "clash_gap": None,
                    "solver_time_seconds": round(time.time() - t0, 4),
                    "num_workers": workers, "timings": timings,
                    "objective_policy": "red-first-v1",
                    "message": "Deadline returned the best feasible RED-phase incumbent.",
                }
            return {
                "status": status_name(last_status), "proven_optimal": False,
                "proven_levels": [], "slot_by_course": {},
                "clash_weight": None, "red_students": None,
                "weekday_balance_l1_scaled": None, "parallel_excess": None,
                "red_bound": solver_best_bound(solver), "red_gap": None,
                "clash_bound": None, "clash_gap": None,
                "solver_time_seconds": round(time.time() - t0, 4),
                "num_workers": workers, "timings": timings,
                "message": solver.ResponseStats(),
                "objective_policy": "red-first-v1",
            }
        red_opt = int(solver.Value(built.red_students))
        slot_by_course = extract_assignment(built, solver)
        red_bound = solver_best_bound(solver)
        red_gap = None if red_bound is None else red_opt - int(red_bound)
        red_plateau = bool(red_cb.stopped_for_plateau)
        red_incumbent = {
            "slot_by_course": slot_by_course,
            "clash_weight": int(solver.Value(built.clash_weight)),
            "red_students": red_opt,
            "weekday_balance_l1_scaled": int(solver.Value(built.balance_l1)),
            "parallel_excess": int(solver.Value(built.parallel_excess)),
        }
        if not red_plateau and integer_gap_closed(red_opt, red_bound):
            proven_levels.append("red_students")
        rehint_incumbent(built, slot_by_course)
        built.model.ClearObjective()
        built.model.Add(built.red_students == red_opt)
        if primary_only:
            return {
                "status": "FEASIBLE",
                "proven_optimal": "red_students" in proven_levels,
                "proven_levels": proven_levels, "slot_by_course": slot_by_course,
                "clash_weight": int(solver.Value(built.clash_weight)),
                "red_students": red_opt,
                "weekday_balance_l1_scaled": int(solver.Value(built.balance_l1)),
                "parallel_excess": int(solver.Value(built.parallel_excess)),
                "red_bound": red_bound, "red_gap": red_gap,
                "clash_bound": None, "clash_gap": None,
                "solver_time_seconds": round(time.time() - t0, 4),
                "num_workers": workers, "timings": timings,
                "message": "RED-primary incumbent returned before tie-break phases.",
                "objective_policy": "red-first-v1",
            }

    # Secondary phase: minimize clash weight while preserving minimum RED.
    if not clash_only and red_incumbent is not None:
        # The known feasible incumbent supplies a safe upper bound, preventing
        # a time-limited tie-break phase from returning a worse pair cost.
        built.model.Add(built.clash_weight <= int(red_incumbent["clash_weight"]))
    built.model.Minimize(built.clash_weight)
    clash_t0 = time.time()
    if deadline_expired():
        last_status, solver, cb = cp_model.UNKNOWN, None, None
    else:
        last_status, solver, cb = solve_with_progress(
        built,
        "minimize_clash",
        time_limit=phase_limit(),
        workers=workers,
        t0=t0,
        seed=seed,
        gap_trace=gap_trace,
        prove_mode=clash_prove_mode,
        prove_strategy=prove_strategy,
        absolute_gap=clash_abs_gap,
        prove_plateau_seconds=clash_plateau,
        apply_prove_controls=clash_only,
        deadline=deadline,
        incumbent_sink=incumbent_sink,
        )
    timings["minimize_clash_seconds"] = round(time.time() - clash_t0, 4)
    if last_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        fallback = red_incumbent if not clash_only else None
        observed = callback_incumbent(cb)
        if observed is not None and (fallback is None or lex_score(observed) < lex_score(fallback)):
            fallback = observed
        fallback_clash_bound = (
            solver_best_bound(solver)
            if solver is not None
            else (cb.best_bound if cb is not None else None)
        )
        fallback_clash_gap = (
            None
            if fallback is None or fallback_clash_bound is None
            else int(fallback["clash_weight"]) - int(fallback_clash_bound)
        )
        if (
            fallback is not None
            and cb is not None
            and not cb.stopped_for_plateau
            and integer_gap_closed(fallback["clash_weight"], fallback_clash_bound)
        ):
            proven_levels.append("clash_weight")
        return {
            "status": "FEASIBLE" if fallback else status_name(last_status),
            "proven_optimal": bool(fallback and "red_students" in proven_levels),
            "proven_levels": proven_levels,
            "slot_by_course": fallback["slot_by_course"] if fallback else {},
            "clash_weight": fallback["clash_weight"] if fallback else None,
            "red_students": fallback["red_students"] if fallback else None,
            "weekday_balance_l1_scaled": fallback["weekday_balance_l1_scaled"] if fallback else None,
            "parallel_excess": fallback["parallel_excess"] if fallback else None,
            "red_bound": red_bound if not clash_only else None,
            "red_gap": red_gap if not clash_only else None,
            "clash_bound": fallback_clash_bound,
            "clash_gap": fallback_clash_gap,
            "solver_time_seconds": round(time.time() - t0, 4),
            "num_workers": workers,
            "timings": timings,
            "message": solver.ResponseStats() if solver is not None else "Deadline expired before the clash phase.",
            "objective_policy": "red-first-v1" if not clash_only else "clash-only",
        }

    phase_clash = {
        "slot_by_course": extract_assignment(built, solver),
        "clash_weight": int(solver.Value(built.clash_weight)),
        "red_students": int(solver.Value(built.red_students)),
        "weekday_balance_l1_scaled": int(solver.Value(built.balance_l1)),
        "parallel_excess": int(solver.Value(built.parallel_excess)),
    }
    clash_incumbent = lex_best(red_incumbent, phase_clash) if not clash_only else phase_clash
    clash_opt = int(clash_incumbent["clash_weight"])
    slot_by_course = clash_incumbent["slot_by_course"]
    red_at_clash = int(clash_incumbent["red_students"])
    bal_at_clash = int(clash_incumbent["weekday_balance_l1_scaled"])
    excess_at_clash = int(clash_incumbent["parallel_excess"])
    plateau_stopped = bool(cb.stopped_for_plateau)
    clash_bound = solver_best_bound(solver)
    if clash_bound is None:
        clash_bound = cb.best_bound
    clash_gap = None if clash_bound is None else int(clash_opt) - int(clash_bound)
    # Certificate from integer gap, never from CP-SAT OPTIMAL alone (gap-limit false positive).
    if (
        int(phase_clash["clash_weight"]) == clash_opt
        and (not plateau_stopped)
        and integer_gap_closed(clash_opt, clash_bound)
    ):
        proven_levels.append("clash_weight")

    if clash_only:
        msg = (
            "Pair-clash diagnostic minimum proven."
            if "clash_weight" in proven_levels
            else (
                "Clash prove stopped on incumbent/bound plateau."
                if plateau_stopped
                else "Clash-only diagnostic result."
            )
        )
        return {
            "status": status_name(last_status),
            "proven_optimal": False,
            "proven_levels": proven_levels,
            "slot_by_course": slot_by_course,
            "clash_weight": clash_opt,
            "red_students": red_at_clash,
            "weekday_balance_l1_scaled": bal_at_clash,
            "parallel_excess": excess_at_clash,
            "clash_bound": clash_bound,
            "clash_gap": clash_gap,
            "solver_time_seconds": round(time.time() - t0, 4),
            "num_workers": workers,
            "stopped_for_plateau": plateau_stopped,
            "timings": timings,
            "message": msg,
            "objective_policy": "clash-only",
        }

    # Phase 3: balance + parallel soft, with RED and clash objectives fixed.
    built.model.ClearObjective()
    built.model.Add(built.clash_weight == clash_opt)
    built.model.Add(built.red_students == red_opt)
    rehint_incumbent(built, slot_by_course)
    balance_multiplier = balance_objective_multiplier(built)
    soft = built.balance_l1 * balance_multiplier + built.parallel_excess
    built.model.Add(
        soft
        <= bal_at_clash * balance_multiplier + excess_at_clash
    )
    built.model.Minimize(soft)
    bal_t0 = time.time()
    if deadline_expired():
        last_status, solver, cb = cp_model.UNKNOWN, None, None
    else:
        last_status, solver, cb = solve_with_progress(
            built,
            "minimize_balance",
            time_limit=phase_limit(),
            workers=workers,
            t0=t0,
            seed=None if seed is None else seed + 2,
            gap_trace=gap_trace,
            deadline=deadline,
            incumbent_sink=incumbent_sink,
        )
    timings["minimize_balance_seconds"] = round(time.time() - bal_t0, 4)

    if last_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        phase_balance = {
            "slot_by_course": extract_assignment(built, solver),
            "clash_weight": int(solver.Value(built.clash_weight)),
            "red_students": int(solver.Value(built.red_students)),
            "weekday_balance_l1_scaled": int(solver.Value(built.balance_l1)),
            "parallel_excess": int(solver.Value(built.parallel_excess)),
        }
        chosen = lex_best(clash_incumbent, phase_balance)
        slot_by_course = chosen["slot_by_course"]
        bal = int(chosen["weekday_balance_l1_scaled"])
        excess = int(chosen["parallel_excess"])
        soft_inc = int(bal) * balance_multiplier + int(excess)
        if (
            soft_inc == bal * balance_multiplier + excess
            and integer_gap_closed(soft_inc, solver_best_bound(solver))
        ):
            proven_levels.append("balance_and_parallel")
        final_status = (
            "OPTIMAL"
            if (
                "clash_weight" in proven_levels
                and "red_students" in proven_levels
                and "balance_and_parallel" in proven_levels
            )
            else "FEASIBLE"
        )
    else:
        observed = callback_incumbent(cb)
        if observed is not None and lex_score(observed) < lex_score({
            "red_students": red_opt,
            "clash_weight": clash_opt,
            "weekday_balance_l1_scaled": bal_at_clash,
            "parallel_excess": excess_at_clash,
        }):
            slot_by_course = observed["slot_by_course"]
            bal = observed["weekday_balance_l1_scaled"]
            excess = observed["parallel_excess"]
        else:
            bal = bal_at_clash
            excess = excess_at_clash
        final_status = "FEASIBLE"

    primary_proven = "red_students" in proven_levels
    primary_plateau_stopped = red_plateau
    full_lex = (
        "red_students" in proven_levels
        and "clash_weight" in proven_levels
        and "balance_and_parallel" in proven_levels
    )

    if full_lex:
        message = (
            "Full lex optimal under the course→weekday CP-SAT model "
            "(RED, clash, and balance/parallel all proven minimal)."
        )
    elif primary_proven:
        message = (
            "Minimum RED count proven under the course→weekday CP-SAT model."
        )
    elif primary_plateau_stopped:
        message = (
            "Best feasible schedule shipped after RED prove plateau "
            "(incumbent and dual bound both flat)."
        )
    else:
        message = "Best feasible solution found (minimum RED count not fully proven)."

    return {
        "status": "OPTIMAL" if full_lex else "FEASIBLE",
        "proven_optimal": primary_proven,
        "proven_levels": proven_levels,
        "slot_by_course": slot_by_course,
        "clash_weight": clash_opt,
        "red_students": red_opt,
        "weekday_balance_l1_scaled": bal,
        "parallel_excess": excess,
        "clash_bound": clash_bound,
        "clash_gap": clash_gap,
        "red_bound": red_bound,
        "red_gap": red_gap,
        "solver_time_seconds": round(time.time() - t0, 4),
        "num_workers": workers,
        "stopped_for_plateau": primary_plateau_stopped,
        "timings": timings,
        "message": message,
        "objective_policy": "red-first-v1",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="UniSlot CP-SAT weekday coloring solver")
    parser.add_argument("--instance", required=True, help="Path to instance JSON")
    parser.add_argument("--output", required=True, help="Path to write solution JSON")
    parser.add_argument(
        "--time-limit",
        type=float,
        default=None,
        help="Optional wall-clock limit in seconds (escape hatch only)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=0,
        help="CP-SAT search workers (0 = all CPUs)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=-1,
        help="CP-SAT random seed (-1 = solver default)",
    )
    parser.add_argument(
        "--clash-only",
        action="store_true",
        help="Run the legacy pair-clash diagnostic and stop before RED/balance phases.",
    )
    parser.add_argument(
        "--primary-only",
        action="store_true",
        help="Stop after the primary minimum-RED phase; skip all tie-breakers.",
    )
    parser.add_argument(
        "--gap-trace",
        default=None,
        help="Write NDJSON incumbent/bound/gap samples for prove diagnosis",
    )
    parser.add_argument(
        "--absolute-gap",
        type=float,
        default=None,
        help="Stop the active primary prove phase when incumbent−bound ≤ this (CP-SAT absolute_gap_limit)",
    )
    parser.add_argument(
        "--prove-plateau",
        type=float,
        default=None,
        help="Stop the active primary prove phase when incumbent and bound are both flat for N seconds",
    )
    parser.add_argument(
        "--prove",
        action="store_true",
        help="Disable plateau/gap escapes; chase a full primary objective certificate",
    )
    parser.add_argument(
        "--prove-strategy",
        choices=("core", "stock", "core_linear"),
        default="core",
        help="Primary-prove CP-SAT portfolio: stock, core (default), or core+linearization=2",
    )
    args = parser.parse_args()

    workers = args.workers if args.workers > 0 else (os.cpu_count() or 1)
    seed = args.seed if args.seed >= 0 else None
    deadline = (
        time.monotonic() + max(0.0, float(args.time_limit))
        if args.time_limit is not None
        else None
    )
    checkpoint = (
        IncumbentCheckpoint(
            args.output,
            "clash-only" if args.clash_only else "red-first-v1",
        )
        if args.time_limit is not None
        else None
    )
    with open(args.instance, encoding="utf-8") as f:
        instance = json.load(f)

    tc = toolchain_info()
    emit({"type": "toolchain", **tc})
    emit(
        {
            "type": "start",
            "workers": workers,
            "courses": len(instance.get("courses") or []),
            "edges": len(instance.get("conflict_edges") or []),
            "students": len(instance.get("students") or []),
            "seed": seed,
            "clash_only": bool(args.clash_only),
            "primary_only": bool(args.primary_only),
            "absolute_gap": args.absolute_gap,
            "prove_plateau": args.prove_plateau,
            "full_prove": bool(args.prove),
            "prove_strategy": args.prove_strategy,
            **tc,
        }
    )
    try:
        build_t0 = time.time()
        built = build_model(instance)
        model_build_seconds = round(time.time() - build_t0, 4)
        stats = model_stats(built.model)
    except Exception as exc:  # noqa: BLE001 — surface to parent CLI
        err = {"status": "MODEL_INVALID", "error": str(exc), "proven_optimal": False}
        with open(args.output, "w", encoding="utf-8") as out:
            json.dump(err, out, indent=2)
        emit({"type": "error", "message": str(exc)})
        return 2

    emit(
        {
            "type": "model_ready",
            "elapsed": model_build_seconds,
            "courses": len(built.course_codes),
            "variables": stats["variables"],
            "constraints": stats["constraints"],
        }
    )
    gap_samples: list[dict[str, Any]] | None = [] if args.gap_trace else None
    absolute_gap = None if args.prove else args.absolute_gap
    prove_plateau = None if args.prove else args.prove_plateau
    try:
        result = solve_lex(
            built,
            time_limit=args.time_limit,
            workers=workers,
            seed=seed,
            clash_only=bool(args.clash_only),
            primary_only=bool(args.primary_only),
            gap_trace=gap_samples,
            absolute_gap=absolute_gap,
            prove_plateau_seconds=prove_plateau,
            full_prove=bool(args.prove),
            prove_strategy=args.prove_strategy,
            deadline=deadline,
            incumbent_sink=checkpoint,
        )
    except Exception as exc:  # noqa: BLE001 — always leave the parent CLI a readable file
        detail = traceback.format_exc()
        err = {
            "status": "SOLVER_ERROR",
            "error": str(exc),
            "traceback": detail,
            "proven_optimal": False,
            "slot_by_course": {},
        }
        with open(args.output, "w", encoding="utf-8") as out:
            json.dump(err, out, indent=2)
        emit({"type": "error", "message": str(exc), "traceback": detail})
        return 3
    if checkpoint is not None:
        try:
            checkpoint.finalize(result)
        except Exception as exc:  # noqa: BLE001 — retain the solver result if checkpoint I/O fails
            checkpoint.report_error_once(exc)
    result.setdefault("timings", {})
    result["timings"]["model_build_seconds"] = model_build_seconds
    result["model_stats"] = stats
    emit(
        {
            "type": "profile",
            "timings": result.get("timings"),
            "model_stats": stats,
            "clash_bound": result.get("clash_bound"),
            "clash_gap": result.get("clash_gap"),
            "red_bound": result.get("red_bound"),
            "red_gap": result.get("red_gap"),
            "objective_policy": result.get("objective_policy"),
        }
    )
    if gap_samples is not None and args.gap_trace:
        analysis = analyze_gap_trace(
            gap_samples,
            primary_phase="minimize_clash" if args.clash_only else "minimize_red",
        )
        result["gap_analysis"] = analysis
        with open(args.gap_trace, "w", encoding="utf-8") as gt:
            for row in gap_samples:
                gt.write(json.dumps(row, separators=(",", ":")) + "\n")
            gt.write(json.dumps({"event": "analysis", **analysis}, separators=(",", ":")) + "\n")
        emit({"type": "gap_analysis", **analysis})
    with open(args.output, "w", encoding="utf-8") as out:
        result = {**result, **tc}
        json.dump(result, out, indent=2)
    emit(
        {
            "type": "done",
            **{
                k: result.get(k)
                for k in (
                    "status",
                    "clash_weight",
                    "red_students",
                    "proven_optimal",
                    "stopped_for_plateau",
                    "clash_bound",
                    "clash_gap",
                    "red_bound",
                    "red_gap",
                    "objective_policy",
                )
            },
            **tc,
        }
    )
    return 0 if result.get("slot_by_course") else 1


if __name__ == "__main__":
    raise SystemExit(main())
