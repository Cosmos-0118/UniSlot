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
const SGR_SPLIT_RE = new RegExp(`(${ESC}\\[[0-9;]*m)`)
const SGR_TEST_RE = new RegExp(`^${ESC}\\[[0-9;]*m$`)

/** Strip SGR color sequences (borders are measured on visible text only). */
export function stripAnsi(s: string): string {
  return s.replace(CSI_RE, '')
}

function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd) ||
    // Modern terminals render emoji and regional-indicator flags in two cells.
    (code >= 0x1f000 && code <= 0x1faff)
  )
}

function charWidth(code: number): number {
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0
  if (
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef) ||
    code === 0x200d
  ) {
    return 0
  }
  return isWideCodePoint(code) ? 2 : 1
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function graphemes(s: string): string[] {
  return Array.from(graphemeSegmenter.segment(s), ({ segment }) => segment)
}

function graphemeWidth(grapheme: string): number {
  // A joined emoji (for example, 👩‍💻) is a single two-column terminal cell,
  // not the sum of its constituent emoji. This also covers flags and keycaps.
  if ([...grapheme].some((ch) => isWideCodePoint(ch.codePointAt(0) ?? 0) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(ch))) {
    return 2
  }
  let width = 0
  for (const ch of grapheme) width += charWidth(ch.codePointAt(0) ?? 32)
  return width
}

function expandTabs(s: string): string {
  let column = 0
  let out = ''
  for (const part of s.split(SGR_SPLIT_RE)) {
    if (!part) continue
    if (SGR_TEST_RE.test(part)) {
      out += part
      continue
    }
    for (const grapheme of graphemes(part)) {
      if (grapheme === '\t') {
        const spaces = 8 - (column % 8)
        out += ' '.repeat(spaces)
        column += spaces
      } else {
        out += grapheme
        column += graphemeWidth(grapheme)
      }
    }
  }
  return out
}

/**
 * Visible terminal columns of a string: ANSI stripped, tabs expanded to 8,
 * CJK/emoji counted as 2, combining marks as 0. Keeps box borders aligned
 * when user data (student names, course titles) contains wide characters.
 */
export function strWidth(s: string): number {
  let w = 0
  for (const grapheme of graphemes(stripAnsi(s))) {
    if (grapheme === '\t') {
      w += 8 - (w % 8)
    } else {
      w += graphemeWidth(grapheme)
    }
  }
  return w
}

