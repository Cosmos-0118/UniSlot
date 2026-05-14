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
} as const

export const DAY_FILL: Record<string, string> = {
  Monday: 'FFEFF6FF',
  Tuesday: 'FFF0FDF4',
  Wednesday: 'FFFFFBEB',
  Thursday: 'FFFDF2F8',
  Friday: 'FFEEF2FF',
  Saturday: 'FFFEF3C7',
}
