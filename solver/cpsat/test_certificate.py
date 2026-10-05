"""Certificate honesty: proven_optimal follows integer gap, not CP-SAT OPTIMAL status."""

from __future__ import annotations

import time
import json
import sys
import threading
from types import SimpleNamespace

import pytest
from ortools.sat.python import cp_model

import solve as solve_module
from model import build_model
from solve import analyze_gap_trace, configure_solver, integer_gap_closed
from solve import IncumbentCheckpoint


def test_integer_gap_closed_requires_zero_gap() -> None:
    assert integer_gap_closed(286, 286) is True
    assert integer_gap_closed(0, 0) is True
    assert integer_gap_closed(286, 282) is False
    assert integer_gap_closed(286, 285) is False


def test_integer_gap_closed_rejects_missing_bound() -> None:
    assert integer_gap_closed(10, None) is False
    assert integer_gap_closed(None, 10) is False
    assert integer_gap_closed(None, None) is False


def test_lex_incumbent_selector_keeps_better_tuple_across_feasible_phases() -> None:
    red_incumbent = {
        "slot_by_course": {"A": 0, "B": 0},
        "red_students": 1,
        "clash_weight": 0,
        "weekday_balance_l1_scaled": 3,
        "parallel_excess": 2,
    }
    worse_clash_phase = {**red_incumbent, "clash_weight": 1}
    worse_balance_phase = {**red_incumbent, "weekday_balance_l1_scaled": 4}

    assert solve_module.lex_best(red_incumbent, worse_clash_phase) is red_incumbent
    assert solve_module.lex_best(red_incumbent, worse_balance_phase) is red_incumbent


@pytest.mark.parametrize("time_limit", [-1, float("nan"), float("inf"), -float("inf")])
def test_solve_lex_rejects_invalid_time_limit(time_limit: float) -> None:
    built = build_model(
        {
            "courses": [{"code": "A"}],
            "students": [],
            "conflict_edges": [],
        }
    )
    with pytest.raises(ValueError, match="finite non-negative"):
        solve_module.solve_lex(built, time_limit=time_limit, workers=1)


def test_solve_lex_retains_incumbent_when_successful_tie_break_phases_are_worse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    built = build_model(
        {
            "num_weekdays": 3,
            "courses": [{"code": "A"}, {"code": "B"}],
            "students": [{"id": "s1", "courses": ["A", "B"]}],
            "conflict_edges": [{"course_a": "A", "course_b": "B", "weight": 1}],
        }
    )
    values_by_phase = {
        "minimize_red": {
            built.day["A"].Index(): 0,
            built.day["B"].Index(): 0,
            built.clash_weight.Index(): 5,
            built.red_students.Index(): 1,
            built.balance_l1.Index(): 0,
            built.parallel_excess.Index(): 0,
        },
        "minimize_clash": {
            built.day["A"].Index(): 0,
            built.day["B"].Index(): 1,
            built.clash_weight.Index(): 6,
            built.red_students.Index(): 1,
            built.balance_l1.Index(): 5,
            built.parallel_excess.Index(): 0,
        },
        "minimize_balance": {
            built.day["A"].Index(): 0,
            built.day["B"].Index(): 2,
            built.clash_weight.Index(): 6,
            built.red_students.Index(): 1,
            built.balance_l1.Index(): 8,
            built.parallel_excess.Index(): 0,
        },
    }

    class FakeSolver:
        def __init__(self, values: dict[int, int]) -> None:
            self.values = values

        def Value(self, variable: object) -> int:
            return self.values[variable.Index()]

        def BestObjectiveBound(self) -> None:
            return None

        def ResponseStats(self) -> str:
            return "fake feasible phase result"

    def fake_phase(_built: object, phase: str, **_kwargs: object):
        return cp_model.FEASIBLE, FakeSolver(values_by_phase[phase]), SimpleNamespace(
            stopped_for_plateau=False, best_bound=None
        )

    monkeypatch.setattr(solve_module, "solve_with_progress", fake_phase)
    result = solve_module.solve_lex(built, time_limit=None, workers=1)

    assert result["status"] == "FEASIBLE"
    assert result["red_students"] == 1
    assert result["clash_weight"] == 5
    assert result["weekday_balance_l1_scaled"] == 0


def test_gap_limited_optimal_is_not_a_certificate() -> None:
    """absolute_gap_limit can yield OPTIMAL with a remaining integer gap."""
    incumbent, bound, absolute_gap = 286, 282, 5
    assert incumbent - bound <= absolute_gap
    # CP-SAT may report OPTIMAL here; UniSlot must not.
    assert integer_gap_closed(incumbent, bound) is False


