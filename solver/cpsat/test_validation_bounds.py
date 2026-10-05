"""Instance validation and exact checks for structural clash lower bounds."""

from __future__ import annotations

import itertools

import pytest

from bounds import compute_clash_lower_bound
from model import build_model


def _instance(**overrides: object) -> dict:
    instance = {
        "num_weekdays": 3,
        "saturday_index": 2,
        "allow_saturday": False,
        "preferred_parallel": 11,
        "courses": [{"code": code} for code in ("A", "B", "C")],
        "students": [],
        "faculty_groups": [],
        "conflict_edges": [],
    }
    instance.update(overrides)
    return instance


@pytest.mark.parametrize(
    "edge",
    [
        {"course_a": "A", "course_b": "K7", "weight": 1},
        {"course_a": "A", "weight": 1},
        {"course_a": "A", "course_b": "A", "weight": 1},
        {"course_a": "A", "course_b": "B", "weight": 0},
        {"course_a": "A", "course_b": "B", "weight": -1},
        {"course_a": "A", "course_b": "B", "weight": 1.5},
        {"course_a": "A", "course_b": "B", "weight": True},
    ],
)
def test_invalid_conflict_edges_fail_before_model_or_bound_construction(edge: dict) -> None:
    instance = _instance(conflict_edges=[edge])
    with pytest.raises(ValueError):
        compute_clash_lower_bound(instance)
    with pytest.raises(ValueError):
        build_model(instance)


@pytest.mark.parametrize(
    "change",
    [
        {"students": [{"id": "s", "courses": ["A", "MISSING"]}]},
        {"faculty_groups": [{"faculty": "F", "course_codes": ["A", "MISSING"]}]},
        {"fixed_days": {"MISSING": 0}},
        {"fixed_days": {"A": 2}},
        {"clique_cuts": [["A", "B", "MISSING"]]},
        {"clique_cuts": [["A", "B", "C"]]},
        {"courses": [{"code": "A"}, {"code": "A"}]},
        {"courses": [{"code": " "}, {"code": "B"}]},
        {"num_weekdays": 0},
    ],
)
def test_invalid_references_domains_and_cuts_are_rejected(change: dict) -> None:
    instance = _instance(**change)
    with pytest.raises(ValueError):
        build_model(instance)


def test_synthetic_weighted_clash_only_instance_without_students_is_valid() -> None:
    instance = _instance(
        conflict_edges=[{"course_a": "A", "course_b": "B", "weight": 4}]
    )
    built = build_model(instance)
    bounds = compute_clash_lower_bound(instance)
    assert built.course_codes == ["A", "B", "C"]
    assert bounds["min_clash_weight_lower_bound"] == 0


def _exact_min_clash(weights: dict[tuple[str, str], int], n: int, colors: int) -> int:
    best: int | None = None
    for values in itertools.product(range(colors), repeat=n):
        assignment = {str(i): value for i, value in enumerate(values)}
        clash = sum(
            weight
            for (a, b), weight in weights.items()
            if assignment[a] == assignment[b]
        )
        if best is None or clash < best:
            best = clash
    assert best is not None
    return best


def test_weighted_clique_component_core_bounds_never_exceed_exhaustive_optima() -> None:
    """Check every weighted graph on four vertices for two and three colors."""
    edge_pairs = list(itertools.combinations(("0", "1", "2", "3"), 2))
    for color_count in (2, 3):
        for weights_tuple in itertools.product((0, 1, 3), repeat=len(edge_pairs)):
            weights = {
                pair: weight
                for pair, weight in zip(edge_pairs, weights_tuple)
                if weight > 0
            }
            exact = _exact_min_clash(weights, 4, color_count)
            instance = _instance(
                num_weekdays=color_count,
                saturday_index=color_count,
                allow_saturday=False,
                courses=[{"code": code} for code in ("0", "1", "2", "3")],
                conflict_edges=[
                    {"course_a": a, "course_b": b, "weight": weight}
                    for (a, b), weight in weights.items()
                ],
            )
            lower_bound = compute_clash_lower_bound(instance)["min_clash_weight_lower_bound"]
            assert 0 <= lower_bound <= exact, (color_count, weights, lower_bound, exact)


def test_weighted_clique_bound_is_positive_for_two_color_triangle() -> None:
    instance = _instance(
        num_weekdays=2,
        saturday_index=2,
        allow_saturday=False,
        courses=[{"code": code} for code in ("A", "B", "C")],
        conflict_edges=[
            {"course_a": a, "course_b": b, "weight": 1}
            for a, b in (("A", "B"), ("A", "C"), ("B", "C"))
        ],
    )
    assert compute_clash_lower_bound(instance)["min_clash_weight_lower_bound"] == 1
