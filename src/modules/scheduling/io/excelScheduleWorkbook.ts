import ExcelJS from 'exceljs'
import type { Schedule, ScheduleEntry, Student } from '../types'
import type { SchedulingSnapshot } from '../merge/snapshot'
import type { RunLogEntry } from '../merge/runLog'
import type { ClashProvenanceMap } from '../merge/clashProvenance'
import { WEEKDAY_ORDER } from '../solver/timeModel'
import {
  applyDataRow,
  ColumnWidthTracker,
  fitRowHeight,
  safeCellString,
  thinBorder,
  type DataRowCellSpec,
} from './excelLayout'
import { EXCEL_BRAND } from './excelBranding'
import { workbookCreatedAt, type ExportDeterminismOptions } from './deterministicExport'
import { DAY_FILL, XL } from './excelStyleConstants'
import {
  formatLateAddsChain,
  lateAddsFont,
  type LateMarking,
} from './excelLateMarking'
import {
  buildClashLogSheet,
  buildLateEnrollmentsSheet,
  buildRunLogSheet,
} from './excelLogSheets'

function writeBufferToArrayBuffer(buf: unknown): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }
  throw new Error('Unexpected workbook buffer type')
}

function facultyDisplay(faculty: string | null | undefined): string {
  return faculty == null || faculty === '' ? '—' : faculty
}

/** Optional banner text for the main “Schedule” sheet (edit in Excel or pass from your app later). */
export type ScheduleWorkbookBranding = {
  /** App name (top banner line). */
  institution?: string
  /** College / university line under the app name. */
  college?: string
  sessionLabel?: string
  timetableTitle?: string
  department?: string
  /** Shown in the VENUE column when you do not model rooms yet. */
  venuePlaceholder?: string
}

const DEFAULT_BRANDING: Required<ScheduleWorkbookBranding> = {
  institution: EXCEL_BRAND.appName,
  college: EXCEL_BRAND.college,
  sessionLabel: EXCEL_BRAND.sessionLabel,
  timetableTitle: EXCEL_BRAND.timetableTitle,
  department: EXCEL_BRAND.department,
  venuePlaceholder: EXCEL_BRAND.venuePlaceholder,
}

function resolveBranding(b?: ScheduleWorkbookBranding): Required<ScheduleWorkbookBranding> {
  return { ...DEFAULT_BRANDING, ...b }
}

/** Clean primary columns for non-technical readers. */
const MAIN_HEADERS = [
  'S.No',
  'Branch / Program',
  'Course Code',
  'Course Title',
  'Students',
  'Day',
  'Timing',
  'Venue',
  'Faculty',
  'Section',
] as const

const DETAIL_HEADERS = [
  'S.No',
  'Course Code',
  'Course Title',
  'Section',
  'Section ID',
  'Day',
  'Timing',
  'Weekday Index',
  'Parallel Lane',
  'Students',
  'Faculty',
  'Programs',
] as const

/** Friendly timing: "Monday 5:00–7:00 PM (Parallel lane 3/72)". */
export function friendlyTiming(day: string, lane: number, laneCount: number): string {
  return `${day} 5:00–7:00 PM (Parallel lane ${lane}/${laneCount})`
}

