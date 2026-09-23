// A single in-memory review, containing IDs and view state only. No manuscript
// snapshots, automatic relationship acceptance, localStorage or network writes.
import { MAX_REVIEW_NOTE_LENGTH, hasReviewAnnotations } from './evidenceReviewReport.js'
import { copyArchivedReviewData, MAX_REVIEW_CHAPTERS } from './evidenceReviewArchiveData.js'
export { MAX_REVIEW_CHAPTERS } from './evidenceReviewArchiveData.js'

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
  let staged = null
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
      // Never silently lose user-authored notes when narrowing or replacing a scope.
      if (hasReviewAnnotations(snapshot) && (!sameScope ||
        Object.keys(snapshot.annotations).some(id => !seen.has(id)))) return null
      const reviewedIds = sameScope ? snapshot.reviewedIds.filter(id => seen.has(id)) : []
      const annotations = sameScope ? snapshot.annotations : Object.freeze({})
      const previous = staged ? staged.previous : snapshot
      staged = { id: sequence + 1, previous }
      publish({
        id: ++sequence,
        projectId: String(context.projectId),
        entityId: String(context.entityId),
        entityLabel: String(context.entityLabel || ''),
        filters,
        chapters: Object.freeze(chapters),
        chapterId,
        reviewedIds: Object.freeze(reviewedIds),
        annotations,
        returnToken: null,
      })
      return snapshot
    },
    restoreArchive(value) {
      // Do not overwrite even an unannotated active round or a pending open.
      if (snapshot || staged) return null
      let data
      try { data = copyArchivedReviewData(value) } catch { return null }
      publish({ ...data, id: ++sequence, reviewedIds: Object.freeze([]), returnToken: null })
      return snapshot
    },
    commitStart(expectedId) {
      if (!staged || staged.id !== expectedId || snapshot?.id !== expectedId) return false
      staged = null
      return true
    },
    cancelStart(expectedId) {
      if (!staged || staged.id !== expectedId || snapshot?.id !== expectedId) return false
      const previous = staged.previous
      staged = null
      publish(previous)
      return true
    },
    end(expectedId, { discardAnnotations = false } = {}) {
      if (!snapshot || (expectedId !== undefined && snapshot.id !== expectedId)) return false
      if (hasReviewAnnotations(snapshot) && !discardAnnotations) {
        // Invalidated project returns must not loop or erase user-authored notes.
        if (snapshot.returnToken) publish({ ...snapshot, returnToken: null })
        return false
      }
      staged = null
      publish(null)
      return true
    },
    setAnnotation(expectedId, chapterId, patch) {
      if (!snapshot || snapshot.id !== expectedId || !snapshot.chapters.some(item => item.id === chapterId) ||
        !patch || typeof patch !== 'object' || Array.isArray(patch)) return false
      const previous = Object.hasOwn(snapshot.annotations, chapterId)
        ? snapshot.annotations[chapterId] : { text: '', needsChanges: false }
      if (Object.hasOwn(patch, 'text') && (typeof patch.text !== 'string' || patch.text.length > MAX_REVIEW_NOTE_LENGTH)) return false
      if (Object.hasOwn(patch, 'needsChanges') && typeof patch.needsChanges !== 'boolean') return false
      const text = Object.hasOwn(patch, 'text') ? patch.text : previous.text
      const needsChanges = Object.hasOwn(patch, 'needsChanges') ? patch.needsChanges : previous.needsChanges
      if (text === previous.text && needsChanges === previous.needsChanges) return true
      staged = null
      const annotations = { ...snapshot.annotations, [chapterId]: Object.freeze({ text, needsChanges }) }
      if (!text && !needsChanges) delete annotations[chapterId]
      publish({ ...snapshot, annotations: Object.freeze(annotations),
        reviewedIds: needsChanges ? Object.freeze(snapshot.reviewedIds.filter(id => id !== chapterId)) : snapshot.reviewedIds })
      return true
    },
    visit(expectedId, chapterId) {
      if (!snapshot || snapshot.id !== expectedId || !snapshot.chapters.some(item => item.id === chapterId)) return false
      if (snapshot.chapterId !== chapterId) publish({ ...snapshot, chapterId })
      return true
    },
    setReviewed(expectedId, chapterId, reviewed) {
      if (!snapshot || snapshot.id !== expectedId || !snapshot.chapters.some(item => item.id === chapterId)) return false
      if (reviewed && Object.hasOwn(snapshot.annotations, chapterId) && snapshot.annotations[chapterId].needsChanges) return false
      const ids = new Set(snapshot.reviewedIds)
      if (ids.has(chapterId) === Boolean(reviewed)) return true
      staged = null
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
      if (!snapshot || snapshot.id !== expectedId || snapshot.returnToken !== returnToken || !returnToken) return false
      publish({ ...snapshot, returnToken: null })
      return true
    },
  }
}

export const evidenceReview = createEvidenceReviewSession()
