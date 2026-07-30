# UniSlot

Terminal evening-course scheduler for universities. Upload an enrollment Excel workbook, then optimize a Mon–Sat evening timetable with **Google OR-Tools CP-SAT** using all CPU cores. When the solver reports proven optimal, clash weight cannot be reduced further under the course→weekday model.

**Usage guide:** [GUIDE.md](GUIDE.md) · **Constraints:** [docs/Constraints.md](docs/Constraints.md) · **Excel schema:** [docs/excel_schema.md](docs/excel_schema.md)

## Prerequisites

- Node.js 20+
- Python 3.11–3.13 (setup prefers 3.12; pin with `UNISLOT_PYTHON_VERSION=3.12`)

## Install

```bash
npm install
npm run setup:cpsat    # creates solver/cpsat/.venv and installs ortools
```

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
- **Objective:** minimize clash weight, then RED students, then weekday balance.
- **Proof:** `proven_optimal: true` in `summary.json` means clash weight is minimal under this model.

## Project layout

```text
cli/                      Terminal UI (file dialogs, progress, exports)
solver/cpsat/             Python OR-Tools CP-SAT model
scripts/setup-cpsat.mjs   Venv bootstrap
src/modules/scheduling/   Parse, preprocess, Excel I/O, CP-SAT bridge
docs/                     Constraints, Excel schema, research
tests/                    Vitest suites
GUIDE.md                  Step-by-step usage
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run unislot` | Run the scheduler CLI |
| `npm run setup:cpsat` | Create Python venv + install ortools |
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
