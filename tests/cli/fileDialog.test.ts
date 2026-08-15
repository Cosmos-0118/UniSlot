import { describe, expect, it } from 'vitest'
import { decodeSpawnedPath } from '../../cli/fileDialog'

describe('decodeSpawnedPath', () => {
  it('reads UTF-8 paths', () => {
    expect(decodeSpawnedPath(Buffer.from('C:\\Users\\hp\\file.xlsx', 'utf8'))).toBe(
      'C:\\Users\\hp\\file.xlsx',
    )
  })

  it('strips quotes, CR, and wrapping whitespace', () => {
    expect(decodeSpawnedPath(Buffer.from('"C:\\out"\r\n', 'utf8'))).toBe('C:\\out')
  })

  it('decodes UTF-16LE PowerShell redirected stdout (with NUL bytes)', () => {
    const path = 'C:\\Users\\hp\\OneDrive\\Documents\\schedule.xlsx'
    expect(decodeSpawnedPath(Buffer.from(path, 'utf16le'))).toBe(path)
  })

  it('skips a UTF-16LE BOM', () => {
    const path = 'D:\\UniSlot\\snapshot.json'
    const bom = Buffer.from([0xff, 0xfe])
    expect(decodeSpawnedPath(Buffer.concat([bom, Buffer.from(path, 'utf16le')]))).toBe(path)
  })

  it('returns empty for no output', () => {
    expect(decodeSpawnedPath(Buffer.alloc(0))).toBe('')
  })
})
