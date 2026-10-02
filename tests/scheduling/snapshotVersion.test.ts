import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_SCHEMA_VERSION,
  cloneSchedulingSnapshot,
  loadSchedulingSnapshot,
  sha256Hex,
  snapshotSchemaVersion,
  type SchedulingSnapshot,
} from '../../src/modules/scheduling/merge/snapshot'
import { runPipeline } from '../../src/modules/scheduling/pipeline/run'

const base = {
  slot_assignments: {},
  courseSections: {},
  students: {},
  enrollmentRows: [],
} as SchedulingSnapshot

describe('snapshot schema version + source', () => {
  it('treats a snapshot without schema_version as version 1', () => {
    expect(snapshotSchemaVersion(base)).toBe(1)
    expect(snapshotSchemaVersion({ schema_version: 2 })).toBe(2)
  })

  it('old snapshots load unchanged (no version, no source invented)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'snap-'))
    await writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(base))
    const loaded = await loadSchedulingSnapshot(dir)
    expect(loaded.schema_version).toBeUndefined()
    expect(loaded.source).toBeUndefined()
  })

  it('clone keeps schema_version and source', () => {
    const src = { file_name: 'a.xlsx', sha256: 'ab', bytes: 3 }
    const c = cloneSchedulingSnapshot({ ...base, schema_version: 2, source: src })
    expect(c.schema_version).toBe(2)
    expect(c.source).toEqual(src)
    expect(c.source).not.toBe(src)
  })

  it('sha256Hex matches the known digest', async () => {
    const bytes = new TextEncoder().encode('abc')
    expect(await sha256Hex(bytes.buffer as ArrayBuffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('a solve records version and the source file name + hash', async () => {
    const buf = await readFile(path.join(__dirname, '../fixtures/tiny-enrollment.xlsx'))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const result = await runPipeline(ab, () => {}, {
      sourceFileName: 'tiny-enrollment.xlsx',
      cpsatTimeLimitSeconds: 20,
    })
    const snap = result.schedulingSnapshot
    expect(snap?.schema_version).toBe(SNAPSHOT_SCHEMA_VERSION)
    expect(snap?.source).toEqual({
      file_name: 'tiny-enrollment.xlsx',
      sha256: await sha256Hex(ab),
      bytes: buf.byteLength,
    })
  }, 60_000)
})
