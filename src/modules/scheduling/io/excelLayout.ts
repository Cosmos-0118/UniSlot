import type ExcelJS from 'exceljs'

/** Shared grid border for data tables. */
export const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
}

export function safeCellString(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** Excel column width (character units) from display text. */
export function colWidthFromText(s: string, min: number, max: number): number {
  if (!s) return min
  const lines = s.split(/\r?\n/)
  const longest = Math.max(...lines.map((line) => line.length), 0)
  const est = Math.ceil(longest * 1.05) + 2
  return Math.min(max, Math.max(min, est))
}

/**
 * Estimate how many visual lines wrapped text will occupy at a given column width.
 * Uses greedy word wrapping (Excel never breaks mid-word) rather than character division,
 * so long program lists like "B.Tech.-Computer Science and Engineering, …" are not under-counted.
 */
export function estimateWrappedLineCount(text: string, columnWidth: number): number {
  const t = text.trim()
  if (!t) return 1
  const usable = Math.max(4, Math.floor(columnWidth) - 1)
  let total = 0
  for (const rawLine of t.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      total += 1
      continue
    }
    const words = line.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      total += 1
      continue
    }
    let lines = 1
    let current = 0
    for (const word of words) {
      const needed = current === 0 ? word.length : word.length + 1
      if (current > 0 && current + needed > usable) {
        lines += 1
        current = word.length
      } else {
        current += needed
      }
      // A single word longer than the column still wraps mid-token in Excel.
      if (word.length > usable) {
        lines += Math.ceil(word.length / usable) - 1
        current = word.length % usable
      }
    }
    // Safety: tall wrapped cells need a little extra so middle-aligned text is not clipped.
    total += lines >= 3 ? lines + 1 : lines
  }
  return Math.max(1, total)
}

/** Row height in points from wrapped line count (Excel default ≈15pt per line). */
export function rowHeightForWrappedLines(
  lineCount: number,
  opts?: { min?: number; max?: number; pointsPerLine?: number; padding?: number },
): number {
  const min = opts?.min ?? 18
  const max = opts?.max ?? 180
  const pointsPerLine = opts?.pointsPerLine ?? 15
  const padding = opts?.padding ?? 6
  return Math.min(max, Math.max(min, lineCount * pointsPerLine + padding))
}

export type DataRowCellSpec = {
  /** 1-based column index */
  col: number
  value: string | number
  wrap?: boolean
  horizontal?: 'left' | 'center' | 'right'
  numFmt?: string
  font?: Partial<ExcelJS.Font>
}

export type ApplyDataRowOptions = {
  fillArgb: string
  defaultHorizontal?: 'left' | 'center' | 'right'
  defaultVertical?: 'top' | 'middle'
  border?: Partial<ExcelJS.Borders>
  columnWidths: ColumnWidthTracker
}

/**
 * Write a data row with borders, fill, wrap, and return the max wrapped line count
 * (for callers to set row height).
 */
export function applyDataRow(
  row: ExcelJS.Row,
  cells: DataRowCellSpec[],
  opts: ApplyDataRowOptions,
): number {
  const border = opts.border ?? thinBorder

  for (const spec of cells) {
    opts.columnWidths.bump(spec.col, safeCellString(spec.value))
  }

  let maxLines = 1

  for (const spec of cells) {
    const cell = row.getCell(spec.col)
    cell.value = spec.value
    cell.border = border
    const text = safeCellString(spec.value)
    const wrap = spec.wrap ?? false
    const colWidth = opts.columnWidths.get(spec.col)

    if (wrap) {
      const lines = estimateWrappedLineCount(text, colWidth)
      maxLines = Math.max(maxLines, lines)
    }

    cell.alignment = {
      horizontal: spec.horizontal ?? opts.defaultHorizontal ?? 'left',
      vertical: opts.defaultVertical ?? 'middle',
      wrapText: wrap,
    }
    if (spec.numFmt) cell.numFmt = spec.numFmt
    if (spec.font) cell.font = spec.font

    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: opts.fillArgb },
    }
  }

  return maxLines
}

/** Tracks per-column widths while building a sheet, then applies them to the worksheet. */
export class ColumnWidthTracker {
  private readonly widths: Map<number, { w: number; min: number; max: number }>

  constructor(specs: { col: number; width: number; min?: number; max?: number }[]) {
    this.widths = new Map()
    for (const s of specs) {
      this.widths.set(s.col, {
        w: s.width,
        min: s.min ?? s.width,
        max: s.max ?? Math.max(s.width, 60),
      })
    }
  }

  get(col: number): number {
    return this.widths.get(col)?.w ?? 12
  }

  bump(col: number, text: string, minOverride?: number, maxOverride?: number): void {
    const entry = this.widths.get(col)
    if (!entry) return
    const min = minOverride ?? entry.min
    const max = maxOverride ?? entry.max
    entry.w = Math.max(entry.w, colWidthFromText(text, min, max))
  }

  apply(ws: ExcelJS.Worksheet): void {
    for (const [col, { w }] of this.widths) {
      ws.getColumn(col).width = w
    }
  }
}

export function fitRowHeight(row: ExcelJS.Row, wrappedLineCount: number, hasWrap: boolean): void {
  if (!hasWrap || wrappedLineCount <= 1) {
    row.height = rowHeightForWrappedLines(1, { min: 20, max: 24 })
    return
  }
  row.height = rowHeightForWrappedLines(wrappedLineCount)
}
