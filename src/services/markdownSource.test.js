import { describe, expect, it } from 'vitest'
import { analyzeMarkdownSourceCompatibility } from './markdownSource'

function stateWith(children) {
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children,
    },
  })
}

function paragraph(text, extra = {}) {
  return {
    type: 'paragraph',
    version: 1,
    children: [{ type: 'text', version: 1, text, format: 0, style: '' }],
    ...extra,
  }
}

describe('Markdown source compatibility', () => {
  it('allows lossless basic Markdown content', () => {
    const result = analyzeMarkdownSourceCompatibility(stateWith([
      paragraph('hello'),
      {
        type: 'heading',
        tag: 'h2',
        version: 1,
        children: [{ type: 'text', version: 1, text: 'Title', format: 1, style: '' }],
      },
      {
        type: 'code-block',
        version: 1,
        language: 'javascript',
        code: 'const answer = 42;',
      },
    ]))

    expect(result.editable).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.markdown).toContain('## **Title**')
    expect(result.markdown).toContain('const answer = 42;')
  })

  it('protects custom rich blocks from destructive source-mode round trips', () => {
    const result = analyzeMarkdownSourceCompatibility(stateWith([
      {
        type: 'image',
        version: 1,
        src: '/uploads/demo.png',
      },
    ]))

    expect(result.editable).toBe(false)
    expect(result.issues).toContain('图片')
  })

  it('protects paragraph formatting that Markdown cannot preserve', () => {
    const aligned = analyzeMarkdownSourceCompatibility(stateWith([
      paragraph('centered', { format: 'center' }),
    ]))
    const indented = analyzeMarkdownSourceCompatibility(stateWith([
      paragraph('nested', { indent: 2 }),
    ]))

    expect(aligned.editable).toBe(false)
    expect(aligned.issues).toContain('段落对齐、缩进或文字方向')
    expect(indented.editable).toBe(false)
    expect(indented.issues).toContain('段落对齐、缩进或文字方向')
  })

  it('protects ordered-list start values and merged or styled table cells', () => {
    const result = analyzeMarkdownSourceCompatibility(stateWith([
      {
        type: 'list',
        version: 1,
        listType: 'number',
        start: 4,
        children: [{
          type: 'listitem',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'fourth', format: 0, style: '' }],
        }],
      },
      {
        type: 'table',
        version: 1,
        children: [{
          type: 'tablerow',
          version: 1,
          children: [{
            type: 'tablecell',
            version: 1,
            colSpan: 2,
            headerState: 1,
            children: [paragraph('cell')],
          }],
        }],
      },
    ]))

    expect(result.editable).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      '有序列表自定义起始序号',
      '合并表格单元格',
      '表格单元格样式',
    ]))
  })

  it('protects link metadata that Markdown links cannot round-trip', () => {
    const result = analyzeMarkdownSourceCompatibility(stateWith([
      {
        type: 'paragraph',
        version: 1,
        children: [{
          type: 'link',
          version: 1,
          url: 'https://example.com',
          target: '_blank',
          children: [{ type: 'text', version: 1, text: 'Example', format: 0, style: '' }],
        }],
      },
    ]))

    expect(result.editable).toBe(false)
    expect(result.issues).toContain('链接窗口、关系或标题属性')
  })
})
