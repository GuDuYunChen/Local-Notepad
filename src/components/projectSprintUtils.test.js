import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildWritingCalendar,
  calculateWritingSprint,
  createWritingSprint,
  getBreakReminder,
  getDailyWritingDeltas,
  getTodayQueue,
  getTodayWritingStatus,
  readDailyReview,
  writeDailyReview,
} from './projectSprintUtils'

function workspace(totalWords = 10000) {
  return {
    project: { id: 'project', type: 'novel' },
    totalWords,
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        notes: [
          { id: 'a', title: '第一章.md', status: 'done' },
          { id: 'b', title: '第二章.md', status: 'draft' },
          { id: 'c', title: '第三章.md', status: 'review' },
        ],
      },
      {
        id: 'v2',
        title: '第二卷',
        notes: [
          { id: 'd', title: '第四章.md', status: 'draft' },
        ],
      },
    ],
  }
}

const history = [
  { date: '2026-09-19', totalWords: 10000 },
  { date: '2026-09-20', totalWords: 11200 },
  { date: '2026-09-21', totalWords: 13600 },
]

describe('project sprint utilities', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('derives daily deltas without inventing the baseline day', () => {
    expect(getDailyWritingDeltas(history)).toEqual([
      {
        date: '2026-09-19',
        totalWords: 10000,
        baseline: true,
        delta: 0,
      },
      {
        date: '2026-09-20',
        totalWords: 11200,
        baseline: false,
        delta: 1200,
      },
      {
        date: '2026-09-21',
        totalWords: 13600,
        baseline: false,
        delta: 2400,
      },
    ])
  })

  it('builds a monthly heatmap and daily goal completion', () => {
    const calendar = buildWritingCalendar(
      history,
      2026,
      9,
      2000,
      new Date(2026, 8, 21, 18),
    )

    expect(calendar.leadingDays).toBe(2)
    expect(calendar.activeDays).toBe(2)
    expect(calendar.goalDays).toBe(1)
    expect(calendar.totalDelta).toBe(3600)

    const baseline = calendar.days.find(day => day.date === '2026-09-19')
    const goalDay = calendar.days.find(day => day.date === '2026-09-21')

    expect(baseline).toMatchObject({
      baseline: true,
      delta: 0,
      level: 0,
    })
    expect(goalDay).toMatchObject({
      delta: 2400,
      goalMet: true,
      completion: 120,
      today: true,
    })
  })

  it('reports today progress against the configured goal', () => {
    expect(
      getTodayWritingStatus(
        history,
        2000,
        new Date(2026, 8, 21, 18),
      )
    ).toMatchObject({
      delta: 2400,
      goal: 2000,
      completion: 120,
      remaining: 0,
      met: true,
      baseline: false,
    })
  })

  it('creates and tracks a seven day sprint from current project words', () => {
    const sprint = createWritingSprint(
      workspace(10000),
      7,
      2000,
      new Date(2026, 8, 21, 12),
    )

    expect(sprint).toEqual({
      startDate: '2026-09-21',
      durationDays: 7,
      startWords: 10000,
      goalWords: 14000,
      active: true,
    })

    const progress = calculateWritingSprint(
      sprint,
      workspace(15000),
      new Date(2026, 8, 23, 12),
    )

    expect(progress).toMatchObject({
      active: true,
      durationDays: 7,
      elapsedDays: 3,
      remainingDays: 4,
      gainedWords: 5000,
      goalWords: 14000,
      remainingWords: 9000,
      completion: 36,
      finished: false,
      expired: false,
      endDate: '2026-09-27',
    })
  })

  it('marks an unfinished sprint expired after its end date', () => {
    const sprint = createWritingSprint(
      workspace(10000),
      7,
      2000,
      new Date(2026, 8, 1, 12),
    )

    expect(
      calculateWritingSprint(
        sprint,
        workspace(12000),
        new Date(2026, 8, 10, 12),
      )
    ).toMatchObject({
      expired: true,
      finished: false,
      remainingDays: 0,
    })
  })

  it('reminds after three days without positive writing growth', () => {
    const value = [
      { date: '2026-09-17', totalWords: 10000 },
      { date: '2026-09-18', totalWords: 11000 },
      { date: '2026-09-19', totalWords: 11000 },
    ]

    expect(
      getBreakReminder(
        value,
        new Date(2026, 8, 21, 12),
        3,
      )
    ).toMatchObject({
      shouldRemind: true,
      idleDays: 3,
      lastActiveDate: '2026-09-18',
    })
  })

  it('uses the planning queue for today while excluding completed chapters', () => {
    expect(
      getTodayQueue(
        workspace(),
        {
          chapterQueue: ['d', 'a', 'c'],
        },
        3,
      ).map(note => note.id)
    ).toEqual(['d', 'c', 'b'])
  })

  it('stores and clears daily reviews by date', () => {
    const date = new Date(2026, 8, 21, 12)
    const withReview = writeDailyReview(
      {},
      '完成冲突场，明天处理余波。',
      date,
    )

    expect(readDailyReview(withReview, date)).toBe(
      '完成冲突场，明天处理余波。'
    )

    const cleared = writeDailyReview(withReview, '   ', date)
    expect(readDailyReview(cleared, date)).toBe('')
  })
})
