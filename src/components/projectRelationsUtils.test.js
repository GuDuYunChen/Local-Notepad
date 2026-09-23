import { describe, expect, it } from 'vitest'
import {
  buildProjectRelationGraph,
  buildProjectRelationLayout,
  filterProjectRelationGraph,
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
      },
    ])
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
