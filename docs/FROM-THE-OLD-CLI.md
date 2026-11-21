# Coming from the original UniSlot command line

The commands, flags, menu and output files are the ones you already know. The engine underneath changed, so some solver options have no counterpart.

## Start it

| Before | Now |
|---|---|
| `npm run unislot` | `unislot` (menu, then plain questions) |
| `npm run unislot -- solve -i in.xlsx -o out -y` | `unislot -i in.xlsx -o out -y` (or `unislot solve …`) |
| `npm run unislot -- doctor` | `unislot doctor` |
| (no full-screen mode) | `unislot --tui` |

No Node.js, Python or `npm run setup` is needed any more: one program, or `dotnet run --project src/UniSlot.Cli`.

## The menu

Same nine choices, same order, same wording: Create schedule · Rectify schedule · Add late enrollments · Fix wrong student course · Remove student from a course · Undo a wrong delete or fix · Export name list · Filter schedule · Find enrollment issues.

Anything a command needs that you did not give as an option is asked for (options you did give are not asked again). `-y` means "never ask".

`Create schedule` asks, in the original order: seed, Saturday for maths, extra Saturday codes, workbook. One difference: the output folder is asked **before** the search starts (default `./unislot-out`, or a new name if a timetable is already there) instead of after it, so a finished search can never be lost. The system file and folder dialogs are back (Windows, macOS, Linux with zenity): Create schedule opens the file dialog straight away and offers a folder dialog for the output; cancel it and you get a list of nearby workbooks, or you can type a path. Set `UNISLOT_NO_DIALOG=1` to turn dialogs off.

## Commands and options

| Command | Same options as before | Notes |
|---|---|---|
| `solve` (default) | `-i -o -y --seed --saturday --no-saturday --saturday-codes --prove --workers --time-limit` | `--seed` takes a number, the new token `seed/chains/moves` (reproduces exactly), or an old token `seed/workers/portfolio/sat` (only the seed carries over). Default output `./unislot-out`. |
| `rectify` | `--previous --rectified -o` | `--baseline` is accepted and ignored: the saved folder already holds the old workbook. Default output `./unislot-out-rectified`. |
| `late` | `--previous --late -o --on-full --on-clash` | `--on-full new-section | fit | park`, `--on-clash accept | park-student`. Default output `./unislot-out-late`. |
| `fix-course` | `--previous --register --from --to --to-title -o` | Default output `./unislot-out-fix`. |
| `drop-course` | `--previous --register --course -o` | Default output `./unislot-out-fix`. |
| `revert` | `--edited --previous --register --course --all -o` | Refuses folders from different runs or in the wrong order. Default output `./unislot-out-revert`. |
| `name-list` | `--folder -o` | Writes `name-list.xlsx` (the enrollment format) next to the snapshot. |
| `filter` | `-i -c -o` | `-i` is the output folder (or the `schedule.xlsx` inside it); `--folder` means the same. |
| `issues` | `-i` | Exit code 1 only when something blocks scheduling. |
| `doctor` | | Runs a tiny timetable through the search engine and the exact CP-SAT stage. |

## What changed, honestly

- **Accepted and ignored** (a note is printed): `--portfolio`, `--absolute-gap`, `--prove-plateau`, `--prove-strategy`, `--nomenclature`, `--baseline`, `--overflow-buffer`. The search is a different algorithm, so these have no equivalent. Program names in the workbooks are abbreviated by the built-in table.
- **Not available yet** (rejected with a clear message): `--on-full equalize` and `buffer`, `--on-clash drop-course`. Run `drop-course` afterwards instead.
- **Not carried over:** the extra sheets in late-run workbooks (Late Adds, Run Log, Clash Log) — the same information is in `late-enrollment-report.json` and `run-log.json`; `--workers` maps to the number of search threads.
- **Seeds:** with `-y` and no `--seed` the old tool picked a random seed; this one uses seed 1 (or the saved seed), so repeated runs give the same timetable. Pass `--seed` to vary it.
- **Language and saved preferences** (language, institution name, default output folder, seed) are changed in `unislot --tui` → Settings, or per run with `--lang` and `--institution`.
- **Exit codes:** 0 ok · 1 failure or cancelled · 2 workbook rejected · 3 hard-rule violation · 64 usage error (the old tool used 0/1/130).
- **Old output folders still work.** `snapshot.json` from the original tool is read directly, including runs saved before weekdays replaced time bands. Anything unreadable or inconsistent is refused with a message instead of being guessed at.
