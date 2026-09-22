import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { $isWikiLinkNode, WikiLinkNode } from '../nodes/WikiLinkNode'
import { $insertWikiLinkAtSelection, matchWikiQuery } from './WikiLinkPlugin'

describe('WikiLinkPlugin helpers', () => {
  it('matches only an unfinished double-bracket query before the cursor', () => {
    expect(matchWikiQuery('See [[Tar', 9)).toEqual({
      raw: '[[Tar',
      query: 'Tar',
      noteQuery: 'Tar',
      sectionQuery: '',
      hasSectionQuery: false,
      start: 4,
    })
    expect(matchWikiQuery('See [[Target#Chap', 17)).toEqual({
      raw: '[[Target#Chap',
      query: 'Target#Chap',
      noteQuery: 'Target',
      sectionQuery: 'Chap',
      hasSectionQuery: true,
      start: 4,
    })
    expect(matchWikiQuery('See [[Target]]', 14)).toBeNull()
    expect(matchWikiQuery('No link', 7)).toBeNull()
  })

  it('replaces the unfinished query with an inline WikiLink node', () => {
    const editor = createEditor({
      nodes: [WikiLinkNode],
      onError(error) {
        throw error
      },
    })

    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const text = $createTextNode('See [[Target')
      paragraph.append(text)
      root.append(paragraph)
      text.select(text.getTextContentSize(), text.getTextContentSize())

      expect($insertWikiLinkAtSelection({ id: 'target-id', title: 'Target' })).toBe(true)
    }, { discrete: true })

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild()
      const children = paragraph.getChildren()
      expect(children.map(node => node.getType())).toEqual(['text', 'wiki-link', 'text'])
      expect(children[0].getTextContent()).toBe('See ')
      expect($isWikiLinkNode(children[1])).toBe(true)
      expect(children[1].getId()).toBe('target-id')
      expect(children[2].getTextContent()).toBe(' ')
    })
  })
})
