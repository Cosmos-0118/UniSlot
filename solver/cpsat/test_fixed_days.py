"""Tests for fixed_days pinning in the CP-SAT model."""

from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from ortools.sat.python import cp_model

import solve as solve_module
from model import build_model

CPSAT_DIR = Path(__file__).resolve().parent
SOLVE_PY = CPSAT_DIR / "solve.py"


def _solve(
    instance: dict,
    *,
    clash_only: bool = True,
    primary_only: bool = False,
    absolute_gap: float | None = None,
    time_limit: float = 20,
) -> dict:
    """Run solve.py against a temp instance file. --instance and --output are both required."""
    with tempfile.TemporaryDirectory() as tmp:
        instance_path = Path(tmp) / "instance.json"
        output_path = Path(tmp) / "solution.json"
        instance_path.write_text(json.dumps(instance), encoding="utf-8")

        cmd = [
            sys.executable,
            str(SOLVE_PY),
            "--instance",
            str(instance_path),
            "--output",
            str(output_path),
            "--time-limit",
            str(time_limit),
            "--seed",
            "17",
        ]
        if clash_only:
            cmd.append("--clash-only")
        if primary_only:
            cmd.append("--primary-only")
        if absolute_gap is not None:
            cmd.extend(["--absolute-gap", str(absolute_gap)])

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=CPSAT_DIR,
            timeout=60,
            check=False,
        )
        assert output_path.is_file(), f"no solution file\nstderr:\n{proc.stderr}"
        result = json.loads(output_path.read_text(encoding="utf-8"))
        assert proc.returncode == 0, f"exit {proc.returncode}\n{result}\n{proc.stderr}"
        return result


def _instance(**overrides: object) -> dict:
    base = {
        "num_weekdays": 6,
        "saturday_index": 5,
        "allow_saturday": True,
        "preferred_parallel": 11,
        "courses": [
            {"code": "A", "is_math": False, "section_count": 1, "section_ids": ["A"]},
            {"code": "B", "is_math": False, "section_count": 1, "section_ids": ["B"]},
            {"code": "D", "is_math": False, "section_count": 1, "section_ids": ["D"]},
        ],
        "conflict_edges": [{"course_a": "A", "course_b": "D", "weight": 1}],
        "faculty_groups": [],
        "students": [
            {"id": "s1", "courses": ["A", "D"]},
            {"id": "s2", "courses": ["B"]},
        ],
    }
    base.update(overrides)
    return base


@pytest.mark.skipif(not SOLVE_PY.is_file(), reason="solve.py missing")
def test_fixed_days_respected() -> None:
    result = _solve(_instance(fixed_days={"A": 2, "B": 4}))
    slots = result.get("slot_by_course") or {}
    assert slots.get("A") == 2
    assert slots.get("B") == 4
    assert "D" in slots
    # D shares a student with A, so the clash-minimal placement moves it off Wednesday.
    assert slots["D"] != 2


@pytest.mark.skipif(not SOLVE_PY.is_file(), reason="solve.py missing")
def test_fixed_days_survive_full_lex() -> None:
    """The balance phase must not shuffle pinned courses off their weekday."""
    result = _solve(_instance(fixed_days={"A": 2, "B": 4}), clash_only=False)
    slots = result.get("slot_by_course") or {}
    assert slots.get("A") == 2
    assert slots.get("B") == 4
    assert result.get("clash_weight") == 0


@pytest.mark.skipif(not SOLVE_PY.is_file(), reason="solve.py missing")
def test_no_fixed_days_still_solves() -> None:
    result = _solve(_instance())
    slots = result.get("slot_by_course") or {}
    assert set(slots) == {"A", "B", "D"}


def test_red_first_prefers_more_clashes_to_fewer_red_students() -> None:
    """Primary RED count wins even when the secondary pair cost is larger."""
    instance = _instance(
        num_weekdays=5,
        allow_saturday=False,
        courses=[
            {"code": c, "is_math": False, "section_count": 1, "section_ids": [c]}
            for c in ("A", "B", "C", "D", "E", "X", "FW", "FT", "FF")
        ],
        fixed_days={"A": 0, "B": 0, "C": 0, "D": 1, "E": 1, "FW": 2, "FT": 3, "FF": 4},
        students=[
            {"id": "s1", "courses": ["X", "A", "B", "C"]},
            {"id": "s2", "courses": ["X", "D"]},
            {"id": "s3", "courses": ["X", "E"]},
        ],
        conflict_edges=[
            {"course_a": a, "course_b": b, "weight": 1}
            for courses in (("X", "A", "B", "C"), ("X", "D"), ("X", "E"))
            for i, a in enumerate(courses)
            for b in courses[i + 1 :]
        ],
        faculty_groups=[{"faculty": "F", "course_codes": ["X", "FW", "FT", "FF"]}],
    )
    result = _solve(instance, clash_only=False)
    assert result["red_students"] == 1
    assert result["clash_weight"] == 6
    assert result["proven_levels"][0] == "red_students"
    assert result["proven_optimal"] is True
    assert result["red_gap"] == 0
    assert result["clash_gap"] == 0