function timingForDisplay(e: ScheduleEntry | string): string {
  if (typeof e === 'string') {
    const t = e.trim()
    const idx = t.indexOf('·')
    return idx > 0 ? t.slice(0, idx).trim() : t
  }
  return friendlyTiming(e.day, e.slot_band, e.parallel_lane_count)
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

/** UniSlot + SRMIST brand row, then sheet title. Returns first content row. */
function writeSheetBrandTitle(ws: ExcelJS.Worksheet, lastCol: number, title: string): number {
  styleBannerRow(ws, 1, lastCol, 14)
  ws.getCell(1, 1).value = `${EXCEL_BRAND.appName} · ${EXCEL_BRAND.college}`
  styleBannerRow(ws, 2, lastCol, 13)
  ws.getCell(2, 1).value = title
  ws.getRow(3).height = 8
  return 4
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

export type ScheduleWorkbookOptions = {
  branding?: ScheduleWorkbookBranding
  /** When provided, adds the “Students by Course & Weekday” roster sheet. */
  snapshot?: SchedulingSnapshot | null
  lateMarking?: LateMarking | null
  runLog?: RunLogEntry[]
  clashProvenance?: ClashProvenanceMap
} & ExportDeterminismOptions

/**
 * Publication-style schedule workbook (multi-sheet):
 * Schedule · Details · By Day · By Program · Course Catalog · Summary · (optional) Students by Course & Weekday
 * · (optional) Late Enrollments · Run Log
 */
export async function scheduleToWorkbookBuffer(
  schedule: Schedule,
  brandingOrOptions?: ScheduleWorkbookBranding | ScheduleWorkbookOptions,
): Promise<ArrayBuffer> {
  const options: ScheduleWorkbookOptions =
    brandingOrOptions &&
    typeof brandingOrOptions === 'object' &&
    ('branding' in brandingOrOptions ||
      'snapshot' in brandingOrOptions ||
      'lateMarking' in brandingOrOptions ||
      'runLog' in brandingOrOptions ||
      'clashProvenance' in brandingOrOptions ||
      'seed' in brandingOrOptions)
      ? (brandingOrOptions as ScheduleWorkbookOptions)
      : { branding: brandingOrOptions as ScheduleWorkbookBranding | undefined }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'UniSlot'
  wb.created = workbookCreatedAt(options.seed)
  const brand = resolveBranding(options.branding)

  const sorted = sortEntries(schedule.entries)
  const late = options.lateMarking ?? null

  buildScheduleMainSheet(wb, sorted, brand, late)
  buildDetailsSheet(wb, sorted, late)
  buildByDaySheet(wb, sorted)
  buildByProgramSheet(wb, sorted)
  buildCourseCatalogSheet(wb, sorted, late)
  buildSummarySheet(wb, schedule, sorted, late, options.runLog)
  if (options.snapshot) {
    buildStudentsByCourseSlotSheet(wb, sorted, options.snapshot, late)
  }
  // Only this run's batch has per-registration detail; a carried-forward marking has none.
  if (late && (late.assignments.length > 0 || late.parked.length > 0)) {
    const dayBySection: Record<string, string> = {}
    const timingBySection: Record<string, string> = {}
    for (const e of sorted) {
      dayBySection[e.section_id] = e.day
      timingBySection[e.section_id] = timingForDisplay(e)
    }
    buildLateEnrollmentsSheet(wb, late, { dayBySection, timingBySection })
  }
  if (options.runLog?.length) {
    buildRunLogSheet(wb, options.runLog)
  }
  if (options.clashProvenance && Object.keys(options.clashProvenance).length > 0) {
    buildClashLogSheet(wb, options.clashProvenance)
  }

  const buf = await wb.xlsx.writeBuffer()
  return writeBufferToArrayBuffer(buf)
}

function buildScheduleMainSheet(
  wb: ExcelJS.Workbook,
  entries: ScheduleEntry[],
  brand: Required<ScheduleWorkbookBranding>,
  late: LateMarking | null,
) {
  const showLate = Boolean(late)
  const headers = showLate ? [...MAIN_HEADERS, 'Late Adds'] : [...MAIN_HEADERS]
  const colCount = headers.length

  const bannerLines = [
    brand.institution,
    brand.college,
    brand.sessionLabel,
    brand.timetableTitle,
    brand.department,
  ].filter((line) => line.trim().length > 0)

  // Banner + howto + legend + header — freeze below the header row.
  const freezeAt = bannerLines.length + 3
  const ws = wb.addWorksheet('Schedule', {
    views: [
      {
        state: 'frozen',
        ySplit: freezeAt,
        activeCell: `A${freezeAt + 1}`,
        topLeftCell: `A${freezeAt + 1}`,
      },
    ],
  })

  let r = 1
  for (let i = 0; i < bannerLines.length; i++) {
    const line = bannerLines[i]!
    const isApp = i === 0
    const isTitle = line === brand.timetableTitle
    styleBannerRow(ws, r, colCount, isApp || isTitle ? 15 : 13)
    ws.getCell(r, 1).value = line
    r++
  }

  ws.mergeCells(r, 1, r, colCount)
  const howto = ws.getCell(r, 1)
  howto.value = showLate
    ? 'How to read this timetable: each row is one course section. Day row colors group weekdays. Late Adds shows batch growth (e.g. 5 +3 = first batch 5, then +3 more). Amber rows/sections were touched by late enrollment.'
    : 'How to read this timetable: each row is one course section. Day row colors group weekdays. Parallel lanes run simultaneously from 5–7 PM; technical IDs are on the Details sheet.'
  howto.font = { size: 10, italic: true, color: { argb: 'FF334155' } }
  howto.alignment = { wrapText: true, vertical: 'middle' }
  ws.getRow(r).height = 28
  r++

  ws.mergeCells(r, 1, r, colCount)
  const legend = ws.getCell(r, 1)
  legend.value = `Day legend: ${WEEKDAY_ORDER.join(' · ')}  |  One evening session each weekday: 5:00–7:00 PM`
  legend.font = { size: 10, color: { argb: 'FF475569' } }
  legend.alignment = { wrapText: true, vertical: 'middle' }
  ws.getRow(r).height = 22
  r++

  const headerRowIndex = r
  applyHeaderRow(ws.getRow(headerRowIndex), headers, colCount)
  r++

  const colWidthSpecs = [
    { col: 1, width: 6, min: 5, max: 8 },
    { col: 2, width: 22, min: 14, max: 48 },
    { col: 3, width: 14, min: 12, max: 22 },
    { col: 4, width: 36, min: 24, max: 56 },
    { col: 5, width: 10, min: 8, max: 14 },
    { col: 6, width: 11, min: 9, max: 14 },
    { col: 7, width: 32, min: 24, max: 44 },
    { col: 8, width: 10, min: 8, max: 14 },
    { col: 9, width: 24, min: 14, max: 42 },
    { col: 10, width: 9, min: 8, max: 12 },
  ]
  if (showLate) colWidthSpecs.push({ col: 11, width: 12, min: 8, max: 18 })
  const colWidths = new ColumnWidthTracker(colWidthSpecs)

  let idx = 1
  for (const e of entries) {
    const row = ws.getRow(r)
    const titleStr = safeCellString(e.course_title)
    const programsStr = safeCellString(e.programs)
    const timeDisp = timingForDisplay(e)
    const isLateSec = late?.lateSectionIds.has(e.section_id)
    let fillArgb = rowFillForEntry(e, r)
    if (isLateSec) fillArgb = XL.lateSection

    const cells: DataRowCellSpec[] = [
      { col: 1, value: idx, horizontal: 'center', numFmt: '0' },
      { col: 2, value: programsStr, wrap: true },
      { col: 3, value: safeCellString(e.course_code) },
      { col: 4, value: titleStr, wrap: true },
      { col: 5, value: e.enrollment_count, horizontal: 'center', numFmt: '0' },
      { col: 6, value: e.day, horizontal: 'center' },
      { col: 7, value: timeDisp, wrap: true },
      { col: 8, value: brand.venuePlaceholder, horizontal: 'center' },
      { col: 9, value: facultyDisplay(e.faculty), wrap: true },
      { col: 10, value: e.section_number, horizontal: 'center', numFmt: '0' },
    ]
    if (showLate && late) {
      const chain = late.lateAddsBySection[e.section_id]
      cells.push({
        col: 11,
        value: formatLateAddsChain(chain),
        horizontal: 'center',
        font: lateAddsFont(chain, late.batch, XL.lateText),
      })
    }

    const wrappedLines = applyDataRow(row, cells, {
      fillArgb,
      columnWidths: colWidths,
      defaultVertical: 'middle',
    })
    fitRowHeight(row, wrappedLines, true)

    idx++
    r++
  }

  colWidths.apply(ws)

  if (entries.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: colCount },
    }
  }
}

