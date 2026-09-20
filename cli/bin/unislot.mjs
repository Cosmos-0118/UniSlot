#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const entry = path.join(root, 'cli', 'index.ts')
const tsconfig = path.join(root, 'tsconfig.json')
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')

const runner = spawn(
  process.execPath,
  [tsxCli, '--tsconfig', tsconfig, entry, ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  },
)

/**
 * The tsx child shares this foreground process group, so it already received
 * SIGINT from the terminal. Forwarding a second SIGINT used to flip the CLI
 * into force-quit (`process.exit`) before solver children were reaped.
 * Swallow here and wait for the child to finish its cancel path.
 */
process.on('SIGINT', () => undefined)
process.on('SIGTERM', () => {
  if (!runner.killed && runner.pid) {
    try {
      runner.kill('SIGTERM')
    } catch {
      /* child already gone */
    }
  }
})

runner.on('exit', (code, signal) => {
  if (signal) {
    // Prefer numeric exit for Ctrl+C so shells see 130.
    process.exit(signal === 'SIGINT' || signal === 'SIGTERM' ? 130 : 1)
    return
  }
  process.exit(code ?? 1)
})
