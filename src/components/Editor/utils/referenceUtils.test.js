import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyzeWikiReferenceHealth,
  diagnoseLibraryReferences,
  extractHeadingReferences,
  findWikiLinkOccurrences,
  formatSectionPath,
  formatWikiReferenceText,
  getRecentReferences,
  planTargetReferenceRefactor,
  planDeleteReferenceImpact,
  hasHeadingStructureChanged,
  inferHeadingRenameMappings,
  getHeadingStructureSignature,
  rememberReference,
  repairWikiReferences,
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

  it('detects stale titles, moved sections, and broken targets', () => {
    const source = JSON.stringify({
      root: {
        children: [
          {
            type: 'wiki-link',
            id: 'target-a',
            title: '旧标题',
            sectionPath: ['旧层级', '青莲剑宗'],
          },
          {
            type: 'wiki-link',
            id: 'missing-target',
            title: '已删除目标',
            sectionPath: [],
          },
        ],
      },
    })

    const targets = new Map([
      ['target-a', {
        id: 'target-a',
        title: '新标题',
        content: JSON.stringify({
          root: {
            children: [
              {
                type: 'heading',
                tag: 'h1',
                children: [{ type: 'text', text: '世界观' }],
              },
              {
                type: 'heading',
                tag: 'h2',
                children: [{ type: 'text', text: '青莲剑宗' }],
              },
            ],
          },
        }),
      }],
      ['missing-target', null],
    ])

    const health = analyzeWikiReferenceHealth(source, targets)
    expect(health[0]).toMatchObject({
      status: 'repairable',
      repairable: true,
      issues: ['title-stale', 'section-moved'],
      suggestedSectionPath: ['世界观', '青莲剑宗'],
    })
    expect(health[1]).toMatchObject({
      status: 'broken',
      repairable: false,
      issues: ['target-missing'],
    })
  })

  it('repairs only unambiguous references and preserves unresolved ones', () => {
    const source = JSON.stringify({
      root: {
        children: [
          {
            type: 'wiki-link',
            id: 'target-a',
            title: '旧标题',
            sectionPath: ['旧层级', '青莲剑宗'],
          },
          {
            type: 'wiki-link',
            id: 'target-b',
            title: 'B',
            sectionPath: ['旧层级', '第一场'],
          },
        ],
      },
    })

    const targets = new Map([
      ['target-a', {
        id: 'target-a',
        title: '新标题',
        content: JSON.stringify({
          root: {
            children: [
              {
                type: 'heading',
                tag: 'h1',
                children: [{ type: 'text', text: '世界观' }],
              },
              {
                type: 'heading',
                tag: 'h2',
                children: [{ type: 'text', text: '青莲剑宗' }],
              },
            ],
          },
        }),
      }],
      ['target-b', {
        id: 'target-b',
        title: 'B',
        content: JSON.stringify({
          root: {
            children: [
              {
                type: 'heading',
                tag: 'h1',
                children: [{ type: 'text', text: '上篇' }],
              },
              {
                type: 'heading',
                tag: 'h2',
                children: [{ type: 'text', text: '第一场' }],
              },
              {
                type: 'heading',
                tag: 'h1',
                children: [{ type: 'text', text: '下篇' }],
              },
              {
                type: 'heading',
                tag: 'h2',
                children: [{ type: 'text', text: '第一场' }],
              },
            ],
          },
        }),
      }],
    ])

    const repaired = repairWikiReferences(source, targets)
    expect(repaired).toMatchObject({
      changed: true,
      repairedCount: 1,
      unresolvedCount: 1,
    })

    const state = JSON.parse(repaired.content)
    expect(state.root.children[0]).toMatchObject({
      title: '新标题',
      sectionPath: ['世界观', '青莲剑宗'],
    })
    expect(state.root.children[1]).toMatchObject({
      title: 'B',
      sectionPath: ['旧层级', '第一场'],
    })
  })

  it('builds a full-library diagnosis and safe repair preview', () => {
    const files = [
      {
        id: 'source',
        title: '正文',
        content: JSON.stringify({
          root: {
            children: [
              {
                type: 'wiki-link',
                id: 'target',
                title: '旧标题',
                sectionPath: ['旧目录', '青莲剑宗'],
              },
              {
                type: 'wiki-link',
                id: 'missing',
                title: '失效目标',
                sectionPath: [],
              },
            ],
          },
        }),
      },
      {
        id: 'target',
        title: '新标题',
        content: JSON.stringify({
          root: {
            children: [
              {
                type: 'heading',
                tag: 'h1',
                children: [{ type: 'text', text: '世界观' }],
              },
              {
                type: 'heading',
                tag: 'h2',
                children: [{ type: 'text', text: '青莲剑宗' }],
              },
            ],
          },
        }),
      },
    ]

    const diagnosis = diagnoseLibraryReferences(files)

    expect(diagnosis.summary).toMatchObject({
      scannedNotes: 2,
      linkedNotes: 1,
      totalReferences: 2,
      repairable: 1,
      broken: 1,
      affectedFiles: 1,
      repairableFiles: 1,
    })

    expect(diagnosis.sources).toHaveLength(1)
    expect(diagnosis.sources[0]).toMatchObject({
      id: 'source',
      repairable: 1,
      broken: 1,
      repairedCount: 1,
      unresolvedCount: 1,
    })
    expect(diagnosis.sources[0].changes).toEqual([
      expect.objectContaining({
        before: '[[旧标题#旧目录 › 青莲剑宗]]',
        after: '[[新标题#世界观 › 青莲剑宗]]',
      }),
    ])
    expect(diagnosis.sources[0].repairContent).toContain('"title":"新标题"')
  })

  it('detects heading structure changes without treating body edits as structural', () => {
    const before = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '第一卷' }],
          },
          {
            type: 'paragraph',
            children: [{ type: 'text', text: '正文 A' }],
          },
        ],
      },
    })
    const bodyOnly = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '第一卷' }],
          },
          {
            type: 'paragraph',
            children: [{ type: 'text', text: '正文 B' }],
          },
        ],
      },
    })
    const renamedHeading = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '第二卷' }],
          },
          {
            type: 'paragraph',
            children: [{ type: 'text', text: '正文 B' }],
          },
        ],
      },
    })

    expect(getHeadingStructureSignature(before)).toBe(
      getHeadingStructureSignature(bodyOnly)
    )
    expect(hasHeadingStructureChanged(before, bodyOnly)).toBe(false)
    expect(hasHeadingStructureChanged(before, renamedHeading)).toBe(true)
  })

  it('infers a single heading rename and migrates descendant paths', () => {
    const before = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '第一卷' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '第一章' }],
          },
          {
            type: 'heading',
            tag: 'h3',
            children: [{ type: 'text', text: '第一场' }],
          },
        ],
      },
    })
    const after = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '上卷' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '第一章' }],
          },
          {
            type: 'heading',
            tag: 'h3',
            children: [{ type: 'text', text: '第一场' }],
          },
        ],
      },
    })

    expect(inferHeadingRenameMappings(before, after)).toEqual([
      { before: ['第一卷'], after: ['上卷'] },
      { before: ['第一卷', '第一章'], after: ['上卷', '第一章'] },
      {
        before: ['第一卷', '第一章', '第一场'],
        after: ['上卷', '第一章', '第一场'],
      },
    ])
  })

  it('does not infer rename mappings when multiple heading texts change', () => {
    const before = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '第一卷' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '第一章' }],
          },
        ],
      },
    })
    const after = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '上卷' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '开篇' }],
          },
        ],
      },
    })

    expect(inferHeadingRenameMappings(before, after)).toEqual([])
  })

  it('plans title propagation and moved-section repairs before a refactor', () => {
    const sourceContent = JSON.stringify({
      root: {
        children: [{
          type: 'wiki-link',
          id: 'target',
          title: '旧标题',
          sectionPath: ['旧层级', '青莲剑宗'],
        }],
      },
    })
    const oldTargetContent = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '旧层级' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '青莲剑宗' }],
          },
        ],
      },
    })
    const nextTargetContent = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '世界观' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '青莲剑宗' }],
          },
        ],
      },
    })

    const plan = planTargetReferenceRefactor([
      { id: 'source', title: '正文', content: sourceContent },
      { id: 'target', title: '旧标题', content: oldTargetContent },
    ], 'target', {
      title: '新标题',
      content: nextTargetContent,
    })

    expect(plan.summary).toMatchObject({
      incomingReferences: 1,
      affectedFiles: 1,
      repairable: 1,
      broken: 0,
      repairableFiles: 1,
    })
    expect(plan.sources[0].changes[0]).toMatchObject({
      before: '[[旧标题#旧层级 › 青莲剑宗]]',
      after: '[[新标题#世界观 › 青莲剑宗]]',
      issues: ['title-stale', 'section-moved'],
    })
  })

  it('reports incoming references before deleting notes or folders', () => {
    const source = {
      id: 'source',
      title: '正文',
      content: JSON.stringify({
        root: {
          children: [
            {
              type: 'wiki-link',
              id: 'target-a',
              title: 'A',
              sectionPath: [],
            },
            {
              type: 'wiki-link',
              id: 'target-b',
              title: 'B',
              sectionPath: ['第一章'],
            },
          ],
        },
      }),
    }

    const plan = planDeleteReferenceImpact([
      source,
      { id: 'target-a', title: 'A', content: '' },
      { id: 'target-b', title: 'B', content: '' },
    ], ['target-a', 'target-b'])

    expect(plan.summary).toEqual({
      incomingReferences: 2,
      affectedFiles: 1,
      targetCount: 2,
    })
    expect(plan.sources[0].references).toHaveLength(2)
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