function buildDetailsSheet(wb: ExcelJS.Workbook, entries: ScheduleEntry[], late: LateMarking | null) {
  const showLate = Boolean(late)
  const headers = showLate ? [...DETAIL_HEADERS, 'Late Adds'] : [...DETAIL_HEADERS]
  const lastCol = headers.length
  const ws = wb.addWorksheet('Details', {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5', topLeftCell: 'A5' }],
  })
  const headerRowIndex = writeSheetBrandTitle(
    ws,
    lastCol,
    'TECHNICAL DETAILS (Weekday / Parallel Lane / Section ID)',
  )
  applyHeaderRow(ws.getRow(headerRowIndex), headers, lastCol)

  const colWidthSpecs = [
    { col: 1, width: 6, min: 5, max: 8 },
    { col: 2, width: 14, min: 12, max: 22 },
    { col: 3, width: 36, min: 24, max: 56 },
    { col: 4, width: 9, min: 8, max: 12 },
    { col: 5, width: 22, min: 14, max: 36 },
    { col: 6, width: 11, min: 9, max: 14 },
    { col: 7, width: 32, min: 24, max: 44 },
    { col: 8, width: 8, min: 6, max: 10 },
    { col: 9, width: 8, min: 6, max: 10 },
    { col: 10, width: 10, min: 8, max: 14 },
    { col: 11, width: 22, min: 14, max: 42 },
    { col: 12, width: 28, min: 18, max: 48 },
  ]
  if (showLate) colWidthSpecs.push({ col: 13, width: 12, min: 8, max: 18 })
  const colWidths = new ColumnWidthTracker(colWidthSpecs)

  let r = headerRowIndex + 1
  let idx = 1
  for (const e of entries) {
    const row = ws.getRow(r)
    let fillArgb = rowFillForEntry(e, r)
    if (late?.lateSectionIds.has(e.section_id)) fillArgb = XL.lateSection
    const cells: DataRowCellSpec[] = [
      { col: 1, value: idx, horizontal: 'center', numFmt: '0' },
      { col: 2, value: safeCellString(e.course_code) },
      { col: 3, value: safeCellString(e.course_title), wrap: true },
      { col: 4, value: e.section_number, horizontal: 'center', numFmt: '0' },
      { col: 5, value: safeCellString(e.section_id) },
      { col: 6, value: e.day, horizontal: 'center' },
      { col: 7, value: timingForDisplay(e), wrap: true },
      { col: 8, value: e.slot_index, horizontal: 'center', numFmt: '0' },
      { col: 9, value: e.slot_band, horizontal: 'center', numFmt: '0' },
      { col: 10, value: e.enrollment_count, horizontal: 'center', numFmt: '0' },
      { col: 11, value: facultyDisplay(e.faculty), wrap: true },
      { col: 12, value: safeCellString(e.programs), wrap: true },
    ]
    if (showLate && late) {
      const chain = late.lateAddsBySection[e.section_id]
      cells.push({
        col: 13,
        value: formatLateAddsChain(chain),
        horizontal: 'center',
        font: lateAddsFont(chain, late.batch, XL.lateText),
      })
    }
    const wrappedLines = applyDataRow(row, cells, { fillArgb, columnWidths: colWidths })
    fitRowHeight(row, wrappedLines, true)
    idx++
    r++
  }
  colWidths.apply(ws)
  if (entries.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: lastCol },
    }
  }
}

