import ExcelJS from 'exceljs'
import type { EnrollmentRow } from '../types'
import { workbookCreatedAt, type ExportDeterminismOptions } from './deterministicExport'

function writeBufferToArrayBuffer(buf: unknown): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  throw new Error('Unexpected workbook buffer type')
}

const HEADERS = [
  'Program',
  'Register Number',
  'Student Name',
  'Mobile Number',
  'Email ID',
  'Course Code',
  'Course Title',
  'Faculty',
  'Registration Type',
  'Remarks',
] as const

/**
 * Write enrollment rows back to a simple first-sheet workbook (corrected copy for fix/drop).
 */
export async function enrollmentRowsToWorkbookBuffer(
  rows: EnrollmentRow[],
  options?: ExportDeterminismOptions,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'UniSlot'
  wb.created = workbookCreatedAt(options?.seed)
  const ws = wb.addWorksheet('Enrollment')

  const header = ws.getRow(1)
  HEADERS.forEach((h, i) => {
    header.getCell(i + 1).value = h
    header.getCell(i + 1).font = { bold: true }
  })
  header.commit()

  const sorted = [...rows].sort((a, b) => {
    const reg = a.register_number.localeCompare(b.register_number)
    if (reg !== 0) return reg
    return a.course_code.localeCompare(b.course_code)
  })

  let r = 2
  for (const row of sorted) {
    const excelRow = ws.getRow(r)
    excelRow.getCell(1).value = row.program
    excelRow.getCell(2).value = row.register_number
    excelRow.getCell(3).value = row.student_name
    excelRow.getCell(4).value = row.mobile_number ?? ''
    excelRow.getCell(5).value = row.email_id ?? ''
    excelRow.getCell(6).value = row.course_code
    excelRow.getCell(7).value = row.course_title
    excelRow.getCell(8).value = row.faculty ?? ''
    excelRow.getCell(9).value = row.registration_type ?? ''
    excelRow.getCell(10).value = row.remarks ?? ''
    excelRow.commit()
    r++
  }

  ws.columns = HEADERS.map(() => ({ width: 18 }))
  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}
