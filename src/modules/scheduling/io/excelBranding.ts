import type ExcelJS from 'exceljs'
import { XL } from './excelStyleConstants'

/** Shared brand lines for every UniSlot Excel export. */
export const EXCEL_BRAND = {
  appName: 'UniSlot',
  college: 'SRM University · SRMIST',
  sessionLabel: 'EVENING SESSION · 5:00–7:00 PM',
  timetableTitle: 'TIME TABLE',
  department: '',
  venuePlaceholder: '—',
} as const

function styleMergedBanner(
  ws: ExcelJS.Worksheet,
  rowIndex: number,
  lastCol: number,
  text: string,
  opts: { fontSize: number; fillArgb: string },
) {
  ws.mergeCells(rowIndex, 1, rowIndex, lastCol)
  const cell = ws.getCell(rowIndex, 1)
  cell.value = text
  cell.font = { bold: true, size: opts.fontSize, color: { argb: XL.white } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fillArgb } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  ws.getRow(rowIndex).height = opts.fontSize >= 15 ? 32 : 26
}

/**
 * Writes UniSlot → SRMIST brand rows, then an optional document title.
 * Returns the next free row index.
 */
export function writeExportBrandHeader(
  ws: ExcelJS.Worksheet,
  lastCol: number,
  documentTitle?: string,
): number {
  let r = 1
  styleMergedBanner(ws, r, lastCol, EXCEL_BRAND.appName, {
    fontSize: 16,
    fillArgb: XL.primary,
  })
  r++
  styleMergedBanner(ws, r, lastCol, EXCEL_BRAND.college, {
    fontSize: 13,
    fillArgb: XL.primaryLight,
  })
  r++
  if (documentTitle) {
    styleMergedBanner(ws, r, lastCol, documentTitle, {
      fontSize: 14,
      fillArgb: XL.secondary,
    })
    r++
  }
  return r + 1 // blank spacer row after brand block
}