function buildStudentsByCourseSlotSheet(
  wb: ExcelJS.Workbook,
  entries: ScheduleEntry[],
  snapshot: SchedulingSnapshot,
  late: LateMarking | null,
) {
  const showLate = Boolean(late)
  const lastCol = showLate ? 7 : 6
  const ws = wb.addWorksheet('Students by Course & Weekday', {
    views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4', topLeftCell: 'A4' }],
  })
  let r = writeSheetBrandTitle(ws, lastCol, 'STUDENTS BY COURSE & WEEKDAY')

  const colWidthSpecs = [
    { col: 1, width: 6, min: 5, max: 8 },
    { col: 2, width: 16, min: 12, max: 22 },
    { col: 3, width: 28, min: 18, max: 44 },
    { col: 4, width: 18, min: 12, max: 28 },
    { col: 5, width: 14, min: 10, max: 18 },
    { col: 6, width: 28, min: 18, max: 40 },
  ]
  if (showLate) colWidthSpecs.push({ col: 7, width: 10, min: 8, max: 14 })
  const colWidths = new ColumnWidthTracker(colWidthSpecs)

  const sectionById = new Map<string, (typeof snapshot.courseSections)[string][number]>()
  for (const secs of Object.values(snapshot.courseSections)) {
    for (const s of secs) sectionById.set(s.section_id, s)
  }

  const byCourse = new Map<string, ScheduleEntry[]>()
  for (const e of entries) {
    if (!byCourse.has(e.course_code)) byCourse.set(e.course_code, [])
    byCourse.get(e.course_code)!.push(e)
  }

  const courseCodes = [...byCourse.keys()].sort((a, b) => a.localeCompare(b))
  for (const code of courseCodes) {
    const courseEntries = byCourse.get(code)!
    for (const e of courseEntries) {
      const sec = sectionById.get(e.section_id)
      const roster = sec?.enrolled_students ?? []
      const timing = timingForDisplay(e)
      styleSectionTitle(
        ws,
        r,
        lastCol,
        `${code} · ${e.course_title} · ${timing} · Section ${e.section_number} · Parallel lane ${e.slot_band}/${e.parallel_lane_count} · ${roster.length} students`,
      )
      r++
      const hdr = showLate
        ? ['S.No', 'Register No', 'Student Name', 'Program', 'Mobile', 'Email', 'Late']
        : ['S.No', 'Register No', 'Student Name', 'Program', 'Mobile', 'Email']
      applyHeaderRow(ws.getRow(r), hdr, lastCol)
      r++

      const sortedRegs = [...roster].sort((a, b) => a.localeCompare(b))
      let n = 1
      for (const reg of sortedRegs) {
        const st: Student | undefined = snapshot.students[reg]
        const row = ws.getRow(r)
        const isLate = late?.latePairs.has(`${reg}:${code}`) || late?.lateStudents.has(reg)
        const isMoved = late?.movedStudents.has(reg)
        let fillArgb: string = r % 2 === 0 ? XL.rowAlt : XL.white
        if (isLate) fillArgb = XL.late
        else if (isMoved) fillArgb = XL.moved
        const cells: DataRowCellSpec[] = [
          { col: 1, value: n, horizontal: 'center', numFmt: '0' },
          { col: 2, value: reg },
          { col: 3, value: safeCellString(st?.name ?? '—'), wrap: true },
          { col: 4, value: safeCellString(st?.program ?? '—'), wrap: true },
          { col: 5, value: safeCellString(st?.mobile ?? '—') },
          { col: 6, value: safeCellString(st?.email ?? '—'), wrap: true },
        ]
        if (showLate) {
          cells.push({
            col: 7,
            value: isLate ? 'Late' : isMoved ? 'Moved' : '',
            horizontal: 'center',
          })
        }
        const wrappedLines = applyDataRow(row, cells, { fillArgb, columnWidths: colWidths })
        fitRowHeight(row, wrappedLines, true)
        n++
        r++
      }
      r++
    }
  }

  colWidths.apply(ws)
}

