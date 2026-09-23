const ENTITY_TYPES = [
  { id: 'character', label: '人物' },
  { id: 'location', label: '地点' },
  { id: 'foreshadow', label: '伏笔' },
  { id: 'faction', label: '势力' },
  { id: 'object', label: '器物' },
  { id: 'concept', label: '概念' },
]

const RELATION_TYPES = [
  { id: 'related', label: '关联', directed: false },
  { id: 'ally', label: '同盟', directed: false },
  { id: 'rival', label: '对立', directed: false },
  { id: 'family', label: '亲缘', directed: false },
  { id: 'mentor', label: '师承', directed: true },
  { id: 'belongs', label: '隶属', directed: true },
  { id: 'located', label: '位于', directed: true },
  { id: 'owns', label: '持有', directed: true },
  { id: 'clue', label: '线索指向', directed: true },
  { id: 'involved', label: '卷入', directed: true },
]

const RELATION_EVENT_TYPES = [
  { id: 'establish', label: '建立' },
  { id: 'strengthen', label: '强化' },
  { id: 'weaken', label: '弱化' },
  { id: 'transform', label: '转变' },
  { id: 'conflict', label: '冲突' },
  { id: 'break', label: '破裂' },
  { id: 'repair', label: '修复' },
  { id: 'reveal', label: '揭示' },
]

function normalizeId(value) {
  return String(value || '').trim()
}

function stripExtension(value) {
  return String(value || '未命名').replace(/\.[^.]+$/, '')
}

function normalizeEntityType(value) {
  return ENTITY_TYPES.some(item => item.id === value)
    ? value
    : 'concept'
}

function normalizeRelationType(value) {
  return RELATION_TYPES.some(item => item.id === value)
    ? value
    : 'related'
}

export function getProjectRelationEntityTypes() {
  return ENTITY_TYPES.map(item => ({ ...item }))
}

export function getProjectRelationTypes() {
  return RELATION_TYPES.map(item => ({ ...item }))
}

export function getProjectRelationEventTypes() {
  return RELATION_EVENT_TYPES.map(item => ({ ...item }))
}

export function normalizeProjectRelationEntities(value) {
  if (!Array.isArray(value)) return []

  const seen = new Set()
  const result = []
  for (const raw of value) {
    const id = normalizeId(raw?.id)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const label = String(raw?.label || '').trim()
    if (!label) continue

    result.push({
      id,
      label,
      type: normalizeEntityType(raw?.type),
      description: String(raw?.description || '').trim(),
      noteId: normalizeId(raw?.noteId),
    })
  }
  return result
}

export function normalizeProjectRelationEvents(value) {
  if (!Array.isArray(value)) return []

  const seen = new Set()
  const result = []
  for (const raw of value) {
    const id = normalizeId(raw?.id)
    const noteId = normalizeId(raw?.noteId)
    if (!id || !noteId || seen.has(id)) continue
    seen.add(id)

    const eventType = RELATION_EVENT_TYPES.some(item => item.id === raw?.eventType)
      ? raw.eventType
      : 'transform'
    const relationType = raw?.relationType &&
      RELATION_TYPES.some(item => item.id === raw.relationType)
      ? raw.relationType
      : ''

    result.push({
      id,
      noteId,
      eventType,
      relationType,
      label: String(raw?.label || '').trim(),
      note: String(raw?.note || '').trim(),
      events: normalizeProjectRelationEvents(raw?.events),
    })
  }
  return result
}

export function normalizeProjectRelations(value) {
  if (!Array.isArray(value)) return []

  const seen = new Set()
  const result = []
  for (const raw of value) {
    const id = normalizeId(raw?.id)
    const sourceId = normalizeId(raw?.sourceId)
    const targetId = normalizeId(raw?.targetId)
    if (
      !id ||
      !sourceId ||
      !targetId ||
      sourceId === targetId ||
      seen.has(id)
    ) {
      continue
    }
    seen.add(id)

    const type = normalizeRelationType(raw?.type)
    const relationType = RELATION_TYPES.find(item => item.id === type)
    result.push({
      id,
      sourceId,
      targetId,
      type,
      directed: typeof raw?.directed === 'boolean'
        ? raw.directed
        : Boolean(relationType?.directed),
      label: String(raw?.label || '').trim(),
      note: String(raw?.note || '').trim(),
    })
  }
  return result
}