def test_core_strategy_sets_optimize_with_core_only() -> None:
    solver = configure_solver(None, 2, prove_mode=True, prove_strategy="core")
    assert solver.parameters.optimize_with_core is True


def test_stock_strategy_leaves_core_off() -> None:
    solver = configure_solver(None, 2, prove_mode=True, prove_strategy="stock")
    assert solver.parameters.optimize_with_core is False


def test_core_linear_sets_linearization() -> None:
    solver = configure_solver(None, 2, prove_mode=True, prove_strategy="core_linear")
    assert solver.parameters.optimize_with_core is True
    assert solver.parameters.linearization_level == 2


def test_primal_search_does_not_enable_core() -> None:
    solver = configure_solver(None, 2, prove_mode=False, prove_strategy="core")
    assert solver.parameters.optimize_with_core is False


@pytest.mark.parametrize("primary_phase", ["minimize_red", "minimize_clash"])
def test_prove_controls_apply_only_when_requested_for_phase(
    monkeypatch: pytest.MonkeyPatch, primary_phase: str
) -> None:
    built = build_model(
        {
            "num_weekdays": 3,
            "courses": [{"code": "A"}, {"code": "B"}],
            "students": [{"id": "s1", "courses": ["A", "B"]}],
            "conflict_edges": [],
        }
    )
    built.model.Minimize(built.red_students if primary_phase == "minimize_red" else built.clash_weight)
    original_configure = solve_module.configure_solver
    configured: list[dict[str, object]] = []

    def capture_config(*args: object, **kwargs: object):
        configured.append(dict(kwargs))
        return original_configure(*args, **kwargs)

    monkeypatch.setattr(solve_module, "configure_solver", capture_config)
    _, solver, callback = solve_module.solve_with_progress(
        built,
        primary_phase,
        time_limit=2,
        workers=1,
        t0=time.time(),
        prove_mode=True,
        absolute_gap=3,
        prove_plateau_seconds=9,
        apply_prove_controls=True,
    )
    assert configured[0]["absolute_gap"] == 3
    assert solver.parameters.absolute_gap_limit == 3
    assert callback._prove_plateau_seconds == 9

    _, secondary_solver, secondary_callback = solve_module.solve_with_progress(
        built,
        "minimize_clash" if primary_phase == "minimize_red" else "minimize_red",
        time_limit=2,
        workers=1,
        t0=time.time(),
        prove_mode=True,
        absolute_gap=3,
        prove_plateau_seconds=9,
        apply_prove_controls=False,
    )
    assert configured[1]["absolute_gap"] is None
    assert secondary_solver.parameters.absolute_gap_limit != 3
    assert secondary_callback._prove_plateau_seconds is None


def test_gap_analysis_defaults_to_red_and_keeps_clash_diagnostic_option() -> None:
    samples = [
        {"phase": "minimize_red", "event": "solution", "incumbent": 2, "bound": 0, "gap": 2, "elapsed": 1, "activity": "improving"},
        {"phase": "minimize_red", "event": "phase_end", "incumbent": 1, "bound": 0, "gap": 1, "elapsed": 2, "activity": "proving"},
        {"phase": "minimize_clash", "event": "phase_end", "incumbent": 4, "bound": 4, "gap": 0, "elapsed": 3, "activity": "proving"},
    ]
    primary = analyze_gap_trace(samples)
    assert primary["phase"] == "minimize_red"
    assert primary["final_gap"] == 1
    assert primary["red_samples"] == 2
    assert primary["clash_samples"] == 1

    diagnostic = analyze_gap_trace(samples, primary_phase="minimize_clash")
    assert diagnostic["phase"] == "minimize_clash"
    assert diagnostic["final_gap"] == 0


class _ControlledClock:
    def __init__(self, now: float) -> None:
        self.now = now

    def monotonic(self) -> float:
        return self.now