function buildByDaySheet(wb: ExcelJS.Workbook, entries: ScheduleEntry[]) {
  const lastCol = 7
  const ws = wb.addWorksheet('By Day', {
    views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4', topLeftCell: 'A4' }],
  })
  let r = writeSheetBrandTitle(ws, lastCol, 'SCHEDULE BY DAY')

  const colWidths = new ColumnWidthTracker([
    { col: 1, width: 5, min: 4, max: 7 },
    { col: 2, width: 14, min: 12, max: 22 },
    { col: 3, width: 40, min: 28, max: 56 },
    { col: 4, width: 9, min: 8, max: 12 },
    { col: 5, width: 11, min: 10, max: 14 },
    { col: 6, width: 28, min: 20, max: 52 },
    { col: 7, width: 22, min: 18, max: 36 },
  ])

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
      const fillArgb = rowFillForEntry(e, r)
      const wrappedLines = applyDataRow(
        row,
        [
          { col: 1, value: n, horizontal: 'center', numFmt: '0' },
          { col: 2, value: e.course_code },
          { col: 3, value: e.course_title, wrap: true },
          { col: 4, value: e.section_number, horizontal: 'center', numFmt: '0' },
          { col: 5, value: e.enrollment_count, horizontal: 'center', numFmt: '0' },
          { col: 6, value: e.programs, wrap: true },
          { col: 7, value: timingForDisplay(e) },
        ],
        { fillArgb, columnWidths: colWidths },
      )
      fitRowHeight(row, wrappedLines, true)
      n++
      r++
    }
    r++
  }

  colWidths.apply(ws)
}

