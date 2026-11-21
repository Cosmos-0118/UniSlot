# Backend speed and optimization plan

Scope: backend only. The CLI, menus, prompts and output files stay exactly as they are, so nobody has to relearn anything. Everything below changes how the schedule is computed, not how it is asked for or shown.

Baseline: `27d7c65`. The work to port from lives in the git stash `classic-CLI work on .NET (pre-reset backup)` (`git stash list`; `git stash show -p --include-untracked stash@{0}`) and on `origin/main-UI` (`ae534db`), which hold the .NET `UniSlot.Solver` annealing engine.

## 1. What the problem is

Assign each course (or section) to one of 6 weekdays. The goal order is fixed (`docs/Constraints.md` §2): fewest RED students (students with two courses on one weekday), then weighted clash pairs, then weekday balance, then parallel excess. This is weighted Max-6-Cut with side constraints (`docs/proving-research-findings.md` §2).

Where the time goes today (from the code and the research notes):

- The dual bound gets stuck far below the incumbent, so "prove" burns its whole time limit (`bound_stuck`, 13 vs 286 in the synthetic run).
- The portfolio race starts `k` separate Python processes, each with `memberWorkers` threads, so threads can exceed cores.
- Every run starts a new Python process, rewrites the instance as JSON, and re-validates it.
- Excel reading/writing (`exceljs`) and the export files are built one after another.
- Edit flows (late, fix, rectify) re-solve the whole problem for a small change.

## 2. Plan, in order of payoff

### A. Measure first (half a day)
- Add a benchmark script that runs the real workbook (`CC Odd 2026-27 … Fully Updated.xlsx`) and a few synthetic sizes, and records per phase: parse, preprocess, instance build, time to first feasible, time to best RED, prove time, export time, total.
- Write the timings into `run-log.json` so every later change is compared with numbers, not feelings.
- Keep one reference result: on the real workbook the .NET engine reached RED 38 against a structural minimum of 29 with the `quick` preset. The new backend must match or beat that RED count.

### B. A fast local-search stage before CP-SAT (biggest win)
- Port the annealing engine from the stash: state is course→weekday; for each student keep a 6-slot count of courses per weekday; a move (change one course's day, or swap two) is scored by updating only the students enrolled in that course, so each move is O(students in the course), not O(all students).
- Run several independent chains in parallel on `worker_threads` (or a small native helper), each with its own seed; keep the best by (RED, clash weight, balance, parallel excess).
- Feed the winner to CP-SAT as the hint and incumbent, replacing `greedyHint.ts`. CP-SAT then only has to improve or prove, not search from scratch.
- Keep the repro token (`seed/chains/moves`) so a run can be reproduced exactly.

### C. Stop proving when it cannot help
- If the incumbent RED equals the structural lower bound (`lowerBounds.ts`), stop: it is optimal, skip the remaining lex phases that cannot improve.
- Make the plateau stop (`--prove-plateau`) the default with a sensible value, and cap the prove phase as a fraction of total time instead of "whatever is left".
- Strengthen the bound cheaply instead of waiting for CP-SAT: stronger clique/component bounds per connected component, computed once and cached.
- Report honestly: "RED 38, lower bound 29, not proven" is fine and should be shown as such.

### D. Shrink the model before it reaches CP-SAT
- Drop students with one course; merge students with identical course sets (weight = count). Use course-pair weights instead of per-student variables where RED allows it.
- Split by connected component of the conflict graph and solve components independently (in parallel).
- Break weekday symmetry: fix the largest clique to distinct days.
- Never re-solve what is already fixed: honour fixed days and faculty pins as constants.

### E. One solver process, right-sized threads
- Replace the multi-process portfolio with one CP-SAT process that uses all cores (`num_search_workers = cores`), with a different seed per run, unless the benchmark shows the race wins.
- If the race stays, enforce `k × memberWorkers ≤ cores`.
- Skip the venv/Python probing (`resolvePython.ts`) on every run: cache the resolved interpreter and the result of the self-check; pass the instance as a binary or compact file instead of pretty JSON.

### F. I/O and exports
- Parse the workbook once, with the streaming reader for large sheets; do not re-read it for derived files.
- Build `schedule.xlsx`, `clash-report.xlsx`, `course-emails.xlsx`, `name-list.xlsx` in parallel (`buildEagerExportsSequential` → parallel) and write the heavy ones lazily if they are not requested.
- Keep the output bytes deterministic for a given seed (`deterministicExport.ts`).

### G. Incremental edits
- Late enrollments, fix-course, drop-course and rectify touch few courses. Re-solve only the affected component(s) with everything else pinned, instead of the whole timetable.
- Keep the snapshot format unchanged so old output folders still work.

## 3. Non-negotiables
- Same or better RED count on the reference workbook; the hard-rule audit (`hardConstraints.ts`) passes on every result.
- Same CLI, same flags, same menu, same file names, same snapshot format.
- Same seed gives the same timetable.
- `npm test`, `npm run lint`, `npm run typecheck` stay green; add tests for the annealing stage (hard rules hold, seed is reproducible, RED never worse than the greedy hint).

## 4. Order of work
1. A (benchmark) → 2. B (annealing + hint) → 3. C (stop rules) → 4. E (single process) → 5. D (model shrink) → 6. F (exports) → 7. G (incremental edits).
Re-run the benchmark after each step and keep only the changes that help.

## 5. Known limits carried over
- Options like `--portfolio`, `--absolute-gap`, `--prove-plateau`, `--prove-strategy` exist in the old CLI. Keep them working; if a step above makes one meaningless, keep accepting it and print a one-line note.
- Edit semantics (`--on-full`, `--on-clash`, and so on) stay exactly as the old CLI defines them; only the solving underneath gets faster.
