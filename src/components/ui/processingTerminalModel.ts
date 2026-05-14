/** One-line stage headers: factual, tied to real pipeline stages. */
export const STAGE_SUMMARY: Record<string, string> = {
  queued: `▸ UniSlot v${__APP_VERSION__} — worker`,
  read: '▸ Read workbook',
  parse: '▸ Parse & validate enrollment',
  preprocess: '▸ Build sections & conflicts',
  schedule: '▸ Optimize slots (local search)',
  export: '▸ Export Excel workbooks',
  done: '▸ Done',
}

export type LineType = 'sys' | 'stage' | 'info' | 'ok' | 'progress'

export interface LogLine {
  text: string
  type: LineType
}
