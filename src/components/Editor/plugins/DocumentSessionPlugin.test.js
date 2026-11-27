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
import {
  $createTableCellNode, $createTableNode, $createTableRowNode,
  TableCellNode, TableNode, TableRowNode,
} from '@lexical/table'

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

  it.each(['text', 'empty'])('restores the exact %s cell after serialized document reload', kind => {
    const config = { namespace: 'TableSession', nodes: [TableNode, TableRowNode, TableCellNode], onError: error => { throw error } }
    const editor = createEditor(config)
    let snapshot
    editor.update(() => {
      const first = $createParagraphNode().append($createTextNode('first'))
      const second = $createParagraphNode()
      if (kind === 'text') second.append($createTextNode('second'))
      $getRoot().append($createTableNode().append($createTableRowNode().append(
        $createTableCellNode().append(first), $createTableCellNode().append(second),
      )))
      second.selectStart()
      snapshot = captureDocumentSelectionSnapshot()
    }, { discrete: true })
    expect(snapshot).not.toBeNull()
    writeDocumentSession('table-note', { scrollTop: 80, selection: snapshot })
    const loaded = createEditor(config)
    loaded.setEditorState(loaded.parseEditorState(JSON.stringify(editor.getEditorState())))
    loaded.update(() => {
      expect(restoreDocumentSelectionSnapshot(readDocumentSession('table-note').selection)).toBe(true)
      const expected = $getRoot().getFirstChild().getFirstChild().getChildren()[1].getFirstChild()
      const selection = $getSelection()
      expect(selection.anchor.getNode().getKey()).toBe((kind === 'text' ? expected.getFirstChild() : expected).getKey())
      expect(selection.anchor.offset).toBe(0)
      expect(selection.anchor.type).toBe(kind === 'text' ? 'text' : 'element')
    }, { discrete: true })
  })

  it('preserves both cell boundaries in a cross-cell range and refuses missing saved paths', () => {
    const editor = createEditor({ namespace: 'TableSessionRange', nodes: [TableNode, TableRowNode, TableCellNode], onError: error => { throw error } })
    editor.update(() => {
      const first = $createTextNode('first'), second = $createTextNode('second')
      const cells = [first, second].map(text => $createTableCellNode().append($createParagraphNode().append(text)))
      $getRoot().append($createTableNode().append($createTableRowNode().append(...cells)))
      const selection = $createRangeSelection()
      selection.anchor.set(first.getKey(), 2, 'text')
      selection.focus.set(second.getKey(), 0, 'text')
      $setSelection(selection)
      const snapshot = captureDocumentSelectionSnapshot()
      expect(snapshot).not.toBeNull()
      $setSelection(null)
      expect(restoreDocumentSelectionSnapshot(snapshot)).toBe(true)
      expect($getSelection().anchor.key).toBe(first.getKey())
      expect($getSelection().focus.key).toBe(second.getKey())
      cells[1].remove()
      $setSelection(null)
      expect(restoreDocumentSelectionSnapshot(snapshot)).toBe(false)
      expect($getSelection()).toBeNull()
    }, { discrete: true })
  })
})
