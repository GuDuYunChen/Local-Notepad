import { describe, expect, it } from 'vitest'
import {
  buildProjectEntityIntelligence,
  normalizeProjectEntityAliases,
} from './projectEntityIntelligenceUtils'

function content({ text = '', links = [] } = {}) {
  return JSON.stringify({
    root: {
      children: [{
        type: 'paragraph',
        children: [
          ...(text ? [{ type: 'text', text }] : []),
          ...links.map((id, index) => ({
            type: 'wiki-link',
            id,
            title: '实体' + index,
            sectionPath: [],
          })),
        ],
      }],
    },
  })
}

describe('project entity intelligence', () => {
  const indexes = {
    characters: [
      { id: 'char-1', title: '关关.md' },
      { id: 'char-2', title: '赵三.md' },
    ],
    locations: [
      { id: 'loc-1', title: '青崖镇.md' },
    ],
    foreshadows: [],
  }

  it('normalizes aliases and drops short or duplicate values', () => {
    expect(normalizeProjectEntityAliases({
      'index:char-1': [' 关姑娘 ', '关姑娘', '她', '小关'],
      '': ['无效'],
    })).toEqual({
      'index:char-1': ['关姑娘', '小关'],
    })
  })

  it('combines explicit links canonical names and aliases into entity mention evidence', () => {
    const workspace = {
      project: { id: 'project', title: '实体智能', type: 'novel' },
      volumes: [{
        id: 'v1',
        title: '第一卷',
        notes: [
          {
            id: 'c1',
            title: '第一章.md',
            content: content({
              text: '关姑娘来到青崖镇。',
              links: ['char-2'],
            }),
          },
          {
            id: 'c2',
            title: '第二章.md',
            content: content({
              text: '小关再次回到青崖镇。',
            }),
          },
        ],
      }],
    }

    const model = buildProjectEntityIntelligence(
      workspace,
      indexes,
      {
        entityAliases: {
          'index:char-1': ['关姑娘', '小关'],
        },
      },
      { minChapters: 2 },
    )

    expect(model.entityById.get('index:char-1')).toMatchObject({
      chapterCount: 2,
      aliasChapters: 2,
      mentionCount: 2,
    })
    expect(model.entityById.get('index:loc-1')).toMatchObject({
      chapterCount: 2,
      canonicalChapters: 2,
      mentionCount: 2,
    })
    expect(model.entityById.get('index:char-2')).toMatchObject({
      chapterCount: 1,
      explicitChapters: 1,
    })
    expect(model.stats).toMatchObject({
      chapters: 2,
      activeEntities: 3,
      recognizedWikiReferences: 1,
      plainTextMentions: 2,
      aliasMentions: 2,
      chaptersWithCooccurrence: 2,
    })
  })

  it('assigns confidence tiers from evidence provenance and repetition', () => {
    const workspace = {
      project: { id: 'project', title: '置信度项目', type: 'novel' },
      volumes: [{
        id: 'v1',
        title: '第一卷',
        notes: [
          {
            id: 'c1',
            title: '第一章.md',
            content: content({ links: ['char-1', 'loc-1'] }),
          },
          {
            id: 'c2',
            title: '第二章.md',
            content: content({ links: ['char-1', 'loc-1'] }),
          },
          {
            id: 'c3',
            title: '第三章.md',
            content: content({ text: '关姑娘回到青崖镇。' }),
          },
          {
            id: 'c4',
            title: '第四章.md',
            content: content({ text: '关姑娘仍住在青崖镇。' }),
          },
        ],
      }],
    }

    const high = buildProjectEntityIntelligence(
      workspace,
      indexes,
      {
        entityAliases: {
          'index:char-1': ['关姑娘'],
        },
      },
      { minChapters: 2 },
    )
    const candidate = high.suggestions.find(item => (
      item.signature === 'index:char-1::index:loc-1'
    ))

    expect(candidate).toMatchObject({
      chapterCount: 4,
      confidence: expect.objectContaining({ id: 'high' }),
    })
    expect(candidate.confidenceScore).toBeGreaterThanOrEqual(90)
    expect(candidate.sourceLabels).toEqual(
      expect.arrayContaining(['WikiLink', '别名', '原名'])
    )

    const mediumOnly = buildProjectEntityIntelligence(
      {
        ...workspace,
        volumes: [{
          ...workspace.volumes[0],
          notes: workspace.volumes[0].notes.slice(2),
        }],
      },
      indexes,
      {
        entityAliases: {
          'index:char-1': ['关姑娘'],
        },
      },
      { minChapters: 2, minConfidence: 'medium' },
    )

    expect(mediumOnly.suggestions[0]).toMatchObject({
      confidence: expect.objectContaining({ id: 'medium' }),
      chapterCount: 2,
    })
  })

  it('suppresses ambiguous aliases that collide with another entity identity', () => {
    const workspace = {
      project: { id: 'project', title: '别名冲突', type: 'novel' },
      volumes: [{
        id: 'v1',
        title: '第一卷',
        notes: [
          {
            id: 'c1',
            title: '一.md',
            content: content({ text: '阿三来到青崖镇。' }),
          },
          {
            id: 'c2',
            title: '二.md',
            content: content({ text: '阿三仍在青崖镇。' }),
          },
        ],
      }],
    }

    const model = buildProjectEntityIntelligence(
      workspace,
      indexes,
      {
        entityAliases: {
          'index:char-1': ['阿三'],
          'index:char-2': ['阿三'],
        },
      },
      { minChapters: 2 },
    )

    expect(model.aliasConflicts).toEqual([
      expect.objectContaining({
        alias: '阿三',
        entityIds: expect.arrayContaining([
          'index:char-1',
          'index:char-2',
        ]),
      }),
    ])
    expect(model.stats.aliasConflictCount).toBe(1)
    expect(model.stats.aliasMentions).toBe(0)
    expect(model.suggestions).toEqual([])
  })

  it('excludes existing and ignored pairs from intelligence suggestions', () => {
    const workspace = {
      project: { id: 'project', title: '过滤项目', type: 'novel' },
      volumes: [{
        id: 'v1',
        title: '第一卷',
        notes: [
          { id: 'c1', title: '一.md', content: content({ text: '关关来到青崖镇。' }) },
          { id: 'c2', title: '二.md', content: content({ text: '关关留在青崖镇。' }) },
        ],
      }],
    }

    expect(buildProjectEntityIntelligence(
      workspace,
      indexes,
      {
        relations: [{
          id: 'existing',
          sourceId: 'index:char-1',
          targetId: 'index:loc-1',
          type: 'located',
        }],
      },
      { minChapters: 2 },
    ).suggestions).toEqual([])

    expect(buildProjectEntityIntelligence(
      workspace,
      indexes,
      {
        relationSuggestionIgnores: ['index:char-1::index:loc-1'],
      },
      { minChapters: 2 },
    ).suggestions).toEqual([])
  })
})
