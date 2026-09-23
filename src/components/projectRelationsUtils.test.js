import { describe, expect, it } from 'vitest'
import {
  buildProjectRelationEvolution,
  buildProjectRelationGraph,
  buildProjectRelationLayout,
  filterProjectRelationGraph,
  getProjectRelationEventTypes,
  normalizeProjectRelationEntities,
  normalizeProjectRelations,
} from './projectRelationsUtils'

describe('project relation graph utilities', () => {
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

  it('normalizes custom entities and relation edges safely', () => {
    expect(normalizeProjectRelationEntities([
      {
        id: 'entity-sect',
        label: '青莲剑宗',
        type: 'faction',
        description: '宗门',
      },
      {
        id: 'entity-sect',
        label: '重复',
        type: 'concept',
      },
      {
        id: '',
        label: 'ignored',
      },
    ])).toEqual([
      {
        id: 'entity-sect',
        label: '青莲剑宗',
        type: 'faction',
        description: '宗门',
        noteId: '',
      },
    ])

    expect(normalizeProjectRelations([
      {
        id: 'relation-1',
        sourceId: 'index:char-1',
        targetId: 'entity-sect',
        type: 'belongs',
      },
      {
        id: 'self',
        sourceId: 'entity-sect',
        targetId: 'entity-sect',
        type: 'related',
      },
    ])).toEqual([
      {
        id: 'relation-1',
        sourceId: 'index:char-1',
        targetId: 'entity-sect',
        type: 'belongs',
        directed: true,
        label: '',
        note: '',
        events: [],
      },
    ])
  })

  it('normalizes relationship evolution events and exposes event types', () => {
    expect(getProjectRelationEventTypes().map(item => item.label))
      .toEqual(['建立', '强化', '弱化', '转变', '冲突', '破裂', '修复', '揭示'])

    expect(normalizeProjectRelations([{
      id: 'relation-events',
      sourceId: 'index:char-1',
      targetId: 'index:char-2',
      type: 'ally',
      events: [
        {
          id: 'event-1',
          noteId: 'c1',
          eventType: 'establish',
          relationType: 'ally',
          label: '联手',
          note: '第一次并肩行动',
        },
        {
          id: 'event-2',
          noteId: '',
          eventType: 'break',
        },
      ],
    }])[0].events).toEqual([
      {
        id: 'event-1',
        noteId: 'c1',
        eventType: 'establish',
        relationType: 'ally',
        label: '联手',
        note: '第一次并肩行动',
      },
    ])
  })

  it('builds relationship evolution in manuscript order and tracks current relation state', () => {
    const workspace = {
      project: { id: 'project', title: '关系演化项目', type: 'novel' },
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
    const evolution = buildProjectRelationEvolution(workspace, indexes, {
      relations: [{
        id: 'relation-arc',
        sourceId: 'index:char-1',
        targetId: 'index:char-2',
        type: 'ally',
        directed: false,
        events: [
          {
            id: 'event-3',
            noteId: 'c3',
            eventType: 'repair',
            relationType: 'ally',
            note: '重新并肩',
          },
          {
            id: 'event-1',
            noteId: 'c1',
            eventType: 'establish',
            relationType: 'ally',
            note: '初次合作',
          },
          {
            id: 'event-2',
            noteId: 'c2',
            eventType: 'break',
            relationType: 'rival',
            note: '立场决裂',
          },
          {
            id: 'orphan',
            noteId: 'missing',
            eventType: 'conflict',
            relationType: 'rival',
          },
        ],
      }],
    })

    expect(evolution.relations[0].events.map(event => event.noteId))
      .toEqual(['c1', 'c2', 'c3', 'missing'])
    expect(evolution.relations[0]).toMatchObject({
      currentType: 'ally',
      currentTypeLabel: '同盟',
      typeChanges: 2,
      startOrdinal: 1,
      endOrdinal: 3,
      hasTimeline: true,
    })
    expect(evolution.timeline.map(event => event.eventLabel))
      .toEqual(['建立', '破裂', '修复'])
    expect(evolution.chapterEvents.c2[0]).toMatchObject({
      eventLabel: '破裂',
      resultingType: 'rival',
      resultingTypeLabel: '对立',
    })
    expect(evolution.totals).toMatchObject({
      relations: 1,
      events: 3,
      evolvingRelations: 1,
      typeChangedRelations: 1,
      chaptersWithChanges: 3,
    })
    expect(evolution.signals.orphanEvents).toBe(1)
  })

  it('inherits the last effective relationship type when later events omit a new type', () => {
    const workspace = {
      project: { id: 'project', title: '继承关系项目', type: 'novel' },
      volumes: [{
        id: 'v1',
        title: '第一卷',
        notes: [
          { id: 'c1', title: '第一章.md' },
          { id: 'c2', title: '第二章.md' },
          { id: 'c3', title: '第三章.md' },
        ],
      }],
    }
    const evolution = buildProjectRelationEvolution(workspace, indexes, {
      relations: [{
        id: 'inherit',
        sourceId: 'index:char-1',
        targetId: 'index:char-2',
        type: 'ally',
        events: [
          {
            id: 'e1',
            noteId: 'c1',
            eventType: 'establish',
            relationType: 'ally',
          },
          {
            id: 'e2',
            noteId: 'c2',
            eventType: 'break',
            relationType: 'rival',
          },
          {
            id: 'e3',
            noteId: 'c3',
            eventType: 'conflict',
            relationType: '',
          },
        ],
      }],
    })

    expect(evolution.relations[0].events.map(event => event.resultingType))
      .toEqual(['ally', 'rival', 'rival'])
    expect(evolution.relations[0]).toMatchObject({
      currentType: 'rival',
      currentTypeLabel: '对立',
      typeChanges: 1,
    })
  })

  it('builds graph metrics from indexes custom entities and directed edges', () => {
    const graph = buildProjectRelationGraph(indexes, {
      relationEntities: [
        {
          id: 'entity-sect',
          label: '青莲剑宗',
          type: 'faction',
          description: '宗门势力',
        },
      ],
      relations: [
        {
          id: 'r1',
          sourceId: 'index:char-1',
          targetId: 'entity-sect',
          type: 'belongs',
          directed: true,
        },
        {
          id: 'r2',
          sourceId: 'index:char-1',
          targetId: 'index:loc-1',
          type: 'located',
          directed: true,
        },
        {
          id: 'r3',
          sourceId: 'index:char-2',
          targetId: 'index:char-1',
          type: 'rival',
          directed: false,
        },
        {
          id: 'r4',
          sourceId: 'missing',
          targetId: 'index:char-1',
          type: 'related',
        },
      ],
    })

    expect(graph.totals).toMatchObject({
      nodes: 5,
      edges: 3,
      isolated: 1,
      hubs: 1,
      customEntities: 1,
      crossTypeEdges: 2,
    })
    expect(graph.signals.orphanEdges).toBe(1)
    expect(graph.nodeById.get('index:char-1')).toMatchObject({
      degree: 3,
      outDegree: 3,
    })
    expect(graph.nodeById.get('entity-sect')).toMatchObject({
      inDegree: 1,
      type: 'faction',
    })
  })

  it('filters graph by focus type relation and query while keeping valid edges', () => {
    const graph = buildProjectRelationGraph(indexes, {
      relations: [
        {
          id: 'r1',
          sourceId: 'index:char-1',
          targetId: 'index:loc-1',
          type: 'located',
          directed: true,
        },
        {
          id: 'r2',
          sourceId: 'index:char-2',
          targetId: 'index:char-1',
          type: 'rival',
          directed: false,
        },
      ],
    })

    const focused = filterProjectRelationGraph(graph, {
      focusId: 'index:char-1',
    })
    expect(focused.nodes.map(node => node.id).sort()).toEqual([
      'index:char-1',
      'index:char-2',
      'index:loc-1',
    ])
    expect(focused.edges).toHaveLength(2)

    const locations = filterProjectRelationGraph(graph, {
      entityType: 'location',
    })
    expect(locations.nodes.map(node => node.id)).toEqual(['index:loc-1'])
    expect(locations.edges).toHaveLength(0)

    const query = filterProjectRelationGraph(graph, {
      query: '关关',
    })
    expect(query.nodes.map(node => node.id)).toEqual(['index:char-1'])
  })

  it('creates a deterministic bounded layout for visible nodes', () => {
    const graph = buildProjectRelationGraph(indexes, {})
    const first = buildProjectRelationLayout(graph, 800, 400)
    const second = buildProjectRelationLayout(graph, 800, 400)

    expect(first.nodes.map(node => [node.id, node.x, node.y]))
      .toEqual(second.nodes.map(node => [node.id, node.x, node.y]))
    for (const node of first.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.x).toBeLessThanOrEqual(800)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeLessThanOrEqual(400)
    }
  })
})