/** Visible length ignoring ANSI CSI sequences. */
export function visibleLen(s: string): number {
  return strWidth(s)
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

type StyledToken = { text: string; style: string; space: boolean }

type SgrState = Map<string, string>

function updateSgr(state: SgrState, code: string): void {
  const match = new RegExp(`^${ESC}\\[([0-9;]*)m$`).exec(code)
  if (!match) return
  const params = (match[1] || '0').split(';').map(Number)
  for (let i = 0; i < params.length; i++) {
    const param = params[i]!
    if (param === 0) {
      state.clear()
    } else if (param === 1 || param === 2) {
      state.set('intensity', String(param))
    } else if (param === 22) {
      state.delete('intensity')
    } else if (param === 3) {
      state.set('italic', '3')
    } else if (param === 23) {
      state.delete('italic')
    } else if (param === 4 || param === 21) {
      state.set('underline', String(param))
    } else if (param === 24) {
      state.delete('underline')
    } else if (param === 5 || param === 6) {
      state.set('blink', String(param))
    } else if (param === 25) {
      state.delete('blink')
    } else if (param === 7) {
      state.set('inverse', '7')
    } else if (param === 27) {
      state.delete('inverse')
    } else if (param === 8) {
      state.set('conceal', '8')
    } else if (param === 28) {
      state.delete('conceal')
    } else if (param === 9) {
      state.set('strike', '9')
    } else if (param === 29) {
      state.delete('strike')
    } else if ((param >= 30 && param <= 37) || (param >= 90 && param <= 97)) {
      state.set('fg', String(param))
    } else if (param === 39) {
      state.delete('fg')
    } else if ((param >= 40 && param <= 47) || (param >= 100 && param <= 107)) {
      state.set('bg', String(param))
    } else if (param === 49) {
      state.delete('bg')
    } else if (param === 38 || param === 48) {
      // 256-color: 38;5;n (3 params). Truecolor: 38;2;r;g;b (5 params).
      const mode = params[i + 1]
      const extra = mode === 5 ? 2 : mode === 2 ? 4 : 0
      if (extra && params[i + extra] !== undefined) {
        state.set(param === 38 ? 'fg' : 'bg', params.slice(i, i + 1 + extra).join(';'))
        i += extra
      }
    }
  }
}

function sgrStyle(state: SgrState): string {
  return [...state.values()].map((params) => `${ESC}[${params}m`).join('')
}

const RESET = `${ESC}[0m`

/**
 * Re-open each token's style after a reset so a later uncolored token (or the
 * box border) cannot inherit an earlier color run.
 */
function renderStyledRow(row: StyledToken[]): string {
  let out = ''
  let lastStyle: string | null = null
  for (const t of row) {
    if (t.style !== lastStyle) {
      if (lastStyle) out += RESET
      out += t.style
      lastStyle = t.style
    }
    out += t.text
  }
  if (lastStyle) out += RESET
  return out
}

/** Split a line into word/whitespace tokens, each carrying its active SGR style. */
function tokenizeStyled(line: string): StyledToken[] {
  const out: StyledToken[] = []
  const active: SgrState = new Map()
  for (const part of expandTabs(line).split(SGR_SPLIT_RE)) {
    if (!part) continue
    if (SGR_TEST_RE.test(part)) {
      updateSgr(active, part)
      continue
    }
    for (const tok of part.split(/(\s+)/)) {
      if (!tok) continue
      out.push({ text: tok, style: sgrStyle(active), space: /^\s+$/.test(tok) })
    }
  }
  return out
}

/** Hard-split an overlong word into visible-width chunks (wide-char aware). */
function splitLongWord(word: string, style: string, width: number): StyledToken[] {
  const chunks: StyledToken[] = []
  let cur = ''
  let curW = 0
  for (const ch of graphemes(word)) {
    const rawWidth = graphemeWidth(ch)
    // A two-column glyph cannot fit in a one-column viewport. Preserve a
    // usable border rather than letting one glyph break it.
    const text = rawWidth > width ? '?' : ch
    const w = Math.min(rawWidth, width)
    if (cur && curW + w > width) {
      chunks.push({ text: cur, style, space: false })
      cur = ''
      curW = 0
    }
    cur += text
    curW += w
  }
  if (cur) chunks.push({ text: cur, style, space: false })
  return chunks.length ? chunks : [{ text: '', style, space: false }]
}

/**
 * Word-wrap a (possibly ANSI-colored) line to `width` visible columns.
 * - Breaks only at whitespace, but hard-splits single words longer than the
 *   width (long paths, tokens) instead of overflowing the border.
 * - Tracks SGR state across the split so every wrapped row re-opens the
 *   active style and resets at row end — color never bleeds into borders
 *   and mid-line color changes survive wrapping.
 * - Lines that already fit are returned untouched (alignment preserved).
 */
export function wrapAnsi(line: string, width: number): string[] {
  if (width <= 0) return ['']
  if (strWidth(line) <= width) {
    // Even a short colored line must close its SGR run so a following border
    // cannot inherit the last color.
    return [line.includes(ESC) && !line.endsWith(RESET) ? `${line}${RESET}` : line]
  }
  const rows: StyledToken[][] = []
  let cur: StyledToken[] = []
  let curW = 0
  let pendingSpace: StyledToken | null = null

  const flush = (): void => {
    // `cur` never ends with whitespace (spaces wait in `pendingSpace`), so it
    // can be committed as-is; skip rows that hold no visible content.
    if (cur.some((t) => !t.space && t.text !== '')) rows.push(cur)
    cur = []
    curW = 0
  }

  const pushWord = (tok: StyledToken): void => {
    const w = strWidth(tok.text)
    if (w > width) {
      if (curW > 0) flush()
      const pieces = splitLongWord(tok.text, tok.style, width)
      for (let i = 0; i < pieces.length - 1; i++) rows.push([pieces[i]!])
      const last = pieces[pieces.length - 1]!
      cur = last.text ? [last] : []
      curW = last.text ? strWidth(last.text) : 0
      pendingSpace = null
      return
    }
    const sepW = curW > 0 && pendingSpace ? strWidth(pendingSpace.text) : 0
    if (curW > 0 && curW + sepW + w > width) flush()
    if (curW > 0 && pendingSpace) {
      cur.push(pendingSpace)
      curW += strWidth(pendingSpace.text)
    }
    cur.push(tok)
    curW += w
    pendingSpace = null
  }

  for (const tok of tokenizeStyled(line)) {
    if (tok.space) {
      if (curW === 0 && cur.length === 0) {
        // Detail panels intentionally use indentation; do not drop it.
        const indentation = splitLongWord(tok.text, tok.style, width)
        for (let i = 0; i < indentation.length - 1; i++) rows.push([indentation[i]!])
        const last = indentation[indentation.length - 1]!
        cur = last.text ? [last] : []
        curW = last.text ? strWidth(last.text) : 0
      } else if (!pendingSpace) {
        pendingSpace = tok
      }
      continue
    }
    pushWord(tok)
  }
  if (curW > 0 || cur.length > 0) flush()

  return rows.map((row) => renderStyledRow(row))
}

/**
 * Truncate to `max` visible columns with an ellipsis. ANSI is dropped when
 * truncation happens (used for select hints and spinner paths).
 */
export function truncateVisible(s: string, max: number, end = '…'): string {
  if (max <= 0) return ''
  if (strWidth(s) <= max) return s
  const budget = Math.max(0, max - strWidth(end))
  let out = ''
  let w = 0
  for (const ch of graphemes(stripAnsi(s))) {
    const cw = graphemeWidth(ch)
    if (w + cw > budget) break
    out += ch
    w += cw
  }
  return `${out}${end}`
}

/** Keep the start and end of a long path, collapsing the middle. */
export function truncateMiddle(s: string, max: number): string {
  if (max <= 0) return ''
  if (strWidth(s) <= max) return s
  if (max <= 4) return truncateVisible(s, max)
  const plain = stripAnsi(s)
  const parts = graphemes(plain)
  const endBudget = Math.floor((max - 1) * 0.6)
  const startBudget = max - 1 - endBudget
  const take = (fromStart: boolean, budget: number): string => {
    const selected: string[] = []
    let width = 0
    const iterable = fromStart ? parts : [...parts].reverse()
    for (const part of iterable) {
      const next = graphemeWidth(part)
      if (width + next > budget) break
      selected.push(part)
      width += next
    }
    return (fromStart ? selected : selected.reverse()).join('')
  }
  return `${take(true, startBudget)}…${take(false, endBudget)}`
}

/** Join a list, capping at `cap` items with an explicit "+N more" tail. */
export function joinCapped(items: string[], cap: number, sep = ', '): string {
  const limit = Math.max(0, Math.floor(cap))
  if (items.length <= limit) return items.join(sep)
  const prefix = items.slice(0, limit).join(sep)
  return `${prefix ? prefix + sep : ''}… +${items.length - limit} more`
}

/**
 * Lightweight bordered panel. Used for Result / Rectified / Late / Lower bounds
 * so every summary shares one look. Auto-sizes to content (capped to the
 * terminal width) and word-wraps any line too long to fit, so long sentences
 * (e.g. proof notes) never overflow past the right border.
 */
export function box(title: string, lines: string[], maxWidth = BOX_MAX_WIDTH): string {
  const { tl, tr, bl, br, h, v } = glyphs.box
  const rawColumns = process.stdout?.columns ?? 0
  const termWidth = rawColumns > 0 ? rawColumns : BOX_MAX_WIDTH
  const outerCap = Math.min(maxWidth, Math.max(4, termWidth))
  const wrapInner = Math.max(1, outerCap - 3) // outer - 2 borders - 1 leading space
  const wrapped = lines.flatMap((line) => wrapAnsi(line, wrapInner))

  const minInner = Math.min(BOX_MIN_WIDTH - 2, outerCap - 2)
  const inner = Math.max(
    minInner,
    Math.min(
      outerCap - 2,
      Math.max(strWidth(` ${title} `) + 2, ...wrapped.map((l) => strWidth(l) + 1)),
    ),
  )
  const titleShown = truncateVisible(title.replace(/[\r\n]+/g, ' '), Math.max(0, inner - 3))
  const titleBit = titleShown ? ` ${titleShown} ` : ''
  const top =
    inner < 4
      ? palette.brand(`${tl}${h.repeat(inner)}${tr}`)
      : palette.brand(`${tl}${h}${titleBit}${h.repeat(Math.max(0, inner - strWidth(titleBit) - 1))}${tr}`)
  const body = wrapped.map((line) => {
    const padded = pad(` ${line}`, inner)
    // Reset before the right border so a mid-line color run cannot tint it.
    return `${palette.dim(v)}${padded}${RESET}${palette.dim(v)}`
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

/** First `cap` lines, plus a dim "… +N more" line when truncated. One shape for every panel's overflow. */
export function capLines(lines: string[], cap: number): string[] {
  if (lines.length <= cap) return lines
  return [...lines.slice(0, cap), palette.dim(`… +${lines.length - cap} more`)]
}

/** Color a spinner stop message for success vs cancel. */
export function spinOk(message: string): string {
  return palette.ok(message)
}

export function spinWarn(message: string): string {
  return palette.warn(message)
}

/** True on an interactive terminal (animations allowed). Piped/CI runs are quiet. */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.CI && !process.env.UNISLOT_QUIET
}
