/**
 * Cross-platform system Python discovery for UniSlot CP-SAT setup / fallback.
 *
 * Always returns an absolute path to a real python executable (via sys.executable)
 * so Windows cmd shims, the py launcher, and PATH quirks do not leak into later
 * spawn() calls.
 */
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Supported CPython minors for ortools wheels we ship against. */
export const SUPPORTED_PYTHON_MINORS = [12, 13, 11] as const
export const MIN_SUPPORTED_MINOR = 11
export const MAX_SUPPORTED_MINOR = 13

export type PythonCandidate = {
  /** Executable name or absolute path (e.g. "py", "python", "C:\\…\\python.exe"). */
  cmd: string
  /** Extra args before -c / -m (e.g. ["-3.12"] for the Windows py launcher). */
  prefixArgs?: string[]
  label?: string
}

export type ResolvedPython = {
  /** Absolute path to python.exe / python — safe to pass to spawn(). */
  executable: string
  major: number
  minor: number
  /** How we found it (for logs). */
  via: string
}

function runCapture(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      reject(new Error(`Timed out running ${cmd} ${args.join(' ')}`))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Strip wrapping quotes users often add when setting env vars in shells. */
export function normalizePythonPath(raw: string): string {
  let s = raw.trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim()
  }
  // Windows sometimes gets forward-slash paths from copy-paste; keep as-is for
  // Node spawn, but normalize only accidental trailing separators.
  if (s.length > 1 && (s.endsWith('\\') || s.endsWith('/')) && !s.endsWith(':\\')) {
    s = s.replace(/[/\\]+$/, '')
  }
  return s
}

/**
 * Microsoft Store "App Execution Alias" stubs live under WindowsApps and are
 * not usable for venv/ortools even when `python --version` appears to work.
 */
