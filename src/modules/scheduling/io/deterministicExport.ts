/** Fixed workbook timestamp base for seeded runs (byte-identical XLSX metadata). */
export const DETERMINISTIC_EXPORT_EPOCH_MS = Date.UTC(2020, 0, 1, 0, 0, 0, 0)

/** Workbook `created` stamp: fixed when seed is set, otherwise current time. */
export function workbookCreatedAt(seed?: number): Date {
  if (seed === undefined) return new Date()
  return new Date(DETERMINISTIC_EXPORT_EPOCH_MS + (seed % 86_400_000))
}

export type ExportDeterminismOptions = {
  /** When set, export metadata uses a seed-derived fixed timestamp. */
  seed?: number
}
