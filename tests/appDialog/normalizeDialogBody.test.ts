import { describe, expect, it } from 'vitest'
import {
  dialogLayoutMode,
  normalizeDialogBody,
} from '../../src/contexts/appDialog/normalizeDialogBody'

describe('normalizeDialogBody', () => {
  it('renders a single item as a paragraph (no list box)', () => {
    const body = normalizeDialogBody({
      items: ['No section capacity left for 21EES101T (student 2211019015400).'],
    })
    expect(body).toEqual({
      kind: 'paragraph',
      text: 'No section capacity left for 21EES101T (student 2211019015400).',
    })
  })

  it('splits multiline messages into a list', () => {
    const body = normalizeDialogBody({
      message: 'First issue\n\nSecond issue',
    })
    expect(body).toEqual({
      kind: 'list',
      intro: undefined,
      items: ['First issue', 'Second issue'],
    })
  })

  it('uses fit layout for typical merge error lines', () => {
    const body = normalizeDialogBody({
      items: ['No section capacity left for 21EES101T (student 2211019015400).'],
    })
    expect(dialogLayoutMode(body)).toBe('fit')
  })

  it('keeps intro plus multiple items', () => {
    const body = normalizeDialogBody({
      message: '3 issue(s) from the last upload.',
      items: ['A', 'B', 'C'],
    })
    expect(body.kind).toBe('list')
    if (body.kind === 'list') {
      expect(body.intro).toBe('3 issue(s) from the last upload.')
      expect(body.items).toHaveLength(3)
    }
  })
})
