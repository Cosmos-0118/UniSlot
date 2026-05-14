# UniSlot (web)

Evening course scheduling in the browser. Enrollment Excel is parsed, sections and conflicts are built, and a timetable is optimized **inside a Web Worker** (**ExcelJS** for read/write + greedy / local search). Outputs are generated in the worker as `.xlsx` downloads.

Enrollment layout and outputs are documented in [`docs/excel_schema.md`](docs/excel_schema.md). Product constraints live in [`docs/Constraints.md`](docs/Constraints.md).

## Project layout

| Path | Purpose |
|------|--------|
| `src/modules/scheduling/` | Domain logic: types, parser, pipeline, engines, Excel I/O, worker entry |
| `src/modules/scheduling/io/` | Spreadsheet read/write and clash/email workbooks |
| `src/modules/scheduling/engines/` | Conflict graph, solver, sectioning, faculty placeholders |
| `src/shared/utils/` | Cross-cutting helpers (`cn`, etc.) |
| `src/features/` | Route-level UI (landing, dashboard, scheduler, emails) |
| `src/components/` | Reusable layout and UI |
| `src/hooks/` | React hooks (worker bridge) |
| `src/contexts/` | Theme and other providers |
| `docs/` | Specs, audits, research notes |

Imports use the `@/` alias (`@/modules/scheduling`, `@/shared/utils/cn`, …), configured in `vite.config.ts` and `tsconfig.app.json`.

```bash
npm install
npm run dev
```

```bash
npm run build && npm run preview
```
