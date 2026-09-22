const STORYLINE_TYPES = [
  { id: 'plot', label: '剧情线' },
  { id: 'character', label: '人物弧光' },
  { id: 'foreshadow', label: '伏笔生命周期' },
]

const STAGES = {
  plot: [
    { id: 'setup', label: '建立' },
    { id: 'advance', label: '推进' },
    { id: 'escalate', label: '升级' },
    { id: 'turn', label: '转折' },
    { id: 'climax', label: '高潮' },
    { id: 'resolve', label: '收束' },
  ],
  character: [
    { id: 'entry', label: '出场' },
    { id: 'desire', label: '欲望' },
    { id: 'setback', label: '受挫' },
    { id: 'change', label: '转变' },
    { id: 'breakthrough', label: '突破' },
    { id: 'complete', label: '完成' },
  ],
  foreshadow: [
    { id: 'plant', label: '埋设' },
    { id: 'reinforce', label: '强化' },
    { id: 'misdirect', label: '误导' },
    { id: 'reveal', label: '揭示' },
    { id: 'payoff', label: '回收' },
  ],
}

const TERMINAL_STAGE = {
  plot: 'resolve',
  character: 'complete',
  foreshadow: 'payoff',
}

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeType(value) {
  return STORYLINE_TYPES.some(item => item.id === value)
    ? value
    : 'plot'
}

function normalizeStage(type, value) {
  const stages = STAGES[normalizeType(type)] || STAGES.plot
  return stages.some(item => item.id === value)
    ? value
    : stages[0].id
}

export function getProjectStorylineTypes() {
  return STORYLINE_TYPES.map(item => ({ ...item }))
}

export function getProjectStorylineStages(type) {
  return (STAGES[normalizeType(type)] || STAGES.plot)
    .map(item => ({ ...item }))
}

export function getProjectStorylineStageLabel(type, stage) {
  return getProjectStorylineStages(type)
    .find(item => item.id === stage)?.label || ''
}

export function normalizeProjectStorylines(value) {
  if (!Array.isArray(value)) return []

  const seenTracks = new Set()
  const result = []

  for (const raw of value) {
    const id = normalizeId(raw?.id)
    if (!id || seenTracks.has(id)) continue
    seenTracks.add(id)

    const type = normalizeType(raw?.type)
    const seenEvents = new Set()
    const events = []

    for (const rawEvent of Array.isArray(raw?.events) ? raw.events : []) {
      const eventId = normalizeId(rawEvent?.id)
      const noteId = normalizeId(rawEvent?.noteId)
      if (!eventId || !noteId || seenEvents.has(eventId)) continue
      seenEvents.add(eventId)

      events.push({
        id: eventId,
        noteId,
        stage: normalizeStage(type, rawEvent?.stage),
        note: String(rawEvent?.note || '').trim(),
      })
    }

    result.push({
      id,
      title: String(raw?.title || '').trim() || '未命名轨迹',
      type,
      description: String(raw?.description || '').trim(),
      sourceNoteId: normalizeId(raw?.sourceNoteId),
      events,
    })
  }

  return result
}

function chapterCatalog(workspace) {
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

export function buildProjectStorylineModel(workspace, projectMeta = {}) {
  const catalog = chapterCatalog(workspace)
  const chapterById = new Map(catalog.map(item => [item.id, item]))
  const storylines = normalizeProjectStorylines(projectMeta.storylines)
  const chapterEvents = {}
  let orphanEvents = 0

  const tracks = storylines.map(track => {
    const events = track.events.map(event => {
      const chapter = chapterById.get(normalizeId(event.noteId)) || null
      if (!chapter) orphanEvents += 1

      const enriched = {
        ...event,
        chapter,
        stageLabel: getProjectStorylineStageLabel(track.type, event.stage),
      }

      if (chapter) {
        const bucket = chapterEvents[chapter.id] || []
        bucket.push({
          trackId: track.id,
          trackTitle: track.title,
          trackType: track.type,
          eventId: event.id,
          stage: event.stage,
          stageLabel: enriched.stageLabel,
          note: event.note,
        })
        chapterEvents[chapter.id] = bucket
      }

      return enriched
    }).sort((a, b) => (
      Number(a.chapter?.ordinal || Number.MAX_SAFE_INTEGER) -
      Number(b.chapter?.ordinal || Number.MAX_SAFE_INTEGER)
    ))

    const terminal = TERMINAL_STAGE[track.type]
    const legacyRecovered = Boolean(
      track.type === 'foreshadow' &&
      track.sourceNoteId &&
      projectMeta?.foreshadowStates?.[track.sourceNoteId] === 'recovered'
    )
    const resolved = legacyRecovered || events.some(event => (
      event.stage === terminal
    ))
    const validEvents = events.filter(event => event.chapter)

    return {
      ...track,
      events,
      status: !events.length
        ? 'empty'
        : resolved
          ? 'resolved'
          : 'active',
      resolved,
      legacyRecovered,
      startOrdinal: validEvents[0]?.chapter?.ordinal || 0,
      endOrdinal: validEvents[validEvents.length - 1]?.chapter?.ordinal || 0,
    }
  })

  const byType = {
    plot: tracks.filter(track => track.type === 'plot').length,
    character: tracks.filter(track => track.type === 'character').length,
    foreshadow: tracks.filter(track => track.type === 'foreshadow').length,
  }

  return {
    catalog,
    tracks,
    chapterEvents,
    totals: {
      tracks: tracks.length,
      events: tracks.reduce((sum, track) => sum + track.events.length, 0),
      active: tracks.filter(track => track.status === 'active').length,
      resolved: tracks.filter(track => track.status === 'resolved').length,
      empty: tracks.filter(track => track.status === 'empty').length,
      byType,
    },
    signals: {
      unresolvedForeshadows: tracks.filter(track => (
        track.type === 'foreshadow' &&
        track.status === 'active'
      )).length,
      emptyTracks: tracks.filter(track => track.status === 'empty').length,
      singlePointTracks: tracks.filter(track => track.events.length === 1).length,
      orphanEvents,
    },
  }
}

export function getProjectStorylineSuggestions(
  projectIndexes = {},
  storylines = [],
  type = 'character',
) {
  const normalized = normalizeProjectStorylines(storylines)
  const used = new Set(
    normalized
      .filter(track => track.type === type)
      .map(track => normalizeId(track.sourceNoteId))
      .filter(Boolean)
  )
  const source = type === 'foreshadow'
    ? projectIndexes.foreshadows
    : type === 'character'
      ? projectIndexes.characters
      : []

  return (Array.isArray(source) ? source : [])
    .filter(item => item?.id && !used.has(normalizeId(item.id)))
    .map(item => ({
      id: item.id,
      title: item.title,
    }))
}
