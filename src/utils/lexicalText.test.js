import { describe, expect, it } from 'vitest'
import { countLexicalCharacters, extractLexicalText } from './lexicalText'

describe('lexicalText', () => {
  it('extracts ordinary, code-block, todo and image text consistently', () => {
    const content = JSON.stringify({
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: '正文' }] },
          { type: 'code-block', code: 'const x = 1;' },
          { type: 'todo', text: '完成任务', checked: false },
          { type: 'image', alt: '图片说明', caption: '图片标题' },
        ],
      },
    })

    const text = extractLexicalText(content)
    expect(text).toContain('正文')
    expect(text).toContain('const x = 1;')
    expect(text).toContain('完成任务')
    expect(text).toContain('图片标题')
  })

  it('falls back to plain text and counts Unicode code points', () => {
    expect(extractLexicalText('plain text')).toBe('plain text')
    expect(countLexicalCharacters(JSON.stringify({
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: '你好A' }] },
        ],
      },
    }))).toBe(3)
  })
})
