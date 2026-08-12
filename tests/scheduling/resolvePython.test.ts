import { describe, expect, it } from 'vitest'
import {
  buildPythonCandidates,
  formatPythonSetupHelp,
  isSupportedCpython,
  isWindowsStoreStub,
  normalizePythonPath,
  parsePinnedMinor,
} from '../../src/modules/scheduling/solver/resolvePython'

describe('normalizePythonPath', () => {
  it('strips wrapping quotes and trailing separators', () => {
    expect(normalizePythonPath('  "C:\\Python\\python.exe"  ')).toBe(
      'C:\\Python\\python.exe',
    )
    expect(normalizePythonPath("'C:\\Python\\python.exe'")).toBe(
      'C:\\Python\\python.exe',
    )
    expect(normalizePythonPath('C:\\Python\\')).toBe('C:\\Python')
  })
})

describe('isWindowsStoreStub', () => {
  it('detects WindowsApps aliases', () => {
    expect(
      isWindowsStoreStub(
        'C:\\Users\\hp\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe',
      ),
    ).toBe(true)
    expect(
      isWindowsStoreStub(
        'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      ),
    ).toBe(false)
  })
})

describe('parsePinnedMinor / isSupportedCpython', () => {
  it('parses 3.x pins', () => {
    expect(parsePinnedMinor('3.12')).toEqual({ major: 3, minor: 12 })
    expect(() => parsePinnedMinor('3')).toThrow(/must look like/)
  })

  it('accepts 3.11–3.13 only', () => {
    expect(isSupportedCpython(3, 11)).toBe(true)
    expect(isSupportedCpython(3, 13)).toBe(true)
    expect(isSupportedCpython(3, 10)).toBe(false)
    expect(isSupportedCpython(3, 14)).toBe(false)
  })
})

describe('buildPythonCandidates', () => {
  it('includes Windows py launcher, python, and common install paths', () => {
    const cands = buildPythonCandidates({
      platform: 'win32',
      localAppData: 'C:\\Users\\hp\\AppData\\Local',
      homeDir: 'C:\\Users\\hp',
      programFiles: 'C:\\Program Files',
      programFilesX86: 'C:\\Program Files (x86)',
    })
    const labels = cands.map((c) => c.label ?? c.cmd)
    expect(labels).toContain('py -3.12')
    expect(labels).toContain('py -3.13')
    expect(labels).toContain('py -3')
    expect(labels).toContain('python3')
    expect(labels).toContain('python')
    expect(
      cands.some((c) =>
        c.cmd.replace(/\//g, '\\').endsWith(
          'AppData\\Local\\Programs\\Python\\Python313\\python.exe',
        ),
      ),
    ).toBe(true)
  })

  it('pins to a single minor when requested', () => {
    const cands = buildPythonCandidates({
      platform: 'win32',
      pinnedMinor: 13,
      localAppData: 'C:\\Users\\hp\\AppData\\Local',
    })
    expect(cands.some((c) => c.label === 'py -3.13')).toBe(true)
    expect(cands.some((c) => c.label === 'py -3.12')).toBe(false)
    expect(cands.some((c) => c.label === 'py -3')).toBe(false)
  })

  it('uses unix-style names off Windows', () => {
    const cands = buildPythonCandidates({ platform: 'darwin' })
    expect(cands.some((c) => c.cmd === 'python3.12')).toBe(true)
    expect(cands.some((c) => c.cmd === 'python')).toBe(true)
    expect(cands.some((c) => c.cmd === 'py')).toBe(false)
  })
})

describe('formatPythonSetupHelp', () => {
  it('documents CMD vs PowerShell on Windows', () => {
    const help = formatPythonSetupHelp(
      String.raw`C:\Users\hp\AppData\Local\Programs\Python\Python313\python.exe`,
      'win32',
    )
    expect(help).toContain('CMD:')
    expect(help).toContain('set UNISLOT_PYTHON=')
    expect(help).toContain('PowerShell:')
    expect(help).toContain('$env:UNISLOT_PYTHON=')
    expect(help).toContain('Do not paste the PowerShell')
  })

  it('documents export on Unix', () => {
    const help = formatPythonSetupHelp('/usr/bin/python3.12', 'darwin')
    expect(help).toContain('export UNISLOT_PYTHON=')
    expect(help).not.toContain('CMD:')
  })
})