def test_deadline_expiry_skips_later_phases_and_keeps_red_incumbent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = _ControlledClock(100.0)
    monkeypatch.setattr(solve_module.time, "monotonic", clock.monotonic)
    built = build_model(
        {
            "num_weekdays": 3,
            "courses": [{"code": "A"}, {"code": "B"}],
            "students": [{"id": "s1", "courses": ["A", "B"]}],
            "conflict_edges": [{"course_a": "A", "course_b": "B", "weight": 2}],
        }
    )
    real_solve = solve_module.solve_with_progress
    phases: list[str] = []

    def expire_after_red(built_arg: object, phase: str, **kwargs: object):
        phases.append(phase)
        assert kwargs["time_limit"] == pytest.approx(1.0)
        result = real_solve(built_arg, phase, **kwargs)
        clock.now = 101.0
        return result

    monkeypatch.setattr(solve_module, "solve_with_progress", expire_after_red)
    result = solve_module.solve_lex(
        built,
        time_limit=1,
        deadline=101.0,
        workers=1,
        seed=4,
    )
    assert phases == ["minimize_red"]
    assert result["status"] == "FEASIBLE"
    assert result["red_students"] is not None
    assert result["slot_by_course"]
    assert result["clash_weight"] is not None
    assert result["proven_levels"] == ["red_students"]
    assert result["proven_optimal"] is True


def test_each_phase_uses_current_monotonic_time_after_phase_overhead(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = _ControlledClock(200.0)
    monkeypatch.setattr(solve_module.time, "monotonic", clock.monotonic)
    built = build_model(
        {
            "num_weekdays": 3,
            "courses": [{"code": "A"}, {"code": "B"}],
            "students": [{"id": "s1", "courses": ["A", "B"]}],
            "conflict_edges": [{"course_a": "A", "course_b": "B", "weight": 2}],
        }
    )
    real_solve = solve_module.solve_with_progress
    phase_limits: list[tuple[str, float | None]] = []

    def elapse_clock_between_phases(built_arg: object, phase: str, **kwargs: object):
        phase_limits.append((phase, kwargs["time_limit"]))
        result = real_solve(built_arg, phase, **kwargs)
        if phase == "minimize_red":
            clock.now = 200.25
        elif phase == "minimize_clash":
            clock.now = 200.8
        return result

    monkeypatch.setattr(solve_module, "solve_with_progress", elapse_clock_between_phases)
    solve_module.solve_lex(
        built,
        time_limit=1,
        deadline=201.0,
        workers=1,
        seed=4,
    )
    assert phase_limits == [
        ("minimize_red", pytest.approx(1.0)),
        ("minimize_clash", pytest.approx(0.75)),
        ("minimize_balance", pytest.approx(0.2)),
    ]


def test_main_deadline_starts_before_input_and_model_construction(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    clock = _ControlledClock(300.0)
    monkeypatch.setattr(solve_module.time, "monotonic", clock.monotonic)
    instance_path = tmp_path / "instance.json"
    output_path = tmp_path / "solution.json"
    instance_path.write_text(
        json.dumps({"courses": [{"code": "A"}, {"code": "B"}], "students": []}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sys,
        "argv",
        ["solve.py", "--instance", str(instance_path), "--output", str(output_path), "--time-limit", "0.1"],
    )
    real_build_model = solve_module.build_model

    def build_past_deadline(instance: dict):
        built = real_build_model(instance)
        clock.now += 0.2
        return built

    monkeypatch.setattr(solve_module, "build_model", build_past_deadline)
    result_code = solve_module.main()
    result = json.loads(output_path.read_text(encoding="utf-8"))
    assert result_code == 1
    assert result["status"] == "UNKNOWN"
    assert result["slot_by_course"] == {}
    assert result["timings"]["model_build_seconds"] is not None


def test_balance_objective_multiplier_exceeds_parallel_excess_domain() -> None:
    built = build_model({"courses": [{"code": "A"}]})
    variable = built.parallel_excess.Index()
    domain = built.model.Proto().variables[variable].domain
    domain.clear()
    domain.extend([0, 2_000_000])
    assert solve_module.balance_objective_multiplier(built) == 2_000_001


def test_checkpoint_write_failure_does_not_block_callback(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    checkpoint = IncumbentCheckpoint(str(tmp_path / "output.json"), "red-first-v1")
    monkeypatch.setattr(solve_module, "emit", lambda _: None)

    def fail_write(_: dict) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(checkpoint, "_write_atomic", fail_write)
    candidate = {
        "slot_by_course": {"A": 0},
        "red_students": 0,
        "clash_weight": 0,
        "weekday_balance_l1_scaled": 1,
        "parallel_excess": 0,
    }
    done = threading.Event()

    def invoke_checkpoint() -> None:
        checkpoint(candidate)
        done.set()

    worker = threading.Thread(target=invoke_checkpoint, daemon=True)
    worker.start()
    assert done.wait(0.5), "checkpoint write failure deadlocked the solver callback"
