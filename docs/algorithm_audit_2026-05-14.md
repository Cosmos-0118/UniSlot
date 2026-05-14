# UniSlot Algorithm Audit (2026-05-14)

## Follow-up (same day)

The following audit items were implemented in code:

- **P0 greedy fallback**: Construction no longer picks a slot only by minimum load when all slots are “infinite” cost. Every slot is scored with explicit **faculty** and **parallel-cap** violation penalties plus clash and load balance, so feasible slots are preferred in a deterministic order.
- **P1 objective / KPI**: The hybrid SA/Tabu phase now optimizes a **lexicographic** goal: minimize **students with ≥2 sections in the same slot** first, then minimize **total weighted edge clashes** (same as `computeClashWeight`). Aspiration and simulated annealing use a combined score `Δstudents × (sumEdgeWeights + 1) + Δedges`.
- **Adaptive multi-start**: Replaced fixed 250/25 with `multiStartRunCount(n)` and `solutionPoolSize(runs)` (roughly √n-scaled). Phase 2 compares refinements with the same lex order.
- **Parser**: Added **`mobile no`** → `mobile_number` column alias (`parser.ts`).

`npm run lint` and `npx tsc -b --noEmit` pass after these changes.

---

## Executive Summary

UniSlot uses a solid heuristic foundation (greedy construction + SA/Tabu/Kempe local search on a conflict graph), but it is **not the best possible algorithmic setup** for your stated goals.

Assumption update (from your input sample): scheduling is currently **student-clash driven**, and faculty is mapped later in output flows.

Main reasons:

- Critical hard constraints can be bypassed in fallback paths.
- Optimization objective is not fully aligned with the headline KPI shown to users.
- Runtime strategy is fixed and expensive, without adaptive stopping or reproducibility controls.

## Overall Rating

**7.0 / 10**

Interpretation:

- **Strengths**: Good core idea, practical local search operators, conflict-graph model, browser worker isolation.
- **Weaknesses**: Feasibility enforcement and objective/KPI mismatch still prevent a higher score.

## Scope and Method

Audited components:

- `src/modules/scheduling/parser.ts`
- `src/modules/scheduling/preprocessing.ts`
- `src/modules/scheduling/scheduler.ts`
- `src/modules/scheduling/pipeline.ts`
- `src/modules/scheduling/types.ts`
- `src/features/LandingPage.tsx`

Validation performed:

- `npm run lint`
- `npm run build`

Both checks passed.

## Findings (Ordered by Severity)

## 1) Hard constraints can be violated by greedy fallback (Critical)

Evidence:

- Infeasible slots (faculty clash or slot over-cap) are marked Infinity: `src/modules/scheduling/scheduler.ts:546`, `src/modules/scheduling/scheduler.ts:548`.
- If all slots are Infinity, code still assigns a slot by minimum load: `src/modules/scheduling/scheduler.ts:566`.

Impact:

- Initial assignment can violate faculty or parallel-cap constraints.
- Later local search optimizes clash weight but does not enforce global feasibility as a hard accept criterion.

Why this matters:

- A schedule can look "optimized" while still breaking operational constraints.

## 2) Objective function is not fully aligned with final KPI (High)

Evidence:

- Solver objective: sum of conflicting edge weights `computeClashWeight`: `src/modules/scheduling/scheduler.ts:29`.
- Final headline metric in clash report: number of students with clashes: `src/modules/scheduling/scheduler.ts:803`.

Impact:

- Minimizing pairwise weighted clashes is related, but not equivalent, to minimizing unique affected students.
- Optimizer may prefer solutions that reduce pair count while still leaving more students red.

Why this matters:

- User-visible success criteria can diverge from what the solver is actually optimizing.

## 3) Runtime strategy is rigid and potentially expensive (High)

Evidence:

- Fixed multi-start count = 250: `src/modules/scheduling/scheduler.ts:15`.
- Top-pool refinement count = 25: `src/modules/scheduling/scheduler.ts:16`.
- SA/Tabu loop upper bound can reach 1,000,000 iterations: `src/modules/scheduling/scheduler.ts:111`.

Impact:

- Over-computation on easy datasets; unpredictable runtime on hard/larger ones.
- No adaptive budget (time-based stop, convergence stop, or dataset-size policy).

Why this matters:

- Performance consistency is critical in browser-worker execution.

## 4) Domain rules are hard-coded and not configurable (Medium)

Evidence:

- Saturday eligibility tied to course code containing `MAB`: `src/modules/scheduling/scheduler.ts:19`.
- Parallel cap computed from number of sections, not explicit resource constraints: `src/modules/scheduling/scheduler.ts:23`.

Impact:

