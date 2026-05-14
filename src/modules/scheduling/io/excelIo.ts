import ExcelJS from 'exceljs'

/** Normalize cell values to plain strings for the legacy parser (pandas-like). */
export function cellValueToString(val: ExcelJS.CellValue | null | undefined): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val)
  }
  if (val instanceof Date) {
    return val.toISOString()
  }
  if (typeof val === 'object') {
    const o = val as unknown as Record<string, unknown>
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((t) => t.text).join('')
    }
    if ('result' in o && o.result != null) return String(o.result)
    if ('text' in o && o.text != null) return String(o.text)
  }
  return ''
}

/** Read the first worksheet as an array-of-rows (column-major strings). */
export async function readFirstSheetAsAoA(arrayBuffer: ArrayBuffer): Promise<unknown[][] | null> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) return null

  const aoa: unknown[][] = []
  ws.eachRow({ includeEmpty: true }, (row) => {
    const arr: unknown[] = []
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      while (arr.length < colNumber - 1) arr.push('')
      arr[colNumber - 1] = cellValueToString(cell.value)
    })
    aoa.push(arr)
  })
  return aoa
}

