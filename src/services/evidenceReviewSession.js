// A single in-memory review, containing IDs and view state only. No manuscript
// snapshots, automatic relationship acceptance, localStorage or network writes.
export const MAX_REVIEW_CHAPTERS = 10000

export function normalizeEvidenceReviewFilters(value = {}) {
  const page = Number(value?.page)
  return {
    query: typeof value?.query === 'string' ? value.query.slice(0, 500) : '',
    source: ['all', 'wiki', 'canonical', 'alias'].includes(value?.source) ? value.source : 'all',
    volumeId: typeof value?.volumeId === 'string' ? value.volumeId : null,
    page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1,
  }
}

export function createEvidenceReviewSession() {
  let snapshot = null
  let sequence = 0
  let returnSequence = 0
  const listeners = new Set()
  const publish = value => {
    snapshot = value ? Object.freeze(value) : null
    for (const listener of [...listeners]) listener()
  }
  const getSnapshot = () => snapshot
  return {
    getSnapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    start(context, candidates, chapterId) {
      if (!context?.projectId || !context?.entityId || !Array.isArray(candidates) || candidates.length > MAX_REVIEW_CHAPTERS) return null
      const seen = new Set()
      const chapters = candidates.filter(item => {
        if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) return false
        seen.add(item.id)
        return true
      }).map(item => Object.freeze({
        id: item.id,
        title: typeof item.title === 'string' ? item.title : '未命名',
        ordinal: Number.isFinite(Number(item.ordinal)) ? Number(item.ordinal) : 0,
      }))
      if (!seen.has(chapterId)) return null
      const filters = Object.freeze(normalizeEvidenceReviewFilters(context.filters))
      const sameScope = snapshot?.projectId === String(context.projectId) &&
        snapshot?.entityId === String(context.entityId) &&
        ['query', 'source', 'volumeId'].every(key => snapshot.filters[key] === filters[key])
      const reviewedIds = sameScope ? snapshot.reviewedIds.filter(id => seen.has(id)) : []
      publish({
        id: ++sequence,
        projectId: String(context.projectId),
        entityId: String(context.entityId),
        entityLabel: String(context.entityLabel || ''),
        filters,
        chapters: Object.freeze(chapters),
        chapterId,
        reviewedIds: Object.freeze(reviewedIds),
        returnToken: null,
      })
      return snapshot
    },
    end(expectedId) {
      if (!snapshot || (expectedId !== undefined && snapshot.id !== expectedId)) return false
      publish(null)
      return true
    },
    visit(expectedId, chapterId) {
      if (snapshot?.id !== expectedId || !snapshot.chapters.some(item => item.id === chapterId)) return false
      if (snapshot.chapterId !== chapterId) publish({ ...snapshot, chapterId })
      return true
    },
    setReviewed(expectedId, chapterId, reviewed) {
      if (snapshot?.id !== expectedId || !snapshot.chapters.some(item => item.id === chapterId)) return false
      const ids = new Set(snapshot.reviewedIds)
      if (ids.has(chapterId) === Boolean(reviewed)) return true
      if (reviewed) ids.add(chapterId)
      else ids.delete(chapterId)
      publish({ ...snapshot, reviewedIds: Object.freeze([...ids]) })
      return true
    },
    requestReturn(expectedId) {
      if (snapshot?.id !== expectedId) return false
      publish({ ...snapshot, returnToken: ++returnSequence })
      return true
    },
    getReturn(projectId, entityId) {
      return snapshot?.returnToken &&
        (projectId === undefined || snapshot.projectId === String(projectId)) &&
        (entityId === undefined || snapshot.entityId === String(entityId)) ? snapshot : null
    },
    finishReturn(expectedId, returnToken) {
      if (snapshot?.id !== expectedId || snapshot.returnToken !== returnToken || !returnToken) return false
      publish({ ...snapshot, returnToken: null })
      return true
    },
  }
}

export const evidenceReview = createEvidenceReviewSession()
