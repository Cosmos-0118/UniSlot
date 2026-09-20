#!/usr/bin/env node

/**
 * Dependency-free UniSlot bootstrap.
 *
 * The entry point intentionally uses only Node built-ins so it still works
 * after `npm ci` has removed node_modules, or before the first install on a
 * fresh clone. It fetches origin, resets the selected branch exactly to
 * GitHub, installs the lockfile, delegates OR-Tools setup to the existing
 * repair script, and verifies the result. Ignored files are preserved unless
 * they conflict with a tracked path in the target branch; such collisions are
 * reported before confirmation.
 *
 * Usage:
 *   npm run setup
 *   npm run setup -- --yes
 *   npm run setup -- --branch main --yes
 *   npm run setup -- --dry-run
 */
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { tmpdir } from 'node:os'
import { stdin as input, stdout as output } from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const remoteName = 'origin'
const isWindows = process.platform === 'win32'
const COMMAND_TIMEOUT_MS = 30 * 60_000
const GIT_TIMEOUT_MS = 5 * 60_000
const activeChildren = new Set()

class SetupFailure extends Error {
  constructor(message) {
    super(message)
    this.name = 'SetupFailure'
  }
}

function fail(message) {
  throw new SetupFailure(message)
}

function shellCommand(command, args) {
  return [command, ...args]
    .map((part) => (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(' ')
}

function killChildTree(child, signal = 'SIGTERM') {
  if (!child.pid) {
    try {
      child.kill(signal)
    } catch {
      // The process may already have exited.
    }
    return
  }
  if (isWindows) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => {
      try {
        child.kill()
      } catch {
        // Ignore an already-exited child.
      }
    })
    return
  }
  try {
    // Commands are spawned detached below, so the negative PID targets the
    // complete process group rather than only npm/git itself.
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Ignore an already-exited child.
    }
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // The process group may already be gone.
    }
  }, 5_000).unref?.()
}

function killChild(child) {
  try {
    killChildTree(child)
  } catch {
    // The process may already have exited.
  }
}

function runCommand(command, args, { capture = false, env = {}, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      detached: !isWindows,
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    activeChildren.add(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          if (settled) return
          timedOut = true
          killChild(child)
          // If a platform refuses to report process-tree termination, do not leave
          // the setup promise hanging forever.
          setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error(`${shellCommand(command, args)} timed out after ${Math.round(timeoutMs / 1000)}s`))
          }, 10_000).unref?.()
        }, timeoutMs)
      : null

    if (capture) {
      child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    }
    child.on('error', (error) => {
      activeChildren.delete(child)
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(new Error(`Could not start ${shellCommand(command, args)}: ${error.message}`, { cause: error }))
    })
    child.on('close', (code, signal) => {
      activeChildren.delete(child)
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`${shellCommand(command, args)} timed out after ${Math.round(timeoutMs / 1000)}s`))
        return
      }
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      const detail = [stderr.trim(), signal ? `signal ${signal}` : `exit ${code}`]
        .filter(Boolean)
        .join(': ')
      reject(new Error(`${shellCommand(command, args)} failed: ${detail}`))
    })
  })
}

function stopActiveChildren(signal) {
  for (const child of activeChildren) killChildTree(child, signal)
  if (activeChildren.size === 0) {
    const exitCode = signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143
    process.exit(exitCode)
  }
}

process.on('SIGINT', () => stopActiveChildren('SIGINT'))
process.on('SIGTERM', () => stopActiveChildren('SIGTERM'))
if (!isWindows) process.on('SIGHUP', () => stopActiveChildren('SIGHUP'))

