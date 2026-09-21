import { beforeEach, describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $setSelection,
  createEditor,
} from 'lexical'
import {
  captureDocumentSelectionSnapshot,
  getDocumentSessionKey,
  normalizeDocumentSelectionSnapshot,
  readDocumentSession,
  restoreDocumentSelectionSnapshot,
  writeDocumentSession,
} from './DocumentSessionPlugin'

describe('document session persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores scroll state independently for each note', () => {
    writeDocumentSession('note-a', { scrollTop: 420 })
    writeDocumentSession('note-b', { scrollTop: 36 })

    expect(readDocumentSession('note-a')).toEqual({ scrollTop: 420, selection: null })
    expect(readDocumentSession('note-b')).toEqual({ scrollTop: 36, selection: null })
  })

  it('normalizes invalid scroll and selection values and ignores missing ids', () => {
    writeDocumentSession('note-a', {
      scrollTop: -20,
      selection: {
        anchor: { blockIndex: -1, offset: 3 },
        focus: { blockIndex: 0, offset: 3 },
      },
    })

    expect(readDocumentSession('note-a')).toEqual({
      scrollTop: 0,
      selection: null,
    })
    expect(getDocumentSessionKey('')).toBe('')
    expect(readDocumentSession('')).toBeNull()
  })

  it('captures and restores a range selection by block index and text offsets', () => {
    const editor = createEditor({
      namespace: 'DocumentSessionSelectionTest',
      onError(error) {
        throw error
      },
    })

    let snapshot = null

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const first = $createParagraphNode()
      first.append($createTextNode('第一段'))
      const second = $createParagraphNode()
      const text = $createTextNode('abcdef')
      second.append(text)
      root.append(first, second)

      const selection = $createRangeSelection()
      selection.anchor.set(text.getKey(), 1, 'text')
      selection.focus.set(text.getKey(), 4, 'text')
      $setSelection(selection)

      snapshot = captureDocumentSelectionSnapshot()
      $setSelection(null)
      expect(restoreDocumentSelectionSnapshot(snapshot)).toBe(true)

      const restored = $getSelection()
      expect(restored.anchor.offset).toBe(1)
      expect(restored.focus.offset).toBe(4)
      expect(restored.anchor.getNode().getTextContent()).toBe('abcdef')
    }, { discrete: true })

    expect(normalizeDocumentSelectionSnapshot(snapshot)).toEqual({
      anchor: { blockIndex: 1, offset: 1 },
      focus: { blockIndex: 1, offset: 4 },
    })
  })
})
