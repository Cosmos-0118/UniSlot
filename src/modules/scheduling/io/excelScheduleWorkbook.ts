import ExcelJS from 'exceljs'
import type { Schedule, ScheduleEntry } from '../types'
import { DAY_FILL, XL } from './excelStyleConstants'

function writeBufferToArrayBuffer(buf: unknown): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  throw new Error('Unexpected workbook buffer type')
}

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
}

/** Excel column width is ~1 unit per average character at Calibri 11; clamp for sanity. */
function colWidthFromText(s: string, min: number, max: number): number {
  const len = s.length
  const est = Math.ceil(len * 1.05) + 2
  return Math.min(max, Math.max(min, est))
}

function safeCellString(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function facultyDisplay(faculty: string | null | undefined): string {
  return faculty == null || faculty === '' ? '—' : faculty
}

/** Rough line count for wrapped cells given approximate chars per line. */
function wrappedLines(text: string, charsPerLine: number): number {
  if (!text) return 1
  return Math.max(1, Math.ceil(text.length / charsPerLine))
}

const HEADER_LABELS = [
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
] as const

const COL_COUNT = HEADER_LABELS.length

function rowFillForEntry(e: ScheduleEntry, rowIndex: number): string {
  const dayTint = DAY_FILL[e.day]
  if (dayTint) return dayTint
  return rowIndex % 2 === 0 ? XL.rowAlt : XL.white
}

/**
 * Rich schedule workbook: styled headers, day tinting, zebra fallback, sensible widths,
 * wrap for long text, numeric types, filters, frozen panes, and a readable Meta sheet.
 */
export async function scheduleToWorkbookBuffer(schedule: Schedule): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'UniSlot'
  wb.created = new Date()

  const ws = wb.addWorksheet('Schedule', {
    views: [{ state: 'frozen', ySplit: 2, activeCell: 'A3', topLeftCell: 'A3' }],
  })

  ws.mergeCells(1, 1, 1, COL_COUNT)
  const banner = ws.getCell(1, 1)
  banner.value = 'TIMETABLE'
  banner.font = { bold: true, size: 18, color: { argb: XL.white } }
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  banner.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 36

  const headerRowIndex = 2
  const headerRow = ws.getRow(headerRowIndex)
  headerRow.height = 26
  for (let c = 1; c <= COL_COUNT; c++) {
    const cell = headerRow.getCell(c)
    cell.value = HEADER_LABELS[c - 1]
    cell.font = { bold: true, size: 11, color: { argb: XL.white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = thinBorder
  }

  const widths = [12, 28, 9, 7, 7, 12, 22, 18, 11, 36].map((w, i) => ({ i, w: w as number }))

  let r = headerRowIndex + 1
  for (const e of schedule.entries) {
    const row = ws.getRow(r)
    const titleStr = safeCellString(e.course_title)
    const programsStr = safeCellString(e.programs)
    const lineGuess = Math.max(
      wrappedLines(titleStr, 48),
      wrappedLines(programsStr, 72),
      wrappedLines(safeCellString(e.time), 40),
    )
    row.height = Math.min(140, Math.max(18, 13 * lineGuess))

    const cells: (string | number)[] = [
      safeCellString(e.course_code),
      titleStr,
      e.section_number,
      e.slot_index,
      e.slot_band,
      e.day,
      safeCellString(e.time),
      facultyDisplay(e.faculty),
      e.enrollment_count,
      programsStr,
    ]

    const fillArgb = rowFillForEntry(e, r)

    const wrapCols = new Set([2, 7, 10])
    const centerCols = new Set([3, 4, 5, 6, 9])
    for (let c = 1; c <= COL_COUNT; c++) {
      const cell = row.getCell(c)
      cell.value = cells[c - 1]
      cell.border = thinBorder
      cell.alignment = {
        vertical: 'middle',
        wrapText: wrapCols.has(c),
        horizontal: centerCols.has(c) ? 'center' : 'left',
      }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
    }

    row.getCell(3).numFmt = '0'
    row.getCell(4).numFmt = '0'
    row.getCell(5).numFmt = '0'
    row.getCell(9).numFmt = '0'

    const codeW = colWidthFromText(safeCellString(e.course_code), 10, 22)
    const titleW = colWidthFromText(titleStr, 18, 52)
    const timeW = colWidthFromText(safeCellString(e.time), 16, 40)
    const facW = colWidthFromText(facultyDisplay(e.faculty), 12, 45)
    const progW = colWidthFromText(programsStr, 22, 70)

    widths[0].w = Math.max(widths[0].w, codeW)
    widths[1].w = Math.max(widths[1].w, titleW)
    widths[6].w = Math.max(widths[6].w, timeW)
    widths[7].w = Math.max(widths[7].w, facW)
    widths[9].w = Math.max(widths[9].w, progW)

    r++
  }

  for (const { i, w } of widths) {
    ws.getColumn(i + 1).width = w
  }

  if (schedule.entries.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: COL_COUNT },
    }
  }

  const meta = wb.addWorksheet('Meta')
  meta.mergeCells('A1:B1')
  const mt = meta.getCell('A1')
  mt.value = 'RUN METADATA'
  mt.font = { bold: true, size: 16, color: { argb: XL.white } }
  mt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  mt.alignment = { horizontal: 'center', vertical: 'middle' }
  meta.getRow(1).height = 32

  const metaRows: [string, string | number | boolean][] = [
    ['Solver', schedule.solver_used],
    ['Solve time (s)', schedule.solver_time_seconds],
    ['Sections in workbook', schedule.entries.length],
    ['Total sections (domain)', schedule.total_sections],
    ['Students with clashes', schedule.total_clashes],
  ]

  if (schedule.hard_constraints_feasible !== undefined) {
    metaRows.push(['Hard constraints feasible', schedule.hard_constraints_feasible])
  }
  if (schedule.solver_primary_metrics_zero !== undefined) {
    metaRows.push(['Solver primary metrics zero', schedule.solver_primary_metrics_zero])
  }
  if (schedule.hard_constraint_violations?.length) {
    metaRows.push(['Hard constraint violations (count)', schedule.hard_constraint_violations.length])
    metaRows.push(['Hard constraint violations (detail)', schedule.hard_constraint_violations.join(' | ')])
  }

  let mr = 3
  meta.getCell(mr, 1).value = 'Key'
  meta.getCell(mr, 2).value = 'Value'
  for (const c of [1, 2]) {
    const cell = meta.getCell(mr, c)
    cell.font = { bold: true, color: { argb: XL.white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    cell.alignment = { horizontal: c === 1 ? 'left' : 'left', vertical: 'middle', wrapText: true }
    cell.border = thinBorder
  }
  meta.getRow(mr).height = 24
  mr++

  for (const [k, v] of metaRows) {
    const kc = meta.getCell(mr, 1)
    kc.value = k
    kc.font = { size: 11 }
    kc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: mr % 2 === 0 ? XL.rowAlt : XL.white } }
    kc.alignment = { vertical: 'top', wrapText: true }
    kc.border = thinBorder

    const vc = meta.getCell(mr, 2)
    vc.value = v
    vc.font = { size: 11 }
    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: mr % 2 === 0 ? XL.rowAlt : XL.white } }
    vc.alignment = { vertical: 'top', wrapText: true }
    vc.border = thinBorder

    if (typeof v === 'number' && k.includes('(s)')) {
      vc.numFmt = '0.000'
    } else if (typeof v === 'number') {
      vc.numFmt = '0'
    }

    meta.getRow(mr).height = Math.min(120, Math.max(18, String(v).length > 80 ? 36 : 20))
    mr++
  }

  meta.getColumn(1).width = 34
  meta.getColumn(2).width = 56

  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}
