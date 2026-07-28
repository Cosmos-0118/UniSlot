import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  applyDataRow,
  colWidthFromText,
  ColumnWidthTracker,
  estimateWrappedLineCount,
  rowHeightForWrappedLines,
} from '../../src/modules/scheduling/io/excelLayout'

describe('excelLayout', () => {
  it('estimates more lines when column is narrow', () => {
    const text = 'CSE, MECH, B, AIML, EEE, ECE, M, AI, BB, BSG, CIVIL, BI'
    const narrow = estimateWrappedLineCount(text, 18)
    const wide = estimateWrappedLineCount(text, 60)
    expect(narrow).toBeGreaterThan(wide)
    expect(narrow).toBeGreaterThanOrEqual(2)
  })

  it('returns at least one line for empty text', () => {
    expect(estimateWrappedLineCount('', 20)).toBe(1)
    expect(estimateWrappedLineCount('   ', 20)).toBe(1)
  })

  it('word-aware wrap never under-counts vs character division for long phrases', () => {
    const text = 'B.Tech.-Computer Science and Engineering, B.Tech.-Electronics and Communication'
    const wordAware = estimateWrappedLineCount(text, 24)
    const usable = Math.max(4, Math.floor(24) - 1)
    const charDiv = Math.max(1, Math.ceil(text.length / usable))
    expect(wordAware).toBeGreaterThanOrEqual(charDiv)
  })

  it('grows row height with line count and allows taller wrapped cells', () => {
    const one = rowHeightForWrappedLines(1)
    const four = rowHeightForWrappedLines(4)
    expect(four).toBeGreaterThan(one)
    expect(rowHeightForWrappedLines(20, { max: 100 })).toBeLessThanOrEqual(100)
    expect(rowHeightForWrappedLines(12)).toBeGreaterThan(140)
  })

  it('colWidthFromText respects min and max', () => {
    expect(colWidthFromText('AB', 10, 12)).toBe(10)
    expect(colWidthFromText('a'.repeat(200), 10, 50)).toBe(50)
  })

  it('applyDataRow uses middle vertical alignment for wrapped cells', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('t')
    const row = ws.getRow(1)
    const colWidths = new ColumnWidthTracker([{ col: 1, width: 20, min: 10, max: 40 }])
    applyDataRow(
      row,
      [{ col: 1, value: 'Long wrapped title that needs multiple lines', wrap: true }],
      { fillArgb: 'FFFFFFFF', columnWidths: colWidths, defaultVertical: 'middle' },
    )
    expect(row.getCell(1).alignment?.vertical).toBe('middle')
  })
})
