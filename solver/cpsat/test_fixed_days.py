"""Tests for fixed_days pinning in the CP-SAT model."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

CPSAT_DIR = Path(__file__).resolve().parent
SOLVE_PY = CPSAT_DIR / "solve.py"


def _run_clash_only(instance: dict) -> dict:
    proc = subprocess.run(
        [sys.executable, str(SOLVE_PY), "--clash-only"],
        input=json.dumps(instance),
        capture_output=True,
        text=True,
        cwd=CPSAT_DIR,
        timeout=30,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    lines = [ln for ln in proc.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, proc.stdout
    return json.loads(lines[-1])


@pytest.mark.skipif(not SOLVE_PY.is_file(), reason="solve.py missing")
def test_fixed_days_respected() -> None:
    instance = {
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
        "fixed_days": {"A": 2, "B": 4},
    }
    result = _run_clash_only(instance)
    slots = result.get("slot_by_course") or {}
    assert slots.get("A") == 2
    assert slots.get("B") == 4
    assert "D" in slots
