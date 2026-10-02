import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseExcelRows } from '../../src/modules/scheduling/parse/parser'
import { scheduleToWorkbookBuffer } from '../../src/modules/scheduling/io/excelScheduleWorkbook'
import { INPUT_SHEET_NAME } from '../../src/modules/scheduling/io/excelInputSheet'
import type { Schedule } from '../../src/modules/scheduling/types'
import type { SchedulingSnapshot } from '../../src/modules/scheduling/merge/snapshot'

const HEADER = [
  'Sno.', 'Program', 'Register no', 'Student Name', 'Mobile No',
  'Email ID', 'Course Code', 'Course Title', 'Remarks', 'Adl Remarks',
]

const emptySchedule: Schedule = {
  entries: [],
  total_sections: 0,
  solver_used: 'test',
  solver_time_seconds: 0,
  total_clashes: 0,
}

describe('Name List sheet (input format)', () => {
  const parsed = parseExcelRows([
    HEADER,
    [1, 'B.Tech-CSE', 'RA2111201010012', 'ASHA RAO', 8822929858, 'ar1@srmist.edu.in', '21CSC203P', 'Data Structures', 'Online Registered', ''],
    [2, 'B.Tech-CSE', 'RA2111201010012', 'ASHA RAO', 8822929858, 'ar1@srmist.edu.in', '21CSE251T', 'Algorithms', 'Online Registered', 'Subject Change request'],
  ])

  it('keeps Remarks and Adl Remarks as separate fields', () => {
    expect(parsed.rows.map((r) => [r.remarks, r.adl_remarks])).toEqual([
      ['Online Registered', null],
      ['Online Registered', 'Subject Change request'],
    ])
  })

  it('is added from the snapshot with the input headers and rows', async () => {
    const snapshot = {
      slot_assignments: {},
      courseSections: {},
      students: {},
      enrollmentRows: parsed.rows,
    } as unknown as SchedulingSnapshot
    const buf = await scheduleToWorkbookBuffer(emptySchedule, { snapshot })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet(INPUT_SHEET_NAME)!
    expect(ws).toBeDefined()
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(HEADER)
    expect((ws.getRow(3).values as unknown[]).slice(1)).toEqual([
      2, 'B.Tech-CSE', 'RA2111201010012', 'ASHA RAO', 8822929858,
      'ar1@srmist.edu.in', '21CSE251T', 'Algorithms', 'Online Registered', 'Subject Change request',
    ])

    // Re-parsing the generated sheet reproduces the same enrollment.
    const aoa: unknown[][] = []
    ws.eachRow((row) => aoa.push((row.values as unknown[]).slice(1)))
    expect(parseExcelRows(aoa).rows).toEqual(parsed.rows)
  })

  it('is omitted when no snapshot is supplied', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await scheduleToWorkbookBuffer(emptySchedule))
    expect(wb.getWorksheet(INPUT_SHEET_NAME)).toBeUndefined()
  })
})

describe('nameListToWorkbookBuffer', () => {
  it('builds a single-sheet workbook that re-parses to the same rows', async () => {
    const { nameListToWorkbookBuffer } = await import('../../src/modules/scheduling/io/excelInputSheet')
    const { rows } = parseExcelRows([
      HEADER,
      [1, 'B.Tech-CSE', 'RA2111201010012', 'ASHA RAO', 8822929858, 'ar1@srmist.edu.in', '21CSC203P', 'Data Structures', 'Online Registered', 'Note'],
    ])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await nameListToWorkbookBuffer(rows))
    expect(wb.worksheets.map((w) => w.name)).toEqual([INPUT_SHEET_NAME])
    const aoa = wb.worksheets[0]!.getSheetValues().slice(1).map((r) => (r as unknown[]).slice(1))
    expect(aoa[0]).toEqual(HEADER)
    expect(parseExcelRows(aoa as unknown[][]).rows).toEqual(rows)
  })
})
