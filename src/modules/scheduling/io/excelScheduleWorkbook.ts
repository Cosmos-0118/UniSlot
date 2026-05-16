import ExcelJS from 'exceljs'
import type { Schedule, ScheduleEntry } from '../types'
import { WEEKDAY_ORDER } from '../engines/timeModel'
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

function wrappedLines(text: string, charsPerLine: number): number {
  if (!text) return 1
  return Math.max(1, Math.ceil(text.length / charsPerLine))
}

/** Optional banner text for the main “Schedule” sheet (edit in Excel or pass from your app later). */
export type ScheduleWorkbookBranding = {
  institution?: string
  college?: string
  sessionLabel?: string
  timetableTitle?: string
  department?: string
  /** Shown in the VENUE column when you do not model rooms yet. */
  venuePlaceholder?: string
}

const DEFAULT_BRANDING: Required<ScheduleWorkbookBranding> = {
  institution: 'INSTITUTE / UNIVERSITY NAME',
  college: 'COLLEGE / SCHOOL NAME',
  sessionLabel: 'EVENING SESSION · (set branding in export options or edit in Excel)',
  timetableTitle: 'TIME TABLE (UNISLOT EXPORT)',
  department: 'DEPARTMENT / PROGRAM OFFICE',
  venuePlaceholder: '—',
}

function resolveBranding(b?: ScheduleWorkbookBranding): Required<ScheduleWorkbookBranding> {
  return { ...DEFAULT_BRANDING, ...b }
}

/** Primary columns aligned with common academic timetable exports + UniSlot detail columns. */
const MAIN_HEADERS = [
  'S.NO',
  'BRANCH',
  'COURSE CODE',
  'COURSE TITLE',
  'Total No. of Students',
  'DAY',
  'TIMING',
  'VENUE',
  'FACULTY NAME',
  'Faculty ID No',
  'FACULTY MOBILE NO',
  'FACULTY Email',
  'Section',
  'Section ID',
  'Slot',
  'Band',
] as const

const MAIN_COL_COUNT = MAIN_HEADERS.length

function timingForDisplay(time: string): string {
  const t = time.trim()
  const idx = t.indexOf('·')
  return idx > 0 ? t.slice(0, idx).trim() : t
}

function rowFillForEntry(e: ScheduleEntry, rowIndex: number): string {
  const dayTint = DAY_FILL[e.day]
  if (dayTint) return dayTint
  return rowIndex % 2 === 0 ? XL.rowAlt : XL.white
}

function sortEntries(entries: ScheduleEntry[]): ScheduleEntry[] {
  const dayOrder = (d: string) => WEEKDAY_ORDER.indexOf(d as (typeof WEEKDAY_ORDER)[number])
  return [...entries].sort(
    (a, b) =>
      dayOrder(a.day) - dayOrder(b.day) ||
      a.slot_index - b.slot_index ||
      a.course_code.localeCompare(b.course_code) ||
      a.section_number - b.section_number,
  )
}

