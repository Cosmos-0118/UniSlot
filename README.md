# UniSlot

Terminal evening-course scheduler for universities. Upload an enrollment Excel workbook, then optimize a Mon–Sat evening timetable with **Google OR-Tools CP-SAT** using all CPU cores. The scheduling goal is to give as many students as possible a completely clash-free timetable.

**Usage guide:** [GUIDE.md](GUIDE.md) · **Constraints:** [docs/Constraints.md](docs/Constraints.md) · **Excel schema:** [docs/excel_schema.md](docs/excel_schema.md)

## Prerequisites

- Node.js 20+
- Python 3.11–3.13 (setup prefers 3.12; pin with `UNISLOT_PYTHON_VERSION=3.12`)
  - Windows: `python` / `py` on PATH is enough; or set `UNISLOT_PYTHON` to `python.exe` (CMD `set`, PowerShell `$env:`)

## Install

```bash
npm run setup          # sync GitHub, install Node + OR-Tools, verify the repo
```

`npm run setup` fetches `origin`, synchronizes the selected branch exactly to
GitHub, installs the committed lockfile with `npm ci`, creates or repairs the
Google OR-Tools CP-SAT environment, and runs the doctor, tests, and lint. It
asks before discarding tracked or non-ignored untracked changes; use
`npm run setup -- --yes` for a deliberate non-interactive reset. Ignored files
such as `solver/cpsat/.venv` and local output folders are preserved by the Git
cleanup unless they conflict with a tracked path in the target branch; those
collisions are shown before confirmation. `npm ci` replaces `node_modules` as
part of the Node installation.

To install and verify the current checkout while keeping local changes, use
`npm run setup -- --skip-git`. Setup checks npm advisories before continuing to
the solver installation. The committed `allowScripts` policy approves only the
reviewed esbuild and fsevents versions; review their install scripts and refresh
those approvals when upgrading them.

For only the Python solver environment, use `npm run setup:cpsat`.

## First solve

```bash
npm run unislot
```

Interactive flow: native file picker → seed / reproduction-token prompt (reuse or new) → parse → CP-SAT → export folder. Each run prints a **reproduction token** (`seed/workers/portfolio/sat`, e.g. `77/8/0/0`) and stores the same fields in `summary.json` / `snapshot.json` for reruns.

Non-interactive (`-y` skips the seed prompt and auto-generates one):

```bash
npm run unislot -- solve -i enrollment.xlsx -o ./unislot-out -y
```

A new seed is generated automatically; check `summary.json` for `repro_token`. To reproduce a prior run interactively, enter that token when prompted. Or with flags:

```bash
npm run unislot -- solve -i enrollment.xlsx -o ./unislot-out -y --seed 12345 --workers 8
```

### Cross-device reproduction

To get the **same schedule on another machine**:

1. Enter the full reproduction token (`seed/workers/portfolio/sat`) when prompted — or pass matching `--seed` / `--workers` / `--portfolio 0`.
2. Use the same enrollment input file.
3. Keep `--portfolio 0` and omit `--time-limit` / `--prove-plateau` / `--absolute-gap`.
4. Match OR-Tools and Python versions (`npm run setup:cpsat` pins both; `summary.json` records `ortools_version` and `python_version`).

A plain seed number alone is still accepted, but workers then default to this machine's CPU count and the schedule may differ.

Check the solver environment:

```bash
npm run unislot -- doctor
```

## How it works

```text
Enrollment .xlsx
  → parse & validate
  → section splits + conflict graph
  → CP-SAT (course → weekday, all CPUs)
  → hard-constraint audit
  → schedule.xlsx · clash-report.xlsx · course-emails.xlsx · summary.json
```

- **Time model:** one evening session per weekday (Mon–Sat, 5–7 PM). Saturday is for maths (when enabled) and/or explicitly allowlisted course codes.
- **Required objective:** minimize unique RED students, then clash weight, then weekday balance and parallel excess. Count an affected student once, even if several courses overlap. Lower-priority improvements must never increase RED count.
- **Implementation:** the solver minimizes RED students first, then clash weight, weekday balance, and parallel excess. Pair-cost and load improvements are considered only among schedules tied at higher-priority levels.
- **Roster model:** section assignment is capacity-balanced and validates canonical enrollments. Course-pair weights come from the canonical student roster, so changing which section holds a student cannot lower the timetable conflict objective.
- **Staffing:** supplied instructors remain identifiable on split courses. Extra sections without assigned staff receive `Planning:` placeholders, which represent staffing needs rather than confirmed faculty availability.
- **Proof:** `proven_optimal: true` means the minimum RED count is proven. `proven_levels` records proven levels in order: `red_students`, `clash_weight`, `balance_and_parallel`. `red_bound` / `red_gap` describe the primary RED proof; `clash_bound` / `clash_gap` describe the pair-cost proof conditional on the fixed RED count. A CP-SAT `OPTIMAL` status alone does not certify a level when a configured gap limit leaves a nonzero integer gap.
- **Run policy:** new snapshots and summaries include `objective_policy: "red-first-v1"`; folders without that field retain their historical objective and certificate meanings. Frozen edits without new course placement preserve the prior marker. `--clash-only` is a pair-cost diagnostic and never sets `proven_optimal`; `--primary-only` runs the RED-first portfolio ranking.

## Project layout

```text
cli/                      Terminal UI (file dialogs, progress, exports)
solver/cpsat/             Python OR-Tools CP-SAT model
scripts/setup.mjs          Full Git + Node + OR-Tools bootstrap
scripts/setup-cpsat.ts     Python/OR-Tools venv bootstrap
src/modules/scheduling/   Parse, preprocess, Excel I/O, CP-SAT bridge
docs/                     Constraints, Excel schema, research
tests/                    Vitest suites
GUIDE.md                  Step-by-step usage
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run unislot` | Run the scheduler CLI |
| `npm run setup` | Sync GitHub + install and verify the complete toolchain |
| `npm run setup:cpsat` | Create/repair Python venv + install OR-Tools |
| `npm test` | Run Vitest |
| `npm run lint` | ESLint |

## Outputs

Default directory `./unislot-out/` (or `-o`):

| File | Contents |
|------|----------|
| `schedule.xlsx` | Section → day / time / faculty / enrollment |
| `clash-report.xlsx` | Student clash workbook |
| `course-emails.xlsx` | Deduplicated emails per course |
| `snapshot.json` | Machine-readable run state |
| `summary.json` | Status, clash weight, RED, `proven_optimal` |

## License

Private project.
