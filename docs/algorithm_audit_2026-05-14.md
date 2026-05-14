# UniSlot Algorithm Audit (2026-05-14)

## Post-Improvement Verification (Pass 2)

This is a fresh audit of the current code after your recent refactor and solver upgrades.
Scope audited:

- `src/modules/scheduling/parser.ts`
- `src/modules/scheduling/pipeline.ts`
- `src/modules/scheduling/preprocessing.ts`
- `src/modules/scheduling/engines/localSearchSolver.ts`
- `src/modules/scheduling/engines/faculty.ts`
- `src/modules/scheduling/engines/scheduleOutput.ts`
- `src/modules/scheduling/engines/timeModel.ts`
- `src/modules/scheduling/types.ts`
- `src/features/LandingPage.tsx`

Validation run during this pass:

- `npm run lint`
- `npm run build`

Both passed.

## Updated Rating

**8.1 / 10**

Rating rationale:

- Large step up from prior version: objective alignment, adaptive search, and conflict reporting are materially better.
- Remaining gaps are now mostly around end-to-end faculty workflow guarantees and explicit feasibility signaling.

## Confirmed Improvements (Verified)

1. Adaptive multi-start replaced old fixed heavy strategy.
- Evidence: `multiStartRunCount` and `solutionPoolSize` in `src/modules/scheduling/engines/localSearchSolver.ts:14`, `src/modules/scheduling/engines/localSearchSolver.ts:18`.
- Applied at runtime in `src/modules/scheduling/engines/localSearchSolver.ts:717`, `src/modules/scheduling/engines/localSearchSolver.ts:718`.

2. Solver objective now prioritizes students with clashes before edge weight.
- Evidence: student clash metric in `src/modules/scheduling/engines/localSearchSolver.ts:40`.
- Lexicographic best-state comparisons in `src/modules/scheduling/engines/localSearchSolver.ts:504` to `src/modules/scheduling/engines/localSearchSolver.ts:507` and `src/modules/scheduling/engines/localSearchSolver.ts:565` to `src/modules/scheduling/engines/localSearchSolver.ts:571`.

3. Greedy construction no longer uses simple infinite-slot fallback; it now scores all slots with hard-violation penalties.
- Evidence: `FACULTY_VIOL` and `CAP_HARD` in `src/modules/scheduling/engines/localSearchSolver.ts:622`, `src/modules/scheduling/engines/localSearchSolver.ts:623`.
- Penalty-based slot scoring in `src/modules/scheduling/engines/localSearchSolver.ts:637` to `src/modules/scheduling/engines/localSearchSolver.ts:665`.

4. Real input alias improvement is present.
- Evidence: `mobile no` alias added in `src/modules/scheduling/parser.ts:33`.

5. Clash report now supports multi-day clashes.
- Evidence: `clashing_days` generation in `src/modules/scheduling/engines/scheduleOutput.ts:165` to `src/modules/scheduling/engines/scheduleOutput.ts:181`.
- Excel output consumes `clashing_days` in `src/modules/scheduling/io/excelClashReport.ts:92` and `src/modules/scheduling/io/excelClashReport.ts:253`.

## Remaining Findings (Ordered by Severity)

## 1) Faculty constraint is still not end-to-end with real faculty assignment (High)

Evidence:

- Canonical course faculty remains null from input pipeline: `src/modules/scheduling/parser.ts:392`.
- Pipeline injects synthetic planning labels before solve: `src/modules/scheduling/pipeline.ts:106`.
- Placeholder generation policy is explicit in `src/modules/scheduling/engines/faculty.ts:6` to `src/modules/scheduling/engines/faculty.ts:10`, and assignments at `src/modules/scheduling/engines/faculty.ts:20`, `src/modules/scheduling/engines/faculty.ts:26` to `src/modules/scheduling/engines/faculty.ts:29`.
- Scheduler signature still accepts faculty constraints but does not use the parameter (`_facultyConstraints`): `src/modules/scheduling/engines/localSearchSolver.ts:693`.