function buildByProgramSheet(wb: ExcelJS.Workbook, entries: ScheduleEntry[]) {
  const lastCol = 6
  const ws = wb.addWorksheet('By Program', {
    views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4', topLeftCell: 'A4' }],
  })
  let r = writeSheetBrandTitle(ws, lastCol, 'SCHEDULE BY PROGRAM')

  const colWidths = new ColumnWidthTracker([
    { col: 1, width: 5, min: 4, max: 7 },
    { col: 2, width: 14, min: 12, max: 22 },
    { col: 3, width: 44, min: 28, max: 56 },
    { col: 4, width: 12, min: 10, max: 14 },
    { col: 5, width: 22, min: 18, max: 36 },
    { col: 6, width: 11, min: 10, max: 14 },
  ])

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
      const fillArgb = rowFillForEntry(e, r)
      const wrappedLines = applyDataRow(
        row,
        [
          { col: 1, value: n, horizontal: 'center', numFmt: '0' },
          { col: 2, value: e.course_code },
          { col: 3, value: e.course_title, wrap: true },
          { col: 4, value: e.day },
          { col: 5, value: timingForDisplay(e) },
          { col: 6, value: e.enrollment_count, horizontal: 'center', numFmt: '0' },
        ],
        { fillArgb, columnWidths: colWidths },
      )
      fitRowHeight(row, wrappedLines, true)
      n++
      r++
    }
    r++
  }

  colWidths.apply(ws)
}

