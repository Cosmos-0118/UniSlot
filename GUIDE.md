# UniSlot user guide

This guide explains how to install UniSlot and produce a clash-optimal evening timetable from an enrollment Excel workbook.

## 1. Install

You need **Node.js 20+** and **Python 3.10+**.

```powershell
cd UniSlot
npm install
npm run setup:cpsat
```

`setup:cpsat` creates `solver/cpsat/.venv` and installs Google OR-Tools. Re-run it if you change machines or delete the venv.

Verify:

```powershell
npm run unislot -- doctor
```

You should see the Python path, solver script, and “Ready to schedule.”

## 2. Prepare the enrollment workbook

Use an `.xlsx` file whose first sheet matches the UniSlot enrollment layout (header row + one row per student–course registration).

Required ideas:

- Student identity (register number, name, program)
- Course code and title
- Optional faculty, email, mobile

Full column rules and alternates: [docs/excel_schema.md](docs/excel_schema.md).  
Scheduling rules (Saturday for maths when enabled, plus optional allowlisted codes): [docs/Constraints.md](docs/Constraints.md).

## 3. Interactive solve (recommended)

```powershell
npm run unislot
```

What happens:

1. **File picker** — choose the enrollment `.xlsx` (macOS / Windows / Linux dialogs).
2. **Saturday policy** — confirm whether maths may use Saturday, then optionally enter extra course codes (comma-separated) that may also use Saturday even if maths Saturday is off.
3. **Parse** — row counts, students, courses.
4. **CP-SAT search** — a live multi-line panel with short stage-transition animations. Example:

   ```text
   ⠋ 1/3 Clash  minimize clash weight  ·  10w  ·  2m 05s
     ⣿⣼⢠⠀…  warm 22/30  →  clash   18  RED   18  bound 12 · gap 6  proving 12.4s
     ● 1/3 clash  ○ 2/3 RED  ○ 3/3 balance
     ────────────────────────────────────────
   ```

   - **1/3 Clash** — primary objective (clash weight).
   - **2/3 RED** — fewest students with a same-day conflict.
   - **3/3 Balance** — soft load balance after clashes are fixed.
   - **clash / RED** — best solution found so far.
   - **proving** — no better clash weight found recently; solver is closing the optimality proof. This can take a while on large enrollments; the clock still advances.
   - **gap / bound** — when shown, distance between best solution and proven lower bound.

   Short intro / stage / result / outro animations play on a TTY; they are skipped in non-interactive logs.

5. **Result panel** — status (`OPTIMAL` / `FEASIBLE`), clash weight, RED count, whether clashes are proven minimal.
6. **Output folder** — optional folder picker, or default `./unislot-out/`.

Cancel anytime with **Ctrl+C**.

## 3b. Issue Finder (enrollment data quality)

Before scheduling, audit the enrollment workbook for data-quality problems — no solver run.

```powershell
npm run unislot
# then choose "Find issues in enrollment file"
```

Or non-interactively:

```powershell
npm run unislot -- issues -i path\to\enrollment.xlsx -y
```

Findings are grouped in the terminal:

| Category | Meaning |
|----------|---------|
| Schema | Empty file / missing required columns |
| Missing fields | Empty program, register number, name, course code, or title |
| Duplicates | Same student + course more than once |
| Faculty | Multiple faculty names for one course code |
| Identity | Same register with conflicting names, or same course code with conflicting titles |
| Enrollment | Student left with no courses after dedupe |

Exit code `0` if there are no blocking errors (warnings alone are OK — Create schedule still drops duplicates). Exit `1` when blocking errors must be fixed first.

## 4. Non-interactive solve

Useful for scripts and CI:

```powershell
npm run unislot -- solve `
  -i path\to\enrollment.xlsx `
  -o path\to\output-dir `
  -y
