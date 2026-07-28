import ExcelJS from 'exceljs'
import type { EnrollmentRow } from '../types'
import { writeExportBrandHeader } from './excelBranding'
import { workbookCreatedAt, type ExportDeterminismOptions } from './deterministicExport'
import {
  applyDataRow,
  ColumnWidthTracker,
  fitRowHeight,
  type DataRowCellSpec,
} from './excelLayout'
import { XL } from './excelStyleConstants'
import { formatLateAddsChain, lateAddsFont, type LateMarking } from './excelLateMarking'

function writeBufferToArrayBuffer(buf: unknown): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  throw new Error('Unexpected workbook buffer type')
}

export type CourseEmailsWorkbookOptions = ExportDeterminismOptions & {
  lateMarking?: LateMarking | null
}

/**
 * Course-wise deduplicated email lists + students missing email (legacy `export_course_grouping_xlsx`).
 */
export async function courseEmailsToWorkbookBuffer(
  rows: EnrollmentRow[],
  options?: CourseEmailsWorkbookOptions,
): Promise<ArrayBuffer> {
  type Group = {
    title: string
    students: Set<string>
    emails: string[]
    missing: EnrollmentRow[]
  }
  const courseMap = new Map<string, Group>()
  const late = options?.lateMarking ?? null
  const showLate = Boolean(late)

  for (const row of rows) {
    const code = row.course_code
    if (!code) continue
    let g = courseMap.get(code)
    if (!g) {
      g = { title: row.course_title || '', students: new Set(), emails: [], missing: [] }
      courseMap.set(code, g)
    }
    g.title = g.title || row.course_title || ''
    g.students.add(row.register_number)
    const em = row.email_id?.trim().toLowerCase()
    if (em) g.emails.push(em)
    else g.missing.push(row)
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'UniSlot'
  wb.created = workbookCreatedAt(options?.seed)
  const ws = wb.addWorksheet('Course Emails')

  const headerRow = writeExportBrandHeader(ws, showLate ? 6 : 5, 'COURSE EMAIL GROUPS')
  const headers = [
    'Course Code',
    'Course Title',
    'Student Count',
    'Email Count',
    'Emails',
    ...(showLate ? ['Late Adds'] : []),
  ]
  headers.forEach((h, i) => {
    const c = ws.getRow(headerRow).getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: XL.white } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  ws.getRow(headerRow).height = 28

  const colSpecs = [
    { col: 1, width: 16, min: 14, max: 24 },
    { col: 2, width: 45, min: 28, max: 56 },
    { col: 3, width: 14, min: 12, max: 18 },
    { col: 4, width: 12, min: 10, max: 16 },
    { col: 5, width: 60, min: 40, max: 100 },
  ]
  if (showLate) colSpecs.push({ col: 6, width: 12, min: 8, max: 18 })
  const colWidths = new ColumnWidthTracker(colSpecs)

  let r = headerRow + 1
  for (const code of [...courseMap.keys()].sort()) {
    const info = courseMap.get(code)!
    const seen = new Set<string>()
    const emails: string[] = []
    for (const e of info.emails) {
      if (e && !seen.has(e)) {
        seen.add(e)
        emails.push(e)
      }
    }
    const rowFill = r % 2 === 0 ? XL.rowAlt : XL.white
    const row = ws.getRow(r)
    const cells: DataRowCellSpec[] = [
      { col: 1, value: code },
      { col: 2, value: info.title, wrap: true },
      { col: 3, value: info.students.size, horizontal: 'center', numFmt: '0' },
      { col: 4, value: emails.length, horizontal: 'center', numFmt: '0' },
      { col: 5, value: emails.join(', '), wrap: true },
    ]
    if (showLate && late) {
      const chain = late.lateAddsByCourse[code]
      cells.push({
        col: 6,
        value: formatLateAddsChain(chain),
        horizontal: 'center',
        font: lateAddsFont(chain, late.batch, XL.lateText),
      })
    }
    const wrappedLines = applyDataRow(row, cells, { fillArgb: rowFill, columnWidths: colWidths })
    fitRowHeight(row, wrappedLines, true)
    r++
  }

  colWidths.apply(ws)
  ws.views = [
    {
      state: 'frozen',
      ySplit: headerRow,
      xSplit: 0,
      activeCell: `A${headerRow + 1}`,
      showGridLines: true,
    },
  ]

  const m = wb.addWorksheet('Missing Emails')
  const mHeaderRow = writeExportBrandHeader(m, 5, 'STUDENTS WITHOUT EMAIL')

  const mh = ['Course Code', 'Course Title', 'Register Number', 'Student Name', 'Program']
  mh.forEach((h, i) => {
    const c = m.getRow(mHeaderRow).getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: XL.white } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  m.getRow(mHeaderRow).height = 28

  const mWidths = new ColumnWidthTracker([
    { col: 1, width: 16, min: 14, max: 24 },
    { col: 2, width: 45, min: 28, max: 56 },
    { col: 3, width: 18, min: 14, max: 24 },
    { col: 4, width: 28, min: 20, max: 40 },
    { col: 5, width: 40, min: 24, max: 56 },
  ])

  let mr = mHeaderRow + 1
  for (const code of [...courseMap.keys()].sort()) {
    const info = courseMap.get(code)!
    for (const row of info.missing) {
      const fillArgb = mr % 2 === 0 ? XL.rowAlt : XL.white
      const excelRow = m.getRow(mr)
      const wrappedLines = applyDataRow(
        excelRow,
        [
          { col: 1, value: code },
          { col: 2, value: info.title, wrap: true },
          { col: 3, value: row.register_number },
          { col: 4, value: row.student_name, wrap: true },
          { col: 5, value: row.program, wrap: true },
        ],
        { fillArgb, columnWidths: mWidths },
      )
      fitRowHeight(excelRow, wrappedLines, true)
      mr++
    }
  }

  mWidths.apply(m)
  m.views = [
    {
      state: 'frozen',
      ySplit: mHeaderRow,
      xSplit: 0,
      activeCell: `A${mHeaderRow + 1}`,
      showGridLines: true,
    },
  ]

  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}
