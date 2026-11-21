# UniSlot

Evening timetables for universities, with the fewest possible students affected by a clash.

Add an enrollment workbook, and UniSlot assigns every course to a weekday (Monday–Friday, Saturday optional) so that as many students as possible get a completely clash-free timetable. It is a terminal application for Windows, macOS and Linux, in six languages, and finds its answer in about a second.

> This branch (`main-UI`) is the rebuilt, cross-platform UniSlot. The original Node.js/Python tool lives on `main` as reference only; this codebase shares no code with it.

## What it does

- **Fewest clashing students first.** The objective is strictly lexicographic: affected (RED) students, then conflicting course-pair weight, then weekday balance, then parallel load. A lower priority never worsens a higher one.
- **Fast.** A purpose-built annealing engine reaches the best known result on a 1,164-student, 391-course workbook in **0.5–3 seconds** on a 6-core CPU.
- **Reproducible.** The same workbook, seed and quality produce the *same* timetable on every machine, Windows or macOS, any core count.
- **Honest about optimality.** An optional exact stage (OR-Tools CP-SAT, in-process, no Python) tightens a proven lower bound. Results are only called optimal when that is proven.
- **Checked twice.** An independent audit re-verifies every hard rule, and its RED count must equal the solver's or the run fails loudly.
- **Interchangeable output.** `schedule.xlsx`, `clash-report.xlsx`, `course-emails.xlsx`, `snapshot.json`, `summary.json`; the snapshot keeps the schema earlier UniSlot releases wrote.
- **Familiar to anyone who used the original command line.** `unislot` opens the same nine-choice menu in the same order and wording (Create schedule, Rectify schedule, Add late enrollments, Fix wrong student course, Remove student from a course, Undo a wrong delete or fix, Export name list, Filter schedule, Find enrollment issues), then asks plain questions one after another. The commands and flags are the originals (`-i`, `-o`, `-y`, `--previous`, `--late`, `--rectified`, `--on-full`, `--seed`, `--saturday`/`--no-saturday`, …), and `solve` is the default command, so `unislot -i data.xlsx -o out -y` works as before. See [docs/FROM-THE-OLD-CLI.md](docs/FROM-THE-OLD-CLI.md).
- **A full-screen mode when you want it.** `unislot --tui` opens the application with a live progress screen, a results dashboard, a schedule and clash browser, and settings (language, institution, output folder, seed). Layouts adapt to the terminal width; consoles without Unicode get ASCII borders.
- **Scriptable.** `-y` (or giving every option) never asks; output is plain text when redirected or with `-q`; `--show schedule,clashes` prints tables; exit codes are stable. `unislot doctor` checks that the search engine and the exact CP-SAT stage work on the machine.
- **Maintain a published timetable** without moving anyone who is already placed. Every edit writes a *new* output folder (the original is never overwritten), carries the run log forward, and is audited by the same independent checks as a fresh solve:
  - **Add late enrollments** (`late`): existing classes and sections keep their weekday and members. Choose what happens when a course is full (open a new section, fit in place over capacity, or park the registration) and when a late registration would clash (accept it or park the student). The late file may be a small delta or the full updated workbook.
  - **Rectify** (`rectify`): apply registration changes from an updated workbook; every continuing course keeps its weekday and only new courses are searched.
  - **Fix a wrong course** (`fix-course`) and **remove a student from a course** (`drop-course`): one-student corrections; a course left empty disappears, a missing course can be created with its own title.
  - **Undo** (`revert`): list what differs between the edited folder and the one from before, then restore only the changes you pick.
  - **Find enrollment issues** (`issues`), **export the name list** (`name-list`) and **filter the schedule** to chosen courses (`filter`).
- **Six languages**, switchable at runtime: English, हिन्दी, தமிழ், Español, Français, Deutsch. Names and course titles in any script are preserved.

## Quick start

Requires the [.NET 10 SDK](https://dotnet.microsoft.com/download) to build.

```bash
dotnet run --project src/UniSlot.Cli                                    # menu, then plain questions
dotnet run --project src/UniSlot.Cli -- -i enrollment.xlsx -o ./out -y      # scripted run (solve is the default command)
dotnet run --project src/UniSlot.Cli -- --tui                               # full-screen application
dotnet run --project src/UniSlot.Cli -- doctor                              # check this machine
```

```bash
dotnet test UniSlot.slnx -c Release               # unit and screen tests
dotnet publish src/UniSlot.Cli -c Release -r win-x64 --self-contained true     # or osx-arm64, linux-x64
```

Commands: `solve` (default), `rectify`, `late`, `fix-course`, `drop-course`, `revert`, `name-list`, `filter`, `issues`, `doctor`. Anything a command needs but was not given is asked for on a terminal; `-y` turns that off. Solve options: `--preset quick|standard|thorough`, `--seed` (a number, or a reproduction token), `--chains`, `--moves`, `--workers`, `--time-limit`, `--saturday`/`--no-saturday`, `--saturday-codes`, `--prove`, `--institution`, `--show`, `--limit`, `--lang`, `--verify`, `-q`. See `unislot --help`.

## Measured performance

Real workbook (1,164 students · 391 courses · 1,032 conflict pairs), Ryzen 5 9600X, 12 threads:

| Quality | Moves | Time | Result (10 seeds) |
|---|---|---|---|
| Quick | 12 × 6 M | ~0.5 s | RED 38 in 10 / 10 |
| Standard | 12 × 30 M | ~2.3 s | RED 38 in 10 / 10 |
| Thorough | 12 × 150 M | ~11 s | RED 38 / clash 50 in 5 / 5 |

One chain does ~21 M moves/s on one thread; 12 threads are 9.3× faster than one. For comparison the previous CP-SAT-only tool needed 120 s to reach RED 38 and never proved it optimal. Details and method: [docs/VALIDATION.md](docs/VALIDATION.md).

## Architecture

Dependencies point inward only.

```text
UniSlot.Cli ──────┬─► UniSlot.Infrastructure  Excel + JSON in/out (ClosedXML)
 (Spectre.Console) │        │
                  ├────────┴─► UniSlot.Application   use cases, parsing, planning
                  │                 │       │
UniSlot.Proof ────┘                 ▼       ▼
 (OR-Tools CP-SAT)            UniSlot.Domain   UniSlot.Solver
                              pure rules       allocation-free search engine,
                                               no dependencies
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md).

## Status

Working: import, validation, section planning, search, optional proof, audit, all exports, classic and full-screen terminal modes, scripted CLI, localisation, and the maintenance workflows above (late enrollment, rectify, fix and drop course, undo, issue finder, name list, schedule filter).

Not yet ported from the original tool: the extra workbook sheets and styling for late runs (`Late Adds` column, amber highlighting, `Late Enrollments`, `Run Log` and `Clash Log` sheets; the same information is in `<mode>-report.json`, `run-log.json` and the snapshot's `run_log`), the *equalize* and *buffer* options for full courses and the *drop-course* option for unavoidable clashes, per-session `doctor` checks, and the system file dialogs (the app lists nearby workbooks and output folders instead).
Built and tested on Windows; macOS and Linux are covered by CI but have not been run by hand yet. Translations other than English need review by native speakers; the terminal may misalign box edges for Devanagari and Tamil text.
