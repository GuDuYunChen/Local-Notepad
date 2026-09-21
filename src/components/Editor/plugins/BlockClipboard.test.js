import { describe, expect, it } from 'vitest'
import { createEditor, $createTextNode, $getRoot } from 'lexical'
import { $createHeadingNode, HeadingNode } from '@lexical/rich-text'

import {
  $insertBlockClipboardPayloadAfter,
  $serializeBlockClipboard,
} from './BlockHandlePlugin'

describe('block clipboard', () => {
  it('duplicates a complete element subtree with fresh node keys', () => {
    const editor = createEditor({
      namespace: 'BlockClipboardTest',
      nodes: [HeadingNode],
      onError(error) {
        throw error
      },
    })

    let originalKey = ''
    let copiedKey = ''

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const heading = $createHeadingNode('h2')
      heading.append($createTextNode('完整块复制'))
      root.append(heading)
      originalKey = heading.getKey()

      const payload = $serializeBlockClipboard(editor, heading)
      expect(payload?.nodes).toHaveLength(1)
      expect(payload.nodes[0]).toMatchObject({
        type: 'heading',
        tag: 'h2',
      })
      expect(payload.nodes[0].children?.[0]).toMatchObject({
        type: 'text',
        text: '完整块复制',
      })

      const inserted = $insertBlockClipboardPayloadAfter(payload, heading)
      expect(inserted).toHaveLength(1)
      copiedKey = inserted[0].getKey()
    }, { discrete: true })

    const state = editor.getEditorState().toJSON()
    expect(state.root.children).toHaveLength(2)
    expect(state.root.children.map(node => node.type)).toEqual(['heading', 'heading'])
    expect(state.root.children.map(node => node.children?.[0]?.text)).toEqual([
      '完整块复制',
      '完整块复制',
    ])
    expect(copiedKey).not.toBe(originalKey)
  })
})