def test_bounded_run_checkpoints_full_red_first_best_incumbent() -> None:
    instance = _instance(
        num_weekdays=5,
        allow_saturday=False,
        courses=[
            {"code": code, "is_math": False, "section_count": 1}
            for code in ("A", "B", "C", "D", "E", "X", "FW", "FT", "FF")
        ],
        fixed_days={"A": 0, "B": 0, "C": 0, "D": 1, "E": 1, "FW": 2, "FT": 3, "FF": 4},
        students=[
            {"id": "s1", "courses": ["X", "A", "B", "C"]},
            {"id": "s2", "courses": ["X", "D"]},
            {"id": "s3", "courses": ["X", "E"]},
        ],
        conflict_edges=[
            {"course_a": a, "course_b": b, "weight": 1}
            for courses in (("X", "A", "B", "C"), ("X", "D"), ("X", "E"))
            for i, a in enumerate(courses)
            for b in courses[i + 1 :]
        ],
        faculty_groups=[{"faculty": "F", "course_codes": ["X", "FW", "FT", "FF"]}],
    )
    with tempfile.TemporaryDirectory() as temp_dir:
        instance_path = Path(temp_dir) / "instance.json"
        output_path = Path(temp_dir) / "solution.json"
        checkpoint_path = Path(str(output_path) + ".incumbent.json")
        instance_path.write_text(json.dumps(instance), encoding="utf-8")
        proc = subprocess.run(
            [
                sys.executable,
                str(SOLVE_PY),
                "--instance",
                str(instance_path),
                "--output",
                str(output_path),
                "--time-limit",
                "20",
                "--workers",
                "1",
                "--seed",
                "17",
            ],
            capture_output=True,
            text=True,
            cwd=CPSAT_DIR,
            timeout=60,
            check=False,
        )
        assert proc.returncode == 0, proc.stderr
        result = json.loads(output_path.read_text(encoding="utf-8"))
        assert checkpoint_path.is_file()
        checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))

    assert checkpoint["slot_by_course"] == result["slot_by_course"]
    assert checkpoint["red_students"] == 1
    assert checkpoint["clash_weight"] == 6
    assert checkpoint["weekday_balance_l1_scaled"] == result["weekday_balance_l1_scaled"]
    assert checkpoint["parallel_excess"] == result["parallel_excess"]
    assert checkpoint["objective_policy"] == "red-first-v1"
    if checkpoint["proven_optimal"]:
        assert checkpoint["red_gap"] == 0
        assert "red_students" in checkpoint["proven_levels"]


def test_primary_only_reports_red_certificate_without_tiebreakers() -> None:
    result = _solve(_instance(), clash_only=False, primary_only=True)
    assert result["proven_levels"] == ["red_students"]
    assert result["proven_optimal"] is True
    assert "clash_gap" in result and result["clash_gap"] is None


def test_red_count_counts_each_student_once() -> None:
    instance = _instance(
        fixed_days={"A": 0, "D": 0},
        students=[{"id": "s1", "courses": ["A", "D"]}],
    )
    result = _solve(instance, clash_only=False, primary_only=True)
    assert result["red_students"] == 1


def test_clash_only_is_diagnostic_not_primary_optimality() -> None:
    result = _solve(_instance(), clash_only=True)
    assert result["objective_policy"] == "clash-only"
    assert result["proven_optimal"] is False


def test_equal_red_schedules_use_lower_pair_cost_as_tiebreaker() -> None:
    instance = _instance(
        fixed_days={"A": 0, "D": 1},
        conflict_edges=[{"course_a": "A", "course_b": "B", "weight": 7}],
        students=[{"id": "s1", "courses": ["A", "D"]}],
    )
    result = _solve(instance, clash_only=False)
    assert result["red_students"] == 0
    assert result["clash_weight"] == 0
    assert result["proven_levels"][:2] == ["red_students", "clash_weight"]


def _small_oracle(instance: dict) -> tuple[int, int, int, int]:
    """Enumerate the complete weekday domain independently of CP-SAT encoding."""
    import itertools

    days_count = int(instance["num_weekdays"])
    saturday = int(instance["saturday_index"])
    allow_saturday = bool(instance["allow_saturday"])
    if not allow_saturday:
        days_count = min(days_count, saturday)
    courses = instance["courses"]
    codes = [str(course["code"]) for course in courses]
    domains = []
    for course in courses:
        upper = days_count
        if allow_saturday and not course.get("is_math"):
            upper = min(upper, saturday)
        domains.append(tuple(range(upper)))

    best = None
    total_sections = sum(int(c.get("section_count") or 1) for c in courses)
    for values in itertools.product(*domains):
        assignment = dict(zip(codes, values))
        if any(assignment.get(str(code)) != int(day) for code, day in instance.get("fixed_days", {}).items()):
            continue
        if any(
            len({assignment[str(code)] for code in group.get("course_codes", [])})
            != len(set(group.get("course_codes", [])))
            for group in instance.get("faculty_groups", [])
        ):
            continue
        red = sum(
            len({assignment[str(code)] for code in student["courses"]})
            < len(set(student["courses"]))
            for student in instance.get("students", [])
        )
        pairs = sum(
            int(edge.get("weight") or 0)
            for edge in instance.get("conflict_edges", [])
            if assignment[str(edge["course_a"])] == assignment[str(edge["course_b"])]
        )
        loads = [
            sum(
                int(course.get("section_count") or 1)
                for course in courses
                if assignment[str(course["code"])] == day
            )
            for day in range(days_count)
        ]
        balance = sum(abs(days_count * load - total_sections) for load in loads)
        parallel = sum(max(0, load - int(instance["preferred_parallel"])) for load in loads)
        score = (red, pairs, balance, parallel)
        if best is None or score < best:
            best = score
    assert best is not None, "oracle fixture must have a feasible assignment"
    return best


