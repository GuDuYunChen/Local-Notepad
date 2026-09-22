import { describe, expect, it } from 'vitest'
import {
  buildProjectInsights,
  formatProjectInsightReport,
  getDifficultChapters,
  getInsightPeriodStats,
  getInsightSessionStats,
} from './projectInsightUtils'

function workspace() {
  return {
    project: {
      id: 'project',
      title: '太初宇宙',
      type: 'novel',
    },
    totalWords: 52000,
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        notes: [
          {
            id: 'a',
            title: '第一章.md',
            status: 'done',
            wordCount: 16000,
            updated_at: 1758200000,
          },
          {
            id: 'b',
            title: '第二章.md',
            status: 'draft',
            wordCount: 18000,
            updated_at: 1757800000,
          },
          {
            id: 'c',
            title: '第三章.md',
            status: 'review',
            wordCount: 18000,
            updated_at: 1758600000,
          },
        ],
      },
    ],
  }
}

function analyticsHistory() {
  return [
    { date: '2026-09-15', totalWords: 48000, noteWords: {} },
    { date: '2026-09-16', totalWords: 49000, noteWords: {} },
    { date: '2026-09-17', totalWords: 50000, noteWords: {} },
    { date: '2026-09-18', totalWords: 50000, noteWords: {} },
    { date: '2026-09-19', totalWords: 50500, noteWords: {} },
    { date: '2026-09-20', totalWords: 51000, noteWords: {} },
    { date: '2026-09-21', totalWords: 52000, noteWords: {} },
  ]
}

function session({
  id,
  noteId,
  noteTitle,
  hour,
  elapsedSeconds,
  wordDelta,
  completedTimer = true,
  reviewNote = '',
  day = 21,
}) {
  const startedAt = new Date(2026, 8, day, hour, 0, 0, 0).getTime()
  return {
    id,
    projectId: 'project',
    noteId,
    noteTitle,
    durationMinutes: 50,
    startedAt,
    endedAt: startedAt + elapsedSeconds * 1000,
    elapsedSeconds,
    wordDelta,
    completedTimer,
    reviewNote,
  }
}

function sessions() {
  return [
    session({
      id: 'a1',
      noteId: 'a',
      noteTitle: '第一章.md',
      hour: 8,
      elapsedSeconds: 1800,
      wordDelta: 1000,
      reviewNote: '顺利',
      day: 19,
    }),
    session({
      id: 'a2',
      noteId: 'a',
      noteTitle: '第一章.md',
      hour: 8,
      elapsedSeconds: 1800,
      wordDelta: 900,
      day: 20,
    }),
    session({
      id: 'b1',
      noteId: 'b',
      noteTitle: '第二章.md',
      hour: 20,
      elapsedSeconds: 1800,
      wordDelta: 160,
      completedTimer: false,
      day: 19,
    }),
    session({
      id: 'b2',
      noteId: 'b',
      noteTitle: '第二章.md',
      hour: 20,
      elapsedSeconds: 1800,
      wordDelta: 120,
      completedTimer: false,
      day: 20,
    }),
    session({
      id: 'b3',
      noteId: 'b',
      noteTitle: '第二章.md',
      hour: 20,
      elapsedSeconds: 1800,
      wordDelta: 100,
      completedTimer: false,
      day: 21,
    }),
  ]
}

describe('project insight utilities', () => {
  const now = new Date(2026, 8, 21, 22, 0, 0, 0)

  it('summarizes period output without inventing missing history', () => {
    const stats = getInsightPeriodStats(
      analyticsHistory().slice(-4),
      30,
      now,
      2000,
    )

    expect(stats).toMatchObject({
      days: 30,
      netWords: 2000,
      activeDays: 3,
      goalDays: 0,
      coverageLimited: true,
      firstRecordedDate: '2026-09-18',
    })
    expect(stats.coverageDays).toBe(4)
  })

  it('summarizes effective and all session data separately', () => {
    const tiny = session({
      id: 'tiny',
      noteId: 'c',
      noteTitle: '第三章.md',
      hour: 10,
      elapsedSeconds: 120,
      wordDelta: 500,
      day: 21,
    })
    const stats = getInsightSessionStats(
      [...sessions(), tiny],
      7,
      now,
    )

    expect(stats.allSessionCount).toBe(6)
    expect(stats.effectiveSessionCount).toBe(5)
    expect(stats.totalWordsAll).toBe(2780)
    expect(stats.reviewCoverage).toBe(20)
  })

  it('flags difficult chapters only after repeated effective sessions', () => {
    const difficult = getDifficultChapters(
      sessions(),
      30,
      now,
    )

    expect(difficult[0]).toMatchObject({
      noteId: 'b',
      sessions: 3,
      difficulty: 'high',
    })
    expect(difficult[0].reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('效率低于项目平均'),
        '完整计时率低于 50%',
      ])
    )
    expect(difficult.some(item => item.noteId === 'a')).toBe(false)
  })

  it('builds explainable alerts and next actions from project data', () => {
    const snapshot = buildProjectInsights({
      workspace: workspace(),
      projectMeta: {
        targetWords: 100000,
        dailyGoal: 1000,
        weeklyGoal: 10000,
        deadline: '2026-10-01',
        statuses: {
          a: 'done',
          b: 'draft',
          c: 'review',
        },
        foreshadowStates: {},
      },
      analyticsHistory: analyticsHistory(),
      sessionHistory: sessions(),
      projectIndexes: {
        foreshadows: [
          { id: 'f1', title: '伏笔1.md' },
          { id: 'f2', title: '伏笔2.md' },
          { id: 'f3', title: '伏笔3.md' },
          { id: 'f4', title: '伏笔4.md' },
          { id: 'f5', title: '伏笔5.md' },
        ],
      },
      periodDays: 7,
      now,
    })

    expect(snapshot.plan.scheduleStatus).toBe('behind')
    expect(snapshot.alerts.map(item => item.id)).toEqual(
      expect.arrayContaining([
        'plan-behind',
        'weekly-gap',
        'difficult-chapter',
      ])
    )
    expect(snapshot.recommendations.map(item => item.id)).toEqual(
      expect.arrayContaining([
        'pace',
        'split-hard-chapter',
        'review-coverage',
        'foreshadows',
      ])
    )
  })

  it('generates a report that discloses the observed data window', () => {
    const snapshot = buildProjectInsights({
      workspace: workspace(),
      projectMeta: {
        targetWords: 100000,
        dailyGoal: 1000,
        weeklyGoal: 10000,
        statuses: {
          a: 'done',
          b: 'draft',
          c: 'review',
        },
      },
      analyticsHistory: analyticsHistory().slice(-4),
      sessionHistory: sessions(),
      projectIndexes: { foreshadows: [] },
      periodDays: 30,
      now,
    })

    const report = formatProjectInsightReport(
      snapshot,
      workspace(),
      {
        dailyGoal: 1000,
      },
    )

    expect(report).toContain('# 太初宇宙 · 30 天复盘')
    expect(report).toContain('当前覆盖：4/30 天（历史数据不足，报告按现有数据生成）')
    expect(report).toContain('## 写作产出')
    expect(report).toContain('## 专注 Session')
    expect(report).toContain('## 提醒')
    expect(report).toContain('## 下一阶段建议')
  })
})
