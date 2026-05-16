# UniSlot Algorithm Audit

**Original pass:** 2026-05-14 (Pass 3)  
**Latest re-verification:** 2026-05-16 (Pass 5) — faculty mapping + integration tests landed.

---

## Pass 5 — Executive summary

The scheduling core remains strong. Pass 5 closes the main **operational** gap from Pass 4: **post-solve faculty assignment** with automatic **hard-constraint re-audit**, plus a thin **integration test** for `runScheduler` determinism.

**Pass 5 rating: 9.4 / 10** (was 9.0 in Pass 4).

Why it moved up:

- **`facultyMapping.ts`** — section-id keyed overrides, CSV import, `applyAndValidateFacultyMapping` → re-runs `auditScheduleHardConstraints` on real names while **slots stay frozen**.
- **`FacultyMappingPanel`** — UI on **Scheduler** (details) and **Saved runs** (detail): table for `Planning:…` sections, template CSV, upload, Apply & validate.
- **`SchedulingSnapshot.facultyOverrides`** — persisted on saved runs in `localStorage`.
- **`tests/scheduling/facultyMapping.test.ts`** — parse, double-booking detection, pass case.
- **`tests/scheduling/runScheduler.smoke.test.ts`** — fixed-seed determinism on a 2-course instance.

What still caps the score below 9.5+:

- No automated **minimal repair** when faculty mapping fails audit (user must fix names or slots manually).
- No full **`runPipeline`** golden-file regression on a real `.xlsx` fixture (smoke test only).

---

## Scope reviewed (Pass 5)

**Core (unchanged)**

- `parser.ts`, `pipeline.ts`, `scheduling.worker.ts`, `localSearchSolver.ts`, `faculty.ts`, `rng.ts`, `scheduleOutput.ts`, `types.ts`

**New / extended (Pass 5)**

- `facultyMapping.ts` — post-solve faculty reconciliation API
- `schedulingSnapshot.ts` — optional `facultyOverrides`
- `FacultyMappingPanel.tsx` — product UI
- `SavedRunsPage.tsx`, `Scheduler.tsx` — wired to panel

**Tests**

- `tests/scheduling/rng.test.ts`
- `tests/scheduling/auditScheduleHardConstraints.test.ts`
- `tests/scheduling/facultyMapping.test.ts` *(new)*
- `tests/scheduling/runScheduler.smoke.test.ts` *(new)*

**Validation (Pass 5)**

- `npm run lint`
- `npm test`
- `npm run build`

---

## Finding status — full history

| # | Topic | Pass 3 | Pass 4 | Pass 5 |
|---|--------|--------|--------|--------|
| 1 | Seeded determinism end-to-end | Open | **Resolved** | **Resolved** |
| 2 | Infeasible schedule export policy | Open | **Resolved** (block by default) | **Resolved** |
| 3 | Post-mapping faculty reconciliation | Open | Open | **Resolved** (mapping + re-audit UI) |
| 4 | Automated regression tests | None | Partial (audit + RNG) | **Mostly resolved** ( + faculty + scheduler smoke) |

---

## Pass 5 — Faculty reconciliation (formerly open)

### Design

1. **Solve time:** `applyDistinctFacultyPerSection` still assigns `Planning:{section_id}` when the sheet has no faculty (solver needs unique resource ids per section).
2. **After solve:** User assigns **real names** keyed by **`section_id`** (inline table or CSV: `section_id,faculty_name`).
3. **Validate:** `applyAndValidateFacultyMapping` merges overrides, updates section `faculty` fields, calls **`auditScheduleHardConstraints`** (faculty overlap, capacity, parallel cap, split-section same slot, etc.).
4. **Persist:** Overrides stored on `SchedulingSnapshot.facultyOverrides` and saved with the run in **Saved runs**.

### Evidence

- `src/modules/scheduling/facultyMapping.ts` — `parseFacultyMappingTable`, `applyAndValidateFacultyMapping`, `buildScheduleFromSnapshot`
- `src/features/FacultyMappingPanel.tsx`
- `src/features/SavedRunsPage.tsx` — panel + `updateSavedRunSnapshot` on apply
- `src/features/Scheduler.tsx` — panel in details view; updates `result.schedule` + export-block flags when audit fails after mapping

### Out of scope (future)

- Automatic slot moves to fix faculty collisions (minimal repair solver).
- Regenerating schedule `.xlsx` in-browser immediately after mapping (user can re-export from saved run / merge flow; schedule object in UI updates).

---

## Confirmed baseline (still true)

1. Deterministic RNG in solver (`rng.ts`, `runScheduler(..., { randomSeed })`).
2. Hard-constraint audit + UI notices (`auditScheduleHardConstraints`, `HardConstraintAuditNotice`).
3. Parser strictness + faculty column parsing.
4. Evening day model Mon–Fri (`types.ts`).
5. Landing copy avoids false optimality claims (`LandingPage.tsx`).
6. Late enrollment merge with frozen slots (`lateEnrollmentMerge.ts`).
7. Multi-sheet schedule workbook export (`excelScheduleWorkbook.ts`).

---

## Remaining findings (Pass 5)

### 1) Faculty collision repair (Low) — optional enhancement

If mapping assigns the same person to two sections in the **same slot**, audit fails and the UI explains why. There is no one-click “move section” repair yet.

### 2) Full pipeline fixture tests (Low)

`runScheduler.smoke.test.ts` covers deterministic search on synthetic data. A small frozen `.xlsx` or AoA fixture through `runPipeline` would further harden parser + sectioning + solve integration.

---

## Rating trajectory

| Pass | Date | Rating | Notes |
|------|------|--------|--------|
| 2 | (prior) | 8.1 | Pre–hard-audit |
| 3 | 2026-05-14 | 8.8 | Audit + RNG internals |
| 4 | 2026-05-16 | 9.0 | Seed + export policy + partial tests |
| **5** | **2026-05-16** | **9.4** | Faculty mapping + re-audit UI + integration smoke test |

---

## Final verdict (Pass 5)

The engine is **algorithmically sound** for heuristic evening scheduling with **transparent feasibility signaling**. Pass 5 makes the **faculty workflow** first-class: planning placeholders during solve, real names after, with **mandatory re-audit** before treating the timetable as faculty-certified. Remaining work is polish (repair heuristics, richer fixtures), not core correctness holes.
