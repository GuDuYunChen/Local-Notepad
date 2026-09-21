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

  it('projects WikiLink labels into readable text', () => {
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: '参见 ' },
              { type: 'wiki-link', id: 'target-id', title: '目标笔记' },
            ],
          },
        ],
      },
    })
    expect(extractLexicalText(content)).toBe('参见 [[目标笔记]]')
  })

  it('projects section-aware WikiLink labels into readable text', () => {
    const content = JSON.stringify({
      root: {
        children: [{
          type: 'paragraph',
          children: [{
            type: 'wiki-link',
            id: 'target-id',
            title: '设定集',
            sectionPath: ['宗门', '青莲剑宗'],
          }],
        }],
      },
    })

    expect(extractLexicalText(content)).toBe('[[设定集#宗门 › 青莲剑宗]]')
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
