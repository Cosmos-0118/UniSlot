import ExcelJS from 'exceljs'
import type { EnrollmentRow } from '../types'
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
    const vals = [code, info.title, info.students.size, emails.length, emails.join(', ')]
    vals.forEach((v, i) => {
      const cell = ws.getRow(r).getCell(i + 1)
      cell.value = v
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFill } }
      cell.alignment =
        i === 4
          ? { vertical: 'middle', wrapText: true, horizontal: 'left' }
          : i === 2 || i === 3
            ? { horizontal: 'center', vertical: 'middle' }
            : { horizontal: 'left', vertical: 'middle' }
    })
    ws.getRow(r).height = 24
    r++
  }

  ws.getColumn(1).width = 16
  ws.getColumn(2).width = 45
  ws.getColumn(3).width = 14
  ws.getColumn(4).width = 12
  ws.getColumn(5).width = 90
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

  let mr = headerRow + 1
  for (const code of [...courseMap.keys()].sort()) {
    const info = courseMap.get(code)!
    for (const miss of info.missing) {
      const rowFill = mr % 2 === 0 ? XL.rowAlt : XL.white
      const vals = [code, info.title, miss.register_number, miss.student_name, miss.program]
      vals.forEach((v, i) => {
        const cell = m.getRow(mr).getCell(i + 1)
        cell.value = v
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFill } }
        cell.alignment = { horizontal: 'left', vertical: 'middle' }
      })
      m.getRow(mr).height = 22
      mr++
    }
  }
  m.getColumn(1).width = 16
  m.getColumn(2).width = 45
  m.getColumn(3).width = 18
  m.getColumn(4).width = 28
  m.getColumn(5).width = 24
  m.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0, activeCell: 'A4', showGridLines: true }]

  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}
