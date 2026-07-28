/** ARGB palette aligned with legacy Python `output.py` COLORS / DAY_COLORS */
export const XL = {
  primary: 'FF0F172A',
  primaryLight: 'FF1E3A8A',
  secondary: 'FF059669',
  success: 'FF10B981',
  danger: 'FFDC2626',
  white: 'FFFFFFFF',
  textMuted: 'FF64748B',
  rowAlt: 'FFF8FAFC',
  clashRow: 'FFFEE2E2',
  /** Late-enrolled student / Late Adds highlight (amber 300). */
  late: 'FFFDE68A',
  /** Section created during a late-enrollment run. */
  lateSection: 'FFFEF9C3',
  /** Student relocated between sections by equalize (violet). */
  moved: 'FFEDE9FE',
  /** Readable amber for the current late batch's "+n" segment (amber 800). */
  lateText: 'FF92400E',
} as const

export const DAY_FILL: Record<string, string> = {
  Monday: 'FFEFF6FF',
  Tuesday: 'FFF0FDF4',
  Wednesday: 'FFFFFBEB',
  Thursday: 'FFFDF2F8',
  Friday: 'FFEEF2FF',
  Saturday: 'FFFEF3C7',
}
