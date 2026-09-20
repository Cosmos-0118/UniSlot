"""Valid Max-k-Cut duals — never inject a heuristic cut as an upper bound."""

from __future__ import annotations

from bounds import (
    compute_clash_lower_bound,
    min_monochrome_pairs,
    spectral_clash_lower_bound,
)


def test_gershgorin_spectral_lb_never_exceeds_total_weight() -> None:
    weights = {("A", "B"): 4, ("A", "C"): 3, ("B", "C"): 5}
    lb = spectral_clash_lower_bound(weights, 6)
    assert 0 <= lb <= 4 + 3 + 5


def test_spectral_lb_is_zero_when_all_edges_can_be_cut() -> None:
    # Two vertices, 6 colors: Max-6-Cut = W, clash LB = 0.
    weights = {("A", "B"): 10}
    assert spectral_clash_lower_bound(weights, 6) == 0


def test_precomputed_skips_duplicate_notes_but_keeps_spectral() -> None:
    instance = {
        "num_weekdays": 6,
        "bounds_precomputed": True,
        "min_clash_weight_lower_bound": 5,
        "conflict_edges": [
            {"course_a": "A", "course_b": "B", "weight": 5},
            {"course_a": "A", "course_b": "C", "weight": 5},
            {"course_a": "B", "course_b": "C", "weight": 5},
        ],
        "clique_cuts": [["A", "B", "C"]],
    }
    info = compute_clash_lower_bound(instance)
    assert info["min_clash_weight_lower_bound"] >= 5
    assert info["clique_cuts"] == [["A", "B", "C"]]
    assert any("Reusing TypeScript" in n for n in info["notes"])


def test_min_monochrome_pairs_k7_on_6_colors() -> None:
    assert min_monochrome_pairs(7, 6) == 1