@pytest.mark.parametrize("allow_saturday", [True, False])
def test_small_exhaustive_oracle_matches_red_first_lexicographic_tuple(
    allow_saturday: bool,
) -> None:
    courses = [
        {"code": code, "is_math": code == "M", "section_count": count}
        for code, count in (("A", 1), ("B", 2), ("C", 1), ("M", 1))
    ]
    instance = _instance(
        num_weekdays=3,
        saturday_index=2,
        allow_saturday=allow_saturday,
        preferred_parallel=2,
        courses=courses,
        students=[{"id": "s1", "courses": ["A", "B", "C"]}],
        conflict_edges=[
            {"course_a": a, "course_b": b, "weight": 1}
            for a, b in (("A", "B"), ("A", "C"), ("B", "C"))
        ],
        faculty_groups=[{"faculty": "F", "course_codes": ["A", "B"]}],
        fixed_days={"M": 2 if allow_saturday else 1},
    )
    expected = _small_oracle(instance)
    result = _solve(instance, clash_only=False)
    actual = (
        result["red_students"],
        result["clash_weight"],
        result["weekday_balance_l1_scaled"],
        result["parallel_excess"],
    )
    assert expected[0] > 0
    assert actual == expected


def test_gap_limited_red_phase_never_claims_nonzero_integer_gap_as_proven() -> None:
    rng = random.Random(5)
    codes = [f"C{i}" for i in range(30)]
    conflict_pairs = [
        (codes[i], codes[j])
        for i in range(len(codes))
        for j in range(i + 1, len(codes))
        if rng.random() < 0.22
    ]
    instance = _instance(
        num_weekdays=2,
        saturday_index=2,
        allow_saturday=False,
        courses=[
            {"code": code, "is_math": False, "section_count": 1} for code in codes
        ],
        students=[
            {"id": str(index), "courses": [a, b]}
            for index, (a, b) in enumerate(conflict_pairs)
        ],
        conflict_edges=[],
        faculty_groups=[],
    )
    result = _solve(
        instance,
        clash_only=False,
        primary_only=True,
        absolute_gap=1000,
        time_limit=0.15,
    )
    assert result["red_gap"] is not None and result["red_gap"] > 0
    assert result["proven_optimal"] is False
    assert "red_students" not in result["proven_levels"]
    assert result["status"] == "FEASIBLE"


@pytest.mark.parametrize("stopped_phase", ["minimize_clash", "minimize_balance"])
def test_time_expired_secondary_phase_returns_matching_incumbent_tuple(
    monkeypatch: pytest.MonkeyPatch, stopped_phase: str
) -> None:
    class ExpiredSolver:
        def WallTime(self) -> float:
            return 0.01

        def BestObjectiveBound(self) -> None:
            return None

        def ResponseStats(self) -> str:
            return "simulated time-limit expiry"

    instance = _instance()
    built = build_model(instance)
    real_solve_with_progress = solve_module.solve_with_progress
    completed_incumbents: dict[str, dict[str, object]] = {}

    def stop_at_requested_phase(built_model: object, phase: str, **kwargs: object):
        if phase == stopped_phase:
            return cp_model.UNKNOWN, ExpiredSolver(), None
        status, solver, callback = real_solve_with_progress(built_model, phase, **kwargs)
        completed_incumbents[phase] = {
            "slot_by_course": solve_module.extract_assignment(built_model, solver),
            "clash_weight": int(solver.Value(built_model.clash_weight)),
            "red_students": int(solver.Value(built_model.red_students)),
            "weekday_balance_l1_scaled": int(solver.Value(built_model.balance_l1)),
            "parallel_excess": int(solver.Value(built_model.parallel_excess)),
        }
        return status, solver, callback

    monkeypatch.setattr(solve_module, "solve_with_progress", stop_at_requested_phase)
    result = solve_module.solve_lex(
        built,
        time_limit=10,
        workers=1,
        seed=17,
        prove_strategy="stock",
    )
    fallback_phase = "minimize_red" if stopped_phase == "minimize_clash" else "minimize_clash"
    expected = completed_incumbents[fallback_phase]
    for key, value in expected.items():
        assert result[key] == value
    assert result["status"] == "FEASIBLE"
    if "red_students" in result["proven_levels"]:
        assert result["proven_optimal"] is True
