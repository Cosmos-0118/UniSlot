import type ExcelJS from 'exceljs'
import type { RunLogEntry } from '../merge/runLog'
import { allClashOrigins, type ClashProvenanceMap } from '../merge/clashProvenance'
import type { LateMarking } from './excelLateMarking'
import { applyDataRow, ColumnWidthTracker, fitRowHeight } from './excelLayout'
import { writeExportBrandHeader } from './excelBranding'
import { XL } from './excelStyleConstants'

/** Build the Run Log sheet (newest last). */
export function buildRunLogSheet(wb: ExcelJS.Workbook, runLog: RunLogEntry[]): void {
  const lastCol = 12
  const ws = wb.addWorksheet('Run Log', {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5', topLeftCell: 'A5' }],
  })
  let r = writeExportBrandHeader(ws, lastCol, 'RUN LOG — WHEN WHAT HAPPENED')

  const heads = [
    '#',
    'When',
    'Mode',
    'Batch',
    'Students +',
    'Regs +',
    'Courses +',
    'Sections created',
    'RED before→after',
    'New clashes',
    'Resolved',
    'Notes / decisions',
  ]
  const headerRow = ws.getRow(r)
  heads.forEach((h, i) => {
    const c = headerRow.getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: XL.white } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  headerRow.height = 28
  r++

  const colWidths = new ColumnWidthTracker([
    { col: 1, width: 5, min: 4, max: 8 },
    { col: 2, width: 22, min: 18, max: 28 },
    { col: 3, width: 10, min: 8, max: 12 },
    { col: 4, width: 8, min: 6, max: 10 },
    { col: 5, width: 10, min: 8, max: 12 },
    { col: 6, width: 10, min: 8, max: 12 },
    { col: 7, width: 10, min: 8, max: 12 },
    { col: 8, width: 28, min: 18, max: 48 },
    { col: 9, width: 14, min: 12, max: 18 },
    { col: 10, width: 10, min: 8, max: 12 },
    { col: 11, width: 10, min: 8, max: 12 },
    { col: 12, width: 48, min: 28, max: 72 },
  ])

  for (const e of runLog) {
    const decisionText = [
      ...e.decisions.map((d) => `${d.kind}:${d.subject}=${d.choice}`),
      ...e.notes.slice(0, 4),
    ].join('; ')
    const fillArgb = e.mode === 'late' ? XL.late : e.mode === 'rectify' ? XL.moved : XL.rowAlt
    const wrapped = applyDataRow(
      ws.getRow(r),
      [
        { col: 1, value: e.seq, horizontal: 'center', numFmt: '0' },
        { col: 2, value: e.at.replace('T', ' ').replace(/\.\d+Z$/, 'Z') },
        { col: 3, value: e.mode, horizontal: 'center' },
        { col: 4, value: e.batch ?? '', horizontal: 'center' },
        { col: 5, value: e.students_added, horizontal: 'center', numFmt: '0' },
        { col: 6, value: e.registrations_added, horizontal: 'center', numFmt: '0' },
        { col: 7, value: e.courses_added, horizontal: 'center', numFmt: '0' },
        { col: 8, value: e.sections_created.join(', ') || '—', wrap: true },
        {
          col: 9,
          value: `${e.red_before}→${e.red_after}`,
          horizontal: 'center',
        },
        { col: 10, value: e.clashes_introduced, horizontal: 'center', numFmt: '0' },
        { col: 11, value: e.clashes_resolved, horizontal: 'center', numFmt: '0' },
        { col: 12, value: decisionText || '—', wrap: true },
      ],
      { fillArgb, columnWidths: colWidths },
    )
    fitRowHeight(ws.getRow(r), wrapped, true)
    r++
  }
  colWidths.apply(ws)
}

/** Build the Clash Log sheet from provenance. */
export function buildClashLogSheet(
  wb: ExcelJS.Workbook,
  provenance: ClashProvenanceMap,
): void {
  const lastCol = 9
  const ws = wb.addWorksheet('Clash Log', {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5', topLeftCell: 'A5' }],
  })
  let r = writeExportBrandHeader(ws, lastCol, 'CLASH LOG — WHY / WHEN / HOW')

  const heads = [
    'Register No.',
    'Student Name',
    'Day',
    'Courses',
    'Status',
    'First seen (run #)',
    'Operation',
    'Batch',
    'Why',
  ]
  const headerRow = ws.getRow(r)
  heads.forEach((h, i) => {
    const c = headerRow.getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: XL.white } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  headerRow.height = 28
  r++

  const colWidths = new ColumnWidthTracker([
    { col: 1, width: 18, min: 14, max: 24 },
    { col: 2, width: 28, min: 20, max: 36 },
    { col: 3, width: 12, min: 10, max: 14 },
    { col: 4, width: 36, min: 24, max: 56 },
    { col: 5, width: 12, min: 10, max: 14 },
    { col: 6, width: 14, min: 10, max: 18 },
    { col: 7, width: 10, min: 8, max: 12 },
    { col: 8, width: 8, min: 6, max: 10 },
    { col: 9, width: 56, min: 36, max: 80 },
  ])

  const rows = allClashOrigins(provenance)
  if (rows.length === 0) {
    ws.getCell(r, 1).value = 'No clashes recorded yet.'
    ws.getCell(r, 1).font = { italic: true }
    colWidths.apply(ws)
    return
  }

  for (const o of rows) {
    const active = o.resolved_seq == null
    const fillArgb = active ? XL.clashRow : XL.rowAlt
    const wrapped = applyDataRow(
      ws.getRow(r),
      [
        { col: 1, value: o.register_number },
        { col: 2, value: o.student_name, wrap: true },
        { col: 3, value: o.day, horizontal: 'center' },
        { col: 4, value: o.courses.join(', '), wrap: true },
        { col: 5, value: active ? 'ACTIVE' : `resolved #${o.resolved_seq}`, horizontal: 'center' },
        { col: 6, value: o.first_seen_seq, horizontal: 'center', numFmt: '0' },
        { col: 7, value: o.operation, horizontal: 'center' },
        { col: 8, value: o.batch ?? '', horizontal: 'center' },
        { col: 9, value: o.cause, wrap: true },
      ],
      { fillArgb, columnWidths: colWidths },
    )
    fitRowHeight(ws.getRow(r), wrapped, true)
    r++
  }
  colWidths.apply(ws)
}

/** Late Enrollments detail sheet. */
export function buildLateEnrollmentsSheet(
  wb: ExcelJS.Workbook,
  marking: LateMarking,
  extras?: {
    dayBySection?: Record<string, string>
    timingBySection?: Record<string, string>
  },
): void {
  const lastCol = 11
  const ws = wb.addWorksheet('Late Enrollments', {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5', topLeftCell: 'A5' }],
  })
  let r = writeExportBrandHeader(
    ws,
    lastCol,
    `LATE ENROLLMENTS — BATCH ${marking.batch}`,
  )

  const heads = [
    'Register No.',
    'Student Name',
    'Program',
    'Course',
    'Section',
    'Day',
    'Timing',
    'How absorbed',
    'Status',
    'Clash detail',
    'Batch',
  ]
  const headerRow = ws.getRow(r)
  heads.forEach((h, i) => {
    const c = headerRow.getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: XL.white } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.primaryLight } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  headerRow.height = 28
  r++

  const colWidths = new ColumnWidthTracker([
    { col: 1, width: 18, min: 14, max: 24 },
    { col: 2, width: 28, min: 20, max: 36 },
    { col: 3, width: 28, min: 18, max: 40 },
    { col: 4, width: 14, min: 12, max: 22 },
    { col: 5, width: 18, min: 12, max: 28 },
    { col: 6, width: 12, min: 10, max: 14 },
    { col: 7, width: 28, min: 18, max: 40 },
    { col: 8, width: 14, min: 12, max: 18 },
    { col: 9, width: 10, min: 8, max: 12 },
    { col: 10, width: 36, min: 24, max: 56 },
    { col: 11, width: 8, min: 6, max: 10 },
  ])

  // Current batch assignments only for the detail rows (history is in Late Adds column).
  const current = marking.assignments
  for (const a of current) {
    const info = marking.studentInfo[a.register_number]
    const status = marking.statusByStudent[a.register_number] ?? '—'
    const clash = marking.clashByStudent[a.register_number] || '—'
    const fillArgb = status === 'Red' ? XL.clashRow : XL.late
    const wrapped = applyDataRow(
      ws.getRow(r),
      [
        { col: 1, value: a.register_number },
        { col: 2, value: info?.name ?? a.register_number, wrap: true },
        { col: 3, value: info?.program || '—', wrap: true },
        { col: 4, value: a.course_code },
        { col: 5, value: a.section_id },
        { col: 6, value: extras?.dayBySection?.[a.section_id] ?? '—', horizontal: 'center' },
        { col: 7, value: extras?.timingBySection?.[a.section_id] ?? '—', wrap: true },
        { col: 8, value: a.how, horizontal: 'center' },
        { col: 9, value: status, horizontal: 'center' },
        { col: 10, value: clash, wrap: true },
        { col: 11, value: marking.batch, horizontal: 'center', numFmt: '0' },
      ],
      { fillArgb, columnWidths: colWidths },
    )
    fitRowHeight(ws.getRow(r), wrapped, true)
    r++
  }

  if (marking.parked.length) {
    r++
    ws.mergeCells(r, 1, r, lastCol)
    ws.getCell(r, 1).value = 'PARKED (not scheduled)'
    ws.getCell(r, 1).font = { bold: true, color: { argb: XL.white } }
    ws.getCell(r, 1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: XL.danger },
    }
    r++
    for (const p of marking.parked) {
      const info = marking.studentInfo[p.register_number]
      applyDataRow(
        ws.getRow(r),
        [
          { col: 1, value: p.register_number },
          { col: 2, value: info?.name ?? '—', wrap: true },
          { col: 3, value: info?.program || '—', wrap: true },
          { col: 4, value: p.course_code },
          { col: 5, value: '—' },
          { col: 6, value: '—' },
          { col: 7, value: '—' },
          { col: 8, value: 'parked', horizontal: 'center' },
          { col: 9, value: '—' },
          { col: 10, value: p.reason, wrap: true },
          { col: 11, value: marking.batch, horizontal: 'center', numFmt: '0' },
        ],
        { fillArgb: XL.clashRow, columnWidths: colWidths },
      )
      r++
    }
  }

  colWidths.apply(ws)
}
