import { describe, expect, it } from 'vitest'
import {
  buildProjectRelationSuggestions,
  getProjectRelationSuggestionSignature,
} from './projectRelationSuggestionUtils'

function wikiContent(...ids) {
  return JSON.stringify({
    root: {
      children: [{
        type: 'paragraph',
        children: ids.map((id, index) => ({
          type: 'wiki-link',
          id,
          title: '实体' + (index + 1),
          sectionPath: [],
        })),
      }],
    },
  })
}

describe('project relationship suggestion utilities', () => {
  const indexes = {
    characters: [
      { id: 'char-1', title: '关关.md' },
      { id: 'char-2', title: '赵三.md' },
    ],
    locations: [
      { id: 'loc-1', title: '青崖镇.md' },
    ],
    foreshadows: [
      { id: 'foreshadow-1', title: '黑铁副印.md' },
    ],
  }

  const workspace = {
    project: { id: 'project', title: '共现项目', type: 'novel' },
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        notes: [
          {
            id: 'c1',
            title: '第一章.md',
            content: wikiContent('char-1', 'loc-1'),
          },
          {
            id: 'c2',
            title: '第二章.md',
            content: wikiContent('char-1', 'loc-1', 'char-2'),
          },
        ],
      },
      {
        id: 'v2',
        title: '第二卷',
        notes: [
          {
            id: 'c3',
            title: '第三章.md',
            content: wikiContent('char-1', 'loc-1'),
          },
          {
            id: 'c4',
            title: '第四章.md',
            content: wikiContent('foreshadow-1'),
          },
        ],
      },
    ],
  }

  it('builds candidate relations only from repeated explicit entity references', () => {
    const result = buildProjectRelationSuggestions(
      workspace,
      indexes,
      {},
      { minChapters: 2 },
    )

    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]).toMatchObject({
      source: expect.objectContaining({
        id: 'index:char-1',
        label: '关关',
        type: 'character',
      }),
      target: expect.objectContaining({
        id: 'index:loc-1',
        label: '青崖镇',
        type: 'location',
      }),
      chapterCount: 3,
      volumeCount: 2,
      coveragePercent: 75,
      repeatedAcrossVolumes: true,
    })
    expect(result.suggestions[0].evidence.map(item => item.chapterId))
      .toEqual(['c1', 'c2', 'c3'])
    expect(result.stats).toMatchObject({
      chapters: 4,
      chaptersWithEntityReferences: 4,
      chaptersWithCooccurrence: 3,
      candidateCount: 1,
      minChapters: 2,
    })
  })

  it('excludes pairs that already have a relationship', () => {
    const result = buildProjectRelationSuggestions(
      workspace,
      indexes,
      {
        relations: [{
          id: 'existing',
          sourceId: 'index:char-1',
          targetId: 'index:loc-1',
          type: 'located',
          directed: true,
        }],
      },
      { minChapters: 2 },
    )

    expect(result.suggestions).toEqual([])
  })

  it('respects ignored candidate signatures without changing the graph', () => {
    const signature = getProjectRelationSuggestionSignature(
      'index:char-1',
      'index:loc-1',
    )
    const result = buildProjectRelationSuggestions(
      workspace,
      indexes,
      {
        relationSuggestionIgnores: [signature],
      },
      { minChapters: 2 },
    )

    expect(result.suggestions).toEqual([])
    expect(result.stats.ignoredCount).toBe(1)
  })

  it('can raise the evidence threshold without treating single co-occurrence as a suggestion', () => {
    const result = buildProjectRelationSuggestions(
      workspace,
      indexes,
      {},
      { minChapters: 4 },
    )

    expect(result.suggestions).toEqual([])
    expect(result.stats.minChapters).toBe(4)
  })

  it('uses a stable order-independent signature for candidate pairs', () => {
    expect(
      getProjectRelationSuggestionSignature(
        'index:char-1',
        'index:loc-1',
      )
    ).toBe(
      getProjectRelationSuggestionSignature(
        'index:loc-1',
        'index:char-1',
      )
    )
  })
})
