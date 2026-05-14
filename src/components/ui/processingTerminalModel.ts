export const STAGE_LINES: Record<string, string[]> = {
  queued: [
    '▸ UniSlot Engine v3.2.1 — cold start',
    '▸ Allocating worker thread …',
    '▸ Mounting virtual file-system …',
  ],
  read: [
    '▸ Ingesting workbook binary stream …',
    '▸ Decompressing OOXML archive …',
    '▸ Extracting sheet → SharedStrings table …',
  ],
  parse: [
    '▸ Tokenising enrollment rows …',
    '▸ Validating schema constraints (strict mode) …',
    '▸ Cross-referencing student ↔ course mappings …',
    '▸ Flagging anomalies …',
  ],
  preprocess: [
    '▸ Computing optimal section splits …',
    '▸ Assigning students → sections (bin-packing) …',
    '▸ Building conflict adjacency graph …',
    '▸ Extracting faculty time-constraints …',
    '▸ Indexing edge weights …',
  ],
  schedule: [
    '▸ Initialising constraint-satisfaction engine …',
    '▸ Seeding population (genetic solver) …',
    '▸ Running graph-colouring heuristic …',
    '▸ Iterating generations — minimising clashes …',
  ],
  export: [
    '▸ Serialising schedule → XLSX workbook …',
    '▸ Generating rich clash report …',
    '▸ Building course-email directory …',
  ],
  done: [
    '▸ All systems nominal ✓',
    '▸ Pipeline complete — ready for download.',
  ],
}

export const FILLER = [
  '  ├─ heap: 12.4 MB used / 256 MB limit',
  '  ├─ cache hit ratio: 94.2 %',
  '  ├─ threads active: 1 (Web Worker)',
  '  ├─ constraint matrix density: sparse',
  '  ├─ adjacency list built — 0 orphan nodes',
]

export type LineType = 'sys' | 'stage' | 'info' | 'ok' | 'progress'

export interface LogLine {
  text: string
  type: LineType
}
