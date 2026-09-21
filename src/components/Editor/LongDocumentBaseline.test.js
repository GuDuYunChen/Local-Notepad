import { describe, expect, it } from 'vitest'
import { createEditor, $createParagraphNode, $createTextNode, $getRoot } from 'lexical'

describe('long document baseline', () => {
  it('serializes a thousand structured paragraphs without losing order or content', () => {
    const editor = createEditor({
      namespace: 'LongDocumentBaseline',
      onError(error) {
        throw error
      },
    })

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const nodes = []
      for (let index = 0; index < 1000; index++) {
        const paragraph = $createParagraphNode()
        paragraph.append($createTextNode(`第 ${index + 1} 段：长文档性能基准内容`))
        nodes.push(paragraph)
      }
      root.append(...nodes)
    }, { discrete: true })

    const state = editor.getEditorState().toJSON()
    expect(state.root.children).toHaveLength(1000)
    expect(state.root.children[0].children[0].text).toContain('第 1 段')
    expect(state.root.children[999].children[0].text).toContain('第 1000 段')
  })
})
