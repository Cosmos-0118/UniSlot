/**
 * Create solver/cpsat/.venv and install ortools.
 *
 * Idempotent — safe to re-run any time. Recovers from:
 * - a missing or partial venv (e.g. a previous run was interrupted mid-create)
 * - a venv whose pip is broken (notably `ModuleNotFoundError:
 *   pip._internal.operations.build` seen with Homebrew Python, where
 *   `pip --version` succeeds but `pip install` fails)
 * - `--upgrade-deps` failing on offline / stripped base installs (falls back
 *   to a plain venv, then heals pip inside it)
 * - transient network failures during `pip install` (retries)
 * - env pollution (VIRTUAL_ENV / PYTHONHOME / PYTHONPATH / CONDA_*) leaking
 *   into venv creation via a sanitized child env
 *
 * Presentation matches the main CLI: Clack intro / spinners / panels / outro,
 * quiet when piped. All child output is captured (never interleaved with the
 * spinner) and only the tail is shown when something fails.
 *
 * Usage:
 *   npm run setup:cpsat [-- --force] [--python <path>]
 */
import * as p from '@clack/prompts'
import type { SpinnerResult } from '@clack/prompts'
import { spawn } from 'node:child_process'
import { access, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  box,
  glyphs,
  palette,
  spinOk,
  spinWarn,
  truncateMiddle,
  truncateVisible,
  wrapAnsi,
} from '../cli/theme.ts'
import {
  resolveSystemPython,
  warnIfOneDrivePath,
} from '../src/modules/scheduling/solver/resolvePython.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cpsatDir = path.join(root, 'solver', 'cpsat')
const venvDir = path.join(cpsatDir, '.venv')
const requirements = path.join(cpsatDir, 'requirements.txt')

const PROBE_TIMEOUT_MS = 60_000
const VENV_TIMEOUT_MS = 180_000
const PIP_INSTALL_TIMEOUT_MS = 10 * 60_000
const GET_PIP_TIMEOUT_MS = 120_000
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'
const DETAIL_TAIL_LINES = 14

const isWindows = process.platform === 'win32'

/** User-facing failure with an optional technical tail for the Details panel. */
class SetupFailure extends Error {
  detail: string | undefined
  constructor(summary: string, detail?: string) {
    super(summary)
    this.name = 'SetupFailure'
    this.detail = detail
  }
}

function fail(summary: string, detail?: string): never {
  throw new SetupFailure(summary, detail)
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Stale virtualenv / conda / custom-path variables break `python -m venv`
  // and make the venv python import the wrong site-packages.
  delete env.VIRTUAL_ENV
  delete env.PYTHONHOME
  delete env.PYTHONPATH
  delete env.PYTHONSTARTUP
  delete env.__PYVENV_LAUNCHER__
  delete env.CONDA_PREFIX
  delete env.CONDA_DEFAULT_ENV
  delete env.CONDA_PROMPT_MODIFIER
  return env
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Kill a child process portably. On Windows there are no POSIX signals —
 * kill() terminates the process; the SIGKILL escalation is POSIX-only.
 */
function killChild(child: ReturnType<typeof spawn>): void {
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  if (!isWindows) {
    setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, 5000).unref?.()
  }
}

