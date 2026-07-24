# UniSlot

Terminal-first evening course scheduling for universities. Parse an enrollment Excel workbook, build sections and a student conflict graph, then optimize a weekly timetable with **Google OR-Tools CP-SAT** using all CPU cores — proving (when status is optimal) that clash weight cannot be reduced further.

A React SPA remains in-repo for browsing saved runs, but **the supported way to schedule is the CLI**.

Enrollment layout and outputs: [`docs/excel_schema.md`](docs/excel_schema.md). Constraints: [`docs/Constraints.md`](docs/Constraints.md).

## Quick start (CLI)

```bash
npm install
npm run setup:cpsat    # creates solver/cpsat/.venv + installs ortools
npm run unislot        # interactive: native file picker → solve → exports
```

Non-interactive:

```bash
npm run unislot -- solve -i enrollment.xlsx -o ./unislot-out -y
```

Optional escape hatch (not a quality “mode”): `--time-limit 120` stops the search early. Omit it to prove optimality.

`unislot doctor` checks Python / OR-Tools readiness.

### What the CLI does

1. Native **file open** dialog (or `-i`) for the enrollment `.xlsx`
2. Parse → sectioning → conflict graph (TypeScript pipeline)
3. **CP-SAT** course→weekday coloring on all CPUs (lex: clash weight → RED students → balance)
4. Live progress (phase, best clash, RED, bound, workers, elapsed)
5. Export schedule / clash report / course emails (+ snapshot JSON); optional folder picker

When `proven_optimal` is true, clash weight is **proven minimal** under the course→weekday model (split sections share a day, Saturday maths-only, faculty hard constraints).

## Features

| Area | What it does |
|------|----------------|
| **CLI** (`npm run unislot`) | Max-resource CP-SAT solve with native file dialogs, progress UI, Excel exports |
| **Scheduler** (`/app/scheduler`) | Legacy browser local-search (maximum effort only) — prefer the CLI for production runs |
| **Saved runs** (`/app/runs`) | Persist / reopen snapshots, late merge, faculty mapping, re-export |
| **Course emails** (`/app/emails`) | Per-course deduplicated email lists |

## How scheduling works

```text
Enrollment .xlsx
  → parse & validate          (parser.ts)
  → preprocess                (section splits, conflict graph, faculty)
  → CP-SAT (OR-Tools)         (cli → cpsatBridge → solver/cpsat/solve.py)
  → hard-constraint audit
  → Excel exports             (schedule, clash report, course emails)
```

**Time model:** Monday–Saturday evenings, 5:00 PM–7:00 PM — **6 weekday sessions** (one simultaneous session per day). Saturday is reserved for mathematics courses. Prefer about **11 parallel sections** per weekday as a soft comfort target.

**Solver:** CP-SAT assigns each **course** to a weekday (sections of a split course share that day). Primary objective: minimize monochrome conflict-edge weight. Lexicographic follow-ups: RED students, then weekday balance / soft parallel excess. Status `OPTIMAL` with `proven_optimal` means clashes cannot be reduced further under this model. Structural lower bounds (cliques / pigeonhole) are reported when zero-clash is impossible.

## Tech stack

- **CLI:** Node (tsx), Commander, Clack prompts, native OS file dialogs
- **Solver:** Python 3 + Google OR-Tools CP-SAT (`solver/cpsat/`)
- **Domain:** TypeScript parse / preprocess / Excel I/O (`src/modules/scheduling/`)
- **UI (secondary):** React 19, Vite 8, Tailwind CSS 4
- **Tests:** Vitest

Path alias `@/` → `src/`.

## Browser SPA (optional)

```bash
npm run dev
```

Production build: `npm run build` / `npm run preview`.

| Script | Purpose |
|--------|---------|
| `npm run unislot` | Terminal CP-SAT scheduler |
| `npm run setup:cpsat` | Create Python venv + install ortools |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run build:brand` | Regenerate favicons from brand source |

## Project layout

```text
cli/                        Terminal app (file dialogs, progress, exports)
solver/cpsat/               Python OR-Tools CP-SAT model + solve.py
scripts/setup-cpsat.mjs     Venv bootstrap
src/modules/scheduling/
  parse/ preprocess/ io/    Shared domain pipeline
  solver/cpsatBridge.ts     Spawn Python solver, NDJSON progress
  solver/cpsatInstance.ts   Instance JSON builder
  solver/localSearchSolver.ts  Legacy browser heuristic
  pipeline/run.ts           End-to-end run (solverBackend: cpsat | local-search)
docs/                       Constraints, Excel schema, research
tests/                      Vitest suites
```

## Outputs

After a successful CLI run (default `./unislot-out/`):

1. **schedule.xlsx** — section assignments (day, time, faculty, enrollment)
2. **clash-report.xlsx** — multi-sheet clash workbook
3. **course-emails.xlsx** — deduplicated addresses per course
4. **snapshot.json** / **summary.json** — machine-readable run record

## Documentation

| File | Contents |
|------|----------|
| [`docs/Constraints.md`](docs/Constraints.md) | Problem definition, hard/soft constraints |
| [`docs/excel_schema.md`](docs/excel_schema.md) | Input / output Excel formats |
| [`docs/research.md`](docs/research.md) | Background research |

## Tests

```bash
npm test
```