function indexNodes(projectIndexes = {}) {
  const configs = [
    ['characters', 'character'],
    ['locations', 'location'],
    ['foreshadows', 'foreshadow'],
  ]
  const result = []
  const seen = new Set()

  for (const [key, type] of configs) {
    for (const item of Array.isArray(projectIndexes?.[key])
      ? projectIndexes[key]
      : []) {
      const noteId = normalizeId(item?.id)
      if (!noteId) continue
      const id = 'index:' + noteId
      if (seen.has(id)) continue
      seen.add(id)
      result.push({
        id,
        noteId,
        label: stripExtension(item?.title),
        type,
        description: '',
        source: 'index',
      })
    }
  }
  return result
}

function connectedComponents(nodes, edges) {
  const adjacency = new Map(nodes.map(node => [node.id, new Set()]))
  for (const edge of edges) {
    adjacency.get(edge.sourceId)?.add(edge.targetId)
    adjacency.get(edge.targetId)?.add(edge.sourceId)
  }

  const seen = new Set()
  const components = []
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    const stack = [node.id]
    const ids = []
    seen.add(node.id)
    while (stack.length) {
      const id = stack.pop()
      ids.push(id)
      for (const neighbor of adjacency.get(id) || []) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        stack.push(neighbor)
      }
    }
    components.push(ids)
  }
  return components
}

export function buildProjectRelationGraph(projectIndexes = {}, projectMeta = {}) {
  const baseNodes = indexNodes(projectIndexes)
  const customNodes = normalizeProjectRelationEntities(
    projectMeta?.relationEntities,
  ).map(entity => ({
    ...entity,
    source: 'custom',
  }))

  const nodes = []
  const nodeById = new Map()
  for (const node of [...baseNodes, ...customNodes]) {
    if (nodeById.has(node.id)) continue
    const normalized = {
      ...node,
      degree: 0,
      inDegree: 0,
      outDegree: 0,
    }
    nodes.push(normalized)
    nodeById.set(normalized.id, normalized)
  }

  const rawRelations = normalizeProjectRelations(projectMeta?.relations)
  const edges = []
  let orphanEdges = 0
  const signatureSeen = new Set()
  let duplicateEdges = 0

  for (const relation of rawRelations) {
    const source = nodeById.get(relation.sourceId)
    const target = nodeById.get(relation.targetId)
    if (!source || !target) {
      orphanEdges += 1
      continue
    }

    const signature = [
      relation.sourceId,
      relation.targetId,
      relation.type,
      relation.directed ? '1' : '0',
    ].join('|')
    const reverseSignature = [
      relation.targetId,
      relation.sourceId,
      relation.type,
      relation.directed ? '1' : '0',
    ].join('|')
    if (
      signatureSeen.has(signature) ||
      (!relation.directed && signatureSeen.has(reverseSignature))
    ) {
      duplicateEdges += 1
    }
    signatureSeen.add(signature)

    edges.push({
      ...relation,
      source,
      target,
      typeLabel: RELATION_TYPES.find(item => item.id === relation.type)?.label ||
        '关联',
      eventCount: relation.events.length,
    })
    source.degree += 1
    target.degree += 1
    source.outDegree += 1
    target.inDegree += 1
    if (!relation.directed) {
      source.inDegree += 1
      target.outDegree += 1
    }
  }

  const components = connectedComponents(nodes, edges)
  const typeCounts = Object.fromEntries(
    ENTITY_TYPES.map(item => [
      item.id,
      nodes.filter(node => node.type === item.id).length,
    ])
  )
  const relationTypeCounts = Object.fromEntries(
    RELATION_TYPES.map(item => [
      item.id,
      edges.filter(edge => edge.type === item.id).length,
    ])
  )

  return {
    nodes,
    edges,
    nodeById,
    components,
    totals: {
      nodes: nodes.length,
      edges: edges.length,
      isolated: nodes.filter(node => node.degree === 0).length,
      hubs: nodes.filter(node => node.degree >= 3).length,
      components: components.length,
      crossTypeEdges: edges.filter(edge => edge.source.type !== edge.target.type).length,
      customEntities: customNodes.length,
      typeCounts,
      relationTypeCounts,
    },
    signals: {
      orphanEdges,
      duplicateEdges,
      isolatedNodes: nodes.filter(node => node.degree === 0).map(node => node.id),
    },
  }
}

