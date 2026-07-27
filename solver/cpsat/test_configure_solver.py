"""Smoke checks for deterministic CP-SAT configuration when a seed is set."""

from __future__ import annotations

import sys
from pathlib import Path

# Allow importing solve.py from the same directory when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from solve import configure_solver  # noqa: E402


def test_seed_enables_interleaved_deterministic_search() -> None:
    solver = configure_solver(time_limit=None, workers=4, seed=42)
    assert solver.parameters.random_seed == 42
    assert solver.parameters.interleave_search is True
    assert solver.parameters.interleave_batch_size == 8
    assert solver.parameters.share_binary_clauses is False
    assert solver.parameters.num_search_workers == 4


def test_unseeded_keeps_default_parallel_search() -> None:
    solver = configure_solver(time_limit=None, workers=4, seed=None)
    assert solver.parameters.interleave_search is False


if __name__ == "__main__":
    test_seed_enables_interleaved_deterministic_search()
    test_unseeded_keeps_default_parallel_search()
    print("ok")
