#!/usr/bin/env python3
"""CLI entry for UniSlot CP-SAT solver.

Reads instance JSON from --instance, writes solution JSON to --output.
Progress events are emitted as NDJSON on stderr (solutions + heartbeats).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import traceback
from typing import Any

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


def phase_label(phase: str) -> str:
    return {
        "minimize_clash": "1/3 Minimizing clashes",
        "minimize_red": "2/3 Minimizing RED students",
        "minimize_balance": "3/3 Balancing weekdays",
    }.get(phase, phase)


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
    ) -> None:
        super().__init__()
        self._built = built
        self._phase = phase
        self._workers = workers
        self._t0 = t0
        self._gap_trace = gap_trace
        self._prove_plateau_seconds = (
            float(prove_plateau_seconds)
            if prove_plateau_seconds is not None and prove_plateau_seconds > 0
            else None
        )
        self.best_clash: int | None = None
        self.best_red: int | None = None
        self.best_balance: int | None = None
        self.best_excess: int | None = None
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
            return int(self.best_balance) * (10**6) + int(self.best_excess or 0)
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
            soft = bal * (10**6) + excess
            prev = self.best_balance * (10**6) + (self.best_excess or 0)
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
    absolute_gap: float | None = None,
) -> cp_model.CpSolver:
    """Configure CP-SAT.

    When ``seed`` is set, enables interleaved deterministic multi-worker search
    (``interleave_search``) so the same seed + workers yield the same trajectory
    absent wall-clock escapes.

    prove_mode enables MaxSAT-core + stronger linearization aimed at dual-bound
    closing on weighted Boolean objectives (clash phase). Portfolio race members
    keep prove_mode=False for faster primal search.
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
        # Weighted sum of Booleans → unsat-core LB stepping often beats weak LP.
        solver.parameters.optimize_with_core = True
        solver.parameters.find_multiple_cores = True
        # Stronger LP cuts for reified same-day constraints (still keep portfolio).
        solver.parameters.linearization_level = 2
        solver.parameters.cp_model_probing_level = 2
        solver.parameters.symmetry_level = 2
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
    absolute_gap: float | None = None,
    prove_plateau_seconds: float | None = None,
) -> tuple[int, cp_model.CpSolver, ProgressCallback]:
    emit(
        {
            "type": "phase",
            "phase": phase,
            "phase_label": phase_label(phase),
            "workers": workers,
            "elapsed": round(time.time() - t0, 3),
            "prove_mode": prove_mode,
        }
    )
    solver = configure_solver(
        time_limit,
        workers,
        seed=seed,
        prove_mode=prove_mode,
        absolute_gap=absolute_gap if phase == "minimize_clash" else None,
    )
    plateau = prove_plateau_seconds if phase == "minimize_clash" else None
    cb = ProgressCallback(
        built,
        phase,
        workers,
        t0,
        gap_trace=gap_trace,
        prove_plateau_seconds=plateau,
    )
    stop = threading.Event()
    start_heartbeat(cb, stop)
    try:
        status = solver.Solve(built.model, cb)
    finally:
        stop.set()
    # Plateau StopSearch often surfaces as FEASIBLE / UNKNOWN with an incumbent.
    if cb.stopped_for_plateau and status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if cb.best_clash is not None:
            status = cp_model.FEASIBLE
    final = cb.snapshot()
    final["type"] = "progress"
    final["event"] = "phase_end"
    final["solver_status"] = status_name(status)
    if cb.stopped_for_plateau:
        final["stopped_for_plateau"] = True
    emit(final)
    cb._record_gap_sample("phase_end", final)
    return status, solver, cb


