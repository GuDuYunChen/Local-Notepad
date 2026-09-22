import { describe, expect, it } from 'vitest'
import {
  buildProjectStorylineModel,
  getProjectStorylineStages,
  getProjectStorylineSuggestions,
  normalizeProjectStorylines,
} from './projectStorylineUtils'

function workspace() {
  return {
    project: { id: 'project', title: '长篇小说', type: 'novel' },
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        notes: [
          { id: 'c1', title: '第一章.md' },
          { id: 'c2', title: '第二章.md' },
        ],
      },
      {
        id: 'v2',
        title: '第二卷',
        notes: [
          { id: 'c3', title: '第三章.md' },
        ],
      },
    ],
  }
}

describe('project storyline utilities', () => {
  it('normalizes tracks events types and invalid stages', () => {
    expect(normalizeProjectStorylines([
      {
        id: 'track-1',
        title: '主线',
        type: 'plot',
        events: [
          {
            id: 'event-1',
            noteId: 'c1',
            stage: 'turn',
            note: '第一次转折',
          },
          {
            id: 'event-1',
            noteId: 'c2',
            stage: 'invalid',
          },
        ],
      },
      {
        id: '',
        title: 'ignored',
      },
    ])).toEqual([
      {
        id: 'track-1',
        title: '主线',
        type: 'plot',
        description: '',
        sourceNoteId: '',
        events: [{
          id: 'event-1',
          noteId: 'c1',
          stage: 'turn',
          note: '第一次转折',
        }],
      },
    ])
  })

  it('builds lifecycle tracks in manuscript order and maps them back to chapters', () => {
    const model = buildProjectStorylineModel(workspace(), {
      foreshadowStates: {
        'foreshadow-note': 'recovered',
      },
      storylines: [
        {
          id: 'plot-1',
          title: '调查主线',
          type: 'plot',
          events: [
            { id: 'p2', noteId: 'c3', stage: 'climax', note: '' },
            { id: 'p1', noteId: 'c1', stage: 'setup', note: '' },
            { id: 'p3', noteId: 'c2', stage: 'turn', note: '' },
          ],
        },
        {
          id: 'char-1',
          title: '关关弧光',
          type: 'character',
          events: [
            { id: 'c1-event', noteId: 'c1', stage: 'entry', note: '' },
            { id: 'c2-event', noteId: 'c2', stage: 'complete', note: '' },
          ],
        },
        {
          id: 'foreshadow-1',
          title: '黑铁副印',
          type: 'foreshadow',
          sourceNoteId: 'foreshadow-note',
          events: [
            { id: 'f1', noteId: 'c1', stage: 'plant', note: '' },
          ],
        },
      ],
    })

    expect(model.tracks[0].events.map(event => event.noteId))
      .toEqual(['c1', 'c2', 'c3'])
    expect(model.tracks[0].status).toBe('active')
    expect(model.tracks[1].status).toBe('resolved')
    expect(model.tracks[2].status).toBe('resolved')
    expect(model.tracks[2].legacyRecovered).toBe(true)
    expect(model.chapterEvents.c1.map(item => item.trackId))
      .toEqual(['plot-1', 'char-1', 'foreshadow-1'])
    expect(model.totals).toMatchObject({
      tracks: 3,
      events: 6,
      active: 1,
      resolved: 2,
      byType: {
        plot: 1,
        character: 1,
        foreshadow: 1,
      },
    })
    expect(model.signals.unresolvedForeshadows).toBe(0)
  })

  it('reports unresolved lifecycle and orphan event signals', () => {
    const model = buildProjectStorylineModel(workspace(), {
      storylines: [
        {
          id: 'f',
          title: '未回收伏笔',
          type: 'foreshadow',
          events: [
            { id: 'f1', noteId: 'c1', stage: 'plant', note: '' },
          ],
        },
        {
          id: 'empty',
          title: '空人物弧',
          type: 'character',
          events: [],
        },
        {
          id: 'orphan',
          title: '孤立主线',
          type: 'plot',
          events: [
            { id: 'o1', noteId: 'missing', stage: 'advance', note: '' },
          ],
        },
      ],
    })

    expect(model.signals).toEqual({
      unresolvedForeshadows: 1,
      emptyTracks: 1,
      singlePointTracks: 2,
      orphanEvents: 1,
    })
  })

  it('offers unused character and foreshadow index suggestions', () => {
    expect(getProjectStorylineSuggestions(
      {
        characters: [
          { id: 'character-1', title: '关关.md' },
          { id: 'character-2', title: '赵三.md' },
        ],
        foreshadows: [
          { id: 'foreshadow-1', title: '副印.md' },
        ],
      },
      [{
        id: 'track',
        title: '关关',
        type: 'character',
        sourceNoteId: 'character-1',
        events: [],
      }],
      'character',
    )).toEqual([
      { id: 'character-2', title: '赵三.md' },
    ])
    expect(getProjectStorylineStages('foreshadow').map(item => item.label))
      .toEqual(['埋设', '强化', '误导', '揭示', '回收'])
  })
})
