# UniSlot (web)

Evening course scheduling in the browser. Enrollment Excel is parsed, sections and conflicts are built, and a timetable is optimized **inside a Web Worker** (**ExcelJS** for read/write + greedy / local search). Outputs are generated in the worker as `.xlsx` downloads.

Enrollment layout and outputs are documented in [`docs/excel_schema.md`](docs/excel_schema.md).

```bash
npm install
npm run dev
```

```bash
npm run build && npm run preview
```
