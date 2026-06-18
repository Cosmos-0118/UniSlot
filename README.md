# UniSlot

Browser-based evening course scheduling for universities. Upload an enrollment Excel workbook, build sections and a student conflict graph, optimize a weekly timetable in a **Web Worker**, and download styled `.xlsx` outputs — all client-side, with no backend required.

Enrollment layout and outputs are documented in [`docs/excel_schema.md`](docs/excel_schema.md). Scheduling constraints and objectives are in [`docs/Constraints.md`](docs/Constraints.md).

## Features

| Area | What it does |
|------|----------------|
| **Scheduler** (`/app/scheduler`) | Drag-and-drop or pick an enrollment `.xlsx`, validate rows, run the solver with live progress in a terminal UI, preview the timetable and clash report, export workbooks, and save a run snapshot. |
| **Saved runs** (`/app/runs`) | Persist scheduling snapshots in `localStorage`; reopen runs, merge late enrollments, edit faculty mappings, and re-export schedule / clash / email workbooks. |
| **Course emails** (`/app/emails`) | View per-course deduplicated email lists from the current session, copy to clipboard, or import email groups from a saved run. |
| **Faculty mapping** | Assign or override faculty per section (CSV template + in-app panel); schedule export can be blocked until hard constraints pass audit. |
| **Insights / Settings** | Placeholder routes (`/app/insights`, `/app/settings`) — coming soon. |

The landing page (`/`) includes a themed boot sequence, animated cube background, and theme switcher (light / dark / system).

## How scheduling works

```text
Enrollment .xlsx
  → parse & validate          (parser.ts)
  → preprocess                (section splits, conflict graph, faculty constraints)
  → local search solver       (multi-start greedy + hill-climb; minimizes student clashes)
  → hard-constraint audit
  → Excel exports             (schedule, clash report, course emails)
```

**Time model:** Monday–Friday, 5:00 PM–7:00 PM, 55 weekly slots total (~11 parallel sections per slot as the soft target).

**Solver:** `localSearchSolver.ts` runs many seeded passes, keeps a solution pool, and optimizes for minimal student timetable clashes while balancing day load and parallel section counts. Optional reproducible runs via a user-supplied seed.

**Worker:** Heavy work runs in `scheduling.worker.ts` (ESM worker with manual chunking for ExcelJS and solver code). Large artifacts (full snapshot, schedule entries) can be deferred and fetched on demand to keep the main thread responsive.

## Tech stack

- **UI:** React 19, React Router 7, Tailwind CSS 4, Framer Motion, Lucide icons
- **Build:** Vite 8, TypeScript 6
- **Spreadsheets:** ExcelJS (read enrollment, write styled outputs)
- **Tests:** Vitest (Node environment)
- **Deploy:** Vercel SPA (`vercel.json` + `public/_redirects`)

Path alias `@/` → `src/` (see `vite.config.ts`, `tsconfig.app.json`).

## Getting started

```bash
npm install
npm run dev
```

Production build and local preview:

```bash
npm run build
npm run preview
```

Other scripts:

| Script | Purpose |
|--------|---------|
| `npm run lint` | ESLint across the repo |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build:brand` | Regenerate favicons / PWA icons from `brand/source/app-logo.png` |

## Routes

| Path | Screen |
|------|--------|
| `/` | Landing page |
| `/app/scheduler` | Upload, run solver, preview, export |
| `/app/runs` | List saved runs |
| `/app/runs/:runId` | Saved run detail (faculty, late merge, exports) |
| `/app/emails` | Course email groups |
| `/app/insights` | Coming soon |
| `/app/settings` | Coming soon |

## Project layout

```text
src/
├── app/                    App shell, React Router routes
├── components/
│   ├── brand/              AppLogo
│   ├── layout/             Layout, Sidebar
│   └── ui/                 Dialogs, terminal, theme, boot overlay, cube background
├── contexts/
│   ├── appDialog/          Global alert/confirm dialogs
│   ├── boot/               Landing boot gate
│   ├── scheduling/         Worker session state (run, progress, exports)
│   └── theme/              Light/dark theme provider
├── features/
│   ├── dashboard/          Dashboard layout wrapper
│   ├── landing/            Marketing / entry page
│   └── scheduling/         Scheduler UI, saved runs, emails, faculty panel, hooks
├── modules/scheduling/     Domain logic (import via @/modules/scheduling)
│   ├── parse/              Excel row parsing & validation
│   ├── preprocess/         Sectioning, conflict graph, faculty extraction
│   ├── solver/             Local search, metrics, time model, schedule output
│   ├── merge/              Snapshots, faculty mapping, late enrollment, saved-run exports
│   ├── io/                 Excel read/write (schedule, clash, emails, layout/styles)
│   ├── pipeline/           End-to-end runPipeline + export buffers
│   ├── worker/             Web Worker entry, cancellation, transfer slimming
│   └── types.ts            Shared domain types
└── shared/
    ├── boot/               Boot veil helpers
    ├── brand/              Static asset paths
    ├── lib/                downloadArrayBuffer
    └── utils/              cn() (clsx + tailwind-merge)

tests/                      Vitest suites (scheduling, appDialog)
docs/                       Constraints, Excel schema, audits, research notes
scripts/                    generate-brand-assets.mjs
brand/                      Source logo for icon generation
public/                     Favicons, web manifest, SPA redirects
```

## Outputs

After a successful run (or from a saved snapshot), the app can produce:

1. **Course schedule** — section assignments with day, time, faculty, enrollment, programs
2. **Clash report** — multi-sheet workbook (summary, clashes only, by program/day/course, full report)
3. **Course emails** — deduplicated addresses per course plus a missing-emails sheet

Column details and validation rules: [`docs/excel_schema.md`](docs/excel_schema.md).

## Documentation

| File | Contents |
|------|----------|
| [`docs/Constraints.md`](docs/Constraints.md) | Problem definition, hard/soft constraints, scale (~2600 students, 300+ courses) |
| [`docs/excel_schema.md`](docs/excel_schema.md) | Input columns, alternates, business rules, output formats |
| [`docs/research.md`](docs/research.md) | Background research |
| [`docs/algorithm_audit_2026-05-14.md`](docs/algorithm_audit_2026-05-14.md) | Solver audit notes |
| [`docs/browser_worker_audit_2026-05-14.md`](docs/browser_worker_audit_2026-05-14.md) | Worker performance audit |
| [`docs/Architectural Optimization of Web Worker.md`](docs/Architectural%20Optimization%20of%20Web%20Worker.md) | Worker chunking strategy |

## Tests

Scheduling and UI helpers are covered under `tests/`:

- Solver smoke test and hard-constraint audit
- Excel layout, faculty mapping, late enrollment / saved-run exports
- Worker transfer slimming, cancellation, progress throttle, RNG
- App dialog body normalization

```bash
npm test
```
