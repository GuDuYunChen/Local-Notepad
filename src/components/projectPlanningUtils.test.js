import { describe, expect, it } from 'vitest'
import {
  calculateProjectPlan,
  getNextPlannedChapters,
  getPlanningHealth,
  getProjectPlanningPreset,
  getVolumeMilestonePlan,
  moveChapterQueue,
  normalizeChapterQueue,
  prioritizeChapterQueue,
} from './projectPlanningUtils'

function workspace() {
  return {
    project: { id: 'project', type: 'novel' },
    totalWords: 50000,
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        wordCount: 30000,
        notes: [
          { id: 'a', title: '第一章.md', status: 'done', wordCount: 10000 },
          { id: 'b', title: '第二章.md', status: 'draft', wordCount: 10000 },
          { id: 'c', title: '第三章.md', status: 'review', wordCount: 10000 },
        ],
      },
      {
        id: 'v2',
        title: '第二卷',
        wordCount: 20000,
        notes: [
          { id: 'd', title: '第四章.md', status: 'draft', wordCount: 20000 },
        ],
      },
    ],
  }
}

describe('project planning utilities', () => {
  it('uses distinct novel and script rhythm presets', () => {
    expect(getProjectPlanningPreset('novel')).toMatchObject({
      dailyGoal: 2000,
      weeklyGoal: 12000,
      label: '小说节奏',
    })
    expect(getProjectPlanningPreset('script')).toMatchObject({
      dailyGoal: 1200,
      weeklyGoal: 6000,
      label: '剧本节奏',
    })
  })

  it('calculates required pace and estimated finish date', () => {
    const plan = calculateProjectPlan(
      workspace(),
      {
        targetWords: 100000,
        dailyGoal: 2500,
        deadline: '2026-10-11',
      },
      {
        baselineReady: true,
        averageActiveDay: 3000,
      },
      new Date(2026, 8, 21, 12),
    )

    expect(plan).toMatchObject({
      remainingWords: 50000,
      remainingDays: 20,
      requiredDaily: 2500,
      estimatedDays: 17,
      estimatedDate: '2026-10-08',
      scheduleStatus: 'ahead',
    })
    expect(plan.pace).toMatchObject({
      observedDaily: 3000,
      effectiveDaily: 3000,
      source: 'observed',
    })
  })

  it('marks a project behind when the required pace exceeds current pace', () => {
    const plan = calculateProjectPlan(
      workspace(),
      {
        targetWords: 100000,
        dailyGoal: 1000,
        deadline: '2026-10-01',
      },
      {
        baselineReady: false,
      },
      new Date(2026, 8, 21, 12),
    )

    expect(plan.scheduleStatus).toBe('behind')
    expect(plan.requiredDaily).toBe(5000)
    expect(getPlanningHealth(plan).label).toBe('进度落后')
  })

  it('uses a weekly goal when no daily or observed pace exists', () => {
    const plan = calculateProjectPlan(
      workspace(),
      {
        targetWords: 57000,
        weeklyGoal: 7000,
      },
      {},
      new Date(2026, 8, 21, 12),
    )

    expect(plan.pace).toMatchObject({
      plannedDaily: 0,
      effectiveDaily: 1000,
      source: 'weekly-goal',
    })
    expect(plan.estimatedDays).toBe(7)
    expect(plan.scheduleStatus).toBe('forecast')
  })

  it('builds volume milestones and flags overdue incomplete volumes', () => {
    const milestones = getVolumeMilestonePlan(
      workspace(),
      {
        volumeMilestones: {
          v1: { deadline: '2026-09-20', targetWords: 60000 },
          v2: { deadline: '2026-09-30', targetWords: 20000 },
        },
      },
      new Date(2026, 8, 21, 12),
    )

    expect(milestones[0]).toMatchObject({
      id: 'v1',
      completed: 1,
      total: 3,
      percent: 33,
      overdue: true,
      daysRemaining: -1,
      targetWords: 60000,
      wordPercent: 50,
    })
    expect(milestones[1]).toMatchObject({
      id: 'v2',
      overdue: false,
      daysRemaining: 9,
      targetWords: 20000,
      wordPercent: 100,
    })
  })

  it('normalizes the planning queue around unfinished chapters', () => {
    const queue = normalizeChapterQueue(workspace(), {
      chapterQueue: ['d', 'missing', 'a', 'b'],
    })

    expect(queue.map(item => item.id)).toEqual(['d', 'b', 'c'])
    expect(getNextPlannedChapters(workspace(), {
      chapterQueue: ['d', 'b'],
    }, 2).map(item => item.id)).toEqual(['d', 'b'])
  })

  it('moves and prioritizes chapter queue ids deterministically', () => {
    expect(moveChapterQueue(['b', 'c', 'd'], 'c', 'up')).toEqual([
      'c',
      'b',
      'd',
    ])
    expect(moveChapterQueue(['b', 'c', 'd'], 'c', 'down')).toEqual([
      'b',
      'd',
      'c',
    ])
    expect(prioritizeChapterQueue(['b', 'c', 'd'], 'd')).toEqual([
      'd',
      'b',
      'c',
    ])
  })
})
