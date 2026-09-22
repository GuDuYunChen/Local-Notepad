import { describe, expect, it } from 'vitest'
import {
  buildProjectStoryMap,
  filterProjectStoryMap,
} from './projectStructureUtils'

function workspace() {
  return {
    project: {
      id: 'project',
      title: '长篇小说',
      type: 'novel',
    },
    totalWords: 9000,
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        wordCount: 6000,
        notes: [
          {
            id: 'c1',
            title: '第一章.md',
            status: 'done',
            wordCount: 3000,
            content: JSON.stringify({
              root: {
                children: [{
                  type: 'paragraph',
                  children: [{ type: 'text', text: '开篇正文' }],
                }],
              },
            }),
          },
          {
            id: 'c2',
            title: '第二章.md',
            status: 'review',
            wordCount: 3000,
            content: JSON.stringify({
              root: {
                children: [{
                  type: 'paragraph',
                  children: [{ type: 'text', text: '青崖镇冲突' }],
                }],
              },
            }),
          },
        ],
      },
      {
        id: 'v2',
        title: '第二卷',
        wordCount: 3000,
        notes: [{
          id: 'c3',
          title: '第三章.md',
          status: 'draft',
          wordCount: 3000,
          content: JSON.stringify({
            root: {
              children: [{
                type: 'paragraph',
                children: [{ type: 'text', text: '第三章正文' }],
              }],
            },
          }),
        }],
      },
      {
        id: 'v3',
        title: '第三卷',
        wordCount: 0,
        notes: [],
      },
    ],
  }
}

describe('project story map utilities', () => {
  it('builds a volume and chapter structure map with index coverage', () => {
    const map = buildProjectStoryMap(
      workspace(),
      {
        chapterTargetWords: 3000,
        summaries: {
          c2: '主角在青崖镇面对第一次正面冲突',
        },
        volumeMilestones: {
          v1: { targetWords: 12000 },
          v2: { targetWords: 6000 },
        },
      },
      {
        characters: [{ id: 'c1', title: '第一章.md' }, { id: 'character-note' }],
        locations: [{ id: 'c2', title: '第二章.md' }],
        foreshadows: [{ id: 'c2', title: '第二章.md' }],
      },
    )

    expect(map.totals).toMatchObject({
      volumes: 3,
      chapters: 3,
      words: 9000,
      donePercent: 33,
      manualSummaryCount: 1,
      summaryCoverage: 33,
      taggedChapterCount: 2,
      taggedCoverage: 67,
      chapterTargetWords: 3000,
      targetedVolumeCount: 2,
    })
    expect(map.totals.statusCounts).toEqual({
      draft: 1,
      review: 1,
      done: 1,
    })
    expect(map.volumes[0].chapters[0]).toMatchObject({
      id: 'c1',
      ordinal: 1,
      markers: ['characters'],
      wordBand: 'normal',
    })
    expect(map.volumes[0].chapters[1]).toMatchObject({
      id: 'c2',
      ordinal: 2,
      markers: ['locations', 'foreshadows'],
      hasManualSummary: true,
    })
    expect(map.signals.emptyVolumes).toBe(1)
    expect(map.signals.volumesWithoutTargets).toBe(1)
  })

  it('filters story map chapters without removing their volume lanes', () => {
    const map = buildProjectStoryMap(
      workspace(),
      {
        summaries: {
          c2: '青崖镇冲突升级',
        },
      },
      {
        characters: [{ id: 'c1' }],
        locations: [{ id: 'c2' }],
        foreshadows: [],
      },
    )

    const filtered = filterProjectStoryMap(map, {
      query: '青崖镇',
      status: 'review',
      marker: 'locations',
    })

    expect(filtered.volumes).toHaveLength(3)
    expect(filtered.volumes[0].chapters.map(chapter => chapter.id))
      .toEqual(['c2'])
    expect(filtered.volumes[1].chapters).toHaveLength(0)
    expect(filtered.volumes[2].chapters).toHaveLength(0)
  })
})
