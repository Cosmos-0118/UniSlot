import { describe, expect, it } from 'vitest'
import { parseExcelRows } from '../../src/modules/scheduling/parse/parser'

describe('parseExcelRows register number normalization', () => {
  it('preserves leading letters in register number', () => {
    const rows = [
      ['Program', 'Register Number', 'Student Name', 'Course Code', 'Course Title'],
      ['B.Tech.-Computer Science and Engineering', 'RA2211054010033', 'Alice', '21CSC101T', 'Programming'],
    ]

    const parsed = parseExcelRows(rows)
    expect(parsed.validation.is_valid).toBe(true)
    expect(parsed.rows[0]?.register_number).toBe('RA2211054010033')
  })

  it('keeps first two letters after cleaning separators', () => {
    const rows = [
      ['Program', 'Register Number', 'Student Name', 'Course Code', 'Course Title'],
      ['B.Tech.-Computer Science and Engineering', 'ab-22 1105 4010033', 'Bob', '21CSC102T', 'Data Structures'],
    ]

    const parsed = parseExcelRows(rows)
    expect(parsed.validation.is_valid).toBe(true)
    expect(parsed.rows[0]?.register_number).toBe('AB2211054010033')
  })
})