function buildCourseCatalogSheet(
  wb: ExcelJS.Workbook,
  entries: ScheduleEntry[],
  late: LateMarking | null,
) {
  const showLate = Boolean(late)
  const lastCol = showLate ? 9 : 8
  const ws = wb.addWorksheet('Course Catalog', {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5', topLeftCell: 'A5' }],
  })
  let r = writeSheetBrandTitle(ws, lastCol, 'COMPLETE COURSE CATALOG')

  const hdr = [
    'S.No',
    'Course Code',
    'Course Title',
    'Total Sections',
    'Total Enrollment',
    'Scheduled Days',
    'Programs/Branches',
    'Faculty',
    ...(showLate ? ['Late Adds'] : []),
  ]
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

  const colWidthSpecs = [
    { col: 1, width: 7, min: 6, max: 9 },
    { col: 2, width: 14, min: 12, max: 22 },
    { col: 3, width: 44, min: 28, max: 56 },
    { col: 4, width: 14, min: 12, max: 18 },
    { col: 5, width: 16, min: 12, max: 18 },
    { col: 6, width: 28, min: 18, max: 40 },
    { col: 7, width: 32, min: 22, max: 52 },
    { col: 8, width: 26, min: 18, max: 44 },
  ]
  if (showLate) colWidthSpecs.push({ col: 9, width: 12, min: 8, max: 18 })
  const colWidths = new ColumnWidthTracker(colWidthSpecs)

  const codes = [...byCode.keys()].sort((a, b) => a.localeCompare(b))
  let sn = 1
  for (const code of codes) {
    const g = byCode.get(code)!
    const row = ws.getRow(r)
    const dayRank = (x: string) => {
      const i = WEEKDAY_ORDER.indexOf(x as (typeof WEEKDAY_ORDER)[number])
      return i < 0 ? 99 : i
    }
    const dayStr = [...g.days].sort((a, b) => dayRank(a) - dayRank(b)).join(', ')
    const progStr = [...g.programs].sort((a, b) => a.localeCompare(b)).join(', ')
    const facStr = g.faculties.size ? [...g.faculties].join(' · ') : '—'
    const fillArgb = r % 2 === 0 ? XL.rowAlt : XL.white
    const cells: DataRowCellSpec[] = [
      { col: 1, value: sn, horizontal: 'center', numFmt: '0' },
      { col: 2, value: code },
      { col: 3, value: g.title, wrap: true },
      { col: 4, value: g.sectionIds.size, horizontal: 'center', numFmt: '0' },
      { col: 5, value: g.enroll, horizontal: 'center', numFmt: '0' },
      { col: 6, value: dayStr || '—', wrap: true },
      { col: 7, value: progStr || '—', wrap: true },
      { col: 8, value: facStr, wrap: true },
    ]
    if (showLate && late) {
      const chain = late.lateAddsByCourse[code]
      cells.push({
        col: 9,
        value: formatLateAddsChain(chain),
        horizontal: 'center',
        font: lateAddsFont(chain, late.batch, XL.lateText),
      })
    }
    const wrappedLines = applyDataRow(row, cells, { fillArgb, columnWidths: colWidths })
    fitRowHeight(row, wrappedLines, true)
    sn++
    r++
  }

  colWidths.apply(ws)
}

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  schedule: Schedule,
  entries: ScheduleEntry[],
  late: LateMarking | null,
  runLog: RunLogEntry[] | undefined,
) {
  const lastCol = 4
  const ws = wb.addWorksheet('Summary', {
    views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4' }],
  })
  let r = writeSheetBrandTitle(ws, lastCol, 'SCHEDULE SUMMARY')

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
      cell.alignment = { vertical: 'middle' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r % 2 === 0 ? XL.rowAlt : XL.white } }
    }
    ws.getCell(r, 2).numFmt = typeof v === 'number' ? '0' : 'General'
    ws.getRow(r).height = 20
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
    solverRows.push([
      'Primary metrics zero (heuristic, not global optimality)',
      schedule.solver_primary_metrics_zero ? 'Yes' : 'No',
    ])
  }
  if (schedule.min_red_students_lower_bound != null && schedule.min_red_students_lower_bound > 0) {
    solverRows.push(['RED students lower bound (structural)', schedule.min_red_students_lower_bound])
  }
  if (schedule.min_clash_weight_lower_bound != null && schedule.min_clash_weight_lower_bound > 0) {
    solverRows.push(['Clash weight lower bound (structural)', schedule.min_clash_weight_lower_bound])
  }
  if (schedule.zero_clash_structurally_impossible !== undefined) {
    solverRows.push([
      'Zero-clash structurally impossible',
      schedule.zero_clash_structurally_impossible ? 'Yes' : 'No',
    ])
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
      cell.alignment = { wrapText: true, vertical: 'middle' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r % 2 === 0 ? XL.rowAlt : XL.white } }
    }
    if (typeof v === 'number' && k.includes('Time')) {
      ws.getCell(r, 2).numFmt = '0.00'
    }
    ws.getRow(r).height = 22
    r++
  }

  if (schedule.hard_constraint_violations?.length) {
    ws.getCell(r, 1).value = 'Violation detail'
    ws.getCell(r, 2).value = schedule.hard_constraint_violations.join(' | ')
    ws.getRow(r).height = Math.min(200, Math.max(24, 18 + schedule.hard_constraint_violations.length * 4))
    for (let c = 1; c <= 2; c++) {
      const cell = ws.getCell(r, c)
      cell.border = thinBorder
      cell.font = { size: 10 }
      cell.alignment = { wrapText: true, vertical: 'middle' }
    }
    r++
  }

  if (late) {
    const thisRun = runLog?.filter((e) => e.mode === 'late').at(-1)
    r++
    styleSectionTitle(ws, r, lastCol, `LATE ENROLLMENT — BATCH ${late.batch}`)
    r++
    const lateRows: [string, string | number][] = [
      ['Registrations added this batch', late.assignments.length],
      ['Students touched (all batches)', late.lateStudents.size],
      ['Sections created this batch', late.lateSectionIds.size],
      ['Students relocated by equalize', late.moved.length],
      ['Registrations parked (unplaced)', late.parked.length],
    ]
    if (thisRun) {
      lateRows.push(
        ['RED students before this batch', thisRun.red_before],
        ['RED students after this batch', thisRun.red_after],
        ['Clashes introduced this batch', thisRun.clashes_introduced],
        ['Clashes resolved this batch', thisRun.clashes_resolved],
      )
    }
    for (const [k, v] of lateRows) {
      ws.getCell(r, 1).value = k
      ws.getCell(r, 2).value = v
      for (let c = 1; c <= 2; c++) {
        const cell = ws.getCell(r, c)
        cell.border = thinBorder
        cell.font = { size: 11 }
        cell.alignment = { wrapText: true, vertical: 'middle' }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.lateSection } }
      }
      if (typeof v === 'number') ws.getCell(r, 2).numFmt = '0'
      ws.getRow(r).height = 20
      r++
    }
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
      cell.alignment = { vertical: 'middle' }
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
