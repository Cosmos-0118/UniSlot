import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const setupScript = path.join(repoRoot, 'scripts', 'setup.mjs')

describe('full setup entrypoint', () => {
  it('runs its help path without loading project dependencies', async () => {
    const { stdout } = await execFileAsync(process.execPath, [setupScript, '--help'], {
      cwd: repoRoot,
    })
    expect(stdout).toContain('Usage: npm run setup [-- options]')
    expect(stdout).toContain('--yes, --force')
  })

  it('supports a no-op dry run without Git or package installation', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [setupScript, '--skip-git', '--dry-run'], {
      cwd: repoRoot,
    })
    expect(stderr).toContain('Git sync skipped (--skip-git).')
    expect(stdout).toContain('Dry run complete')
  })
})
