import { describe, expect, it } from 'vitest'
import { $createWikiLinkNode, WikiLinkNode } from './WikiLinkNode'

describe('WikiLinkNode', () => {
  it('serializes and restores target identity', () => {
    const node = $createWikiLinkNode('file-123', '目标笔记')
    const json = node.exportJSON()

    expect(json).toEqual({
      type: 'wiki-link',
      version: 1,
      id: 'file-123',
      title: '目标笔记',
    })

    const restored = WikiLinkNode.importJSON(json)
    expect(restored.getId()).toBe('file-123')
    expect(restored.getTitle()).toBe('目标笔记')
    expect(restored.getTextContent()).toBe('[[目标笔记]]')
    expect(restored.isInline()).toBe(true)
  })
})
