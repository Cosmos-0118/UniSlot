import ExcelJS from 'exceljs'
import type { EnrollmentRow } from '../types'
import {
  finalizeWorkbookBuffer,
  workbookCreatedAt,
  type ExportDeterminismOptions,
} from './deterministicExport'
import { safeCellString } from './excelLayout'

export const INPUT_SHEET_NAME = 'Name List'

/** Same headers and column order as the enrollment name-list workbook UniSlot is fed. */
const INPUT_HEADERS = [
  'Sno.',
  'Program',
  'Register no',
  'Student Name',
  'Mobile No',
  'Email ID',
  'Course Code',
  'Course Title',
  'Remarks',
  'Adl Remarks',
] as const

const INPUT_COLUMN_WIDTHS = [6, 36, 20, 26, 14, 28, 16, 44, 16, 30]

const OPTIONAL_COLUMNS: { header: string; width: number; get: (row: EnrollmentRow) => string | null }[] = [
  { header: 'Faculty', width: 28, get: (row) => row.faculty },
  { header: 'Registration Type', width: 18, get: (row) => row.registration_type },
]

const THIN = { style: 'thin' as const }
const HEADER_BORDER: Partial<ExcelJS.Borders> = {
  top: THIN,
  left: THIN,
  bottom: THIN,
  right: THIN,
}

/**
 * Current enrollment, laid out like the input name list (one row per student × course, original
 * order preserved). Always reflects the state this workbook was generated from, so edits,
 * late adds, rectifies and reverts are visible here.
 */
export function buildInputFormatSheet(wb: ExcelJS.Workbook, rows: EnrollmentRow[]): void {
  const ws = wb.addWorksheet(INPUT_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1, activeCell: 'A2', topLeftCell: 'A2' }],
  })

  // Faculty / Registration Type are not in the standard name list, but dropping them would make
  // a re-solve from this sheet lose instructor assignments. Append them only when populated.
  const extras = OPTIONAL_COLUMNS.filter((c) => rows.some((row) => c.get(row)))
  const headers = [...INPUT_HEADERS, ...extras.map((c) => c.header)]

  const header = ws.getRow(1)
  headers.forEach((h, i) => {
    const cell = header.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = HEADER_BORDER
  })
  header.commit()

  rows.forEach((row, idx) => {
    const r = ws.getRow(idx + 2)
    r.getCell(1).value = idx + 1
    r.getCell(2).value = safeCellString(row.program)
    r.getCell(3).value = safeCellString(row.register_number)
    r.getCell(4).value = safeCellString(row.student_name)
    // Mobile numbers are numeric in the source sheet; keep text when a leading zero would be lost.
    const mobile = row.mobile_number ?? ''
    r.getCell(5).value = /^[1-9]\d{0,14}$/.test(mobile) ? Number(mobile) : mobile
    r.getCell(6).value = safeCellString(row.email_id)
    r.getCell(7).value = safeCellString(row.course_code)
    r.getCell(8).value = safeCellString(row.course_title)
    r.getCell(9).value = safeCellString(row.remarks)
    r.getCell(10).value = safeCellString(row.adl_remarks)
    extras.forEach((c, i) => {
      r.getCell(INPUT_HEADERS.length + 1 + i).value = safeCellString(c.get(row))
    })
    r.commit()
  })

  ws.columns = [...INPUT_COLUMN_WIDTHS, ...extras.map((c) => c.width)].map((width) => ({ width }))
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
}

/** Standalone workbook holding only the Name List sheet (for exporting from a saved output folder). */
export async function nameListToWorkbookBuffer(
  rows: EnrollmentRow[],
  options?: ExportDeterminismOptions,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'UniSlot'
  wb.created = workbookCreatedAt(options?.seed)
  wb.modified = wb.created
  buildInputFormatSheet(wb, rows)
  const buf: unknown = await wb.xlsx.writeBuffer()
  return finalizeWorkbookBuffer(buf, options?.seed)
}
