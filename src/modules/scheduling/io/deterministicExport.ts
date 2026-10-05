/** Fixed workbook timestamp base for seeded runs (byte-identical XLSX metadata). */
export const DETERMINISTIC_EXPORT_EPOCH_MS = Date.UTC(2020, 0, 1, 0, 0, 0, 0)

/** Workbook `created` stamp: fixed when seed is set, otherwise current time. */
export function workbookCreatedAt(seed?: number): Date {
  if (seed === undefined) return new Date()
  return new Date(DETERMINISTIC_EXPORT_EPOCH_MS + (seed % 86_400_000))
}

export type ExportDeterminismOptions = {
  /** When set, export metadata uses a seed-derived fixed timestamp. */
  seed?: number
}

/**
 * ExcelJS/JSZip currently timestamps every ZIP member with `new Date()` and
 * `xlsx.writeBuffer` exposes no per-entry date option. Normalize both local
 * file headers and central-directory records so seeded XLSX bytes do not depend
 * on the wall clock. Workbook core properties are set separately by each writer.
 */
export function finalizeWorkbookBuffer(buffer: unknown, seed?: number): ArrayBuffer {
  let bytes: Uint8Array
  if (buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(buffer.slice(0))
  } else if (ArrayBuffer.isView(buffer)) {
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice()
  } else {
    throw new Error('Unexpected workbook buffer type')
  }
  if (seed === undefined) return bytes.buffer as ArrayBuffer

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdSignature = 0x06054b50
  const centralSignature = 0x02014b50
  const localSignature = 0x04034b50
  const minEocd = Math.max(0, bytes.byteLength - 22 - 0xffff)
  let eocdOffset = -1
  for (let offset = bytes.byteLength - 22; offset >= minEocd; offset--) {
    if (view.getUint32(offset, true) === eocdSignature) {
      const commentLength = view.getUint16(offset + 20, true)
      if (offset + 22 + commentLength === bytes.byteLength) {
        eocdOffset = offset
        break
      }
    }
  }
  if (eocdOffset < 0) throw new Error('Cannot normalize timestamps: XLSX ZIP directory was not found.')

  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralSize = view.getUint32(eocdOffset + 12, true)
  const centralOffset = view.getUint32(eocdOffset + 16, true)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('Cannot normalize timestamps: ZIP64 XLSX archives are not supported.')
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw new Error('Cannot normalize timestamps: invalid XLSX ZIP directory bounds.')
  }

  const timestamp = workbookCreatedAt(seed)
  const dosTime =
    (timestamp.getUTCHours() << 11) |
    (timestamp.getUTCMinutes() << 5) |
    Math.floor(timestamp.getUTCSeconds() / 2)
  const dosDate =
    ((Math.max(1980, Math.min(2107, timestamp.getUTCFullYear())) - 1980) << 9) |
    ((timestamp.getUTCMonth() + 1) << 5) |
    timestamp.getUTCDate()

  let offset = centralOffset
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > centralOffset + centralSize || view.getUint32(offset, true) !== centralSignature) {
      throw new Error('Cannot normalize timestamps: malformed XLSX ZIP central directory.')
    }
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== localSignature) {
      throw new Error('Cannot normalize timestamps: malformed XLSX ZIP local header.')
    }

    view.setUint16(offset + 12, dosTime, true)
    view.setUint16(offset + 14, dosDate, true)
    view.setUint16(localOffset + 10, dosTime, true)
    view.setUint16(localOffset + 12, dosDate, true)
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error('Cannot normalize timestamps: XLSX ZIP directory size mismatch.')
  }
  return bytes.buffer as ArrayBuffer
}
