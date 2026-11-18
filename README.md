# UniSlot

Evening timetables for universities, with the fewest possible students affected by a clash.

Add an enrollment workbook, and UniSlot assigns every course to a weekday (Monday–Friday, Saturday optional) so that as many students as possible get a completely clash-free timetable. It runs on Windows and macOS, in six languages, and finds its answer in about a second.

> This branch (`main-UI`) is the rebuilt, cross-platform UniSlot. The original Node.js/Python tool lives on `main` as reference only; this codebase shares no code with it.

## What it does

- **Fewest clashing students first.** The objective is strictly lexicographic: affected (RED) students, then conflicting course-pair weight, then weekday balance, then parallel load. A lower priority never worsens a higher one.
- **Fast.** A purpose-built annealing engine reaches the best known result on a 1,164-student, 391-course workbook in **0.5–3 seconds** on a 6-core CPU.
- **Reproducible.** The same workbook, seed and quality produce the *same* timetable on every machine, Windows or macOS, any core count.
- **Honest about optimality.** An optional exact stage (OR-Tools CP-SAT, in-process, no Python) tightens a proven lower bound. Results are only called optimal when that is proven.
- **Checked twice.** An independent audit re-verifies every hard rule, and its RED count must equal the solver's or the run fails loudly.
- **Interchangeable output.** `schedule.xlsx`, `clash-report.xlsx`, `course-emails.xlsx`, `snapshot.json`, `summary.json`; the snapshot keeps the schema earlier UniSlot releases wrote.
- **Adapts to your screen.** The interface scales automatically (about 100% on a laptop, 120% on full HD, up to 135% on QHD and 4K), uses wide screens with a two-column layout, and collapses the sidebar to icons in narrow windows. Change the size in Settings or with Ctrl + / Ctrl − / Ctrl 0; the window size is remembered.
- **Six languages**, switchable at runtime: English, हिन्दी, தமிழ், Español, Français, Deutsch. Names and course titles in any script are preserved.

## Quick start

Requires the [.NET 10 SDK](https://dotnet.microsoft.com/download) to build.

```bash
dotnet run --project src/UniSlot.Desktop          # the app
dotnet run --project src/UniSlot.Cli -- solve -i enrollment.xlsx -o ./out
```

```bash
dotnet test UniSlot.slnx -c Release               # 90 tests
dotnet publish src/UniSlot.Desktop -c Release -r win-x64 --self-contained true     # or osx-arm64
```

CLI options: `--preset quick|standard|thorough`, `--seed`, `--chains`, `--moves`, `--time`, `--saturday`, `--saturday-codes`, `--prove`, `--institution`, `--verify`. See `unislot --help`.

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
UniSlot.Desktop ──┐                          Avalonia UI (Windows, macOS)
UniSlot.Cli ──────┼─► UniSlot.Infrastructure  Excel + JSON in/out (ClosedXML)
                  │        │
                  ├────────┴─► UniSlot.Application   use cases, parsing, planning
                  │                 │       │
UniSlot.Proof ────┘                 ▼       ▼
 (OR-Tools CP-SAT)            UniSlot.Domain   UniSlot.Solver
                              pure rules       allocation-free search engine,
                                               no dependencies
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md).

## Status

Working: import, validation, section planning, search, optional proof, audit, all exports, desktop app, CLI, localisation.
Not yet ported from the original tool: rectifying an edited timetable, late enrollments, single-student course fixes and reverts. The `snapshot.json` format is compatible, so those workflows can be added without migrating data.
Built and tested on Windows; macOS and Linux are covered by CI but have not been run by hand yet. Translations other than English need review by native speakers.

## License

Copyright (c) 2026 Dhanush S. Licensed under the [GNU General Public License v3.0 only](LICENSE).