function runCapture(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      windowsHide: true,
      env: childEnv(),
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killChild(child)
      reject(
        new Error(
          `${cmd} ${args.join(' ')} timed out after ${Math.round(timeoutMs / 1000)}s`,
        ),
      )
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
      reject(
        new Error(`Failed to start ${cmd} ${args.join(' ')}: ${err.message}`, {
          cause: err,
        }),
      )
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve(stdout.trim())
      else
        reject(
          new Error(
            `${cmd} ${args.join(' ')} exited ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
          ),
        )
    })
  })
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/** rm -rf with retries: Windows AV / file locks often fail the first attempt. */
async function rmWithRetry(target: string, label: string): Promise<void> {
  const delays = [200, 500, 1000, 2000]
  let lastErr: unknown
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await rm(target, { recursive: true, force: true })
      return
    } catch (err) {
      lastErr = err
      if (attempt === delays.length) break
      await sleep(delays[attempt]!)
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
  fail(
    `Could not remove ${label}.`,
    [
      `Path: ${target}`,
      `Error: ${detail}`,
      isWindows
        ? 'Close any Python processes using the venv, pause antivirus / OneDrive sync on this folder, then re-run.'
        : 'Check file permissions, then re-run.',
    ].join('\n'),
  )
}

function venvPythonPath(): string {
  return isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

/**
 * Deep pip health check. `pip --version` alone is NOT enough: the known
 * Homebrew failure mode passes `--version` yet every `pip install` dies with
 * `ModuleNotFoundError: No module named 'pip._internal.operations.build'`.
 */
async function pipHealth(python: string): Promise<{ ok: boolean; reason: string }> {
  try {
    await runCapture(python, ['-m', 'pip', '--version'])
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
  try {
    await runCapture(python, [
      '-c',
      'import pip._internal.operations.build, pip._internal.req.req_install',
    ])
  } catch (err) {
    return {
      ok: false,
      reason: `pip metadata is present but unimportable (${err instanceof Error ? err.message : String(err)})`,
    }
  }
  return { ok: true, reason: '' }
}

function hintForBootstrapError(detail: string): string {
  if (/No module named (ensurepip|venv)/.test(detail)) {
    if (process.platform === 'linux') {
      return 'This Python is missing the venv/ensurepip modules. On Debian/Ubuntu install them first, e.g. `sudo apt install python3.13-venv`, then re-run.'
    }
    return 'This Python install is missing the venv/ensurepip modules. Reinstall Python from https://www.python.org/downloads/ (on Windows tick "Add python.exe to PATH"), then re-run.'
  }
  return ''
}

/**
 * Repair a broken venv pip without relying on pip itself (which is broken).
 *
 * 1. `ensurepip --upgrade` re-lays pip from the stdlib wheels (no network,
 *    does not need a working pip).
 * 2. If pip now imports, opportunistically `pip install --upgrade pip` — but
 *    that step needs the network AND a working pip, so its failure is
 *    tolerated as long as pip is functional.
 * 3. Otherwise fall back to get-pip.py (downloaded with the stdlib urllib —
 *    no curl needed, Windows-safe), which force-installs a fresh pip and
 *    overwrites the partial copy that `ensurepip` sometimes leaves behind
 *    ("Requirement already satisfied" yet files are missing).
 */
async function healPip(
  python: string,
  onProgress: (message: string) => void,
): Promise<'ensurepip' | 'get-pip.py'> {
  try {
    await runCapture(python, ['-m', 'ensurepip', '--upgrade'], {
      timeoutMs: VENV_TIMEOUT_MS,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const hint = hintForBootstrapError(detail)
    fail('Could not bootstrap pip.', [detail, hint].filter(Boolean).join('\n'))
  }

  if ((await pipHealth(python)).ok) {
    onProgress('pip responds — trying to upgrade it…')
    try {
      await runCapture(
        python,
        ['-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', 'pip'],
        { timeoutMs: PIP_INSTALL_TIMEOUT_MS },
      )
    } catch {
      // Tolerated: the bundled pip works, we just could not upgrade it
      // (usually offline). Re-run ensurepip best-effort in case the failed
      // upgrade left pip half-written, then carry on.
      onProgress('pip upgrade skipped (offline?) — keeping bundled pip…')
      try {
        await runCapture(python, ['-m', 'ensurepip', '--upgrade'], {
          timeoutMs: VENV_TIMEOUT_MS,
        })
      } catch {
        /* ignore — health check below decides */
      }
    }
    if ((await pipHealth(python)).ok) return 'ensurepip'
  }

  onProgress('pip still broken — bootstrapping via get-pip.py…')
  const dest = path.join(tmpdir(), `unislot-get-pip-${process.pid}.py`)
  try {
    await runCapture(
      python,
      [
        '-c',
        [
          'import urllib.request',
          `urllib.request.urlretrieve(${JSON.stringify(GET_PIP_URL)}, ${JSON.stringify(dest)})`,
          'print("downloaded")',
        ].join('; '),
      ],
      { timeoutMs: GET_PIP_TIMEOUT_MS },
    )
    await runCapture(python, [dest, '--disable-pip-version-check', '--no-input'], {
      timeoutMs: PIP_INSTALL_TIMEOUT_MS,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    fail(
      'Could not download a fresh pip.',
      [
        detail,
        'Check your network connection / proxy (PIP_INDEX_URL, HTTPS_PROXY) and re-run.',
        isWindows ? 'If antivirus quarantined the download, allow the UniSlot folder and re-run.' : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  } finally {
    try {
      await unlink(dest)
    } catch {
      /* ignore — temp dir, and AV may briefly hold the file on Windows */
    }
  }

  const health = await pipHealth(python)
  if (!health.ok) {
    fail(
      'pip is still broken after bootstrapping.',
      `${health.reason}\nDelete ${venvDir} and re-run \`npm run setup:cpsat\`.`,
    )
  }
  return 'get-pip.py'
}

