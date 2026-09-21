import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import {
  $findAllSearchMatches,
  findTextMatchOffsets,
} from './SearchPlugin'
import {
  $createCodeBlockNode,
  CodeBlockNode,
} from '../nodes/CodeBlockNode'

describe('findTextMatchOffsets', () => {
  it('finds case-insensitive matches by default', () => {
    expect(findTextMatchOffsets('Alpha alpha ALPHA', 'alpha')).toEqual([0, 6, 12])
  })

  it('supports case-sensitive matching', () => {
    expect(findTextMatchOffsets('Alpha alpha ALPHA', 'Alpha', { matchCase: true })).toEqual([0])
  })

  it('supports whole-word matching without consuming partial identifiers', () => {
    expect(findTextMatchOffsets(
      'cat scatter cat_1 cat 中文cat中文',
      'cat',
      { wholeWord: true },
    )).toEqual([0, 18])
  })

  it('matches CJK phrases as complete phrases when boundaries are non-word characters', () => {
    expect(findTextMatchOffsets(
      '测试 文本测试 测试。',
      '测试',
      { wholeWord: true },
    )).toEqual([0, 8])
  })

  it('returns no matches for an empty query', () => {
    expect(findTextMatchOffsets('anything', '')).toEqual([])
  })

  it('collects ordinary text and custom code-block matches in document order', () => {
    const editor = createEditor({
      namespace: 'SearchCodeBlockTest',
      nodes: [CodeBlockNode],
      onError(error) {
        throw error
      },
    })

    let result = []

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('alpha outside'))
      root.append(
        paragraph,
        $createCodeBlockNode('const alpha = 1;\n// alpha again', 'javascript'),
      )

      result = $findAllSearchMatches('alpha').map(match => ({
        kind: match.kind,
        offset: match.offset,
      }))
    }, { discrete: true })

    expect(result).toEqual([
      { kind: 'text', offset: 0 },
      { kind: 'code-block', offset: 6 },
      { kind: 'code-block', offset: 20 },
    ])
  })
})
