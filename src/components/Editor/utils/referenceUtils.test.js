import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractHeadingReferences,
  findWikiLinkOccurrences,
  formatSectionPath,
  formatWikiReferenceText,
  getRecentReferences,
  rememberReference,
} from './referenceUtils'

const content = JSON.stringify({
  root: {
    children: [
      {
        type: 'heading',
        tag: 'h1',
        children: [{ type: 'text', text: '第一卷' }],
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '参见 ' },
          {
            type: 'wiki-link',
            id: 'target-a',
            title: '设定集',
            sectionPath: ['宗门', '青莲剑宗'],
          },
        ],
      },
      {
        type: 'heading',
        tag: 'h2',
        children: [{ type: 'text', text: '第一章' }],
      },
      {
        type: 'paragraph',
        children: [
          {
            type: 'wiki-link',
            id: 'target-a',
            title: '设定集',
            sectionPath: ['人物', '关关'],
          },
        ],
      },
      {
        type: 'heading',
        tag: 'h3',
        children: [{ type: 'text', text: '第一场' }],
      },
    ],
  },
})

describe('structured reference utilities', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('extracts stable hierarchical heading paths from Lexical content', () => {
    expect(extractHeadingReferences(content)).toEqual([
      { level: 1, text: '第一卷', path: ['第一卷'] },
      { level: 2, text: '第一章', path: ['第一卷', '第一章'] },
      { level: 3, text: '第一场', path: ['第一卷', '第一章', '第一场'] },
    ])
  })

  it('locates the source section and target section for Wiki references', () => {
    expect(findWikiLinkOccurrences(content, 'target-a')).toEqual([
      {
        sourceSectionPath: ['第一卷'],
        targetSectionPath: ['宗门', '青莲剑宗'],
        title: '设定集',
      },
      {
        sourceSectionPath: ['第一卷', '第一章'],
        targetSectionPath: ['人物', '关关'],
        title: '设定集',
      },
    ])
  })

  it('formats readable note and section references', () => {
    expect(formatSectionPath(['第一卷', '第一章'])).toBe('第一卷 › 第一章')
    expect(formatWikiReferenceText('正文', ['第一卷', '第一章']))
      .toBe('[[正文#第一卷 › 第一章]]')
    expect(formatWikiReferenceText('正文')).toBe('[[正文]]')
  })

  it('keeps recent references deduplicated and newest first', () => {
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(300)

    rememberReference({ id: 'a', title: 'A', sectionPath: ['第一章'] })
    rememberReference({ id: 'b', title: 'B', sectionPath: [] })
    rememberReference({ id: 'a', title: 'A', sectionPath: ['第一章'] })

    const recent = getRecentReferences()
    expect(recent).toHaveLength(2)
    expect(recent[0]).toMatchObject({
      id: 'a',
      title: 'A',
      sectionPath: ['第一章'],
      usedAt: 300,
    })
    expect(recent[1]).toMatchObject({ id: 'b', usedAt: 200 })

    nowSpy.mockRestore()
  })
})
