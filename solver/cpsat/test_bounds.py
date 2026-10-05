"""Valid Max-k-Cut duals — never inject a heuristic cut as an upper bound."""

from __future__ import annotations

from bounds import (
    compute_clash_lower_bound,
    min_monochrome_pairs,
)


def test_precomputed_skips_duplicate_clique_packing() -> None:
    instance = {
        "num_weekdays": 6,
        "courses": [{"code": c} for c in ("A", "B", "C")],
        "students": [],
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
    assert "spectral_clash_lower_bound" not in info


def test_min_monochrome_pairs_k7_on_6_colors() -> None:
    assert min_monochrome_pairs(7, 6) == 1