async function runOrFail(command, args, options = {}) {
  try {
    return await runCommand(command, args, options)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

async function optionalCommand(command, args, options = {}) {
  try {
    return await runCommand(command, args, { ...options, capture: true })
  } catch {
    return null
  }
}

function gitEnv() {
  return { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
}

function git(args, options = {}) {
  return runOrFail('git', args, {
    ...options,
    env: { ...gitEnv(), ...(options.env ?? {}) },
    timeoutMs: options.timeoutMs ?? GIT_TIMEOUT_MS,
  })
}

function gitOptional(args) {
  return optionalCommand('git', args, { env: gitEnv(), timeoutMs: GIT_TIMEOUT_MS })
}

function parseArgs(argv) {
  const result = {
    assumeYes: process.env.UNISLOT_SETUP_ASSUME_YES === '1',
    branch: process.env.UNISLOT_SETUP_BRANCH?.trim() || null,
    dryRun: false,
    skipGit: false,
    skipChecks: false,
    recreateCpsat: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--yes' || arg === '--force') result.assumeYes = true
    else if (arg === '--dry-run') result.dryRun = true
    else if (arg === '--skip-git' || arg === '--no-git') result.skipGit = true
    else if (arg === '--skip-checks') result.skipChecks = true
    else if (arg === '--recreate-cpsat') result.recreateCpsat = true
    else if (arg === '--branch' && i + 1 < argv.length) result.branch = argv[++i].trim()
    else if (arg.startsWith('--branch=')) result.branch = arg.slice('--branch='.length).trim()
    else if (arg === '--help' || arg === '-h') result.help = true
    else fail(`Unknown setup option: ${arg}. Run npm run setup -- --help.`)
  }
  if (result.branch === '') fail('--branch needs a non-empty branch name.')
  return result
}

function printHelp() {
  console.log([
    'Usage: npm run setup [-- options]',
    '',
    '  --yes, --force       Allow reset of local changes/commits and reported collisions.',
    '  --branch <name>     Sync this branch instead of the current tracked branch.',
    '  --dry-run           Fetch and show the Git plan without changing the worktree.',
    '  --skip-git          Keep the current checkout; install and verify only.',
    '  --skip-checks       Skip doctor, tests, and lint after installation.',
    '  --recreate-cpsat    Recreate the OR-Tools virtualenv from scratch.',
    '',
    'Environment:',
    '  UNISLOT_SETUP_ASSUME_YES=1  Non-interactive equivalent of --yes.',
    '  UNISLOT_SETUP_BRANCH=<name> Default branch override.',
  ].join('\n'))
}

async function remoteDefaultBranch() {
  const remoteHead = await gitOptional(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remoteName}/HEAD`])
  if (remoteHead?.startsWith(`${remoteName}/`)) return remoteHead.slice(remoteName.length + 1)
  const remoteInfo = await gitOptional(['remote', 'show', remoteName])
  const headLine = remoteInfo?.match(/^\s*HEAD branch:\s*(\S+)\s*$/m)?.[1]
  if (headLine) return headLine
  for (const candidate of ['main', 'master']) {
    if (await gitOptional(['show-ref', '--verify', '--quiet', `refs/remotes/${remoteName}/${candidate}`]) !== null) {
      return candidate
    }
  }
  fail(`Could not determine ${remoteName}'s default branch. Pass --branch <name>.`)
}

async function remoteBranchExists(branch) {
  return (await gitOptional(['show-ref', '--verify', '--quiet', `refs/remotes/${remoteName}/${branch}`])) !== null
}

async function resolveBranch(requested, current) {
  const branch = requested || (current &&
    (await gitOptional(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])) === `${remoteName}/${current}` &&
    (await remoteBranchExists(current)) ? current : await remoteDefaultBranch())
  await git(['check-ref-format', '--branch', branch], { capture: true })
  if (!(await remoteBranchExists(branch))) fail(`GitHub branch ${remoteName}/${branch} does not exist.`)
  return branch
}

async function aheadCount(localRef, remoteRef) {
  const counts = await git(['rev-list', '--left-right', '--count', `${remoteRef}...${localRef}`], { capture: true })
  const values = counts.trim().split(/\s+/).map((value) => Number(value))
  if (values.length !== 2 || values.some((value) => !Number.isInteger(value) || value < 0)) {
    fail(`Git returned an invalid ahead/behind count: ${counts}`)
  }
  return values[1]
}

function pathConflicts(left, right) {
  const a = left.replace(/\\/g, '/').replace(/\/$/, '')
  const b = right.replace(/\\/g, '/').replace(/\/$/, '')
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

async function ignoredTargetCollisions(branch) {
  const ignored = await git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], { capture: true })
  const target = await git(['ls-tree', '-r', '--name-only', `${remoteName}/${branch}`], { capture: true })
  const ignoredPaths = ignored.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const targetPaths = target.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return ignoredPaths.filter((ignoredPath) => targetPaths.some((targetPath) => pathConflicts(ignoredPath, targetPath)))
}

async function buildGitPlan(requestedBranch) {
  const gitRoot = await git(['rev-parse', '--show-toplevel'], { capture: true })
  if (path.resolve(gitRoot) !== root) fail(`Run setup from the UniSlot repository. Git root is ${gitRoot}, expected ${root}.`)
  const remoteUrl = await git(['remote', 'get-url', remoteName], { capture: true })
  if (!remoteUrl) fail(`Git remote ${remoteName} has no URL.`)
  const currentBranch = await git(['branch', '--show-current'], { capture: true })
  await git(['fetch', '--prune', remoteName])
  await gitOptional(['remote', 'set-head', remoteName, '-a'])
  const branch = await resolveBranch(requestedBranch, currentBranch)
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all'], { capture: true })
  const cleanPreview = await gitOptional(['clean', '-nd', '-d', '--']) || ''
  const localCommitsAhead = await aheadCount('HEAD', `refs/remotes/${remoteName}/${branch}`)
  let targetCommitsAhead = 0
  if (await gitOptional(['show-ref', '--verify', `refs/heads/${branch}`])) {
    targetCommitsAhead = await aheadCount(`refs/heads/${branch}`, `refs/remotes/${remoteName}/${branch}`)
  }
  const ignoredCollisions = await ignoredTargetCollisions(branch)
  return { branch, currentBranch, remoteUrl, status, cleanPreview, localCommitsAhead, targetCommitsAhead, ignoredCollisions }
}

function hasDiscardableWork(plan) {
  return Boolean(
    plan.status.trim() ||
    plan.cleanPreview.trim() ||
    plan.localCommitsAhead ||
    plan.targetCommitsAhead ||
    plan.ignoredCollisions.length,
  )
}

function formatPlan(plan) {
  const lines = [
    `Remote: ${plan.remoteUrl}`,
    `Branch: ${plan.currentBranch || '(detached)'} → ${plan.branch}`,
    `Action: fetch origin, clean local changes, and reset exactly to origin/${plan.branch}`,
  ]
  if (plan.status.trim()) {
    const entries = plan.status.trim().split('\n')
    lines.push(`Tracked/staged changes: ${entries.length}`, ...entries.slice(0, 8).map((entry) => `  ${entry}`))
    if (entries.length > 8) lines.push(`  … +${entries.length - 8} more`)
  }
  if (plan.cleanPreview.trim()) {
    const entries = plan.cleanPreview.trim().split('\n')
    lines.push(`Non-ignored untracked paths to remove: ${entries.length}`, ...entries.slice(0, 8).map((entry) => `  ${entry}`))
    if (entries.length > 8) lines.push(`  … +${entries.length - 8} more`)
  }
  if (plan.localCommitsAhead) {
    const source = plan.currentBranch ? `from ${plan.currentBranch}` : 'from detached HEAD'
    lines.push(`Local commits not in origin/${plan.branch} ${source}: ${plan.localCommitsAhead}`)
  }
  if (plan.targetCommitsAhead) lines.push(`Existing ${plan.branch} commits ahead of GitHub: ${plan.targetCommitsAhead}`)
  if (plan.ignoredCollisions.length) {
    lines.push(`Ignored paths that conflict with files in origin/${plan.branch}: ${plan.ignoredCollisions.length}`)
    lines.push(...plan.ignoredCollisions.slice(0, 8).map((entry) => `  ${entry}`))
    if (plan.ignoredCollisions.length > 8) lines.push(`  … +${plan.ignoredCollisions.length - 8} more`)
    lines.push('These ignored paths may be overwritten by checkout/reset and require confirmation.')
  } else {
    lines.push('Git cleanup preserves ignored paths such as node_modules, solver/cpsat/.venv, and local outputs.')
  }
  return lines.join('\n')
}

async function confirmCleanup(plan, assumeYes) {
  if (!hasDiscardableWork(plan) || assumeYes) return
  if (!input.isTTY || !output.isTTY) fail('Setup would discard local changes, but no interactive terminal is available. Re-run with --yes after confirming the Git plan.')
  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question('Discard these local changes and sync exactly to GitHub? [y/N] ')
    if (!/^y(?:es)?$/i.test(answer.trim())) fail('Git sync cancelled; no local changes were discarded.')
  } finally {
    rl.close()
  }
}

