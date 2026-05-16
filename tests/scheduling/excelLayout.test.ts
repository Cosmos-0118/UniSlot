import { describe, expect, it } from 'vitest'
import {
  colWidthFromText,
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

  it('grows row height with line count', () => {
    const one = rowHeightForWrappedLines(1)
    const four = rowHeightForWrappedLines(4)
    expect(four).toBeGreaterThan(one)
    expect(rowHeightForWrappedLines(20, { max: 100 })).toBeLessThanOrEqual(100)
  })

  it('colWidthFromText respects min and max', () => {
    expect(colWidthFromText('AB', 10, 12)).toBe(10)
    expect(colWidthFromText('a'.repeat(200), 10, 50)).toBe(50)
  })
})
