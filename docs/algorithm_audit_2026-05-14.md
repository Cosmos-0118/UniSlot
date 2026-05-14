# UniSlot Algorithm Audit (2026-05-14)

## Post-Improvement Verification (Pass 3)

This is a fresh re-audit after your latest fixes. It supersedes Pass 2 findings that are no longer valid.

Scope audited:

- `src/modules/scheduling/parser.ts`
- `src/modules/scheduling/pipeline.ts`
- `src/modules/scheduling/scheduler.ts`
- `src/modules/scheduling/engines/localSearchSolver.ts`
- `src/modules/scheduling/engines/faculty.ts`
- `src/modules/scheduling/engines/rng.ts`
- `src/modules/scheduling/engines/scheduleOutput.ts`
- `src/modules/scheduling/types.ts`
- `src/features/LandingPage.tsx`

Validation run:

- `npm run lint`
- `npm run build`

Both passed.

## Updated Rating

**8.8 / 10**

Why:

- Core solver quality is now strong and materially improved.
- Major previous gaps (feasibility signaling, parser strictness, schema alignment, product claims) have been fixed.
- Remaining issues are mostly integration/productization gaps, not core algorithm correctness flaws.

## Confirmed Fixes Since Pass 2

1. Deterministic RNG support exists in solver internals.
- Evidence: `createRng` in `src/modules/scheduling/engines/rng.ts:4`.
- Solver now uses injected RNG in search loops: `src/modules/scheduling/engines/localSearchSolver.ts:777`, `src/modules/scheduling/engines/localSearchSolver.ts:490` to `src/modules/scheduling/engines/localSearchSolver.ts:543`.

2. Hard-constraint audit is now implemented and returned.
- Evidence: `auditScheduleHardConstraints` in `src/modules/scheduling/engines/localSearchSolver.ts:242`.
- Feasibility/optimal flags returned: `src/modules/scheduling/engines/localSearchSolver.ts:881` to `src/modules/scheduling/engines/localSearchSolver.ts:883`.
- Pipeline passes these into schedule meta: `src/modules/scheduling/pipeline.ts:118` to `src/modules/scheduling/pipeline.ts:120`.
- UI shows warning when infeasible: `src/features/Scheduler.tsx:28`.

3. Parser is now materially stricter.
- Evidence: combined relative+absolute gate `errorRate <= 0.06` + `maxAbsoluteErrors` in `src/modules/scheduling/parser.ts:314` to `src/modules/scheduling/parser.ts:316`.

4. Faculty field is now parsed and propagated to canonical data.
- Evidence: parse row includes faculty in `src/modules/scheduling/parser.ts:306`.
- Canonical course faculty set when provided: `src/modules/scheduling/parser.ts:402`.

5. Day model mismatch was corrected.
- Evidence: `DayName` no longer includes Saturday in `src/modules/scheduling/types.ts:1`.

6. Landing-page overclaims were corrected.
- Evidence: claims updated to "high-quality" wording in `src/features/LandingPage.tsx:71`.

## Remaining Findings (Current)

## 1) Seeded determinism is not exposed end-to-end (Medium)

Evidence:

- Solver supports seed option: `src/modules/scheduling/engines/localSearchSolver.ts:766`.
- Pipeline calls `runScheduler` without options: `src/modules/scheduling/pipeline.ts:112`.
- Worker request has no seed field: `src/modules/scheduling/scheduling.worker.ts:5`.
- Hook request also has no seed plumbing: `src/hooks/useUnislotWorker.ts:84`.

Impact:

- Reproducibility cannot be controlled from UI/worker API yet, even though solver internals support it.

Recommendation:

- Add optional `randomSeed` through WorkerRequest -> pipeline -> runScheduler.

## 2) Infeasible schedules are flagged but still exported (Medium)

Evidence:

- Pipeline always proceeds to export regardless of feasibility flag: `src/modules/scheduling/pipeline.ts:123`.
- UI warns but still allows downloads: `src/features/Scheduler.tsx:332`, `src/features/Scheduler.tsx:342`.

Impact:

- Operational users can still consume provisional schedules as final by mistake.

Recommendation:

- Add policy mode: either block exports on infeasible runs or require explicit "export provisional" confirmation.

## 3) Real faculty assignment after output still needs a formal reconciliation pass (Medium)

Evidence:

- When faculty is absent, placeholders are synthesized: `src/modules/scheduling/engines/faculty.ts:20`, `src/modules/scheduling/engines/faculty.ts:28`.
- This supports planning constraints, but real post-hoc faculty mapping can still introduce collisions outside solve-time assumptions.

Impact:

- If mapped faculty differ from planning labels, final timetable can regress without automated repair.

Recommendation:

- Add post-mapping faculty validation + minimal-change repair pass.

## 4) Automated regression tests are still missing (Low)

Evidence:

- No `*.test.*` / `*.spec.*` files found in workspace.

Impact:

- Changes to heuristics remain harder to benchmark and safely evolve.

Recommendation:

- Add fixture-based solver regression tests (small exact cases + medium realistic cases).

## Re-Rating Summary

Previous verified rating (Pass 2): **8.1 / 10**
Current verified rating (Pass 3): **8.8 / 10**

Why score increased:

- Hard-constraint feasibility audit and signaling are now in place.
- Parser strictness and data contract are substantially better.
- Deterministic RNG capability was added.
- Type/domain and product-messaging issues were corrected.

What still caps the score:

- Determinism is not user-configurable end-to-end yet.
- Infeasible run handling is warning-only, not policy-enforced.
- Post-mapping faculty reconciliation remains external.
- No automated regression suite.

## Final Verdict

Your latest fixes are significant and real. The scheduling engine is now in a strong state for heuristic quality and operational transparency.

Next leap to ~9.2+ is mostly productization: expose seed control, enforce infeasibility policy, and add post-mapping faculty repair + regression tests.
