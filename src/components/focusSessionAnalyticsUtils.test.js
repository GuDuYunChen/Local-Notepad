import { describe, expect, it } from 'vitest'
import {
  compareFocusDurations,
  getBestWritingTime,
  getChapterSessionEfficiency,
  getSessionEfficiencySummary,
  getSessionReviewStats,
  getSessionTrend,
} from './focusSessionAnalyticsUtils'

function session({
  id,
  noteId,
  noteTitle,
  durationMinutes,
  startedAt,
  endedAt,
  elapsedSeconds,
  wordDelta,
  completedTimer = false,
  reviewNote = '',
}) {
  return {
    id,
    noteId,
    noteTitle,
    durationMinutes,
    startedAt,
    endedAt,
    elapsedSeconds,
    wordDelta,
    completedTimer,
    reviewNote,
  }
}

describe('focus session analytics', () => {
  const base = new Date(2026, 8, 21, 8, 0, 0, 0).getTime()
  const history = [
    session({
      id: 'a1',
      noteId: 'a',
      noteTitle: '第一章.md',
      durationMinutes: 25,
      startedAt: base,
      endedAt: base + 25 * 60 * 1000,
      elapsedSeconds: 1500,
      wordDelta: 750,
      completedTimer: true,
      reviewNote: '上午状态很好。',
    }),
    session({
      id: 'a2',
      noteId: 'a',
      noteTitle: '第一章.md',
      durationMinutes: 50,
      startedAt: base + 2 * 60 * 60 * 1000,
      endedAt: base + 2 * 60 * 60 * 1000 + 3000 * 1000,
      elapsedSeconds: 3000,
      wordDelta: 1200,
      completedTimer: true,
    }),
    session({
      id: 'b1',
      noteId: 'b',
      noteTitle: '第二章.md',
      durationMinutes: 90,
      startedAt: base + 11 * 60 * 60 * 1000,
      endedAt: base + 11 * 60 * 60 * 1000 + 3600 * 1000,
      elapsedSeconds: 3600,
      wordDelta: 900,
      completedTimer: false,
      reviewNote: '晚上容易分心。',
    }),
    session({
      id: 'tiny',
      noteId: 'b',
      noteTitle: '第二章.md',
      durationMinutes: 25,
      startedAt: base + 1000,
      endedAt: base + 121000,
      elapsedSeconds: 120,
      wordDelta: 500,
      completedTimer: false,
    }),
  ]

  it('summarizes words per hour and review coverage excluding tiny sessions', () => {
    expect(getSessionEfficiencySummary(history)).toMatchObject({
      sessionCount: 3,
      productiveSessionCount: 3,
      totalSeconds: 8100,
      totalWords: 2850,
      averageWordsPerHour: 1267,
      bestWordsPerHour: 1800,
      reviewedSessions: 2,
      reviewCoverage: 67,
    })
  })

  it('finds the best time bucket by productive words per hour', () => {
    const result = getBestWritingTime(history)

    expect(result.best).toMatchObject({
      label: '清晨',
      sessions: 1,
      wordsPerHour: 1800,
    })
    expect(result.buckets.map(item => item.label)).toEqual([
      '清晨',
      '上午',
      '晚上',
    ])
  })

  it('compares 25 50 and 90 minute focus modes', () => {
    expect(compareFocusDurations(history)).toEqual([
      {
        durationMinutes: 25,
        sessions: 1,
        totalWords: 750,
        averageWordDelta: 750,
        wordsPerHour: 1800,
        completionRate: 100,
      },
      {
        durationMinutes: 50,
        sessions: 1,
        totalWords: 1200,
        averageWordDelta: 1200,
        wordsPerHour: 1440,
        completionRate: 100,
      },
      {
        durationMinutes: 90,
        sessions: 1,
        totalWords: 900,
        averageWordDelta: 900,
        wordsPerHour: 900,
        completionRate: 0,
      },
    ])
  })

  it('builds fixed-length daily trends with zero-filled days', () => {
    const trend = getSessionTrend(
      history,
      7,
      new Date(2026, 8, 21, 20).getTime(),
    )

    expect(trend).toHaveLength(7)
    expect(trend.at(-1)).toMatchObject({
      date: '2026-09-21',
      sessions: 4,
      words: 3350,
    })
    expect(trend[0].sessions).toBe(0)
  })

  it('ranks chapter efficiency by words per hour', () => {
    const chapters = getChapterSessionEfficiency(history)

    expect(chapters[0]).toMatchObject({
      noteId: 'a',
      sessions: 2,
      words: 1950,
      averageWordDelta: 975,
      wordsPerHour: 1560,
      completionRate: 100,
    })
    expect(chapters[1]).toMatchObject({
      noteId: 'b',
      sessions: 1,
      words: 900,
      wordsPerHour: 900,
    })
  })

  it('summarizes session review coverage and recent reviewed sessions', () => {
    const result = getSessionReviewStats(history)

    expect(result).toMatchObject({
      total: 4,
      reviewed: 2,
      coverage: 50,
    })
    expect(result.recent.map(item => item.id)).toEqual(['b1', 'a1'])
  })
})
