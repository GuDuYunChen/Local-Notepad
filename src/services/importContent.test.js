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