def analyze_gap_trace(samples: list[dict[str, Any]]) -> dict[str, Any]:
    """Classify prove behavior from incumbent/bound time series."""
    clash = [s for s in samples if s.get("phase") == "minimize_clash"]
    if not clash:
        return {"diagnosis": "no_clash_phase_samples", "samples": len(samples)}

    first_sol = next((s for s in clash if s.get("event") == "solution"), None)
    last = clash[-1]
    incumbents = [s["incumbent"] for s in clash if s.get("incumbent") is not None]
    bounds = [s["bound"] for s in clash if s.get("bound") is not None]
    gaps = [s["gap"] for s in clash if s.get("gap") is not None]

    first_inc = incumbents[0] if incumbents else None
    final_inc = incumbents[-1] if incumbents else None
    first_bound = bounds[0] if bounds else None
    final_bound = bounds[-1] if bounds else None
    final_gap = gaps[-1] if gaps else None
    total_elapsed = float(last.get("elapsed") or 0)

    # Longest stretch where incumbent flat but gap > 0 (bound-stuck prove).
    max_prove_stretch = 0.0
    stretch_start = None
    for s in clash:
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
    late = [s for s in clash if float(s.get("elapsed") or 0) >= late_cut]
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
        "clash_samples": len(clash),
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
    gap_trace: list[dict[str, Any]] | None = None,
    absolute_gap: float | None = None,
    prove_plateau_seconds: float | None = None,
    full_prove: bool = False,
) -> dict[str, Any]:
    t0 = time.time()
    remaining = time_limit
    proven_levels: list[str] = []
    last_status = cp_model.UNKNOWN
    slot_by_course: dict[str, int] = {}
    # Portfolio race (clash_only, no escapes): primal-first params.
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
        if remaining is None:
            return None
        return max(0.1, remaining)

    def consume(elapsed_phase: float) -> None:
        nonlocal remaining
        if remaining is not None:
            remaining = max(0.0, remaining - elapsed_phase)

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

    # Phase 1: minimize clash weight
    built.model.Minimize(built.clash_weight)
    last_status, solver, cb = solve_with_progress(
        built,
        "minimize_clash",
        time_limit=phase_limit(),
        workers=workers,
        t0=t0,
        seed=seed,
        gap_trace=gap_trace,
        prove_mode=clash_prove_mode,
        absolute_gap=clash_abs_gap,
        prove_plateau_seconds=clash_plateau,
    )
    consume(solver.WallTime())
    if last_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": status_name(last_status),
            "proven_optimal": False,
            "proven_levels": proven_levels,
            "slot_by_course": {},
            "clash_weight": None,
            "red_students": None,
            "weekday_balance_l1_scaled": None,
            "parallel_excess": None,
            "solver_time_seconds": round(time.time() - t0, 4),
            "num_workers": workers,
            "message": solver.ResponseStats(),
        }

    clash_opt = int(solver.Value(built.clash_weight))
    slot_by_course = extract_assignment(built, solver)
    red_at_clash = int(solver.Value(built.red_students))
    bal_at_clash = int(solver.Value(built.balance_l1))
    excess_at_clash = int(solver.Value(built.parallel_excess))
    plateau_stopped = bool(cb.stopped_for_plateau)
    if last_status == cp_model.OPTIMAL and not plateau_stopped:
        proven_levels.append("clash_weight")

    if clash_only:
        msg = (
            "Clash weight proven in portfolio race member."
            if "clash_weight" in proven_levels
            else (
                "Clash prove stopped on incumbent/bound plateau."
                if plateau_stopped
                else "Clash-only portfolio race result."
            )
        )
        return {
            "status": status_name(last_status),
            "proven_optimal": "clash_weight" in proven_levels,
            "proven_levels": proven_levels,
            "slot_by_course": slot_by_course,
            "clash_weight": clash_opt,
            "red_students": red_at_clash,
            "weekday_balance_l1_scaled": bal_at_clash,
            "parallel_excess": excess_at_clash,
            "solver_time_seconds": round(time.time() - t0, 4),
            "num_workers": workers,
            "stopped_for_plateau": plateau_stopped,
            "message": msg,
        }

    # Phase 2: fix clash, minimize RED
    rehint_incumbent(built, slot_by_course)
    built.model.ClearObjective()
    built.model.Add(built.clash_weight == clash_opt)
    built.model.Minimize(built.red_students)
    last_status, solver, cb = solve_with_progress(
        built,
        "minimize_red",
        time_limit=phase_limit(),
        workers=workers,
        t0=t0,
        seed=None if seed is None else seed + 1,
        gap_trace=gap_trace,
    )
    consume(solver.WallTime())
    if last_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": "FEASIBLE",
            "proven_optimal": "clash_weight" in proven_levels,
            "proven_levels": proven_levels,
            "slot_by_course": slot_by_course,
            "clash_weight": clash_opt,
            "red_students": cb.best_red if cb.best_red is not None else red_at_clash,
            "weekday_balance_l1_scaled": cb.best_balance,
            "parallel_excess": cb.best_excess,
            "solver_time_seconds": round(time.time() - t0, 4),
            "num_workers": workers,
            "message": "Phase-2 did not improve; returning clash-optimal incumbent.",
        }

    red_opt = int(solver.Value(built.red_students))
    slot_by_course = extract_assignment(built, solver)
    if last_status == cp_model.OPTIMAL:
        proven_levels.append("red_students")

    # Phase 3: balance + parallel soft
    rehint_incumbent(built, slot_by_course)
    built.model.ClearObjective()
    built.model.Add(built.red_students == red_opt)
    soft = built.balance_l1 * (10**6) + built.parallel_excess
    built.model.Minimize(soft)
    last_status, solver, cb = solve_with_progress(
        built,
        "minimize_balance",
        time_limit=phase_limit(),
        workers=workers,
        t0=t0,
        seed=None if seed is None else seed + 2,
        gap_trace=gap_trace,
    )
    consume(solver.WallTime())

    if last_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        slot_by_course = extract_assignment(built, solver)
        bal = int(solver.Value(built.balance_l1))
        excess = int(solver.Value(built.parallel_excess))
        if last_status == cp_model.OPTIMAL:
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
        bal = cb.best_balance
        excess = cb.best_excess
        final_status = "FEASIBLE"

    primary_proven = "clash_weight" in proven_levels
    full_lex = (
        "clash_weight" in proven_levels
        and "red_students" in proven_levels
        and "balance_and_parallel" in proven_levels
    )

    if full_lex:
        message = (
            "Full lex optimal under the course→weekday CP-SAT model "
            "(clash, RED, and balance/parallel all proven minimal)."
        )
    elif primary_proven:
        message = (
            "Clash weight proven minimal under the course→weekday CP-SAT model."
        )
    elif plateau_stopped:
        message = (
            "Best feasible schedule shipped after clash prove plateau "
            "(incumbent and dual bound both flat)."
        )
    else:
        message = "Best feasible solution found (clash weight not fully proven)."

    return {
        "status": final_status if primary_proven else status_name(last_status),
        "proven_optimal": primary_proven,
        "proven_levels": proven_levels,
        "slot_by_course": slot_by_course,
        "clash_weight": clash_opt,
        "red_students": red_opt,
        "weekday_balance_l1_scaled": bal,
        "parallel_excess": excess,
        "solver_time_seconds": round(time.time() - t0, 4),
        "num_workers": workers,
        "stopped_for_plateau": plateau_stopped,
        "message": message,
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
        help="Stop after lex level 1 (clash). Used by portfolio race members.",
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
        help="Stop clash prove when incumbent−bound ≤ this (CP-SAT absolute_gap_limit)",
    )
    parser.add_argument(
        "--prove-plateau",
        type=float,
        default=None,
        help="Stop clash prove when incumbent and bound are both flat for N seconds",
    )
    parser.add_argument(
        "--prove",
        action="store_true",
        help="Disable plateau/gap escapes; chase full clash OPTIMAL certificate",
    )
    args = parser.parse_args()

    workers = args.workers if args.workers > 0 else (os.cpu_count() or 1)
    seed = args.seed if args.seed >= 0 else None
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
            "absolute_gap": args.absolute_gap,
            "prove_plateau": args.prove_plateau,
            "full_prove": bool(args.prove),
            **tc,
        }
    )
    try:
        built = build_model(instance)
    except Exception as exc:  # noqa: BLE001 — surface to parent CLI
        err = {"status": "MODEL_INVALID", "error": str(exc), "proven_optimal": False}
        with open(args.output, "w", encoding="utf-8") as out:
            json.dump(err, out, indent=2)
        emit({"type": "error", "message": str(exc)})
        return 2

    emit({"type": "model_ready", "elapsed": 0, "courses": len(built.course_codes)})
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
            gap_trace=gap_samples,
            absolute_gap=absolute_gap,
            prove_plateau_seconds=prove_plateau,
            full_prove=bool(args.prove),
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
    if gap_samples is not None and args.gap_trace:
        analysis = analyze_gap_trace(gap_samples)
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
                )
            },
            **tc,
        }
    )
    return 0 if result.get("slot_by_course") else 1


if __name__ == "__main__":
    raise SystemExit(main())
