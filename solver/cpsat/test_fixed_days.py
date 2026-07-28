"""Tests for fixed_days pinning in the CP-SAT model."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

CPSAT_DIR = Path(__file__).resolve().parent
SOLVE_PY = CPSAT_DIR / "solve.py"


def _solve(instance: dict, *, clash_only: bool = True) -> dict:
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
            "20",
        ]
        if clash_only:
            cmd.append("--clash-only")

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
