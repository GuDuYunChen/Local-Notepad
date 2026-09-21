import { describe, expect, it } from 'vitest'
import { markdownToLexical, normalizeImportedContent, plainTextToLexical } from './importContent'

function textFromState(serialized) {
  const state = JSON.parse(serialized)
  const collect = node => {
    if (!node) return ''
    if (node.type === 'text') return node.text || ''
    return (node.children || []).map(collect).join('\n')
  }
  return collect(state.root)
}

describe('import content normalization', () => {
  it('turns plain text lines into valid Lexical paragraphs', () => {
    const serialized = plainTextToLexical('line one\nline two')
    const state = JSON.parse(serialized)
    expect(state.root.children).toHaveLength(2)
    expect(textFromState(serialized)).toContain('line one')
    expect(textFromState(serialized)).toContain('line two')
  })

  it('preserves basic Markdown structure as Lexical nodes', () => {
    const serialized = markdownToLexical('# Heading\n\n- one\n- two\n\n> quote')
    const state = JSON.parse(serialized)
    expect(state.root.children.some(node => node.type === 'heading')).toBe(true)
    expect(state.root.children.some(node => node.type === 'list')).toBe(true)
    expect(state.root.children.some(node => node.type === 'quote')).toBe(true)
  })

  it('converts Markdown pipe tables into native Lexical tables', () => {
    const serialized = markdownToLexical([
      '## 人物设定',
      '',
      '| 项目 | 详情 |',
      '|------|------|',
      '| 年龄 | 30 岁 |',
      '| 武器 | 重剑 |',
      '',
      '后续正文',
    ].join('\n'))

    const state = JSON.parse(serialized)
    const table = state.root.children.find(node => node.type === 'table')

    expect(table).toBeTruthy()
    expect(table.children).toHaveLength(3)
    expect(table.children[0].children).toHaveLength(2)
    expect(textFromState(JSON.stringify({ root: { children: [table] } }))).toContain('项目')
    expect(textFromState(JSON.stringify({ root: { children: [table] } }))).toContain('重剑')
  })

  it('preserves standalone Markdown dividers as native divider blocks', () => {
    const serialized = markdownToLexical([
      '# 标题',
      '',
      '正文',
      '',
      '---',
      '',
      '下一段',
    ].join('\n'))

    const state = JSON.parse(serialized)
    expect(state.root.children.some(node => node.type === 'divider')).toBe(true)
  })

  it('imports block and inline Markdown formulas as native formula nodes', () => {
    const serialized = markdownToLexical([
      '## 公式',
      '',
      '行内公式 $E = mc^2$ 继续正文。',
      '',
      '$$',
      '\\int_0^1 x^2 \\, dx',
      '$$',
    ].join('\n'))

    const state = JSON.parse(serialized)
    const formulas = []

    const visit = node => {
      if (!node) return
      if (node.type === 'formula') formulas.push(node)
      for (const child of node.children || []) visit(child)
    }

    visit(state.root)

    expect(formulas).toHaveLength(2)
    expect(formulas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        expression: 'E = mc^2',
        displayMode: false,
      }),
      expect.objectContaining({
        expression: '\\int_0^1 x^2 \\, dx',
        displayMode: true,
      }),
    ]))
  })

  it('honors parser content type for legacy Word plain text', () => {
    const serialized = JSON.parse(normalizeImportedContent({
      title: 'legacy.doc',
      content: '# literal legacy heading',
      contentType: 'text',
    }))
    expect(serialized.root.children[0].type).toBe('paragraph')
  })

  it('uses plain text conversion only for txt imports', () => {
    const txt = JSON.parse(normalizeImportedContent({ title: 'notes.txt', content: '# literal' }))
    const md = JSON.parse(normalizeImportedContent({ title: 'notes.md', content: '# heading' }))

    expect(txt.root.children[0].type).toBe('paragraph')
    expect(md.root.children[0].type).toBe('heading')
  })
})
