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
Scheduling rules (Saturday maths-only, section splits, clash definition): [docs/Constraints.md](docs/Constraints.md).

## 3. Interactive solve (recommended)

```powershell
npm run unislot
```

What happens:

1. **File picker** — choose the enrollment `.xlsx` (macOS / Windows / Linux dialogs).
2. **Parse** — row counts, students, courses.
3. **CP-SAT search** — live status line, for example:

   ```text
   1/3 Minimizing clashes  clash 18  RED 18 · proving (12.4s since last improve)  2m 05s · 10w
   ```

   - **1/3 Minimizing clashes** — primary objective (clash weight).
   - **2/3 Minimizing RED students** — fewest students with a same-day conflict.
   - **3/3 Balancing weekdays** — soft load balance after clashes are fixed.
   - **clash / RED** — best solution found so far.
   - **proving** — no better clash weight found recently; solver is closing the optimality proof. This can take a while on large enrollments; the clock still advances.
   - **gap / bound** — when shown, distance between best solution and proven lower bound.

4. **Result panel** — status (`OPTIMAL` / `FEASIBLE`), clash weight, RED count, whether clashes are proven minimal.
5. **Output folder** — optional folder picker, or default `./unislot-out/`.

Cancel anytime with **Ctrl+C**.

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
| `--workers <n>` | CP-SAT workers for the prove phase (default: all CPUs) |
| `--portfolio <k>` | Multi-seed clash race before prove (default: 5; `0` disables) |
| `--time-limit <seconds>` | Escape hatch only — stops early; may not prove optimality |

Omit `--time-limit` for a full prove-to-optimal run. Before CP-SAT search, UniSlot builds a DSATUR + polish warm start and injects structural clash/RED lower bounds as model cuts.

**Seeds:** Unless you pass `-y`, UniSlot asks whether you have a seed from a previous run. Say yes and enter it to reproduce exports byte-for-byte; say no and a new seed is generated. The seed is shown at the end and stored in `summary.json` and `snapshot.json`. With `-y`, a fresh seed is generated automatically.

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
- `seed` — run seed (reuse when prompted to reproduce exports)
- `clash_weight` — total monochrome conflict weight
- `red_students` — students with at least one clash
- `proven_optimal` — `true` means clash weight is proven minimal under the course→weekday model
- `lower_bounds` — structural notes (e.g. clique larger than 6 weekdays ⇒ zero-clash impossible)

If lower bounds say zero-clash is impossible, a positive clash weight with `proven_optimal: true` is still a correct best answer — not a solver failure.

## 6. Progress phases (detail)

| Phase | Goal |
|-------|------|
| Warm start | DSATUR + light SA polish → CP-SAT hints |
| Portfolio race | Optional multi-seed clash-only race; best incumbent seeds the prove |
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

## 8. Commands cheat sheet

```powershell
npm install
npm run setup:cpsat
npm run unislot -- doctor
npm run unislot
npm run unislot -- solve -i enroll.xlsx -o .\unislot-out -y
npm run unislot -- solve -i enroll.xlsx -o .\out -y --workers 8
npm test
```

For the low-level Python solver invocation, see [solver/cpsat/README.md](solver/cpsat/README.md).
