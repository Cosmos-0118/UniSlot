import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Resolve through the consumers so both transitive brace-expansion branches
// are exercised, even if npm changes where it hoists their dependencies.
const consumers = {
  eslint: `require = createRequire(require.resolve('eslint'))`,
  archiver: `
    require = createRequire(require.resolve('exceljs'))
    require = createRequire(require.resolve('archiver'))
    require = createRequire(require.resolve('readdir-glob'))
  `,
}

const payloads = {
  'nested brace groups': `'{'.repeat(3200) + 'a,b' + '}'.repeat(3200)`,
  'comma-separated brace groups': `'{' + '{a},'.repeat(7000) + 'b}'`,
  'malformed closing braces': `'{a}' + '}'.repeat(64000) + ',z}'`,
}

describe.each(Object.entries(consumers))('%s glob dependency safety', (_name, resolveConsumer) => {
  it.each(Object.entries(payloads))('handles %s without crashing or stalling', async (_label, payload) => {
    // A child process bounds a regression that would otherwise block Vitest's
    // event loop. All payloads fit minimatch's 65,536-character input limit.
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import { createRequire } from 'node:module'
      let require = createRequire(process.cwd() + '/package.json')
      ${resolveConsumer}
      const { braceExpand } = require('minimatch')
      assert.deepEqual(braceExpand('report-{mon,tue}.xlsx'), ['report-mon.xlsx', 'report-tue.xlsx'])
      assert.deepEqual(braceExpand('report-{1..3}.xlsx'), ['report-1.xlsx', 'report-2.xlsx', 'report-3.xlsx'])
      assert.ok(Array.isArray(braceExpand(${payload})))
      console.log('ok')
    `], { cwd: repoRoot, timeout: 4000 })
    expect(stdout.trim()).toBe('ok')
  })
})