function programTokensFromCell(programsCell: string): string[] {
  return programsCell
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function uniqueProgramTokens(entries: ScheduleEntry[]): string[] {
  const s = new Set<string>()
  for (const e of entries) {
    for (const t of programTokensFromCell(e.programs)) {
      s.add(t.toUpperCase())
    }
  }
  return [...s].sort((a, b) => a.localeCompare(b))
}

function entryHasProgramToken(e: ScheduleEntry, tokenUpper: string): boolean {
  return programTokensFromCell(e.programs).some((t) => t.toUpperCase() === tokenUpper)
}

function styleBannerRow(ws: ExcelJS.Worksheet, rowIndex: number, lastCol: number, fontSize: number) {
  ws.mergeCells(rowIndex, 1, rowIndex, lastCol)
  const cell = ws.getCell(rowIndex, 1)
  cell.font = { bold: true, size: fontSize, color: { argb: XL.white } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primary } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  ws.getRow(rowIndex).height = fontSize > 14 ? 34 : 28
}

function styleSectionTitle(ws: ExcelJS.Worksheet, rowIndex: number, lastCol: number, title: string) {
  ws.mergeCells(rowIndex, 1, rowIndex, lastCol)
  const cell = ws.getCell(rowIndex, 1)
  cell.value = title
  cell.font = { bold: true, size: 12, color: { argb: XL.white } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  ws.getRow(rowIndex).height = 24
}

function applyHeaderRow(
  row: ExcelJS.Row,
  labels: readonly string[],
  lastCol: number,
) {
  row.height = 24
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c)
    cell.value = labels[c - 1] ?? ''
    cell.font = { bold: true, size: 11, color: { argb: XL.white } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = thinBorder
  }
}

function asciiBar(value: number, max: number, width: number): string {
  if (max <= 0 || value <= 0) return value > 0 ? '▏' : ''
  const n = Math.min(width, Math.max(1, Math.round((value / max) * width)))
  return `${'█'.repeat(n)}${value > n && n === width ? '+' : ''}`
}

/**
 * Publication-style schedule workbook (multi-sheet), aligned with common institutional .xlsx layouts:
 * **Schedule** (banner + roster), **By Day**, **By Program**, **Course Catalog**, **Summary**.
 */
export async function scheduleToWorkbookBuffer(
  schedule: Schedule,
  branding?: ScheduleWorkbookBranding,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'UniSlot'
  wb.created = new Date()
  const brand = resolveBranding(branding)

  const sorted = sortEntries(schedule.entries)

  buildScheduleMainSheet(wb, sorted, brand)
  buildByDaySheet(wb, sorted)
  buildByProgramSheet(wb, sorted)
  buildCourseCatalogSheet(wb, sorted)
  buildSummarySheet(wb, schedule, sorted)

  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}

function buildScheduleMainSheet(
  wb: ExcelJS.Workbook,
  entries: ScheduleEntry[],
  brand: Required<ScheduleWorkbookBranding>,
) {
  const ws = wb.addWorksheet('Schedule', {
    views: [{ state: 'frozen', ySplit: 7, activeCell: 'A8', topLeftCell: 'A8' }],
  })

  const bannerLines = [
    brand.institution,
    brand.college,
    brand.sessionLabel,
    brand.timetableTitle,
    brand.department,
  ]
  let r = 1
  for (const line of bannerLines) {
    styleBannerRow(ws, r, MAIN_COL_COUNT, r === 4 ? 15 : 13)
    ws.getCell(r, 1).value = line
    r++
  }

  ws.getRow(r).height = 6
  r++

  const headerRowIndex = r
  applyHeaderRow(ws.getRow(headerRowIndex), MAIN_HEADERS, MAIN_COL_COUNT)
  r++

  const widths = [6, 14, 14, 36, 12, 11, 22, 10, 22, 12, 16, 28, 9, 22, 7, 7].map((w, i) => ({ i, w: w as number }))

  let idx = 1
  for (const e of entries) {
    const row = ws.getRow(r)
    const titleStr = safeCellString(e.course_title)
    const programsStr = safeCellString(e.programs)
    const timeDisp = timingForDisplay(safeCellString(e.time))
    const lineGuess = Math.max(
      wrappedLines(titleStr, 44),
      wrappedLines(programsStr, 20),
      wrappedLines(timeDisp, 36),
    )
    row.height = Math.min(120, Math.max(18, 12 * lineGuess))

    const cells: (string | number)[] = [
      idx,
      programsStr,
      safeCellString(e.course_code),
      titleStr,
      e.enrollment_count,
      e.day,
      timeDisp,
      brand.venuePlaceholder,
      facultyDisplay(e.faculty),
      '—',
      '—',
      '—',
      e.section_number,
      safeCellString(e.section_id),
      e.slot_index,
      e.slot_band,
    ]

    const fillArgb = rowFillForEntry(e, r)
    const wrapCols = new Set([4, 9, 12])
    const centerCols = new Set([1, 5, 6, 13, 15, 16])
    for (let c = 1; c <= MAIN_COL_COUNT; c++) {
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
    row.getCell(1).numFmt = '0'
    row.getCell(5).numFmt = '0'
    row.getCell(13).numFmt = '0'
    row.getCell(15).numFmt = '0'
    row.getCell(16).numFmt = '0'

    widths[2].w = Math.max(widths[2].w, colWidthFromText(safeCellString(e.course_code), 12, 20))
    widths[3].w = Math.max(widths[3].w, colWidthFromText(titleStr, 24, 52))
    widths[6].w = Math.max(widths[6].w, colWidthFromText(timeDisp, 18, 36))
    widths[8].w = Math.max(widths[8].w, colWidthFromText(facultyDisplay(e.faculty), 14, 40))
    widths[1].w = Math.max(widths[1].w, colWidthFromText(programsStr, 12, 28))
    widths[13].w = Math.max(widths[13].w, colWidthFromText(e.section_id, 14, 36))

    idx++
    r++
  }

  for (const { i, w } of widths) {
    ws.getColumn(i + 1).width = w
  }

  if (entries.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: MAIN_COL_COUNT },
    }
  }
}

