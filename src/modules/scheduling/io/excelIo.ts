import ExcelJS from 'exceljs'
import type { Schedule } from './types'

/** Normalize cell values to plain strings for the legacy parser (pandas-like). */
export function cellValueToString(val: ExcelJS.CellValue | null | undefined): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val)
  }
  if (val instanceof Date) {
    return val.toISOString()
  }
  if (typeof val === 'object') {
    const o = val as unknown as Record<string, unknown>
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((t) => t.text).join('')
    }
    if ('result' in o && o.result != null) return String(o.result)
    if ('text' in o && o.text != null) return String(o.text)
  }
  return ''
}

/** Read the first worksheet as an array-of-rows (column-major strings). */
export async function readFirstSheetAsAoA(arrayBuffer: ArrayBuffer): Promise<unknown[][] | null> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) return null

  const aoa: unknown[][] = []
  ws.eachRow({ includeEmpty: true }, (row) => {
    const arr: unknown[] = []
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      while (arr.length < colNumber - 1) arr.push('')
      arr[colNumber - 1] = cellValueToString(cell.value)
    })
    aoa.push(arr)
  })
  return aoa
}

function writeBufferToArrayBuffer(buf: unknown): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  throw new Error('Unexpected workbook buffer type')
}

export async function scheduleToWorkbookBuffer(schedule: Schedule): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const s = wb.addWorksheet('Schedule')
  s.addRow([
    'Course Code',
    'Course Title',
    'Section',
    'Slot',
    'Band',
    'Day',
    'Time',
    'Faculty',
    'Enrollment',
    'Programs',
  ])
  for (const e of schedule.entries) {
    s.addRow([
      e.course_code,
      e.course_title,
      e.section_number,
      e.slot_index,
      e.slot_band,
      e.day,
      e.time,
      e.faculty ?? '',
      e.enrollment_count,
      e.programs,
    ])
  }

  const m = wb.addWorksheet('Meta')
  m.addRow(['Key', 'Value'])
  m.addRow(['Solver', schedule.solver_used])
  m.addRow(['Seconds', schedule.solver_time_seconds])
  m.addRow(['Sections', schedule.total_sections])
  m.addRow(['Students with clashes', schedule.total_clashes])

  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}
