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
from typing import Any

from ortools.sat.python import cp_model

from model import BuiltModel, apply_hints, build_model

HEARTBEAT_INTERVAL_S = 0.5


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
    ) -> None:
        super().__init__()
        self._built = built
        self._phase = phase
        self._workers = workers
        self._t0 = t0
        self.best_clash: int | None = None
        self.best_red: int | None = None
        self.best_balance: int | None = None
        self.best_excess: int | None = None
        self.best_bound: int | None = None
        self.solution_count = 0
        self.last_improve_at = t0
        self._lock = threading.Lock()

    def _bound_value(self) -> int | None:
        bound_raw = self.BestObjectiveBound()
        if bound_raw is None or bound_raw >= 2**62:
            return None
        return int(bound_raw)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            elapsed = time.time() - self._t0
            idle = max(0.0, time.time() - self.last_improve_at)
            if self.solution_count == 0:
                activity = "searching"
            elif idle >= 1.5:
                activity = "proving"
            else:
                activity = "improving"
            return {
                "type": "progress",
                "phase": self._phase,
                "phase_label": phase_label(self._phase),
                "best_clash": self.best_clash,
                "best_red": self.best_red,
                "best_balance_l1_scaled": self.best_balance,
                "best_parallel_excess": self.best_excess,
                "bound": self.best_bound,
                "elapsed": round(elapsed, 3),
                "workers": self._workers,
                "solutions": self.solution_count,
                "activity": activity,
                "seconds_since_improve": round(max(0.0, idle), 3),
            }

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
                self.best_bound = bound
            if improved:
                self.last_improve_at = now
        evt = self.snapshot()
        evt["event"] = "solution"
        emit(evt)


def start_heartbeat(cb: ProgressCallback, stop: threading.Event) -> threading.Thread:
    def loop() -> None:
        while not stop.wait(HEARTBEAT_INTERVAL_S):
            evt = cb.snapshot()
            evt["type"] = "heartbeat"
            evt["event"] = "heartbeat"
            emit(evt)

    t = threading.Thread(target=loop, name="cpsat-heartbeat", daemon=True)
    t.start()
    return t


def configure_solver(
    time_limit: float | None,
    workers: int,
    seed: int | None = None,
) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = max(1, workers)
    solver.parameters.log_search_progress = False
    if time_limit is not None and time_limit > 0:
        solver.parameters.max_time_in_seconds = float(time_limit)
    if seed is not None and seed >= 0:
        solver.parameters.random_seed = int(seed)
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
) -> tuple[int, cp_model.CpSolver, ProgressCallback]:
    emit(
        {
            "type": "phase",
            "phase": phase,
            "phase_label": phase_label(phase),
            "workers": workers,
            "elapsed": round(time.time() - t0, 3),
        }
    )
    solver = configure_solver(time_limit, workers, seed=seed)
    cb = ProgressCallback(built, phase, workers, t0)
    stop = threading.Event()
    start_heartbeat(cb, stop)
    try:
        status = solver.Solve(built.model, cb)
    finally:
        stop.set()
    final = cb.snapshot()
    final["type"] = "progress"
    final["event"] = "phase_end"
    final["solver_status"] = status_name(status)
    emit(final)
    return status, solver, cb


def solve_lex(
    built: BuiltModel,
    *,
    time_limit: float | None,
    workers: int,
    seed: int | None = None,
    clash_only: bool = False,
) -> dict[str, Any]:
    t0 = time.time()
    remaining = time_limit
    proven_levels: list[str] = []
    last_status = cp_model.UNKNOWN
    slot_by_course: dict[str, int] = {}

    def phase_limit() -> float | None:
        if remaining is None:
            return None
        return max(0.1, remaining)

    def consume(elapsed_phase: float) -> None:
        nonlocal remaining
        if remaining is not None:
            remaining = max(0.0, remaining - elapsed_phase)

    # Phase 1: minimize clash weight
    built.model.Minimize(built.clash_weight)
    last_status, solver, cb = solve_with_progress(
        built,
        "minimize_clash",
        time_limit=phase_limit(),
        workers=workers,
        t0=t0,
        seed=seed,
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
    if last_status == cp_model.OPTIMAL:
        proven_levels.append("clash_weight")

    if clash_only:
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
            "message": (
                "Clash-only portfolio race result."
                if "clash_weight" not in proven_levels
                else "Clash weight proven in portfolio race member."
            ),
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
        "message": (
            "Clash weight proven minimal under the course→weekday CP-SAT model."
            if primary_proven
            else "Best feasible solution found (clash weight not fully proven)."
        ),
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
    args = parser.parse_args()

    workers = args.workers if args.workers > 0 else (os.cpu_count() or 1)
    seed = args.seed if args.seed >= 0 else None
    with open(args.instance, encoding="utf-8") as f:
        instance = json.load(f)

    emit(
        {
            "type": "start",
            "workers": workers,
            "courses": len(instance.get("courses") or []),
            "edges": len(instance.get("conflict_edges") or []),
            "students": len(instance.get("students") or []),
            "seed": seed,
            "clash_only": bool(args.clash_only),
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
    result = solve_lex(
        built,
        time_limit=args.time_limit,
        workers=workers,
        seed=seed,
        clash_only=bool(args.clash_only),
    )
    with open(args.output, "w", encoding="utf-8") as out:
        json.dump(result, out, indent=2)
    emit(
        {
            "type": "done",
            **{
                k: result.get(k)
                for k in ("status", "clash_weight", "red_students", "proven_optimal")
            },
        }
    )
    return 0 if result.get("slot_by_course") else 1


if __name__ == "__main__":
    raise SystemExit(main())
