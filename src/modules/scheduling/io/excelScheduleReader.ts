import { readFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import type { DayName, Schedule, ScheduleEntry } from '../types'
import { WEEKDAY_ORDER } from '../solver/timeModel'
import { cellValueToString } from './excelIo'
import { friendlyTiming } from './excelScheduleWorkbook'

const REQUIRED_DETAIL_HEADERS = [
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

export type FilterScheduleResult = {
  entries: ScheduleEntry[]
  kept: number
  dropped: number
  /** Codes requested but not present in the source schedule. */
  missingCodes: string[]
  /** Codes present in the source but not in the allowlist. */
  excludedCodes: string[]
}

/** Parse comma- and/or newline-separated course codes into a normalized, deduped list. */
export function normalizeCourseCodeList(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return []
  const parts = Array.isArray(raw)
    ? raw.flatMap((p) => String(p).split(/[\n\r,;]+/))
    : String(raw).split(/[\n\r,;]+/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const code = part.trim().toUpperCase()
    if (!code || seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

/** Keep schedule rows whose course_code is in the allowlist. */
export function filterScheduleEntries(
  entries: ScheduleEntry[],
  codes: string | string[] | undefined,
): FilterScheduleResult {
  const allowlist = normalizeCourseCodeList(codes)
  const allowed = new Set(allowlist)
  const present = new Set(entries.map((e) => e.course_code.toUpperCase()))
  const filtered = entries.filter((e) => allowed.has(e.course_code.toUpperCase()))
  const missingCodes = allowlist.filter((c) => !present.has(c))
  const excludedCodes = [...present].filter((c) => !allowed.has(c)).sort((a, b) => a.localeCompare(b))
  return {
    entries: filtered,
    kept: filtered.length,
    dropped: entries.length - filtered.length,
    missingCodes,
    excludedCodes,
  }
}

/** Minimal Schedule wrapper so scheduleToWorkbookBuffer can rebuild Summary. */
export function scheduleFromFilteredEntries(entries: ScheduleEntry[]): Schedule {
  return {
    entries,
    total_sections: entries.length,
    solver_used: 'filter',
    solver_time_seconds: 0,
    total_clashes: 0,
  }
}

function parseLaneCountFromTiming(timing: string): number | null {
  const m = timing.match(/Parallel\s+lane\s+(\d+)\s*\/\s*(\d+)/i)
  if (!m) return null
  const n = Number(m[2])
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseFaculty(raw: string): string | null {
  const t = raw.trim()
  if (!t || t === '—' || t === '-' || t === '–') return null
  return t
}

function isDayName(value: string): value is DayName {
  return (WEEKDAY_ORDER as readonly string[]).includes(value)
}

function findHeaderRow(
  ws: ExcelJS.Worksheet,
): { rowIndex: number; colByHeader: Map<string, number> } | null {
  const maxScan = Math.min(ws.rowCount || 0, 40)
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r)
    const colByHeader = new Map<string, number>()
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const label = cellValueToString(cell.value).trim()
      if (label) colByHeader.set(label, colNumber)
    })
    const hasAll = REQUIRED_DETAIL_HEADERS.every((h) => colByHeader.has(h))
    if (hasAll) return { rowIndex: r, colByHeader }
  }
  return null
}

function cellAt(
  row: ExcelJS.Row,
  colByHeader: Map<string, number>,
  header: string,
): string {
  const col = colByHeader.get(header)
  if (col == null) return ''
  return cellValueToString(row.getCell(col).value).trim()
}

function numAt(
  row: ExcelJS.Row,
  colByHeader: Map<string, number>,
  header: string,
): number {
  const raw = cellAt(row, colByHeader, header)
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** Parse ScheduleEntry rows from a UniSlot schedule workbook's Details sheet. */
export async function readScheduleEntriesFromBuffer(
  arrayBuffer: ArrayBuffer,
): Promise<ScheduleEntry[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const ws = wb.getWorksheet('Details')
  if (!ws) {
    throw new Error('Schedule workbook is missing a Details sheet')
  }
  const header = findHeaderRow(ws)
  if (!header) {
    throw new Error(
      'Details sheet is missing required headers (Course Code, Section ID, Weekday Index, …)',
    )
  }
  const { rowIndex, colByHeader } = header
  const entries: ScheduleEntry[] = []

  for (let r = rowIndex + 1; r <= (ws.rowCount || 0); r++) {
    const row = ws.getRow(r)
    const courseCode = cellAt(row, colByHeader, 'Course Code').toUpperCase()
    if (!courseCode) continue

    const dayRaw = cellAt(row, colByHeader, 'Day')
    const day: DayName = isDayName(dayRaw) ? dayRaw : 'Monday'
    const slotIndex = numAt(row, colByHeader, 'Weekday Index')
    const slotBand = numAt(row, colByHeader, 'Parallel Lane')
    const timing = cellAt(row, colByHeader, 'Timing')
    const laneCount = parseLaneCountFromTiming(timing) ?? Math.max(1, slotBand)
    const sectionNumber = numAt(row, colByHeader, 'Section') || 1
    const sectionId = cellAt(row, colByHeader, 'Section ID') || courseCode

    entries.push({
      section_id: sectionId,
      course_code: courseCode,
      course_title: cellAt(row, colByHeader, 'Course Title'),
      section_number: sectionNumber,
      day,
      time: timing || friendlyTiming(day, slotBand || 1, laneCount),
      slot_index: slotIndex,
      slot_band: slotBand || 1,
      parallel_lane_count: laneCount,
      faculty: parseFaculty(cellAt(row, colByHeader, 'Faculty')),
      enrollment_count: numAt(row, colByHeader, 'Students'),
      programs: cellAt(row, colByHeader, 'Programs'),
    })
  }

  return entries
}

/** Load ScheduleEntry rows from a schedule.xlsx path. */
export async function readScheduleEntriesFromFile(filePath: string): Promise<ScheduleEntry[]> {
  const buf = await readFile(filePath)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return readScheduleEntriesFromBuffer(ab)
}
