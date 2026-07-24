#!/usr/bin/env node
/**
 * Create solver/cpsat/.venv and install ortools.
 */
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cpsatDir = path.join(root, 'solver', 'cpsat')
const venvDir = path.join(cpsatDir, '.venv')
const requirements = path.join(cpsatDir, 'requirements.txt')

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: root, ...opts })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    })
  })
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const py = process.env.UNISLOT_PYTHON || 'python3'
console.log(`Using ${py}…`)
if (!(await exists(path.join(venvDir, 'bin', 'python'))) && !(await exists(path.join(venvDir, 'Scripts', 'python.exe')))) {
  console.log(`Creating venv at ${venvDir}`)
  await run(py, ['-m', 'venv', venvDir])
}

const pip =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip')
console.log('Installing ortools…')
await run(pip, ['install', '-r', requirements])
console.log('CP-SAT environment ready. Run: npm run unislot')
