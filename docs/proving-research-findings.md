# UniSlot proving research findings

Research executed against the live course→weekday CP-SAT model (not the older 55-slot doc). Goal: understand why “proving” burns wall time and which literature/product levers actually help.

## 1. Diagnostic result (synthetic hard instance)

Command:

```bash
solver/cpsat/.venv/bin/python solver/cpsat/diagnose_gap.py \
  --courses 70 --edge-prob 0.35 --time-limit 35 --workers 4 --seed 7
```

| Metric | Value |
|--------|-------|
| Diagnosis | **`bound_stuck`** |
| First feasible clash | 2613 at 0.13s |
| Final incumbent | 286 |
| Final dual bound | 13 |
| Final gap | **273** |
| Bound last moved | ~10s (0→7→13), then flat |
| Late phase | incumbent + bound both flat while proving |

Interpretation: UniSlot finds good clash incumbents quickly; OPTIMAL fails because the **dual bound does not rise** to meet the incumbent. Further portfolio/warm-start work alone will not finish prove.

Instrumentation added:

- Heartbeats refresh `bound` / `gap` / `incumbent` during proving ([`solve.py`](../solver/cpsat/solve.py))
- `--gap-trace` NDJSON + `gap_analysis` on the solution
- [`diagnose_gap.py`](../solver/cpsat/diagnose_gap.py) for synthetic Max-6-Cut–style stress tests

Re-run the same `--gap-trace` on a real enrollment to confirm the same shape (expected).

---

## 2. Problem identity (search under the right name)

Minimizing monochromatic conflict-edge weight with a fixed number of weekdays is the dual of **weighted Max-k-Cut** (k = 6), not classical proper coloring and not full UCTP slot assignment.

Useful aliases when reading papers:

- weighted Max-k-Cut / minimum k-partition (minimize within-cluster weight)
- weighted improper / threshold improper coloring (related but usually min colors for a defect threshold)
- conflict-graph timetabling lower bounds / clique inequalities (structure, not the exact objective)

---

## 3. Tier 1 findings — lower bounds & kernels

### Stronger duals (highest leverage)

What you have today: clique size vs 6 colors + pigeonhole → `min_clash_weight_lower_bound` ([`lowerBounds.ts`](../src/modules/scheduling/solver/lowerBounds.ts)). Diagnostic bound stayed at **13** while incumbent was **286** — structural LB is far too weak on dense weighted graphs.

| Approach | Relevance | Practicality at UniSlot scale (~10² courses) |
|----------|-----------|-----------------------------------------------|
| **Weighted Max-k-Cut LP/SDP relaxations** (facet cuts, SDP-based inequalities; e.g. Ghaddar–Anjos–Liers bundle B&C, LP+eigenvalue cuts) | Direct: upper-bounds cut weight ⇒ lower-bounds clash | SDP heavy; **LP + combinatorial cuts** more shippable as offline LB or cut pool |
| **Poljak–Turzík / spanning-tree style Max-Cut LBs** (weighted Max-Cut literature) | Strong for k=2; ideas extend weakly to k>2 | Cheap heuristics worth trying as cuts |
| **Weighted improper coloring bounds** (Araujo et al.; Guðmundsson et al. FPT by treewidth) | Same monochrome-weight language | Theory-heavy; treewidth of enrollment graphs may be usable |
| Fractional / column-generation chromatic LBs | Better for *proper* coloring chromatic number | Secondary unless you first ask “is zero clash possible?” |

**Actionable next experiments:** compute an offline Max-6-Cut upper bound (greedy + local search on cut) and inject `clash >= total_weight - cut_UB`; compare to clique LB on real enrollments.

### Graph reduction / kernelization

| Technique | Source | UniSlot fit |
|-----------|--------|-------------|
| **Dominated vertices** (N(u) ⊆ N(v) ⇒ u can share v’s color in proper coloring) | SAT coloring solvers (e.g. ZykovColor / arXiv 2504.04821) | For *improper weighted* objective, domination is **not always safe** — adapt carefully (same-day only when weights allow) |
| Twin / modular decomposition | Coloring kernelization (Jansen–Pieterse et al.) | Twins with identical neighbor weights can be merged for clash objective |
| Connected-component prove | Folklore | Safe: clash LB/optimum sums over components |
| Core by heavy edges | Heuristic | Prove on high-weight subgraph first; fix light courses from hint |

**Actionable:** component decomposition + twin merge on equal neighborhoods before CP-SAT; measure edge/var reduction on real graphs.

---

## 4. Tier 1 findings — CP-SAT / encodings

Current knobs: `num_search_workers`, `max_time_in_seconds`, `random_seed` only.