function buildByDaySheet(wb: ExcelJS.Workbook, entries: ScheduleEntry[]) {
  const ws = wb.addWorksheet('By Day', {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5', topLeftCell: 'A5' }],
  })
  const lastCol = 7
  styleBannerRow(ws, 1, lastCol, 16)
  ws.getCell(1, 1).value = 'SCHEDULE BY DAY'
  ws.getRow(2).height = 8

  let r = 3
  for (const day of WEEKDAY_ORDER) {
    const dayEntries = entries.filter((e) => e.day === day)
    const enrollSum = dayEntries.reduce((a, e) => a + e.enrollment_count, 0)
    styleSectionTitle(ws, r, lastCol, `${day.toUpperCase()} — ${dayEntries.length} sections | ${enrollSum} students`)
    r++

    const hdr = ['#', 'Course Code', 'Course Title', 'Section', 'Enrollment', 'Programs', 'Time']
    applyHeaderRow(ws.getRow(r), hdr, lastCol)
    r++

    let n = 1
    const sortedDay = [...dayEntries].sort(
      (a, b) => a.slot_index - b.slot_index || a.course_code.localeCompare(b.course_code),
    )
    for (const e of sortedDay) {
      const row = ws.getRow(r)
      row.height = 20
      const vals = [
        n,
        e.course_code,
        e.course_title,
        e.section_number,
        e.enrollment_count,
        e.programs,
        timingForDisplay(e.time),
      ]
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c)
        cell.value = vals[c - 1]
        cell.border = thinBorder
        cell.alignment = {
          vertical: 'middle',
          wrapText: c === 3 || c === 6,
          horizontal: c === 1 || c === 4 || c === 5 ? 'center' : 'left',
        }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: rowFillForEntry(e, r) },
        }
      }
      row.getCell(1).numFmt = '0'
      row.getCell(4).numFmt = '0'
      row.getCell(5).numFmt = '0'
      n++
      r++
    }
    r++
  }

  ws.getColumn(1).width = 5
  ws.getColumn(2).width = 14
  ws.getColumn(3).width = 40
  ws.getColumn(4).width = 9
  ws.getColumn(5).width = 11
  ws.getColumn(6).width = 22
  ws.getColumn(7).width = 22
}

function buildByProgramSheet(wb: ExcelJS.Workbook, entries: ScheduleEntry[]) {
  const ws = wb.addWorksheet('By Program', {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5', topLeftCell: 'A5' }],
  })
  const lastCol = 6
  styleBannerRow(ws, 1, lastCol, 16)
  ws.getCell(1, 1).value = 'SCHEDULE BY PROGRAM'
  ws.getRow(2).height = 8

  let r = 3
  const tokensRaw = uniqueProgramTokens(entries)
  const tokens = tokensRaw.length ? tokensRaw : ['_ALL_']
  const hdr = ['#', 'Course Code', 'Course Title', 'Day', 'Time', 'Enrollment']

  for (const tok of tokens) {
    const progEntries =
      tok === '_ALL_'
        ? entries
        : entries.filter((e) => entryHasProgramToken(e, tok))
    const courseKeys = new Set(progEntries.map((e) => e.course_code))
    const label = tok === '_ALL_' ? 'ALL SECTIONS' : tok
    styleSectionTitle(ws, r, lastCol, `${label} — ${courseKeys.size} courses`)
    r++

    applyHeaderRow(ws.getRow(r), hdr, lastCol)
    r++

    const sortedP = [...progEntries].sort(
      (a, b) =>
        a.course_code.localeCompare(b.course_code) ||
        a.section_number - b.section_number,
    )
    let n = 1
    for (const e of sortedP) {
      const row = ws.getRow(r)
      row.height = 20
      const vals = [n, e.course_code, e.course_title, e.day, timingForDisplay(e.time), e.enrollment_count]
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c)
        cell.value = vals[c - 1]
        cell.border = thinBorder
        cell.alignment = {
          vertical: 'middle',
          wrapText: c === 3,
          horizontal: c === 1 || c === 6 ? 'center' : 'left',
        }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: rowFillForEntry(e, r) },
        }
      }
      row.getCell(1).numFmt = '0'
      row.getCell(6).numFmt = '0'
      n++
      r++
    }
    r++
  }

  ws.getColumn(1).width = 5
  ws.getColumn(2).width = 14
  ws.getColumn(3).width = 44
  ws.getColumn(4).width = 12
  ws.getColumn(5).width = 22
  ws.getColumn(6).width = 11
}