```

| Flag | Meaning |
|------|---------|
| `-i, --input <file>` | Enrollment `.xlsx` |
| `-o, --output <dir>` | Export directory |
| `-y, --yes` | Skip interactive prompts when paths are given |
| `--saturday` / `--no-saturday` | Allow or block Saturday for maths |
| `--saturday-codes <list>` | Extra course codes allowed on Saturday (comma-separated), independent of maths |
| `--seed <n>` | Reuse a prior run seed (skips seed prompt; works with `-y`) |
| `--workers <n>` | CP-SAT workers for the prove phase (default: all CPUs) |
| `--portfolio <k>` | Multi-seed clash race before prove (default: `0`; `k>0` enables but breaks seed reproducibility) |
| `--time-limit <seconds>` | Escape hatch only — stops early; may not prove optimality |

Omit `--time-limit` for a full prove-to-optimal run. Before CP-SAT search, UniSlot builds a DSATUR + polish warm start and injects structural clash/RED lower bounds as model cuts.

**Seeds / reproduction tokens:** Each run prints a reproduction token `seed/workers/portfolio/sat` (e.g. `77/8/0/0`) and stores the same fields in `summary.json` / `snapshot.json` (`repro_token`, `seed`, `workers`, `portfolio`, `allow_saturday_for_math`). To reproduce the same schedule:

Interactive: answer yes to the seed prompt and paste the full token.

Or with flags:

```powershell
npm run unislot -- solve -i enroll.xlsx -o .\out -y --seed 12345 --workers 8
```

Use the same `--workers` as the original run. Keep `--portfolio 0` (the default) and omit `--time-limit` / `--prove-plateau` / `--absolute-gap`. With `-y` and no `--seed`, a fresh seed is generated automatically.

### Cross-device reproduction

The token's `workers` field overrides the current machine's CPU count, so entering `77/8/0/0` on any device uses 8 workers. Also match:

- Same enrollment input file
- Same OR-Tools version and Python minor (`npm run setup:cpsat` pins them; check `ortools_version` / `python_version` in `summary.json`)
- No time/plateau/gap escapes

A plain seed number alone is still accepted, but the CLI warns that workers will default to this machine's CPU count and may not reproduce.

When a seed is set, CP-SAT uses interleaved deterministic search so multi-worker solves are reproducible. A portfolio race (`--portfolio k` with `k>0`) uses a wall-clock budget and will not reproduce from seed alone.

## 5. Reading the outputs

| File | Use it for |
|------|------------|
| `schedule.xlsx` | Official timetable (day, time, section, faculty, enrollment) |
| `clash-report.xlsx` | Who is RED and which courses clash |
| `course-emails.xlsx` | Per-course email lists |
| `snapshot.json` | Full run state for tooling |
| `summary.json` | Quick metrics |

In `summary.json`, the important fields are:

- `status` — solver status string
- `repro_token` — compact `seed/workers/portfolio/sat` string to paste when prompted
- `seed` — run seed (reuse with `--seed` or the full token to reproduce)
- `workers` — CP-SAT worker count used (match on rerun)
- `portfolio` — portfolio race size (`0` = off)
- `allow_saturday_for_math` — whether Saturday was enabled for maths
- `saturday_extra_course_codes` — optional comma-entered course codes independently allowed on Saturday
- `ortools_version` / `python_version` — toolchain used (match for cross-device repro)
- `clash_weight` — total monochrome conflict weight
- `red_students` — students with at least one clash
- `proven_optimal` — `true` means clash weight is proven minimal under the course→weekday model
- `lower_bounds` — structural notes (e.g. clique larger than 6 weekdays ⇒ zero-clash impossible)

If lower bounds say zero-clash is impossible, a positive clash weight with `proven_optimal: true` is still a correct best answer — not a solver failure.

## 6. Progress phases (detail)

| Phase | Goal |
|-------|------|
| Warm start | DSATUR + light SA polish → CP-SAT hints |
| Portfolio race | Optional (`--portfolio k`); multi-seed clash-only race — wall-clock, not seed-reproducible |
| Building model | Encoding courses, conflict edges, faculty, students into CP-SAT |
| 1/3 Minimizing clashes | Lex level 1 — prove minimum clash weight |
| 2/3 Minimizing RED | Lex level 2 — among clash-optimal schedules, fewest RED students |
| 3/3 Balancing weekdays | Lex level 3 — soft balance / parallel comfort |
| Serialising workbooks | Writing Excel + JSON |

Long stretches on **proving** with an unchanged clash number are normal: CP-SAT is verifying that nothing better exists.

## 7. Troubleshooting

| Problem | What to try |
|---------|-------------|
| `OR-Tools venv not found` | `npm run setup:cpsat` |
| Wrong Python | Set `UNISLOT_PYTHON=/path/to/python` then re-run setup, or use the venv under `solver/cpsat/.venv` |
| File picker cancelled / missing | Pass `-i enroll.xlsx -o ./out -y` instead |
| Validation errors | Fix the sheet per [docs/excel_schema.md](docs/excel_schema.md) |
| Seems stuck on prove | Watch elapsed time and “since last improve”; leave it running or use `--time-limit` only if you accept a non-proven result |
| Ctrl+C | Aborts the Python child and exits; no partial Excel unless the run already finished exports |

## 8. Rectify and late enrollment

### Rectify (registration changes)

Use when students drop/add courses or new course codes appear and you want continuing courses to keep their weekdays:

```powershell
npm run unislot -- rectify --baseline old.xlsx --rectified new.xlsx --previous .\unislot-out -o .\unislot-out-rectified
```

Or pick **Rectify schedule** from the interactive menu.

### Late enrollment (freeze existing schedule)

Use when students register late *after* a schedule is already published. Existing course weekdays, section IDs, and untouched students never move.

```powershell
npm run unislot -- late --previous .\Unislot-Final --late .\late.xlsx -o .\unislot-out-late
```

Interactive mode asks how to handle:

1. **Capacity conflicts** — new section / equalize / fit in place / buffer / park  
2. **Unavoidable clashes** — accept / drop one course / park the student  

Non-interactive flags: `--on-full new-section|equalize|fit|buffer|park`, `--overflow-buffer N`, `--on-clash accept|drop-course|park-student`, `-y`.

The late file can be a small delta (only the new rows) or the full updated workbook — UniSlot detects which and subtracts. Rows that only *remove* a registration are reported and ignored, because dropping courses is rectify's job.

Outputs add:

- `Late Adds` column (batch chain like `5 +3`)
- Amber highlighting for late students and newly created sections
- `Late Enrollments`, `Run Log`, and `Clash Log` sheets
- `late-enrollment-report.json` and `run-log.json`

### Reading the new columns and sheets

**`Late Adds`** is a change log, not a total. `5 +3` means the first late batch added 5 students and the second added 3, so the section grew by 8. The current run's trailing segment is bold amber. A blank cell means no late run has ever touched that section or course. The column is per-section on `Schedule` and `Details`, per-course on `Course Catalog` and `Course Emails`.

**`Late Enrollments`** lists this batch only: who went into which section, on which weekday, how they were absorbed (`existing`, `new_section`, `overflow`, `equalized`), and their resulting clash status. Anything the run could not place appears under `PARKED` with the reason.

**`Run Log`** is one row per run ever, oldest first, carried forward from the previous output folder. It records what each run changed, RED before→after, and which option was chosen in each panel — so a later reader can tell that an unusual section shape was a deliberate human choice and which one.

**`Clash Log`** is one row per clash *event*, with the run that first caused it, the operation (`solve` / `rectify` / `late`), the late batch number, and a plain-language `Why`. A clash that survives several runs keeps pointing at the run that actually caused it rather than being lumped in as "pre-existing"; once it goes away the row is marked `resolved #N`.

Rectify runs carry the same trail forward, so `Run Log`, `Clash Log`, and `Late Adds` all survive a later rectification.

## 9. Commands cheat sheet

```powershell
npm install
npm run setup:cpsat
npm run unislot -- doctor
npm run unislot
npm run unislot -- issues -i enroll.xlsx -y
npm run unislot -- solve -i enroll.xlsx -o .\out -y
npm run unislot -- solve -i enroll.xlsx -o .\out -y --seed 12345 --workers 8
npm run unislot -- rectify --baseline old.xlsx --rectified new.xlsx --previous .\out -o .\out-r -y
npm run unislot -- late --previous .\out --late late.xlsx -o .\out-late -y
npm test
```

For the low-level Python solver invocation, see [solver/cpsat/README.md](solver/cpsat/README.md).
