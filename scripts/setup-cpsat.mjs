#!/usr/bin/env node
/**
 * Create solver/cpsat/.venv and install ortools.
 */
import { spawn } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
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

function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr.trim()}`))
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

function venvPythonPath() {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

async function probePython(cmd) {
  try {
    const version = await runCapture(cmd, [
      '-c',
      'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")',
    ])
    const [major, minor] = version.split('.').map(Number)
    return { cmd, major, minor }
  } catch {
    return null
  }
}

async function resolvePython() {
  const override = process.env.UNISLOT_PYTHON?.trim()
  if (override) return override

  const candidates = ['python3.13', 'python3.12', 'python3.11', 'python3']
  for (const cmd of candidates) {
    const info = await probePython(cmd)
    if (info && info.major === 3 && info.minor >= 11 && info.minor <= 13) {
      return cmd
    }
  }

  const fallback = await probePython('python3')
  if (fallback) {
    console.warn(
      `Warning: using ${fallback.cmd} (Python ${fallback.major}.${fallback.minor}); ortools may not support this version.`,
    )
    return fallback.cmd
  }

  throw new Error('No suitable python3 found (need 3.11–3.13, or set UNISLOT_PYTHON).')
}

async function pipWorks(python) {
  try {
    await runCapture(python, ['-m', 'pip', '--version'])
    return true
  } catch {
    return false
  }
}

const py = await resolvePython()
console.log(`Using ${py}…`)

const venvPython = venvPythonPath()
if (await exists(venvPython) && !(await pipWorks(venvPython))) {
  console.log('Existing venv has broken pip; recreating…')
  await rm(venvDir, { recursive: true, force: true })
}

if (!(await exists(venvPython))) {
  console.log(`Creating venv at ${venvDir}`)
  await run(py, ['-m', 'venv', venvDir])
}

console.log('Installing ortools…')
await run(venvPython, ['-m', 'pip', 'install', '-r', requirements])
console.log('CP-SAT environment ready. Run: npm run unislot')