export function isWindowsStoreStub(executable: string): boolean {
  const normalized = executable.replace(/\//g, '\\').toLowerCase()
  return (
    normalized.includes('\\windowsapps\\') ||
    normalized.includes('\\microsoft\\windowsapps\\')
  )
}

export function parsePinnedMinor(raw: string): { major: number; minor: number } {
  const trimmed = raw.trim()
  const m = /^(\d+)\.(\d+)$/.exec(trimmed)
  if (!m) {
    throw new Error(`UNISLOT_PYTHON_VERSION must look like "3.12" (got "${raw}")`)
  }
  return { major: Number(m[1]), minor: Number(m[2]) }
}

export function isSupportedCpython(major: number, minor: number): boolean {
  return major === 3 && minor >= MIN_SUPPORTED_MINOR && minor <= MAX_SUPPORTED_MINOR
}

/** Shell-specific instructions for pointing UniSlot at a Python install. */
export function formatPythonSetupHelp(
  examplePath?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const sample =
    examplePath ??
    (platform === 'win32'
      ? String.raw`C:\Users\You\AppData\Local\Programs\Python\Python313\python.exe`
      : '/usr/bin/python3.12')

  if (platform === 'win32') {
    return [
      'No suitable Python found (need 3.11–3.13).',
      '',
      'Install Python from https://www.python.org/downloads/ and tick',
      '"Add python.exe to PATH". Then either reopen the terminal and re-run',
      '`npm run setup:cpsat`, or point UniSlot at python.exe explicitly:',
      '',
      '  CMD:',
      `    set UNISLOT_PYTHON=${sample}`,
      '    npm run setup:cpsat',
      '',
      '  PowerShell:',
      `    $env:UNISLOT_PYTHON="${sample}"`,
      '    npm run setup:cpsat',
      '',
      'Do not paste the PowerShell `$env:…` line into CMD — that causes',
      '"The filename, directory name, or volume label syntax is incorrect."',
      '',
      'Optional: pin a minor with UNISLOT_PYTHON_VERSION=3.12',
    ].join('\n')
  }

  return [
    'No suitable Python found (need 3.11–3.13).',
    '',
    'Install Python 3.11–3.13, then re-run `npm run setup:cpsat`, or:',
    '',
    `  export UNISLOT_PYTHON=${sample}`,
    '  npm run setup:cpsat',
    '',
    'Optional: pin a minor with UNISLOT_PYTHON_VERSION=3.12',
  ].join('\n')
}

export function warnIfOneDrivePath(repoRoot: string): void {
  const lower = repoRoot.replace(/\//g, '\\').toLowerCase()
  if (lower.includes('\\onedrive\\') || lower.includes('\\onedrive -')) {
    console.warn(
      [
        'Warning: this repo is under OneDrive. Python venvs often break there',
        '(file locking / sync). Prefer cloning to a local path like',
        'C:\\Users\\You\\Developer\\UniSlot if setup or solves fail oddly.',
      ].join(' '),
    )
  }
}

/** Build discovery candidates for a target 3.x minor (or all supported minors). */
export function buildPythonCandidates(opts?: {
  platform?: NodeJS.Platform
  pinnedMinor?: number
  localAppData?: string
  homeDir?: string
  programFiles?: string
  programFilesX86?: string
}): PythonCandidate[] {
  const platform = opts?.platform ?? process.platform
  const minors = opts?.pinnedMinor != null ? [opts.pinnedMinor] : [...SUPPORTED_PYTHON_MINORS]
  const out: PythonCandidate[] = []
  const seen = new Set<string>()

  const push = (c: PythonCandidate) => {
    const key = `${c.cmd}\0${(c.prefixArgs ?? []).join('\0')}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  if (platform === 'win32') {
    for (const minor of minors) {
      push({
        cmd: 'py',
        prefixArgs: [`-3.${minor}`],
        label: `py -3.${minor}`,
      })
    }
    if (opts?.pinnedMinor == null) {
      push({ cmd: 'py', prefixArgs: ['-3'], label: 'py -3' })
    }
  }

  for (const minor of minors) {
    push({ cmd: `python3.${minor}`, label: `python3.${minor}` })
  }
  push({ cmd: 'python3', label: 'python3' })
  push({ cmd: 'python', label: 'python' })

  if (platform === 'win32') {
    const localAppData =
      opts?.localAppData ?? process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local')
    const home = opts?.homeDir ?? homedir()
    const programFiles = opts?.programFiles ?? process.env.ProgramFiles ?? 'C:\\Program Files'
    const programFilesX86 =
      opts?.programFilesX86 ?? process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'

    for (const minor of minors) {
      const tag = `Python3${minor}`
      const relative = ['Programs', 'Python', tag, 'python.exe'] as const
      push({
        cmd: path.join(localAppData, ...relative),
        label: `%LOCALAPPDATA%\\Programs\\Python\\${tag}\\python.exe`,
      })
      push({
        cmd: path.join(home, 'AppData', 'Local', ...relative),
        label: `~/AppData/Local/Programs/Python/${tag}/python.exe`,
      })
      push({
        cmd: path.join(programFiles, 'Python', tag, 'python.exe'),
        label: `%ProgramFiles%\\Python\\${tag}\\python.exe`,
      })
      push({
        cmd: path.join(programFilesX86, 'Python', tag, 'python.exe'),
        label: `%ProgramFiles(x86)%\\Python\\${tag}\\python.exe`,
      })
    }
  }

  return out
}

export async function probePythonCandidate(
  candidate: PythonCandidate,
): Promise<ResolvedPython | null> {
  const prefix = candidate.prefixArgs ?? []
  const label = candidate.label ?? [candidate.cmd, ...prefix].join(' ')

  // Absolute path that does not exist — skip without spawning.
  if (path.isAbsolute(candidate.cmd) || /^[a-zA-Z]:[\\/]/.test(candidate.cmd)) {
    if (!(await pathExists(candidate.cmd))) return null
  }

  try {
    const probed = await runCapture(candidate.cmd, [
      ...prefix,
      '-c',
      'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}"); print(sys.executable)',
    ])
    if (probed.code !== 0) return null

    const lines = probed.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) return null

    const versionLine = lines[0]!
    const executable = lines[lines.length - 1]!
    const [majS, minS] = versionLine.split('.')
    const major = Number(majS)
    const minor = Number(minS)
    if (!Number.isInteger(major) || !Number.isInteger(minor)) return null
    if (!executable) return null
    if (process.platform === 'win32' && isWindowsStoreStub(executable)) return null

    return { executable, major, minor, via: label }
  } catch {
    return null
  }
}

export type ResolveSystemPythonOptions = {
  /** Override executable (UNISLOT_PYTHON). */
  override?: string | null
  /** Pin minor like "3.12" (UNISLOT_PYTHON_VERSION). */
  pinnedVersion?: string | null
  /** Allow versions outside 3.11–3.13 with a warning (setup only). */
  allowUnsupported?: boolean
  log?: (msg: string) => void
  warn?: (msg: string) => void
}

/**
 * Resolve a usable system Python interpreter to an absolute executable path.
 */
export async function resolveSystemPython(
  options: ResolveSystemPythonOptions = {},
): Promise<ResolvedPython> {
  const log = options.log ?? (() => {})
  const warn = options.warn ?? ((msg: string) => console.warn(msg))

  const overrideRaw =
    options.override?.trim() || process.env.UNISLOT_PYTHON?.trim() || ''
  if (overrideRaw) {
    const override = normalizePythonPath(overrideRaw)
    if (!(await pathExists(override))) {
      throw new Error(
        [
          `UNISLOT_PYTHON does not exist: ${override}`,
          '',
          formatPythonSetupHelp(override),
        ].join('\n'),
      )
    }
    const info = await probePythonCandidate({
      cmd: override,
      label: `UNISLOT_PYTHON=${override}`,
    })
    if (!info) {
      throw new Error(
        [
          `UNISLOT_PYTHON is set but is not a working Python interpreter: ${override}`,
          '',
          formatPythonSetupHelp(override),
        ].join('\n'),
      )
    }
    if (!isSupportedCpython(info.major, info.minor)) {
      if (!options.allowUnsupported) {
        throw new Error(
          `UNISLOT_PYTHON is Python ${info.major}.${info.minor}; need 3.11–3.13.\n\n${formatPythonSetupHelp(override)}`,
        )
      }
      warn(
        `Warning: UNISLOT_PYTHON is Python ${info.major}.${info.minor}; ortools may not support this version.`,
      )
    }
    log(`Resolved Python ${info.major}.${info.minor} → ${info.executable} (via ${info.via})`)
    return info
  }

  const pinnedRaw =
    options.pinnedVersion?.trim() || process.env.UNISLOT_PYTHON_VERSION?.trim() || ''
  let pinnedMinor: number | undefined
  let pinnedMajor = 3
  if (pinnedRaw) {
    const pinned = parsePinnedMinor(pinnedRaw)
    pinnedMajor = pinned.major
    pinnedMinor = pinned.minor
  }

  const candidates = buildPythonCandidates({
    pinnedMinor: pinnedMinor,
  })

  for (const candidate of candidates) {
    const info = await probePythonCandidate(candidate)
    if (!info) continue

    if (pinnedMinor != null) {
      if (info.major === pinnedMajor && info.minor === pinnedMinor) {
        log(
          `Pinned Python ${info.major}.${info.minor} via UNISLOT_PYTHON_VERSION → ${info.executable}`,
        )
        return info
      }
      continue
    }

    if (isSupportedCpython(info.major, info.minor)) {
      log(`Resolved Python ${info.major}.${info.minor} → ${info.executable} (via ${info.via})`)
      return info
    }
  }

  if (pinnedMinor != null) {
    throw new Error(
      [
        `No Python ${pinnedMajor}.${pinnedMinor} found.`,
        '',
        formatPythonSetupHelp(),
      ].join('\n'),
    )
  }

  // Last resort: any python3/python, with warning (setup path only).
  if (options.allowUnsupported) {
    for (const candidate of [
      { cmd: 'python3', label: 'python3' },
      { cmd: 'python', label: 'python' },
    ] satisfies PythonCandidate[]) {
      const info = await probePythonCandidate(candidate)
      if (!info) continue
      warn(
        `Warning: using ${info.executable} (Python ${info.major}.${info.minor}); ortools may not support this version.`,
      )
      return info
    }
  }

  throw new Error(formatPythonSetupHelp())
}