- Logic may fail when naming conventions change.
- Schedules are less transferable across departments/semesters/campuses.

Why this matters:

- Hard-coded assumptions reduce robustness and future maintainability.

## 5) Parser accepts up to 19.9% row-level critical errors and still marks file valid (Medium)

Evidence:

- Validity threshold based on error rate < 0.2: `src/modules/scheduling/parser.ts:310`.

Impact:

- Scheduling can run on materially incomplete or biased data.
- Failure mode is silent degradation, not explicit stop.

Why this matters:

- In timetabling, bad input quality directly distorts conflict graph quality.

## 6) Input alias gap: "Mobile No" is not recognized by current parser aliases (Low)

Evidence:

- Input sample uses "Mobile No".
- Parser aliases include mobile number/mobile/phone/contact, but not "mobile no": `src/modules/scheduling/parser.ts:31` to `src/modules/scheduling/parser.ts:35`.

Impact:

- Mobile values may be dropped when this exact header variant is used.

Why this matters:

- This is optional data, but still a data-quality gap against your real sheet format.

## 7) Clash report stores only one clash day per student (Low)

Evidence:

- `clashingDay` gets overwritten in loop, last clash day wins: `src/modules/scheduling/scheduler.ts:768`, `src/modules/scheduling/scheduler.ts:778`.

Impact:

- Report under-represents multi-day clash cases for a student.

Why this matters:

- Analytics and remediation workflows can be misled.

## 8) Determinism and test coverage gaps (Low)

Evidence:

- Stochastic search relies on `Math.random` with no seed control: `src/modules/scheduling/scheduler.ts:526`.
- No unit/integration test files found in workspace.

Impact:

- Reproducibility and regression detection are weak.

Why this matters:

- Makes benchmarking and safe iteration harder.

## 9) Product copy overstates algorithm guarantees (Low)

Evidence:

- "optimal conflict-free schedules" claim: `src/features/LandingPage.tsx:89`.
- "ensure optimal scheduling with zero undetected clashes" claim: `src/features/LandingPage.tsx:125`.

Impact:

- Sets expectations that current heuristic architecture cannot guarantee in general NP-hard timetabling.

## Is This the Best Possible Algorithm?

Short answer: **No**.

Long answer:

- Timetabling is NP-hard, so "best possible" in absolute terms is unrealistic across all instances.
- For your current architecture and student-only input constraints, this is a **decent heuristic baseline**, but not best-in-class due to feasibility and objective alignment gaps.
- A stronger design is a **hybrid hard-constraint model + metaheuristic or CP-SAT backend** with lexicographic objectives.

Note on faculty:

- If faculty is truly mapped only after schedule generation, the solver cannot prevent faculty timetable collisions by design.
- That is acceptable only if faculty non-overlap is explicitly out of scope for now.

## Recommended Target Architecture

1. Enforce hard constraints strictly:
- No fallback that places infeasible assignments.
- Track feasibility status explicitly and reject infeasible final outputs.

2. Keep a clear mode boundary:
- Student-only mode: do not advertise faculty constraint enforcement.
- Faculty-aware mode (future): ingest faculty mapping before solve and enforce no-overlap.

3. Align objective with business KPI:
- Primary objective: minimize unique students with >=1 clash.
- Secondary objective: minimize total pairwise conflict weight.
- Tertiary objective: improve load balance.

4. Adaptive runtime policy:
- Time-budgeted multi-start and auto-stop on plateau.
- Dataset-size-based iteration caps.

5. Reproducibility and validation:
- Seeded RNG support.
- Add benchmark fixtures + regression tests (small exact-check instances + medium realistic datasets).

## Priority Action Plan

### P0 (Immediate)

- Remove infeasible-slot fallback behavior; return/flag infeasible if no legal slot exists.
- Add final feasibility audit after optimization.
- Add missing input aliases from your real sheet headers (for example "Mobile No").

### P1 (Short Term)

- Convert objective to lexicographic multi-objective scoring matching clash-report KPI.
- Add adaptive stop conditions and runtime budgets.
- Add deterministic seeded runs + repeatability mode.

### P2 (Medium Term)

- Build evaluation harness comparing current heuristic vs improved version on fixed datasets.
- If faculty constraints become in-scope, ingest faculty mapping pre-solver and enforce hard non-overlap.
- Optionally add CP-SAT path for smaller/medium instances needing stronger optimality guarantees.

## Final Verdict

The current approach is **promising but not production-optimal** yet.

If P0 items are fixed, this can move into the ~7.8/10 range quickly.
If P1 + reproducibility/testing are done well, it can realistically reach ~8.5/10 for heuristic scheduling quality and trustworthiness.
