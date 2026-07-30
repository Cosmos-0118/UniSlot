import { describe, expect, it } from 'vitest'
import {
  activeWeekdayCount,
  isSaturdayEligible,
  maxSlotIndexForCourse,
  normalizeSaturdayExtraCodes,
  saturdaySlotOpen,
  SATURDAY_SLOT_INDEX,
} from '../../src/modules/scheduling/solver/timeModel'

describe('normalizeSaturdayExtraCodes', () => {
  it('splits, trims, uppercases, and dedupes comma-separated input', () => {
    expect(normalizeSaturdayExtraCodes(' 21cse101t , 21ECE202T, 21CSE101T ,')).toEqual([
      '21CSE101T',
      '21ECE202T',
    ])
  })

  it('accepts an array and returns empty for undefined', () => {
    expect(normalizeSaturdayExtraCodes(['ab', ' AB ', ''])).toEqual(['AB'])
    expect(normalizeSaturdayExtraCodes(undefined)).toEqual([])
  })
})

describe('Saturday eligibility with extras', () => {
  it('opens Saturday when extras are present even if maths is blocked', () => {
    expect(saturdaySlotOpen(false, ['21CSE101T'])).toBe(true)
    expect(activeWeekdayCount(false, ['21CSE101T'])).toBe(6)
    expect(saturdaySlotOpen(false, [])).toBe(false)
    expect(activeWeekdayCount(false, [])).toBe(5)
  })

  it('allows listed extras on Saturday independently of maths', () => {
    expect(isSaturdayEligible('21CSE101T', false, ['21CSE101T'])).toBe(true)
    expect(maxSlotIndexForCourse('21CSE101T', false, ['21CSE101T'])).toBe(SATURDAY_SLOT_INDEX)
    expect(isSaturdayEligible('21MAB101T', false, ['21CSE101T'])).toBe(false)
    expect(maxSlotIndexForCourse('21MAB101T', false, ['21CSE101T'])).toBe(4)
  })

  it('still allows maths when the maths flag is on', () => {
    expect(isSaturdayEligible('21MAB101T', true, [])).toBe(true)
    expect(isSaturdayEligible('21CSC202J', true, [])).toBe(false)
  })
})
