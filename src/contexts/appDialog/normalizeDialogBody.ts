export type NormalizedDialogBody =
  | { kind: 'empty' }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; intro?: string; items: string[] }

export type DialogBodyInput = {
  message?: string
  items?: string[]
  /** When true, split `message` on newlines into list items if there are multiple lines. */
  splitMessageLines?: boolean
}

function cleanLines(parts: (string | undefined)[]): string[] {
  return parts
    .flatMap((p) => (p ? [p] : []))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Unifies message / items / multiline strings into one render model. */
export function normalizeDialogBody(input: DialogBodyInput): NormalizedDialogBody {
  let items = cleanLines(input.items ?? [])
  let intro = input.message?.trim() || undefined

  if (items.length === 0 && intro && (input.splitMessageLines ?? true) && /\n/.test(intro)) {
    const lines = intro.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    if (lines.length > 1) {
      items = lines
      intro = undefined
    }
  }

  if (items.length === 0) {
    return intro ? { kind: 'paragraph', text: intro } : { kind: 'empty' }
  }

  if (items.length === 1 && !intro) {
    return { kind: 'paragraph', text: items[0]! }
  }

  return { kind: 'list', intro, items }
}

export function dialogBodyPlainText(body: NormalizedDialogBody): string {
  switch (body.kind) {
    case 'empty':
      return ''
    case 'paragraph':
      return body.text
    case 'list':
      return [body.intro, ...body.items.map((item, i) => `${i + 1}. ${item}`)].filter(Boolean).join('\n')
  }
}

/** Longest unbroken line length — used to pick dialog width. */
export function dialogBodyLongestLine(body: NormalizedDialogBody): number {
  const text = dialogBodyPlainText(body)
  if (!text) return 0
  return text.split(/\n/).reduce((max, line) => Math.max(max, line.length), 0)
}

export type DialogLayoutMode = 'fit' | 'standard' | 'wide'

/** `fit` grows the panel to the longest line (up to viewport cap). */
export function dialogLayoutMode(
  body: NormalizedDialogBody,
  size: 'sm' | 'md' | 'lg' = 'md',
): DialogLayoutMode {
  if (size === 'lg') return 'wide'
  if (body.kind === 'list' && body.items.length > 2) return 'wide'
  const longest = dialogBodyLongestLine(body)
  if (longest <= 80 && body.kind !== 'list') return 'fit'
  if (longest > 96 || (body.kind === 'list' && body.items.length > 1)) return 'wide'
  return 'standard'
}