async function createVenv(
  py: string,
  onProgress: (message: string) => void,
): Promise<void> {
  // A previous interrupted run may have left a partial dir that `venv`
  // refuses to reuse — always start clean.
  if (await exists(venvDir)) {
    onProgress('Removing incomplete venv directory…')
    await rmWithRetry(venvDir, 'incomplete venv')
  }
  // --upgrade-deps refreshes the bundled pip/setuptools at creation time
  // instead of leaving whatever ensurepip shipped in that Python install.
  // It needs the network, so fall back to a plain venv (then heal pip
  // inside it) rather than failing outright when offline.
  try {
    await runCapture(py, ['-m', 'venv', venvDir, '--upgrade-deps'], {
      timeoutMs: VENV_TIMEOUT_MS,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const hint = hintForBootstrapError(detail)
    if (hint) fail('Could not create the venv.', `${detail}\n${hint}`)
    onProgress('Full venv failed — retrying minimal venv…')
    if (await exists(venvDir)) await rmWithRetry(venvDir, 'partial venv')
    try {
      await runCapture(py, ['-m', 'venv', venvDir], {
        timeoutMs: VENV_TIMEOUT_MS,
      })
    } catch (err2) {
      const detail2 = err2 instanceof Error ? err2.message : String(err2)
      const hint2 = hintForBootstrapError(detail2)
      fail(
        'Could not create the venv.',
        [detail2, hint2].filter(Boolean).join('\n'),
      )
    }
  }

  const venvPython = venvPythonPath()
  if (!(await exists(venvPython))) {
    fail(
      'venv was created but its Python is missing.',
      [
        `Expected: ${venvPython}`,
        isWindows
          ? 'On Windows this usually means the repo is under OneDrive or antivirus locked new files. Move the repo to a short local path like C:\\Dev\\UniSlot and re-run.'
          : `Check write permissions for ${venvDir} and re-run.`,
      ].join('\n'),
    )
  }
  // A minimal-venv fallback can carry the same stale pip the base install has.
  const health = await pipHealth(venvPython)
  if (!health.ok) {
    onProgress('New venv has broken pip — repairing…')
    await healPip(venvPython, onProgress)
  }
}

function isTransientInstallError(output: string): boolean {
  return /timed out|timeout|connection|network|temporary failure|ssl|reset by peer|broken pipe|502|503|504|500 internal|too many requests|429/i.test(
    output,
  )
}

async function installRequirements(
  python: string,
  onProgress: (message: string) => void,
): Promise<void> {
  const maxAttempts = 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runCapture(
        python,
        [
          '-m',
          'pip',
          'install',
          '--disable-pip-version-check',
          '--no-input',
          '-r',
          requirements,
        ],
        { timeoutMs: PIP_INSTALL_TIMEOUT_MS },
      )
      return
    } catch (err) {
      lastErr = err
      const detail = err instanceof Error ? err.message : String(err)
      const isLast = attempt === maxAttempts
      // Deterministic failures (bad pin, no wheel for this platform/Python)
      // never succeed on retry — surface them immediately.
      if (!isTransientInstallError(detail) || isLast) {
        fail(
          'Could not install requirements.',
          [
            detail,
            /No matching distribution/.test(detail)
              ? `No ortools wheel for this interpreter — use Python 3.11–3.13 (64-bit), e.g. UNISLOT_PYTHON=<path> npm run setup:cpsat.`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }
      const waitMs = attempt * 2000
      onProgress(`Network hiccup (attempt ${attempt}/${maxAttempts}) — retrying…`)
      await sleep(waitMs)
    }
  }
  throw lastErr
}

async function pinnedOrtoolsVersion(): Promise<string | null> {
  try {
    const text = await readFile(requirements, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const clean = line.trim()
      if (!clean || clean.startsWith('#')) continue
      const m = /^ortools\s*==\s*([^\s;#]+)/i.exec(clean)
      if (m) return m[1]!.trim()
    }
    return null
  } catch {
    return null
  }
}

async function verifyOrtools(python: string): Promise<string> {
  let version: string
  try {
    version = await runCapture(python, ['-c', 'import ortools; print(ortools.__version__)'], {
      timeoutMs: PROBE_TIMEOUT_MS,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    fail('ortools installed but cannot be imported.', detail)
  }
  const pinned = await pinnedOrtoolsVersion()
  if (pinned && version !== pinned) {
    fail(
      `ortools version mismatch (installed ${version}, pinned ${pinned}).`,
      'Re-run `npm run setup:cpsat -- --force`.',
    )
  }
  return version
}

function parseArgs(argv: string[]): { force: boolean; pythonOverride: string | null } {
  let force = false
  let pythonOverride: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--force' || arg === '--recreate' || arg === '--clean') {
      force = true
    } else if (arg === '--python' && i + 1 < argv.length) {
      pythonOverride = argv[++i]!
    } else if (arg.startsWith('--python=')) {
      pythonOverride = arg.slice('--python='.length)
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: npm run setup:cpsat [-- --force] [--python <path>]',
          '',
          '  --force           Delete any existing venv and recreate from scratch.',
          '  --python <path>   Use this Python instead of auto-discovery',
          '                    (same as UNISLOT_PYTHON=<path>).',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  return { force, pythonOverride }
}

/**
 * One panel shape for setup summaries and error details. Mirrors the main
 * CLI: Clack note on a TTY, bordered box when piped.
 */
function showSetupPanel(title: string, body: string): void {
  let lines = body.split('\n')
  while (lines.length > 0 && lines[0]!.trim() === '') lines = lines.slice(1)
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
    lines = lines.slice(0, -1)
  }
  if (lines.length === 0) return
  const maxLines = 40
  if (process.stdout.isTTY) {
    const rawColumns = process.stdout.columns ?? 0
    const wrapWidth = Math.max(4, (rawColumns > 0 ? rawColumns : 100) - 10)
    const wrapped = lines.flatMap((line) => wrapAnsi(line, wrapWidth))
    const shown =
      wrapped.length > maxLines
        ? [...wrapped.slice(0, maxLines), palette.dim(`… +${wrapped.length - maxLines} more lines`)]
        : wrapped
    p.note(shown.join('\n'), truncateVisible(title, wrapWidth))
    return
  }
  const shown =
    lines.length > maxLines
      ? [...lines.slice(0, maxLines), palette.dim(`… +${lines.length - maxLines} more lines`)]
      : lines
  process.stdout.write(`\n${box(title, shown)}\n`)
}

function tailLines(text: string, max: number): string {
  const lines = text.split('\n')
  return lines.slice(Math.max(0, lines.length - max)).join('\n')
}

type Spinner = SpinnerResult
/** Holder (not a bare `let`) so reads always see the declared union type. */
const stage: { spinner: Spinner | null } = { spinner: null }

function startStage(message: string): Spinner {
  const s = p.spinner()
  stage.spinner = s
  s.start(message)
  return s
}

function stopStage(s: Spinner, message: string): void {
  s.stop(spinOk(message))
  if (stage.spinner === s) stage.spinner = null
}

function installCancelSafetyNet(): void {
  const onSignal = () => {
    try {
      stage.spinner?.stop(spinWarn('Cancelled'))
    } catch {
      /* ignore */
    }
    stage.spinner = null
    p.cancel('Setup cancelled — nothing was half-written (re-run to resume).')
    process.exit(130)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  // SIGHUP does not exist on Windows; only listen where it can fire.
  if (!isWindows) process.on('SIGHUP', onSignal)
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const { force, pythonOverride } = parseArgs(process.argv.slice(2))
  installCancelSafetyNet()

  p.intro(palette.accent('▲ UniSlot') + palette.dim(' · CP-SAT setup'))

  if (root.replace(/\//g, '\\').toLowerCase().includes('\\onedrive\\')) {
    p.log.warn(
      'This repo is under OneDrive — Python venvs often break there (file locking / sync). Prefer a local path if setup or solves fail oddly.',
    )
  } else {
    warnIfOneDrivePath(root)
  }

  if (!(await exists(requirements))) {
    fail('requirements.txt is missing.', `Expected: ${requirements}`)
  }
  if (!(await exists(cpsatDir))) {
    fail('solver directory is missing.', `Expected: ${cpsatDir}`)
  }

  // ── 1. Resolve Python ────────────────────────────────────────────
  let py: string
  let pyLabel = ''
  {
    const s = startStage('Resolving Python…')
    const notes: { kind: 'info' | 'warn'; message: string }[] = []
    try {
      const resolved = await resolveSystemPython({
        override: pythonOverride?.trim() ? pythonOverride : undefined,
        allowUnsupported: true,
        log: (msg) => notes.push({ kind: 'info', message: msg }),
        warn: (msg) => notes.push({ kind: 'warn', message: msg }),
      })
      py = resolved.executable
      pyLabel = `Python ${resolved.major}.${resolved.minor}`
    } catch (err) {
      s.stop(spinWarn('No Python found'))
      stage.spinner = null
      fail(
        'No suitable Python found.',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      const bits = await runCapture(py, ['-c', 'import struct; print(struct.calcsize("P")*8)'])
      if (bits.trim() !== '64') {
        s.stop(spinWarn('Python unusable'))
        stage.spinner = null
        fail(
          'This Python is 32-bit — ortools needs 64-bit.',
          `Interpreter: ${py}\nInstall a 64-bit Python 3.11–3.13 and re-run.`,
        )
      }
    } catch (err) {
      if (err instanceof SetupFailure) throw err
      s.stop(spinWarn('Python unusable'))
      stage.spinner = null
      fail(
        'This Python is not usable.',
        `${py}\n${err instanceof Error ? err.message : String(err)}`,
      )
    }
    stopStage(s, `${pyLabel} · ${truncateMiddle(py, 64)}`)
    for (const n of notes) {
      if (n.kind === 'warn') p.log.warn(n.message)
      else p.log.info(n.message)
    }
  }

  // ── 2. Ensure venv ───────────────────────────────────────────────
  const venvPython = venvPythonPath()
  {
    if (force && (await exists(venvDir))) {
      const s = startStage('Removing existing venv (--force)…')
      await rmWithRetry(venvDir, 'existing venv')
      stopStage(s, 'Existing venv removed')
    }

    if (await exists(venvPython)) {
      const health = await pipHealth(venvPython)
      if (!health.ok) {
        const s = startStage('Repairing venv pip…')
        try {
          const method = await healPip(venvPython, (msg) => s.message(msg))
          stopStage(s, `pip repaired via ${method}`)
        } catch (err) {
          if (!(err instanceof SetupFailure)) throw err
          s.message('Repair failed — recreating the venv…')
          await rmWithRetry(venvDir, 'broken venv')
          await createVenv(py, (msg) => s.message(msg))
          stopStage(s, 'venv recreated')
        }
      } else {
        p.log.info(`venv · ${truncateMiddle(venvDir, 64)}`)
      }
    } else {
      const s = startStage(
        (await exists(venvDir)) ? 'Recreating incomplete venv…' : 'Creating venv…',
      )
      await createVenv(py, (msg) => s.message(msg))
      stopStage(s, 'venv created')
    }

    if (!(await exists(venvPython))) {
      fail(
        'venv was created but its Python is missing.',
        [
          `Expected: ${venvPython}`,
          isWindows
            ? 'On Windows this usually means the repo is under OneDrive or antivirus locked new files. Move the repo to a short local path like C:\\Dev\\UniSlot and re-run.'
            : `Check write permissions for ${venvDir} and re-run.`,
        ].join('\n'),
      )
    }

    // Belt-and-braces: a reused venv may have degraded since the check above.
    const preInstall = await pipHealth(venvPython)
    if (!preInstall.ok) {
      const s = startStage('Repairing venv pip…')
      try {
        const method = await healPip(venvPython, (msg) => s.message(msg))
        stopStage(s, `pip repaired via ${method}`)
      } catch (err) {
        if (!(err instanceof SetupFailure)) throw err
        s.message('Repair failed — recreating the venv…')
        await rmWithRetry(venvDir, 'broken venv')
        await createVenv(py, (msg) => s.message(msg))
        stopStage(s, 'venv recreated')
      }
      const healed = await pipHealth(venvPython)
      if (!healed.ok) {
        fail(
          'venv pip is broken and automatic repair failed.',
          `${healed.reason}\nDelete ${venvDir} and re-run \`npm run setup:cpsat\`.`,
        )
      }
    }
  }

  // ── 3. Install + verify ──────────────────────────────────────────
  let ortoolsVersion: string
  {
    const s = startStage('Installing ortools…')
    try {
      await installRequirements(venvPython, (msg) => s.message(msg))
    } catch (err) {
      if (err instanceof SetupFailure && /No module named 'pip\._internal/.test(err.detail ?? '')) {
        // The install itself exposed a broken pip (e.g. a half-written
        // upgrade). Heal once and retry before giving up.
        s.message('pip broke during install — repairing and retrying…')
        await healPip(venvPython, (msg) => s.message(msg))
        await installRequirements(venvPython, (msg) => s.message(msg))
      } else {
        s.stop(spinWarn('Install failed'))
        stage.spinner = null
        throw err
      }
    }
    s.message('Verifying ortools…')
    ortoolsVersion = await verifyOrtools(venvPython)
    stopStage(s, `ortools ${ortoolsVersion} installed`)
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
  p.log.success(`ortools ${ortoolsVersion} imports cleanly`)
  p.outro(
    `${palette.ok(`${glyphs.check} CP-SAT environment ready`)} ${palette.dim(`· ${elapsed}s`)}\n${palette.dim('Next:')} npm run unislot`,
  )
}

try {
  await main()
} catch (err) {
  try {
    stage.spinner?.stop(spinWarn('Failed'))
  } catch {
    /* ignore */
  }
  stage.spinner = null
  if (err instanceof SetupFailure) {
    p.log.error(err.message)
    if (err.detail) showSetupPanel('Details', tailLines(err.detail, DETAIL_TAIL_LINES))
  } else {
    p.log.error(err instanceof Error ? err.message : String(err))
  }
  p.cancel('Setup failed.')
  process.exit(1)
}
