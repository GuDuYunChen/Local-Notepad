import { describe, expect, it } from 'vitest'
import { markdownToLexical } from '~/services/importContent'
import { analyzeMarkdownSourceCompatibility } from '~/services/markdownSource'

describe('protected Markdown source mode', () => {
  it('serializes Markdown-safe Lexical structures and round-trips custom code blocks', () => {
    const state = {
      root: {
        type: 'root',
        children: [
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '标题', format: 0 }],
          },
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: '粗体', format: 1 },
              { type: 'text', text: ' 和正文', format: 0 },
              { type: 'formula', expression: 'E = mc^2', displayMode: false },
            ],
          },
          {
            type: 'code-block',
            language: 'javascript',
            code: 'const x = 42;',
          },
          {
            type: 'divider',
          },
        ],
      },
    }

    const analysis = analyzeMarkdownSourceCompatibility(state)

    expect(analysis.editable).toBe(true)
    expect(analysis.issues).toEqual([])
    expect(analysis.markdown).toContain('## 标题')
    expect(analysis.markdown).toContain('**粗体**')
    expect(analysis.markdown).toContain('$E = mc^2$')
    expect(analysis.markdown).toContain('const x = 42;')

    const roundTrip = JSON.parse(markdownToLexical(analysis.markdown))
    const code = roundTrip.root.children.find(node => node.type === 'code-block')
    expect(code).toMatchObject({
      type: 'code-block',
      language: 'javascript',
      code: 'const x = 42;',
    })
  })

  it('protects documents with non-standard blocks or non-Markdown text styling', () => {
    const state = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                text: '带颜色正文',
                format: 0,
                style: 'color: #ef4444;',
              },
            ],
          },
          {
            type: 'image',
            src: 'image.jpg',
            alt: '图片',
          },
        ],
      },
    }

    const analysis = analyzeMarkdownSourceCompatibility(state)

    expect(analysis.editable).toBe(false)
    expect(analysis.issues).toEqual(expect.arrayContaining([
      '图片',
      '自定义字体、字号、颜色或高亮样式',
    ]))
  })
})
