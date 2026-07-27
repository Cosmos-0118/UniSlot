import type { Workbook } from 'exceljs'
import { readFirstSheetAsAoA } from './excelIo'

function normalizeProgramKey(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\.\s*/g, '.')
}

function normalizeProgramKeyNoDots(s: string): string {
  return normalizeProgramKey(s).replace(/\./g, '')
}

/**
 * Loads `Nomenclature.xlsx` (first sheet) and builds a lookup map:
 * `Courses Offered` → `Nomenclature`.
 *
 * The returned map also includes a "no-dots" key variant for tolerant matching.
 */
export async function nomenclatureToProgramAbbrevMap(
  arrayBuffer: ArrayBuffer,
): Promise<Record<string, string>> {
  const aoa = await readFirstSheetAsAoA(arrayBuffer)
  if (!aoa) return {}

  const maxScanRows = Math.min(40, aoa.length)
  let headerIdx = -1
  let coursesOfferedCol = -1
  let nomenclatureCol = -1

  for (let r = 0; r < maxScanRows; r++) {
    const row = aoa[r] ?? []
    const lower = row.map((v) => String(v ?? '').trim().toLowerCase())
    coursesOfferedCol = lower.findIndex((v) => v === 'courses offered')
    nomenclatureCol = lower.findIndex((v) => v === 'nomenclature')
    if (coursesOfferedCol >= 0 && nomenclatureCol >= 0) {
      headerIdx = r
      break
    }
  }

  if (headerIdx < 0 || coursesOfferedCol < 0 || nomenclatureCol < 0) return {}

  const out: Record<string, string> = {}
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const coursesOffered = String(row[coursesOfferedCol] ?? '').trim()
    const nomenclature = String(row[nomenclatureCol] ?? '').trim()
    if (!coursesOffered || !nomenclature) continue

    const key = normalizeProgramKey(coursesOffered)
    const keyNoDots = normalizeProgramKeyNoDots(coursesOffered)
    if (!out[key]) out[key] = nomenclature
    if (!out[keyNoDots]) out[keyNoDots] = nomenclature
  }

  return out
}

