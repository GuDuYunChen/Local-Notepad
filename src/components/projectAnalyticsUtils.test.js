import { beforeEach, describe, expect, it } from 'vitest'
import {
  analyzeChapterLengths,
  findStaleProjectChapters,
  getForeshadowAnalysis,
  getProjectEntityFrequencies,
  getVolumeCompletion,
  getWritingRhythm,
  readProjectAnalyticsHistory,
  recordProjectAnalyticsSnapshot,
} from './projectAnalyticsUtils'

function lexical(text) {
  return JSON.stringify({
    root: {
      children: [{
        type: 'paragraph',
        children: [{ type: 'text', text }],
      }],
    },
  })
}

function workspace() {
  return {
    project: { id: 'project', type: 'novel' },
    totalWords: 6000,
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        wordCount: 4000,
        notes: [
          { id: 'a', title: '第一章.md', wordCount: 1000, updated_at: 1000, status: 'done', content: lexical('关关来到青崖镇。关关观察米铺。') },
          { id: 'b', title: '第二章.md', wordCount: 3000, updated_at: 2000, status: 'draft', content: lexical('青崖镇发生冲突。') },
        ],
      },
      {
        id: 'v2',
        title: '第二卷',
        wordCount: 2000,
        notes: [
          { id: 'c', title: '第三章.md', wordCount: 2000, updated_at: 3000, status: 'review', content: lexical('关关离开青崖镇。') },
        ],
      },
    ],
  }
}

describe('project analytics', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('records one snapshot per day and derives writing rhythm', () => {
    const first = workspace()
    recordProjectAnalyticsSnapshot('project', first, new Date(2026, 8, 19, 12))

    const second = { ...first, totalWords: 6800 }
    recordProjectAnalyticsSnapshot('project', second, new Date(2026, 8, 20, 12))

    const third = { ...first, totalWords: 7600 }
    const history = recordProjectAnalyticsSnapshot('project', third, new Date(2026, 8, 21, 12))

    expect(readProjectAnalyticsHistory('project')).toHaveLength(3)
    expect(getWritingRhythm(history, new Date(2026, 8, 21, 18))).toMatchObject({
      baselineReady: true,
      dailyDelta: 800,
      weeklyDelta: 1600,
      activeDays: 2,
      averageActiveDay: 800,
      streak: 2,
    })
  })

  it('replaces the same-day snapshot instead of duplicating it', () => {
    const first = workspace()
    recordProjectAnalyticsSnapshot('project', first, new Date(2026, 8, 21, 9))
    recordProjectAnalyticsSnapshot('project', { ...first, totalWords: 7000 }, new Date(2026, 8, 21, 18))

    const history = readProjectAnalyticsHistory('project')
    expect(history).toHaveLength(1)
    expect(history[0].totalWords).toBe(7000)
  })

  it('flags chapter lengths around a configured target', () => {
    const result = analyzeChapterLengths(workspace(), {
      projectType: 'novel',
      targetWords: 2000,
    })

    expect(result.medianWords).toBe(2000)
    expect(result.averageWords).toBe(2000)
    expect(result.alerts).toEqual([
      expect.objectContaining({ id: 'a', type: 'short' }),
    ])
  })

  it('finds stale unfinished chapters while excluding completed chapters', () => {
    const now = 30 * 86400
    const value = workspace()
    value.volumes[0].notes[0].updated_at = 1
    value.volumes[0].notes[1].updated_at = 5 * 86400
    value.volumes[1].notes[0].updated_at = 20 * 86400

    const stale = findStaleProjectChapters(
      value,
      { statuses: { a: 'done', b: 'draft', c: 'review' } },
      now,
      14,
    )

    expect(stale.map(item => item.id)).toEqual(['b'])
    expect(stale[0].idleDays).toBe(25)
  })

  it('calculates volume completion', () => {
    expect(getVolumeCompletion(workspace())).toEqual([
      expect.objectContaining({ id: 'v1', completed: 1, total: 2, percent: 50 }),
      expect.objectContaining({ id: 'v2', completed: 0, total: 1, percent: 0 }),
    ])
  })

  it('counts character and location mentions across manuscript text', () => {
    const frequencies = getProjectEntityFrequencies(workspace(), {
      characters: [{ id: 'char', title: '关关.md' }],
      locations: [{ id: 'loc', title: '青崖镇.md' }],
    })

    expect(frequencies.characters[0].count).toBe(3)
    expect(frequencies.locations[0].count).toBe(3)
  })

  it('tracks open and recovered foreshadows from project meta', () => {
    const result = getForeshadowAnalysis({
      foreshadows: [
        { id: 'f1', title: '剑鞘伏笔.md' },
        { id: 'f2', title: '旧炭车伏笔.md' },
      ],
    }, {
      foreshadowStates: {
        f2: 'recovered',
      },
    })

    expect(result.open).toBe(1)
    expect(result.recovered).toBe(1)
    expect(result.items.find(item => item.id === 'f2').state).toBe('recovered')
  })
})
