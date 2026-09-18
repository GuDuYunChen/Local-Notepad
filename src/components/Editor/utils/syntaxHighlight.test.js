import { describe, expect, it } from 'vitest'
import { highlightCode } from './syntaxHighlight'

describe('syntaxHighlight', () => {
  it('escapes plaintext without loading a language grammar', async () => {
    const result = await highlightCode('<script>alert("x")</script>', 'plaintext')
    expect(result).toContain('&lt;script&gt;')
    expect(result).not.toContain('<script>')
  })

  it('loads and highlights a language grammar on demand', async () => {
    const result = await highlightCode('const answer = 42;', 'javascript')
    expect(result).toContain('hljs-keyword')
    expect(result).toContain('answer')
  })

  it('supports aliases used by the editor language picker', async () => {
    const result = await highlightCode('<div>Hello</div>', 'markup')
    expect(result).toContain('hljs-tag')
  })

  it('falls back to escaped plaintext for an unknown language', async () => {
    const result = await highlightCode('<unknown>', 'not-a-language')
    expect(result).toBe('&lt;unknown&gt;')
  })
})
