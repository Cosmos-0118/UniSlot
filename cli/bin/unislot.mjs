#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const entry = path.join(root, 'cli', 'index.ts')
const tsconfig = path.join(root, 'cli', 'tsconfig.json')
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

runner.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
