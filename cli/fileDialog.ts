import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import path from 'node:path'
import { access } from 'node:fs/promises'

/**
 * Decode a path written by a spawned Windows helper (PowerShell stdout is often
 * UTF-16LE when redirected; Node would otherwise see NULs and the path "fails").
 */
export function decodeSpawnedPath(buf: Buffer): string {
  if (!buf.length) return ''
  let text: string
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.subarray(2).toString('utf16le')
  } else if (buf.includes(0) && buf.length % 2 === 0) {
    text = buf.toString('utf16le')
  } else {
    text = buf.toString('utf8')
  }
  return (
    text
      .replace(/^\uFEFF/, '')
      .replace(new RegExp(String.fromCharCode(0), 'g'), '')
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
}

async function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(platform() === 'win32' ? 'where' : 'which', [cmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      resolve(out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null)
    })
    child.on('error', () => resolve(null))
  })
}

function runOsascript(script: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString()
    })
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      const p = out.trim()
      resolve(p || null)
    })
    child.on('error', () => resolve(null))
    void err
  })
}

async function macOpenFile(prompt: string): Promise<string | null> {
  const escaped = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return runOsascript(
    `POSIX path of (choose file with prompt "${escaped}" of type {"org.openxmlformats.spreadsheetml.sheet", "public.data"})`,
  )
}

async function macChooseFolder(prompt: string): Promise<string | null> {
  const escaped = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return runOsascript(`POSIX path of (choose folder with prompt "${escaped}")`)
}

async function zenityFile(prompt: string): Promise<string | null> {
  const zenity = await which('zenity')
  if (!zenity) return null
  return new Promise((resolve) => {
    const child = spawn(
      zenity,
      ['--file-selection', `--title=${prompt}`, '--file-filter=Excel | *.xlsx *.XLSX'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let out = ''
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('close', (code) => resolve(code === 0 ? out.trim() || null : null))
    child.on('error', () => resolve(null))
  })
}

async function zenityFolder(prompt: string): Promise<string | null> {
  const zenity = await which('zenity')
  if (!zenity) return null
  return new Promise((resolve) => {
    const child = spawn(zenity, ['--file-selection', `--title=${prompt}`, '--directory'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('close', (code) => resolve(code === 0 ? out.trim() || null : null))
    child.on('error', () => resolve(null))
  })
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * WinForms dialogs must run on an STA thread, write UTF-8, and own a TopMost
 * parent so the picker is not hidden behind the terminal (common on Windows).
 */
function runWindowsFormsDialog(body: string): Promise<string | null> {
  const script = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
${body}
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    child.stdout?.on('data', (d: Buffer) => {
      chunks.push(d)
    })
    child.on('close', () => {
      const picked = decodeSpawnedPath(Buffer.concat(chunks))
      resolve(picked || null)
    })
    child.on('error', () => resolve(null))
  })
}

function windowsOwnerFormPrelude(): string {
  return `
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.WindowState = 'Minimized'
$owner.FormBorderStyle = 'FixedToolWindow'
$owner.Width = 1
$owner.Height = 1
$null = $owner.Show()
$owner.Activate()
`
}

function windowsOwnerFormCleanup(): string {
  return `
$owner.Close()
$owner.Dispose()
`
}

async function windowsOpenFile(prompt: string): Promise<string | null> {
  return runWindowsFormsDialog(`
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = 'Excel (*.xlsx)|*.xlsx|All files (*.*)|*.*'
$dialog.Title = ${psSingleQuote(prompt)}
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
${windowsOwnerFormPrelude()}
$result = $dialog.ShowDialog($owner)
${windowsOwnerFormCleanup()}
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.FileName)
}
`)
}

async function windowsChooseFolder(prompt: string): Promise<string | null> {
  return runWindowsFormsDialog(`
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = ${psSingleQuote(prompt)}
$dialog.ShowNewFolderButton = $true
${windowsOwnerFormPrelude()}
$result = $dialog.ShowDialog($owner)
${windowsOwnerFormCleanup()}
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`)
}

/** Native OS file open dialog for an enrollment .xlsx (falls back to null if cancelled / unavailable). */
export async function pickEnrollmentFile(prompt = 'Select enrollment Excel workbook'): Promise<string | null> {
  const os = platform()
  if (os === 'darwin') return macOpenFile(prompt)
  if (os === 'win32') return windowsOpenFile(prompt)
  return zenityFile(prompt)
}

/** Native OS folder picker for export destination. */
export async function pickOutputFolder(prompt = 'Choose folder for UniSlot exports'): Promise<string | null> {
  const os = platform()
  if (os === 'darwin') return macChooseFolder(prompt)
  if (os === 'win32') return windowsChooseFolder(prompt)
  return zenityFolder(prompt)
}

/** Folder picker for a prior run that must contain snapshot.json. */
export async function pickPreviousOutputFolder(
  prompt = 'Choose previous UniSlot output folder (must contain snapshot.json)',
): Promise<string | null> {
  return pickOutputFolder(prompt)
}

export async function assertSnapshotFolder(dirPath: string): Promise<void> {
  const snapPath = path.join(dirPath, 'snapshot.json')
  try {
    await access(snapPath)
  } catch {
    throw new Error(`Previous output folder must contain snapshot.json: ${dirPath}`)
  }
}

export async function assertReadableFile(filePath: string): Promise<void> {
  await access(filePath)
  if (!/\.xlsx$/i.test(filePath)) {
    throw new Error(`Expected an .xlsx file, got: ${path.basename(filePath)}`)
  }
}
