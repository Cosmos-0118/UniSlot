import { describe, expect, it } from 'vitest'
import { findEnrollmentIssues } from '../../src/modules/scheduling/parse/issueFinder'

const HEADER = ['Program', 'Register Number', 'Student Name', 'Course Code', 'Course Title']

describe('findEnrollmentIssues', () => {
  it('returns empty report for a clean sheet', () => {
    const report = findEnrollmentIssues([
      HEADER,
      ['B.Tech CSE', '21BCS001', 'Alice Kumar', 'CS501', 'Machine Learning'],
      ['B.Tech CSE', '21BCS001', 'Alice Kumar', 'CS502', 'Data Mining'],
      ['B.Tech CSE', '21BCS002', 'Bob Singh', 'CS501', 'Machine Learning'],
    ])

    expect(report.blocking).toBe(false)
    expect(report.total_issues).toBe(0)
    expect(report.error_count).toBe(0)
    expect(report.warning_count).toBe(0)
    expect(report.valid_rows).toBe(3)
    expect(report.total_rows).toBe(3)
  })

  it('categorizes duplicate registrations as warnings', () => {
    const report = findEnrollmentIssues([
      HEADER,
      ['B.Tech CSE', '21BCS001', 'Alice', 'CS501', 'Machine Learning'],
      ['B.Tech CSE', '21BCS001', 'Alice', 'CS501', 'Machine Learning'],
      ['B.Tech CSE', '21BCS002', 'Bob', 'CS501', 'Machine Learning'],
    ])

    expect(report.blocking).toBe(false)
    expect(report.counts.duplicate).toBe(1)
    expect(report.by_category.duplicate[0]?.severity).toBe('warning')
    expect(report.by_category.duplicate[0]?.message).toMatch(/Duplicate registration/)
    expect(report.valid_rows).toBe(2)
  })

  it('categorizes missing required fields as blocking errors', () => {
    const report = findEnrollmentIssues([
      HEADER,
      ['B.Tech CSE', '21BCS001', 'Alice', '', 'Machine Learning'],
      ['B.Tech CSE', '21BCS002', 'Bob', 'CS501', 'Machine Learning'],
    ])

    expect(report.blocking).toBe(true)
    expect(report.counts.missing_field).toBeGreaterThanOrEqual(1)
    expect(report.by_category.missing_field.some((i) => i.severity === 'error')).toBe(true)
    expect(report.by_category.missing_field.some((i) => /Course code is empty/i.test(i.message))).toBe(
      true,
    )
  })

  it('flags conflicting student names for the same register', () => {
    const report = findEnrollmentIssues([
      HEADER,
      ['B.Tech CSE', '21BCS001', 'Alice Kumar', 'CS501', 'Machine Learning'],
      ['B.Tech CSE', '21BCS001', 'Alice K', 'CS502', 'Data Mining'],
    ])

    expect(report.blocking).toBe(false)
    expect(report.counts.identity).toBe(1)
    expect(report.by_category.identity[0]?.severity).toBe('warning')
    expect(report.by_category.identity[0]?.message).toMatch(/conflicting student names/)
  })

  it('flags conflicting course titles for the same course code', () => {
    const report = findEnrollmentIssues([
      HEADER,
      ['B.Tech CSE', '21BCS001', 'Alice', 'CS501', 'Machine Learning'],
      ['B.Tech CSE', '21BCS002', 'Bob', 'CS501', 'ML Systems'],
    ])

    expect(report.blocking).toBe(false)
    expect(report.counts.identity).toBe(1)
    expect(report.by_category.identity[0]?.message).toMatch(/conflicting titles/)
  })

  it('flags multiple faculty names for one course', () => {
    const report = findEnrollmentIssues([
      [...HEADER, 'Faculty'],
      ['B.Tech CSE', '21BCS001', 'Alice', 'CS501', 'Machine Learning', 'Dr A'],
      ['B.Tech CSE', '21BCS002', 'Bob', 'CS501', 'Machine Learning', 'Dr B'],
    ])

    expect(report.blocking).toBe(false)
    expect(report.counts.faculty).toBe(1)
    expect(report.by_category.faculty[0]?.severity).toBe('warning')
    expect(report.by_category.faculty[0]?.message).toMatch(/multiple distinct faculty/)
  })

  it('flags schema errors for missing columns', () => {
    const report = findEnrollmentIssues([
      ['Program', 'Student Name'],
      ['B.Tech CSE', 'Alice'],
    ])

    expect(report.blocking).toBe(true)
    expect(report.counts.schema).toBeGreaterThanOrEqual(1)
    expect(report.by_category.schema[0]?.severity).toBe('error')
  })
})