async function syncGit(args) {
  const plan = await buildGitPlan(args.branch)
  console.log(formatPlan(plan))
  if (args.dryRun) return
  await confirmCleanup(plan, args.assumeYes)
  await git(['clean', '-fd', '--'])
  if (plan.currentBranch !== plan.branch) {
    await git(['checkout', '-B', plan.branch, `${remoteName}/${plan.branch}`])
    await git(['branch', '--set-upstream-to', `${remoteName}/${plan.branch}`, plan.branch])
  } else {
    await git(['reset', '--hard', `${remoteName}/${plan.branch}`])
  }
  await git(['clean', '-fd', '--'])
  const localHead = await git(['rev-parse', 'HEAD'], { capture: true })
  const remoteHead = await git(['rev-parse', `refs/remotes/${remoteName}/${plan.branch}`], { capture: true })
  if (localHead !== remoteHead) fail(`Git sync verification failed: HEAD ${localHead} != ${remoteName}/${plan.branch} ${remoteHead}.`)
  const remaining = await git(['status', '--porcelain=v1', '--untracked-files=all'], { capture: true })
  if (remaining.trim()) fail(`Git sync left local changes behind:\n${remaining}`)
  console.log(`GitHub sync complete · ${plan.branch} @ ${localHead.slice(0, 12)}`)
}

