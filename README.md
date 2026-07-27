# UniSlot

Terminal evening-course scheduler for universities. Upload an enrollment Excel workbook, then optimize a Mon–Sat evening timetable with **Google OR-Tools CP-SAT** using all CPU cores. When the solver reports proven optimal, clash weight cannot be reduced further under the course→weekday model.

**Usage guide:** [GUIDE.md](GUIDE.md) · **Constraints:** [docs/Constraints.md](docs/Constraints.md) · **Excel schema:** [docs/excel_schema.md](docs/excel_schema.md)

## Prerequisites

- Node.js 20+
- Python 3.10+ (for OR-Tools)

## Install

```bash
npm install
npm run setup:cpsat    # creates solver/cpsat/.venv and installs ortools
```

## First solve

```bash
npm run unislot
```

Interactive flow: native file picker → seed prompt (reuse or new) → parse → CP-SAT → export folder. Each run gets a seed; `summary.json` and `snapshot.json` record it for reruns.

Non-interactive (`-y` skips the seed prompt and auto-generates one):

```bash
npm run unislot -- solve -i enrollment.xlsx -o ./unislot-out -y
```

A new seed is generated automatically; check `summary.json` for the value. To reproduce a prior run, use interactive mode and enter that seed when asked.

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

- **Time model:** one evening session per weekday (Mon–Sat, 5–7 PM). Saturday is mathematics-only.
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
