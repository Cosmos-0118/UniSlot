/**
 * Create solver/cpsat/.venv and install ortools.
 */
import { spawn } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveSystemPython,
  warnIfOneDrivePath,
} from '../src/modules/scheduling/solver/resolvePython.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cpsatDir = path.join(root, 'solver', 'cpsat')
const venvDir = path.join(cpsatDir, '.venv')
const requirements = path.join(cpsatDir, 'requirements.txt')

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: opts.cwd ?? root,
      windowsHide: true,
      env: process.env,
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))
    })
  })
}

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      windowsHide: true,
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr.trim()}`))
    })
  })
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function venvPythonPath(): string {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

async function pipWorks(python: string): Promise<boolean> {
  try {
    await runCapture(python, ['-m', 'pip', '--version'])
    return true
  } catch {
    return false
  }
}

warnIfOneDrivePath(root)

const resolved = await resolveSystemPython({
  allowUnsupported: true,
  log: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
})
const py = resolved.executable
console.log(`Using ${py}…`)

const venvPython = venvPythonPath()
if ((await exists(venvPython)) && !(await pipWorks(venvPython))) {
  console.log('Existing venv has broken pip; recreating…')
  await rm(venvDir, { recursive: true, force: true })
}

if (!(await exists(venvPython))) {
  console.log(`Creating venv at ${venvDir}`)
  await run(py, ['-m', 'venv', venvDir])
}

if (!(await exists(venvPython))) {
  throw new Error(
    [
      `venv was created but ${venvPython} is missing.`,
      'On Windows this often means the repo is under OneDrive or antivirus locked files.',
      'Move the repo to a local folder and re-run `npm run setup:cpsat`.',
    ].join(' '),
  )
}

console.log('Installing ortools…')
await run(venvPython, ['-m', 'pip', 'install', '-r', requirements])
console.log('CP-SAT environment ready. Run: npm run unislot')
