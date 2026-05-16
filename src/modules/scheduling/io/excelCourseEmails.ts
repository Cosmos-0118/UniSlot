import ExcelJS from 'exceljs'
import type { EnrollmentRow } from '../types'
import { applyDataRow, ColumnWidthTracker, fitRowHeight } from './excelLayout'
import { XL } from './excelStyleConstants'

function writeBufferToArrayBuffer(buf: unknown): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  throw new Error('Unexpected workbook buffer type')
}

/**
 * Course-wise deduplicated email lists + students missing email (legacy `export_course_grouping_xlsx`).
 */
export async function courseEmailsToWorkbookBuffer(rows: EnrollmentRow[]): Promise<ArrayBuffer> {
  type Group = {
    title: string
    students: Set<string>
    emails: string[]
    missing: EnrollmentRow[]
  }
  const courseMap = new Map<string, Group>()

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
  const ws = wb.addWorksheet('Course Emails')

  ws.mergeCells('A1:E1')
  const t1 = ws.getCell('A1')
  t1.value = 'COURSE EMAIL GROUPS'
  t1.font = { bold: true, size: 16, color: { argb: XL.white } }
  t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  t1.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 30

  const headers = ['Course Code', 'Course Title', 'Student Count', 'Email Count', 'Emails']
  const headerRow = 3
  headers.forEach((h, i) => {
    const c = ws.getRow(headerRow).getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: XL.white } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  ws.getRow(headerRow).height = 28

  const colWidths = new ColumnWidthTracker([
    { col: 1, width: 16, min: 14, max: 24 },
    { col: 2, width: 45, min: 28, max: 56 },
    { col: 3, width: 14, min: 12, max: 18 },
    { col: 4, width: 12, min: 10, max: 16 },
    { col: 5, width: 60, min: 40, max: 100 },
  ])

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
    const wrappedLines = applyDataRow(
      row,
      [
        { col: 1, value: code },
        { col: 2, value: info.title, wrap: true },
        { col: 3, value: info.students.size, horizontal: 'center', numFmt: '0' },
        { col: 4, value: emails.length, horizontal: 'center', numFmt: '0' },
        { col: 5, value: emails.join(', '), wrap: true },
      ],
      { fillArgb: rowFill, columnWidths: colWidths },
    )
    fitRowHeight(row, wrappedLines, true)
    r++
  }

  colWidths.apply(ws)
  ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0, activeCell: 'A4', showGridLines: true }]

  const m = wb.addWorksheet('Missing Emails')
  m.mergeCells('A1:E1')
  const t2 = m.getCell('A1')
  t2.value = 'STUDENTS WITHOUT EMAIL'
  t2.font = { bold: true, size: 16, color: { argb: XL.white } }
  t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  t2.alignment = { horizontal: 'center', vertical: 'middle' }
  m.getRow(1).height = 30

  const mh = ['Course Code', 'Course Title', 'Register Number', 'Student Name', 'Program']
  mh.forEach((h, i) => {
    const c = m.getRow(headerRow).getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: XL.white } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  m.getRow(headerRow).height = 28

  const missingColWidths = new ColumnWidthTracker([
    { col: 1, width: 16, min: 14, max: 24 },
    { col: 2, width: 45, min: 28, max: 56 },
    { col: 3, width: 18, min: 14, max: 24 },
    { col: 4, width: 28, min: 20, max: 40 },
    { col: 5, width: 24, min: 18, max: 44 },
  ])

  let mr = headerRow + 1
  for (const code of [...courseMap.keys()].sort()) {
    const info = courseMap.get(code)!
    for (const miss of info.missing) {
      const rowFill = mr % 2 === 0 ? XL.rowAlt : XL.white
      const row = m.getRow(mr)
      const wrappedLines = applyDataRow(
        row,
        [
          { col: 1, value: code },
          { col: 2, value: info.title, wrap: true },
          { col: 3, value: miss.register_number },
          { col: 4, value: miss.student_name },
          { col: 5, value: miss.program, wrap: true },
        ],
        { fillArgb: rowFill, columnWidths: missingColWidths },
      )
      fitRowHeight(row, wrappedLines, true)
      mr++
    }
  }
  missingColWidths.apply(m)
  m.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0, activeCell: 'A4', showGridLines: true }]

  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}