export function filterProjectRelationGraph(graph, filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase()
  const entityType = ENTITY_TYPES.some(item => item.id === filters.entityType)
    ? filters.entityType
    : 'all'
  const relationType = RELATION_TYPES.some(item => item.id === filters.relationType)
    ? filters.relationType
    : 'all'
  const focusId = normalizeId(filters.focusId)

  let allowedIds = new Set((graph?.nodes || []).map(node => node.id))
  if (focusId && graph?.nodeById?.has(focusId)) {
    allowedIds = new Set([focusId])
    for (const edge of graph.edges || []) {
      if (edge.sourceId === focusId) allowedIds.add(edge.targetId)
      if (edge.targetId === focusId) allowedIds.add(edge.sourceId)
    }
  }

  const nodes = (graph?.nodes || []).filter(node => {
    if (!allowedIds.has(node.id)) return false
    if (entityType !== 'all' && node.type !== entityType) return false
    if (!query) return true
    return [
      node.label,
      node.description,
    ].join(' ').toLocaleLowerCase().includes(query)
  })
  const nodeIds = new Set(nodes.map(node => node.id))
  const edges = (graph?.edges || []).filter(edge => (
    nodeIds.has(edge.sourceId) &&
    nodeIds.has(edge.targetId) &&
    (relationType === 'all' || edge.type === relationType)
  ))

  return {
    ...graph,
    nodes,
    edges,
  }
}

export function buildProjectRelationLayout(graph, width = 960, height = 520) {
  const nodes = graph?.nodes || []
  const safeWidth = Math.max(320, Number(width) || 960)
  const safeHeight = Math.max(280, Number(height) || 520)
  const centerX = safeWidth / 2
  const centerY = safeHeight / 2
  const radiusX = Math.max(90, safeWidth * 0.36)
  const radiusY = Math.max(80, safeHeight * 0.34)
  const typeOrder = new Map(
    ENTITY_TYPES.map((item, index) => [item.id, index])
  )

  const sorted = [...nodes].sort((a, b) => (
    (typeOrder.get(a.type) ?? 99) - (typeOrder.get(b.type) ?? 99) ||
    b.degree - a.degree ||
    a.label.localeCompare(b.label)
  ))

  const positioned = sorted.map((node, index) => {
    if (sorted.length === 1) {
      return { ...node, x: centerX, y: centerY }
    }
    const angle = ((Math.PI * 2) / sorted.length) * index - Math.PI / 2
    const degreePull = Math.min(0.24, node.degree * 0.035)
    return {
      ...node,
      x: centerX + Math.cos(angle) * radiusX * (1 - degreePull),
      y: centerY + Math.sin(angle) * radiusY * (1 - degreePull),
    }
  })

  return {
    width: safeWidth,
    height: safeHeight,
    nodes: positioned,
    nodeById: new Map(positioned.map(node => [node.id, node])),
    edges: (graph?.edges || []).map(edge => ({
      ...edge,
      source: positioned.find(node => node.id === edge.sourceId) || edge.source,
      target: positioned.find(node => node.id === edge.targetId) || edge.target,
    })),
  }
}


function manuscriptCatalog(workspace) {
  const result = []
  let ordinal = 0
  for (const volume of workspace?.volumes || []) {
    for (const note of volume.notes || []) {
      ordinal += 1
      result.push({
        id: normalizeId(note.id),
        title: note.title,
        ordinal,
        volumeId: normalizeId(volume.id),
        volumeTitle: volume.title,
      })
    }
  }
  return result
}