Impact:

- Current run is effectively student-first with synthetic faculty resource IDs.
- If real faculty are decided later and one person is mapped to multiple scheduled sections, collisions can still appear after mapping.

Recommendation:

- Add a post-mapping validation and repair pass (minimal move policy), or ingest real faculty before solve when available.

## 2) Final feasibility/optimality status is not emitted (Medium)

Evidence:

- `SchedulerResult` type includes `optimal` and `feasible`: `src/modules/scheduling/types.ts:128`, `src/modules/scheduling/types.ts:129`.
- Actual scheduler return shape omits both fields: `src/modules/scheduling/engines/localSearchSolver.ts:696` to `src/modules/scheduling/engines/localSearchSolver.ts:700` and return object around `src/modules/scheduling/engines/localSearchSolver.ts:791`.

Impact:

- Downstream UI/export cannot distinguish "best found" from "provably feasible"/"provably optimal".

Recommendation:

- Add explicit final feasibility checks and return flags.

## 3) Seed-stage hard constraints are still best-effort penalties, not hard fail-fast (Medium)

Evidence:

- Construction evaluates violations as numeric penalties (`CAP_HARD`, `FACULTY_VIOL`) instead of rejecting assignment states outright: `src/modules/scheduling/engines/localSearchSolver.ts:622` to `src/modules/scheduling/engines/localSearchSolver.ts:665`.

Impact:

- On difficult or impossible instances, solver may still produce the least-bad schedule without surfacing infeasibility explicitly.

Recommendation:

- Add a strict post-solve feasibility audit and fail/flag when hard constraints remain violated.

## 4) Parser still accepts up to 19.9% row-level critical errors (Medium)

Evidence:

- Parse validity threshold remains `errorRate < 0.2`: `src/modules/scheduling/parser.ts:313`.

Impact:

- Scheduling can proceed with materially degraded input quality.

Recommendation:

- Tighten threshold or gate by absolute critical error count.

## 5) Determinism and automated regression safety are still weak (Low)

Evidence:

- Stochastic flow still uses `Math.random` in solver: `src/modules/scheduling/engines/localSearchSolver.ts:490`, `src/modules/scheduling/engines/localSearchSolver.ts:522`, `src/modules/scheduling/engines/localSearchSolver.ts:613`.
- No unit/integration test files were found in workspace.

Impact:

- Harder to reproduce run-to-run behavior and benchmark deltas safely.

Recommendation:

- Add seedable RNG path and baseline fixture tests.

## 6) Minor domain-model mismatch: type allows Saturday, solver model is Mon-Fri only (Low)

Evidence:

- `DayName` includes Saturday: `src/modules/scheduling/types.ts:7`.
- Time model defines 5 weekdays only: `src/modules/scheduling/engines/timeModel.ts:8` to `src/modules/scheduling/engines/timeModel.ts:14`.

Impact:

- Potential confusion for consumers expecting Saturday from type-level contract.

Recommendation:

- Align type union with active model or make weekend mode explicit.

## 7) Product copy still overstates guarantees (Low)

Evidence:

- "optimal conflict-free schedules" in `src/features/LandingPage.tsx:69`.
- "zero undetected clashes" in `src/features/LandingPage.tsx:107`.

Impact:

- Claims exceed what a stochastic NP-hard heuristic can guarantee.

Recommendation:

- Rephrase to "high-quality" / "best found" language.

## Re-Rating Summary

Previous rating: **7.0 / 10**
Current verified rating: **8.1 / 10**

Why score increased:

- Objective/KPI alignment improved significantly.
- Runtime scaling strategy is substantially more practical.
- Conflict reporting quality improved.
- Parser alias gap (`mobile no`) was fixed.

Why not higher yet:

- Real faculty assignment still needs a formal second pass for guaranteed final feasibility.
- No explicit feasibility/optimality status in solver output.
- Determinism/testing maturity is still low.
