"""Certificate honesty: proven_optimal follows integer gap, not CP-SAT OPTIMAL status."""

from __future__ import annotations

from solve import configure_solver, integer_gap_closed


def test_integer_gap_closed_requires_zero_gap() -> None:
    assert integer_gap_closed(286, 286) is True
    assert integer_gap_closed(0, 0) is True
    assert integer_gap_closed(286, 282) is False
    assert integer_gap_closed(286, 285) is False


def test_integer_gap_closed_rejects_missing_bound() -> None:
    assert integer_gap_closed(10, None) is False
    assert integer_gap_closed(None, 10) is False
    assert integer_gap_closed(None, None) is False


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