function buildCourseCatalogSheet(wb: ExcelJS.Workbook, entries: ScheduleEntry[]) {
  const ws = wb.addWorksheet('Course Catalog', {
    views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4', topLeftCell: 'A4' }],
  })
  const lastCol = 8
  styleBannerRow(ws, 1, lastCol, 16)
  ws.getCell(1, 1).value = 'COMPLETE COURSE CATALOG'
  ws.getRow(2).height = 8

  const hdr = [
    'S.No',
    'Course Code',
    'Course Title',
    'Total Sections',
    'Total Enrollment',
    'Scheduled Days',
    'Programs/Branches',
    'Faculty',
  ]
  let r = 3
  applyHeaderRow(ws.getRow(r), hdr, lastCol)
  r++

  const byCode = new Map<
    string,
    {
      title: string
      sectionIds: Set<string>
      enroll: number
      days: Set<string>
      programs: Set<string>
      faculties: Set<string>
    }
  >()

  for (const e of entries) {
    let g = byCode.get(e.course_code)
    if (!g) {
      g = {
        title: e.course_title,
        sectionIds: new Set(),
        enroll: 0,
        days: new Set(),
        programs: new Set(),
        faculties: new Set(),
      }
      byCode.set(e.course_code, g)
    }
    g.title = e.course_title
    g.sectionIds.add(e.section_id)
    g.enroll += e.enrollment_count
    g.days.add(e.day)
    for (const t of programTokensFromCell(e.programs)) {
      g.programs.add(t)
    }
    const f = facultyDisplay(e.faculty)
    if (f !== '—') g.faculties.add(f)
  }

  const codes = [...byCode.keys()].sort((a, b) => a.localeCompare(b))
  let sn = 1
  for (const code of codes) {
    const g = byCode.get(code)!
    const row = ws.getRow(r)
    row.height = 22
    const dayRank = (x: string) => {
      const i = WEEKDAY_ORDER.indexOf(x as (typeof WEEKDAY_ORDER)[number])
      return i < 0 ? 99 : i
    }
    const dayStr = [...g.days].sort((a, b) => dayRank(a) - dayRank(b)).join(', ')
    const progStr = [...g.programs].sort((a, b) => a.localeCompare(b)).join(', ')
    const facStr = g.faculties.size ? [...g.faculties].join(' · ') : '—'
    const vals = [
      sn,
      code,
      g.title,
      g.sectionIds.size,
      g.enroll,
      dayStr || '—',
      progStr || '—',
      facStr,
    ]
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c)
      cell.value = vals[c - 1]
      cell.border = thinBorder
      cell.alignment = {
        vertical: 'middle',
        wrapText: c === 3 || c === 6 || c === 7 || c === 8,
        horizontal: c === 1 || c === 4 || c === 5 ? 'center' : 'left',
      }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: r % 2 === 0 ? XL.rowAlt : XL.white },
      }
    }
    row.getCell(1).numFmt = '0'
    row.getCell(4).numFmt = '0'
    row.getCell(5).numFmt = '0'
    sn++
    r++
  }

  ws.getColumn(1).width = 7
  ws.getColumn(2).width = 14
  ws.getColumn(3).width = 44
  ws.getColumn(4).width = 14
  ws.getColumn(5).width = 16
  ws.getColumn(6).width = 28
  ws.getColumn(7).width = 28
  ws.getColumn(8).width = 26
}