async function handoffToFetchedSetup(args) {
  const script = path.join(root, 'scripts', 'setup.mjs')
  try {
    await access(script)
  } catch {
    fail(`GitHub branch ${args.branch || '(selected branch)'} does not contain scripts/setup.mjs after sync.`)
  }
  const forwarded = ['--skip-git']
  if (args.skipChecks) forwarded.push('--skip-checks')
  if (args.recreateCpsat) forwarded.push('--recreate-cpsat')
  console.log('Reloading the setup script from the synchronized GitHub checkout…')
  // The child runs its own command-level timeouts. Do not impose another
  // 30-minute ceiling over the complete npm + Python bootstrap.
  await runOrFail(process.execPath, [script, ...forwarded], { timeoutMs: 0 })
}

function npmInvocation() {
  const npmExecPath = process.env.npm_execpath
  return npmExecPath
    ? { command: process.execPath, prefix: [npmExecPath] }
    : { command: isWindows ? 'npm.cmd' : 'npm', prefix: [] }
}

async function prepareNpmEnvironment() {
  const npm = npmInvocation()
  const configured = await runOrFail(npm.command, [...npm.prefix, 'config', 'get', 'cache'], { capture: true, timeoutMs: GIT_TIMEOUT_MS })
  const cache = configured.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)
  if (!cache) fail('npm did not report a cache directory.')
  try {
    for (const directory of [cache, path.join(cache, 'tmp'), path.join(cache, '_logs')]) {
      await mkdir(directory, { recursive: true })
      const probe = path.join(directory, `.unislot-cache-probe-${process.pid}-${Date.now()}`)
      await writeFile(probe, 'ok')
      await rm(probe, { force: true })
    }
    return {}
  } catch (error) {
    let fallback = ''
    try {
      fallback = await mkdtemp(path.join(tmpdir(), 'unislot-npm-cache-'))
      await writeFile(path.join(fallback, 'write-test'), 'ok')
      await rm(path.join(fallback, 'write-test'), { force: true })
    } catch (fallbackError) {
      fail([
        `npm cache is not writable: ${cache}`,
        error instanceof Error ? error.message : String(error),
        `Could not create fallback cache: ${fallback}`,
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      ].join('\n'))
    }
    console.warn(`npm cache is not writable; using temporary cache ${fallback}`)
    return { npm_config_cache: fallback, NPM_CONFIG_CACHE: fallback }
  }
}

async function npmRun(args, label, env) {
  const npm = npmInvocation()
  console.log(`\n==> ${label}`)
  await runOrFail(npm.command, [...npm.prefix, ...args], { env })
  console.log(`✓ ${label}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  console.log('▲ UniSlot · full setup')
  if (args.skipGit) {
    console.warn('Git sync skipped (--skip-git).')
  } else {
    await syncGit(args)
    if (!args.dryRun) {
      await handoffToFetchedSetup(args)
      return
    }
  }
  if (args.dryRun) {
    console.log('Dry run complete — the working tree was not reset or cleaned. Remote refs may have been refreshed.')
    return
  }

  const npmEnv = await prepareNpmEnvironment()
  await npmRun(['ci', '--no-audit', '--no-fund'], 'Installing Node dependencies', npmEnv)
  await npmRun(['audit', '--audit-level=moderate'], 'Checking npm advisories', npmEnv)
  const cpsatArgs = ['run', 'setup:cpsat']
  if (args.recreateCpsat) cpsatArgs.push('--', '--force')
  await npmRun(cpsatArgs, 'Setting up Google OR-Tools', npmEnv)
  if (!args.skipChecks) {
    await npmRun(['run', 'unislot', '--', 'doctor'], 'Verifying CP-SAT readiness', npmEnv)
    await npmRun(['test'], 'Running tests', npmEnv)
    await npmRun(['run', 'lint'], 'Running lint', npmEnv)
  }
  console.log('\nSetup complete — UniSlot is ready to schedule.')
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
