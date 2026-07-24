import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import path from 'node:path'
import { access } from 'node:fs/promises'

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

async function windowsOpenFile(prompt: string): Promise<string | null> {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = 'Excel (*.xlsx)|*.xlsx|All files (*.*)|*.*'
$f.Title = '${prompt.replace(/'/g, "''")}'
if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }
`
  return new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', ps], {
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

async function windowsChooseFolder(prompt: string): Promise<string | null> {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = '${prompt.replace(/'/g, "''")}'
if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }
`
  return new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', ps], {
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

export async function assertReadableFile(filePath: string): Promise<void> {
  await access(filePath)
  if (!/\.xlsx$/i.test(filePath)) {
    throw new Error(`Expected an .xlsx file, got: ${path.basename(filePath)}`)
  }
}