export function buildProjectRelationEvolution(
  workspace,
  projectIndexes = {},
  projectMeta = {},
) {
  const graph = buildProjectRelationGraph(projectIndexes, projectMeta)
  const catalog = manuscriptCatalog(workspace)
  const chapterById = new Map(catalog.map(item => [item.id, item]))
  const chapterEvents = {}
  let orphanEvents = 0

  const relations = graph.edges.map(edge => {
    const sortedEvents = (edge.events || []).map(event => {
      const chapter = chapterById.get(normalizeId(event.noteId)) || null
      if (!chapter) orphanEvents += 1

      return {
        ...event,
        chapter,
        eventLabel: RELATION_EVENT_TYPES.find(item => (
          item.id === event.eventType
        ))?.label || '转变',
      }
    }).sort((a, b) => (
      Number(a.chapter?.ordinal || Number.MAX_SAFE_INTEGER) -
      Number(b.chapter?.ordinal || Number.MAX_SAFE_INTEGER)
    ))

    let runningType = edge.type
    let typeChanges = 0
    const events = sortedEvents.map(event => {
      const previousType = runningType
      if (event.chapter && event.relationType) {
        runningType = event.relationType
      }

      const resultingType = event.chapter
        ? runningType
        : (event.relationType || runningType)
      const resultingTypeLabel = RELATION_TYPES.find(item => (
        item.id === resultingType
      ))?.label || edge.typeLabel

      if (event.chapter && resultingType !== previousType) {
        typeChanges += 1
      }

      const enriched = {
        ...event,
        resultingType,
        resultingTypeLabel,
      }

      if (event.chapter) {
        const bucket = chapterEvents[event.chapter.id] || []
        bucket.push({
          relationId: edge.id,
          relationLabel: edge.label || edge.typeLabel,
          sourceId: edge.sourceId,
          sourceLabel: edge.source.label,
          targetId: edge.targetId,
          targetLabel: edge.target.label,
          directed: edge.directed,
          eventId: event.id,
          eventType: event.eventType,
          eventLabel: event.eventLabel,
          resultingType,
          resultingTypeLabel,
          note: event.note,
        })
        chapterEvents[event.chapter.id] = bucket
      }

      return enriched
    })

    const validEvents = events.filter(event => event.chapter)
    const latest = validEvents[validEvents.length - 1] || null
    const currentType = latest?.resultingType || edge.type
    const currentTypeLabel = RELATION_TYPES.find(item => (
      item.id === currentType
    ))?.label || edge.typeLabel

    return {
      ...edge,
      events,
      currentType,
      currentTypeLabel,
      latestEvent: latest,
      typeChanges,
      startOrdinal: validEvents[0]?.chapter?.ordinal || 0,
      endOrdinal: latest?.chapter?.ordinal || 0,
      hasTimeline: validEvents.length > 0,
    }
  })

  const timeline = relations
    .flatMap(relation => relation.events
      .filter(event => event.chapter)
      .map(event => ({
        ...event,
        relationId: relation.id,
        relationTitle:
          relation.source.label +
          (relation.directed ? ' → ' : ' ↔ ') +
          relation.target.label,
        relationBaseType: relation.type,
      })))
    .sort((a, b) => (
      Number(a.chapter?.ordinal || 0) -
      Number(b.chapter?.ordinal || 0)
    ))

  const chapters = catalog.map(chapter => ({
    ...chapter,
    events: chapterEvents[chapter.id] || [],
  }))

  return {
    graph,
    catalog,
    relations,
    relationById: new Map(relations.map(item => [item.id, item])),
    chapterEvents,
    chapters,
    timeline,
    totals: {
      relations: relations.length,
      events: timeline.length,
      evolvingRelations: relations.filter(item => item.hasTimeline).length,
      typeChangedRelations: relations.filter(item => item.typeChanges > 0).length,
      chaptersWithChanges: chapters.filter(item => item.events.length > 0).length,
    },
    signals: {
      orphanEvents,
      relationsWithoutTimeline: relations.filter(item => !item.hasTimeline).length,
      multiChangeChapters: chapters.filter(item => item.events.length >= 2).length,
    },
  }
}