function buildSummarySheet(wb: ExcelJS.Workbook, schedule: Schedule, entries: ScheduleEntry[]) {
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4' }] })
  const lastCol = 4
  styleBannerRow(ws, 1, lastCol, 16)
  ws.getCell(1, 1).value = 'SCHEDULE SUMMARY'
  ws.getRow(2).height = 8

  let r = 3
  const sectionCount = entries.length
  const enrollmentSeats = entries.reduce((a, e) => a + e.enrollment_count, 0)
  const uniqueCourses = new Set(entries.map((e) => e.course_code)).size
  const uniquePrograms = uniqueProgramTokens(entries).length

  styleSectionTitle(ws, r, lastCol, 'OVERVIEW')
  r++

  const overview: [string, string | number, string][] = [
    ['Total Sections Scheduled', sectionCount, 'sections'],
    ['Total Student Enrollments', enrollmentSeats, 'students'],
    ['Unique Courses', uniqueCourses, 'courses'],
    ['Unique Programs (branch tags)', uniquePrograms, 'programs'],
    ['Days Utilized', WEEKDAY_ORDER.length, 'days'],
  ]
  for (const [k, v, u] of overview) {
    ws.getCell(r, 1).value = k
    ws.getCell(r, 2).value = v
    ws.getCell(r, 3).value = u
    for (let c = 1; c <= 3; c++) {
      const cell = ws.getCell(r, c)
      cell.border = thinBorder
      cell.font = { size: 11 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r % 2 === 0 ? XL.rowAlt : XL.white } }
    }
    ws.getCell(r, 2).numFmt = typeof v === 'number' ? '0' : 'General'
    r++
  }

  r++
  styleSectionTitle(ws, r, lastCol, 'SOLVER & QUALITY')
  r++

  const clashRate =
    enrollmentSeats > 0 ? ((schedule.total_clashes / enrollmentSeats) * 100).toFixed(1) : '0.0'
  const solverRows: [string, string | number][] = [
    ['Algorithm Used', schedule.solver_used],
    ['Computation Time (s)', schedule.solver_time_seconds],
    ['Students with Clashes (report)', schedule.total_clashes],
    ['Clash rate (vs enrollments)', `${clashRate}%`],
  ]
  if (schedule.hard_constraints_feasible !== undefined) {
    solverRows.push(['Hard constraints feasible', schedule.hard_constraints_feasible ? 'Yes' : 'No'])
  }
  if (schedule.solver_primary_metrics_zero !== undefined) {
    solverRows.push(['Solver primary metrics zero', schedule.solver_primary_metrics_zero ? 'Yes' : 'No'])
  }
  if (schedule.hard_constraint_violations?.length) {
    solverRows.push(['Hard constraint violations (count)', schedule.hard_constraint_violations.length])
  }

  for (const [k, v] of solverRows) {
    ws.getCell(r, 1).value = k
    ws.getCell(r, 2).value = v
    for (let c = 1; c <= 2; c++) {
      const cell = ws.getCell(r, c)
      cell.border = thinBorder
      cell.font = { size: 11 }
      cell.alignment = { wrapText: true, vertical: 'top' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r % 2 === 0 ? XL.rowAlt : XL.white } }
    }
    if (typeof v === 'number' && k.includes('Time')) {
      ws.getCell(r, 2).numFmt = '0.00'
    }
    r++
  }

  if (schedule.hard_constraint_violations?.length) {
    ws.getCell(r, 1).value = 'Violation detail'
    ws.getCell(r, 2).value = schedule.hard_constraint_violations.join(' | ')
    ws.getRow(r).height = Math.min(200, 24 + schedule.hard_constraint_violations.length * 2)
    for (let c = 1; c <= 2; c++) {
      const cell = ws.getCell(r, c)
      cell.border = thinBorder
      cell.font = { size: 10 }
      cell.alignment = { wrapText: true, vertical: 'top' }
    }
    r++
  }

  r++
  styleSectionTitle(ws, r, lastCol, 'DAY DISTRIBUTION')
  r++

  applyHeaderRow(ws.getRow(r), ['Day', 'Sections', 'Students', 'Visual'], 4)
  r++

  const perDay: { day: string; sections: number; students: number }[] = []
  for (const day of WEEKDAY_ORDER) {
    const list = entries.filter((e) => e.day === day)
    perDay.push({
      day,
      sections: list.length,
      students: list.reduce((a, e) => a + e.enrollment_count, 0),
    })
  }
  const maxStud = Math.max(1, ...perDay.map((d) => d.students))

  for (const d of perDay) {
    const row = ws.getRow(r)
    row.getCell(1).value = d.day
    row.getCell(2).value = d.sections
    row.getCell(3).value = d.students
    row.getCell(4).value = asciiBar(d.students, maxStud, 26)
    for (let c = 1; c <= 4; c++) {
      const cell = row.getCell(c)
      cell.border = thinBorder
      cell.font = { size: 11 }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: DAY_FILL[d.day] ?? (r % 2 === 0 ? XL.rowAlt : XL.white) },
      }
    }
    row.getCell(2).numFmt = '0'
    row.getCell(3).numFmt = '0'
    row.height = 20
    r++
  }

  ws.getCell(r, 1).value = 'TOTAL'
  ws.getCell(r, 2).value = sectionCount
  ws.getCell(r, 3).value = enrollmentSeats
  ws.getCell(r, 4).value = ''
  for (let c = 1; c <= 4; c++) {
    const cell = ws.getCell(r, c)
    cell.font = { bold: true }
    cell.border = thinBorder
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    cell.alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle' }
  }
  ws.getCell(r, 2).numFmt = '0'
  ws.getCell(r, 3).numFmt = '0'

  ws.getColumn(1).width = 22
  ws.getColumn(2).width = 14
  ws.getColumn(3).width = 14
  ws.getColumn(4).width = 30
}
