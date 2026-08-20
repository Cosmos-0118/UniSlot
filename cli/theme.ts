import chalk from 'chalk'

/** Shared semantic colors for the CLI. */
export const palette = {
  brand: chalk.cyan,
  ok: chalk.green,
  warn: chalk.yellow,
  bad: chalk.red,
  dim: chalk.dim,
  accent: chalk.bold.cyan,
  bold: chalk.bold,
} as const

export type Tone = 'brand' | 'ok' | 'warn' | 'bad' | 'dim' | 'accent'

export const glyphs = {
  check: '✓',
  cross: '✗',
  star: '★',
  dot: '·',
  arrow: '→',
  step: {
    done: '✓',
    active: '●',
    pending: '○',
  },
  divider: '─',
  // Square corners match Clack's own chrome (┌ │ └) and render consistently
  // across terminal fonts — rounded box-drawing glyphs (╭╮╰╯) fall back
  // inconsistently on some fonts/terminals.
  box: {
    tl: '┌',
    tr: '┐',
    bl: '└',
    br: '┘',
    h: '─',
    v: '│',
  },
} as const

const ESC = String.fromCharCode(27)
const CSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const CSI_LEAD_RE = new RegExp(`^(?:${ESC}\\[[0-9;]*m)+`)
const CSI_TRAIL_RE = new RegExp(`(?:${ESC}\\[[0-9;]*m)+$`)

/** Visible length ignoring ANSI CSI sequences. */
export function visibleLen(s: string): number {
  return s.replace(CSI_RE, '').length
}

export function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const len = visibleLen(s)
  if (len >= width) return s
  const spaces = ' '.repeat(width - len)
  return align === 'right' ? spaces + s : s + spaces
}

export function divider(width = 44, label?: string): string {
  const h = glyphs.box.h
  if (!label) return palette.dim(h.repeat(width))
  const title = ` ${label} `
  const rest = Math.max(0, width - visibleLen(title) - 2)
  const left = Math.floor(rest / 2)
  const right = rest - left
  return palette.dim(h.repeat(left) + title + h.repeat(right))
}

const BOX_MIN_WIDTH = 28
const BOX_MAX_WIDTH = 88

/**
 * Word-wrap a (possibly ANSI-colored) line to fit `width` visible columns.
 * Most colored lines in this CLI are wrapped end-to-end in a single
 * palette call (e.g. `palette.ok('a long sentence...')`), so stripping the
 * leading/trailing escape run and reapplying it to every wrapped row keeps
 * color contained within each row instead of bleeding into the border.
 */
function wrapLine(line: string, width: number): string[] {
  if (width <= 0 || visibleLen(line) <= width) return [line]

  const leadMatch = CSI_LEAD_RE.exec(line)
  const lead = leadMatch ? leadMatch[0] : ''
  const rest = lead ? line.slice(lead.length) : line
  const trailMatch = CSI_TRAIL_RE.exec(rest)
  const trail = trailMatch ? trailMatch[0] : ''
  const core = trail ? rest.slice(0, rest.length - trail.length) : rest

  const words = core.split(' ')
  const rows: string[] = []
  let cur = ''
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word
    if (cur && visibleLen(candidate) > width) {
      rows.push(cur)
      cur = word
    } else {
      cur = candidate
    }
  }
  rows.push(cur)
  return rows.map((r) => `${lead}${r}${trail}`)
}

/**
 * Lightweight bordered panel. Used for Result / Rectified / Late / Lower bounds
 * so every summary shares one look. Auto-sizes to content (capped to the
 * terminal width) and word-wraps any line too long to fit, so long sentences
 * (e.g. proof notes) never overflow past the right border.
 */
export function box(title: string, lines: string[], maxWidth = BOX_MAX_WIDTH): string {
  const { tl, tr, bl, br, h, v } = glyphs.box
  const termWidth = process.stdout?.columns || BOX_MAX_WIDTH
  const outerCap = Math.max(BOX_MIN_WIDTH, Math.min(maxWidth, termWidth))
  const wrapInner = Math.max(4, outerCap - 3) // outer - 2 borders - 1 leading space
  const wrapped = lines.flatMap((line) => wrapLine(line, wrapInner))

  const titleBit = ` ${title} `
  const inner = Math.max(
    BOX_MIN_WIDTH - 2,
    Math.min(outerCap - 2, Math.max(visibleLen(titleBit) + 2, ...wrapped.map((l) => visibleLen(l) + 1))),
  )

  const topFill = Math.max(0, inner - visibleLen(titleBit) - 1)
  const top = palette.brand(`${tl}${h}${titleBit}${h.repeat(topFill)}${tr}`)
  const body = wrapped.map((line) => {
    const padded = pad(` ${line}`, inner)
    return `${palette.dim(v)}${padded}${palette.dim(v)}`
  })
  const bottom = palette.dim(`${bl}${h.repeat(inner)}${br}`)
  return [top, ...body, bottom].join('\n')
}

/** Aligned `label  value` column for live metrics and result panels. */
export function col(
  label: string,
  value: string,
  opts: { labelWidth?: number; valueWidth?: number; tone?: Tone } = {},
): string {
  const labelWidth = opts.labelWidth ?? 10
  const valueWidth = opts.valueWidth ?? 6
  const toneFn = opts.tone ? palette[opts.tone] : (s: string) => s
  return `${palette.dim(pad(label, labelWidth))} ${toneFn(pad(value, valueWidth, 'right'))}`
}

/** First `cap` lines, plus a dim "… N more" line when truncated. One shape for every panel's overflow. */
export function capLines(lines: string[], cap: number): string[] {
  if (lines.length <= cap) return lines
  return [...lines.slice(0, cap), palette.dim(`… ${lines.length - cap} more`)]
}

/** Color a spinner stop message for success vs cancel. */
export function spinOk(message: string): string {
  return palette.ok(message)
}

export function spinWarn(message: string): string {
  return palette.warn(message)
}
