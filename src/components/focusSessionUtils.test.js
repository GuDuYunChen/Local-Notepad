import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendFocusSession,
  createFocusSession,
  finalizeFocusSession,
  formatCountdown,
  formatFocusDuration,
  getFocusSessionElapsedSeconds,
  getFocusSessionRemainingSeconds,
  getTodayFocusSummary,
  readFocusSessionHistory,
  updateFocusSessionReview,
} from './focusSessionUtils'

describe('focus session utilities', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('creates a timed session and calculates elapsed/remaining seconds', () => {
    const session = createFocusSession({
      projectId: 'project',
      noteId: 'chapter-1',
      noteTitle: '第一章.md',
      durationMinutes: 25,
      startWords: 1000,
      startedAt: 100000,
    })

    expect(session).toMatchObject({
      projectId: 'project',
      noteId: 'chapter-1',
      durationMinutes: 25,
      startWords: 1000,
      active: true,
    })
    expect(getFocusSessionElapsedSeconds(session, 160000)).toBe(60)
    expect(getFocusSessionRemainingSeconds(session, 160000)).toBe(1440)
  })

  it('finalizes net session words and timer completion', () => {
    const session = createFocusSession({
      projectId: 'project',
      noteId: 'chapter-1',
      noteTitle: '第一章.md',
      durationMinutes: 25,
      startWords: 1000,
      startedAt: 100000,
    })

    expect(finalizeFocusSession(session, 1650, {
      endedAt: 1600000,
      reason: 'timer',
    })).toMatchObject({
      wordDelta: 650,
      endWords: 1650,
      elapsedSeconds: 1500,
      completedTimer: true,
      reason: 'timer',
    })
  })

  it('persists project session history newest first', () => {
    const first = finalizeFocusSession(
      createFocusSession({
        projectId: 'project',
        noteId: 'a',
        startedAt: 1000,
        startWords: 10,
      }),
      110,
      { endedAt: 2000 },
    )
    const second = finalizeFocusSession(
      createFocusSession({
        projectId: 'project',
        noteId: 'b',
        startedAt: 3000,
        startWords: 20,
      }),
      220,
      { endedAt: 5000 },
    )

    appendFocusSession(first)
    appendFocusSession(second)

    expect(readFocusSessionHistory('project').map(item => item.noteId)).toEqual([
      'b',
      'a',
    ])
  })

  it('updates a saved session review note', () => {
    const record = finalizeFocusSession(
      createFocusSession({
        projectId: 'project',
        noteId: 'chapter-1',
        noteTitle: '第一章.md',
        durationMinutes: 25,
        startWords: 100,
        startedAt: 1000,
      }),
      300,
      { endedAt: 1510000 },
    )

    appendFocusSession(record)
    const updated = updateFocusSessionReview(
      'project',
      record.id,
      '上午状态最好，下次直接从冲突段开始。',
    )

    expect(updated.reviewNote).toBe('上午状态最好，下次直接从冲突段开始。')
    expect(readFocusSessionHistory('project')[0].reviewNote)
      .toBe('上午状态最好，下次直接从冲突段开始。')
  })

  it('summarizes today focus time and word delta', () => {
    const day = new Date(2026, 8, 21, 12).getTime()
    const history = [
      {
        id: '1',
        noteId: 'a',
        endedAt: day + 1000,
        elapsedSeconds: 1500,
        wordDelta: 600,
        completedTimer: true,
      },
      {
        id: '2',
        noteId: 'b',
        endedAt: day + 2000,
        elapsedSeconds: 900,
        wordDelta: -50,
        completedTimer: false,
      },
      {
        id: '3',
        noteId: 'c',
        endedAt: new Date(2026, 8, 20, 12).getTime(),
        elapsedSeconds: 500,
        wordDelta: 100,
        completedTimer: false,
      },
    ]

    expect(getTodayFocusSummary(history, day)).toMatchObject({
      sessionCount: 2,
      totalSeconds: 2400,
      wordDelta: 550,
      completedTimers: 1,
    })
  })

  it('formats focus durations and countdowns', () => {
    expect(formatFocusDuration(1500)).toBe('25 分')
    expect(formatFocusDuration(4200)).toBe('1 小时 10 分')
    expect(formatCountdown(1500)).toBe('25:00')
    expect(formatCountdown(9)).toBe('00:09')
  })
})