From [CP-SAT Primer – Parameters](https://d-krupke.github.io/cpsat-primer/parameters.html) and OR-Tools issues:

| Lever | Use for UniSlot | Caution |
|-------|-----------------|---------|
| `absolute_gap_limit` / `relative_gap_limit` | Stop when gap “good enough” (product escape) | Relative gap depends on objective offset |
| Idle-incumbent `StopSearch` callback | Cap pure-prove wall time after last improve | Returns FEASIBLE, not OPTIMAL |
| Portfolio subsolvers (`objective_lb_search`, `max_lp`) | Bound-focused workers already exist *inside* CP-SAT | **Do not** blindly set top-level `linearization_level` — breaks LNS portfolio balance |
| `log_search_progress` | Human diagnosis of bound rate | Noisy in CLI UI |
| Alternate encoding: explicit `x[c,d]` binaries + clique inequalities | Stronger LP relaxation for prove | Rework [`model.py`](../solver/cpsat/model.py); A/B vs current day IntVar + `same_day` reifs |
| Edge `same_day` as primary + implied days | Sometimes fewer vars | Worth a bake-off on gap-close time |
| Pure MIP (HiGHS/SCIP) on linearized Max-k-Cut | May close dual faster than CP-SAT on dense weighted graphs | Keep CP-SAT for feasibility/lex if MIP wins prove only |

Laurent Perron (OR-Tools): when improvement rate slows, it usually keeps slowing — stopping is often rational ([issue #2073](https://github.com/google/or-tools/issues/2073)).

---

## 5. Tier 2 findings — UniSlot structure

### Enrollment conflict graphs

- Edges are co-enrollment weights → near **block / multipartite** structure by program, not Erdős–Rényi (our synthetic diagnose is denser/harder than typical curricula).
- ITC 2019 MIP work (Holm; DTU graph-based MIP): **clique covers** of conflict graphs strengthen formulations; reduction/preprocessing removes redundant conflicts.
- Student-level interval-graph clique formulations (RSS / ITC papers) help *assignment* constraints more than weekday Max-k-Cut, but clique inequalities on the **course** conflict graph still apply.

### Sectioning before prove

[Edge Minimizing the Student Conflict Graph](https://optimization-online.org/wp-content/uploads/2021/02/8257.pdf) (greedy + CP-SAT sectioning) matches [`docs/research.md`](research.md): fewer/lighter conflict edges make both search and prove easier. With UniSlot’s simultaneous-section rule, sectioning cannot move sections across days — edge minimization is still valuable for **who shares which section**, shaping edge weights into the course graph.

### Lex strategy

Proving clash then fixing equality then RED is correct lexicographically. Research suggestion: treat RED/balance as **heuristic-only** once clash is proven (or gap-accepted); full three-level OPTIMAL is rarely needed for shipping schedules.

---

## 6. Policy decision (product)

**Chosen default: dual-track efficiency policy**

1. **Interactive / default run:** ship the best feasible schedule when either
   - clash `absolute_gap_limit` is small (e.g. 0, or a configured δ), or
   - incumbent unchanged for T seconds while still proving, or
   - `--time-limit` hits  
   Mark `proven_optimal: false` honestly; show bound/gap in UI (already partially there).
2. **Overnight / `--prove` mode:** unbounded (or long) clash prove for certificates when admins need them.
3. **Engineering priority for true speedups:** stronger clash LBs + graph reduction + encoding bake-off — **not** more portfolio seeds for incumbent quality.

Rationale: the diagnostic shows efficiency is lost on **bound closing**, not on finding schedules. Forcing OPTIMAL on every interactive run is the wrong default; researching Max-k-Cut LBs is the right path if certificates must stay fast.

---

## 7. Prioritized reading list (concrete)

1. Weighted Max-k-Cut LP/SDP computational papers (Ghaddar et al.; LP+eigenvalue cuts optimization-online 2018)
2. CP-SAT Primer parameters — gap limits + `objective_lb_search` portfolio notes
3. Edge-minimizing student conflict graph (Optimization Online 2021)
4. ITC 2019 graph-based MIP / clique formulation (DTU / Holm)
5. Dominated-vertex reductions in SAT coloring (arXiv:2504.04821) — adapt with care
6. Weighted improper colouring (Araujo–Bermond–Giroire–Havet–Mazauric–Modrzejewski)

---

## 8. Suggested implementation order (after research)

1. Keep gap-trace; run on one real enrollment; archive NDJSON
2. Offline stronger clash LB → inject into instance
3. Component + twin reduction preprocessor
4. Product: `--prove` vs default gap/idle stop
5. Encoding A/B (binary day matrix vs current) measured on **time-to-gap-0**, not time-to-first-feasible

---

## 9. Implemented (2026-07-25)

| Item | Status |
|------|--------|
| Gap-trace + bound refresh on heartbeats | Done (`--gap-trace`, `diagnose_gap.py`) |
| CP-SAT prove params (`optimize_with_core`, `linearization_level=2`, probing) | Done on clash prove; race stays primal-first |
| Weighted clique + component + core-edge LB cuts | Done (`lowerBounds.ts` + `bounds.py` via `model.py`) |
| Twin-fold detection (notes; fold-into-solve deferred) | Partial — counts candidates in bound notes |
| `--absolute-gap` / `--prove-plateau` / `--prove` | Done (CLI + bridge + pipeline) |
| Column generation / HiGHS hybrid / sectioning rewrite | Not started (Tier 2–3 research) |
