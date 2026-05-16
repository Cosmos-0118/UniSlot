import { describe, expect, it } from 'vitest'
import {
  displayRunTitle,
  isTitleSameAsSourceFile,
  sourceFileLabel,
} from '@/features/scheduling/savedRunDisplay'

describe('savedRunDisplay', () => {
  it('strips trailing locale date from auto titles', () => {
    expect(displayRunTitle('CC_R21_Even list (16/05/2026)')).toBe('CC_R21_Even list')
  })

  it('strips .xlsx from source file labels', () => {
    expect(sourceFileLabel('enrollment.xlsx')).toBe('enrollment')
  })

  it('detects auto-save title matching source file', () => {
    expect(
      isTitleSameAsSourceFile('CC_R21_Even list (16/05/2026)', 'CC_R21_Even list.xlsx'),
    ).toBe(true)
    expect(isTitleSameAsSourceFile('Spring 2026 draft', 'CC_R21_Even list.xlsx')).toBe(false)
  })
})
