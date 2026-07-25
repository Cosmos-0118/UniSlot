"""Structural clash lower bounds computed from the course conflict graph.

Used at model-build time to raise clash_weight cuts beyond the TS clique LB:
connected-component additivity, weighted-clique pigeonhole, and heavy-edge core.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any


def _pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def min_monochrome_pairs(n: int, k: int) -> int:
    """Min Σ C(size_c, 2) placing n clique vertices into k colors."""
    if n <= 0 or k <= 0 or n <= k:
        return 0
    base, rem = divmod(n, k)
    large = base + 1
    return rem * (large * (large - 1) // 2) + (k - rem) * (base * (base - 1) // 2)


def _build_weighted_adj(
    edges: list[dict[str, Any]],
) -> tuple[dict[str, set[str]], dict[tuple[str, str], int]]:
    adj: dict[str, set[str]] = defaultdict(set)
    weights: dict[tuple[str, str], int] = {}
    for edge in edges:
        a = str(edge.get("course_a") or "")
        b = str(edge.get("course_b") or "")
        w = int(edge.get("weight") or 0)
        if not a or not b or a == b or w <= 0:
            continue
        key = _pair_key(a, b)
        weights[key] = weights.get(key, 0) + w
        adj[a].add(b)
        adj[b].add(a)
    return dict(adj), weights


def _connected_components(adj: dict[str, set[str]]) -> list[list[str]]:
    seen: set[str] = set()
    comps: list[list[str]] = []
    for start in adj:
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        comp: list[str] = []
        while stack:
            u = stack.pop()
            comp.append(u)
            for v in adj.get(u, ()):
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        comps.append(comp)
    return comps


def _greedy_clique(
    adj: dict[str, set[str]],
    nodes: list[str],
    start: str,
) -> list[str]:
    clique = [start]
    candidates = [v for v in adj.get(start, ()) if v in nodes]
    node_set = set(nodes)
    while candidates:
        candidates.sort(
            key=lambda a: (
                -sum(1 for c in candidates if c in adj.get(a, ())),
                -len(adj.get(a, ())),
            )
        )
        pick = candidates[0]
        clique.append(pick)
        candidates = [c for c in candidates if c != pick and c in adj.get(pick, ()) and c in node_set]
    return clique


def _clique_weighted_lb(
    clique: list[str],
    weights: dict[tuple[str, str], int],
    colors: int,
) -> int:
    """Valid LB: at least minMonochromePairs edges are mono; cheapest such edges."""
    n = len(clique)
    pairs = min_monochrome_pairs(n, colors)
    if pairs <= 0:
        return 0
    edge_ws: list[int] = []
    for i, a in enumerate(clique):
        for b in clique[i + 1 :]:
            w = weights.get(_pair_key(a, b), 0)
            if w > 0:
                edge_ws.append(w)
    if len(edge_ws) < pairs:
        # Incomplete weight data — fall back to unit-weight pigeonhole.
        return pairs
    edge_ws.sort()
    return int(sum(edge_ws[:pairs]))


def _best_cliques_lb(
    adj: dict[str, set[str]],
    weights: dict[tuple[str, str], int],
    nodes: list[str],
    colors: int,
    starts: int = 24,
) -> int:
    if not nodes:
        return 0
    ranked = sorted(nodes, key=lambda v: len(adj.get(v, ())), reverse=True)
    best = 0
    used_edges: set[tuple[str, str]] = set()
    packed = 0
    for start in ranked[: min(starts, len(ranked))]:
        clique = _greedy_clique(adj, nodes, start)
        lb = _clique_weighted_lb(clique, weights, colors)
        best = max(best, lb)
        # Greedy edge-disjoint packing for additive LB.
        clique_edges = [
            _pair_key(clique[i], clique[j])
            for i in range(len(clique))
            for j in range(i + 1, len(clique))
            if weights.get(_pair_key(clique[i], clique[j]), 0) > 0
        ]
        if clique_edges and all(e not in used_edges for e in clique_edges):
            packed += lb
            used_edges.update(clique_edges)
    return max(best, packed)


def compute_clash_lower_bound(
    instance: dict[str, Any],
    *,
    core_weight_tau: int | None = None,
) -> dict[str, Any]:
    """Return strengthened clash LB and notes for injection into the CP-SAT model."""
    edges = list(instance.get("conflict_edges") or [])
    num_weekdays = int(instance.get("num_weekdays") or 6)
    existing = int(instance.get("min_clash_weight_lower_bound") or 0)
    adj, weights = _build_weighted_adj(edges)
    notes: list[str] = []

    if not adj:
        return {
            "min_clash_weight_lower_bound": existing,
            "component_count": 0,
            "core_edge_count": 0,
            "notes": notes,
        }

    # Additive LB across connected components.
    comps = _connected_components(adj)
    comp_lb = 0
    for comp in comps:
        comp_lb += _best_cliques_lb(adj, weights, comp, num_weekdays)
    if comp_lb > existing:
        notes.append(
            f"Component-wise weighted clique LB raised clash cut to {comp_lb} "
            f"({len(comps)} components)."
        )

    # Heavy-edge core: valid LB on subgraph of edges with weight >= tau.
    if core_weight_tau is None:
        # Default tau: median weight (at least 2) so residual light edges are deferred.
        ws = sorted(weights.values())
        core_weight_tau = max(2, ws[len(ws) // 2] if ws else 2)
    core_edges = [
        {"course_a": a, "course_b": b, "weight": w}
        for (a, b), w in weights.items()
        if w >= core_weight_tau
    ]
    core_adj, core_w = _build_weighted_adj(core_edges)
    core_lb = 0
    if core_adj:
        for comp in _connected_components(core_adj):
            core_lb += _best_cliques_lb(core_adj, core_w, comp, num_weekdays)
        if core_lb > existing:
            notes.append(
                f"Core-edge LB (τ≥{core_weight_tau}, {len(core_edges)} edges) ≥ {core_lb}."
            )

    # Identical-twin fold hint: count foldable pairs (LB-safe merge of equal neighborhoods).
    twin_folds = 0
    nodes = list(adj.keys())
    for i, u in enumerate(nodes):
        for v in nodes[i + 1 :]:
            if weights.get(_pair_key(u, v), 0) > 0:
                continue
            nu = adj.get(u, set())
            nv = adj.get(v, set())
            if nu != nv:
                continue
            if all(weights.get(_pair_key(u, k), 0) == weights.get(_pair_key(v, k), 0) for k in nu):
                twin_folds += 1
    if twin_folds:
        notes.append(
            f"Detected {twin_folds} identical-twin course pair(s) (equal weighted neighborhoods)."
        )

    final_lb = max(existing, comp_lb, core_lb)
    return {
        "min_clash_weight_lower_bound": final_lb,
        "component_count": len(comps),
        "core_edge_count": len(core_edges),
        "core_weight_tau": core_weight_tau,
        "twin_fold_candidates": twin_folds,
        "notes": notes,
    }
