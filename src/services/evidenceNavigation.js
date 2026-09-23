// One ephemeral, latest-wins navigation request. Never write manuscript snapshots
// to localStorage, send them over the network, or replay them after expiration.
export function createEvidenceNavigationStore({ now = Date.now, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let pending = null
  let timer = null
  let version = 0
  const listeners = new Set()
  const publish = () => { for (const listener of [...listeners]) listener() }
  const clear = () => {
    if (timer !== null) unschedule(timer)
    timer = null
    pending = null
  }
  return {
    start(documentId, target, onExpire) {
      if (!String(documentId || '').trim() || target?.version !== 1) return null
      clear()
      const id = ++version
      pending = { id, documentId: String(documentId), target, expiresAt: now() + 30000 }
      timer = schedule(() => {
        if (pending?.id !== id) return
        clear()
        publish()
        onExpire?.()
      }, 30000)
      publish()
      return id
    },
    peek(documentId) {
      if (pending && pending.expiresAt <= now()) clear()
      return pending && (documentId === undefined || pending.documentId === String(documentId)) ? pending : null
    },
    take(id, documentId) {
      const request = this.peek(documentId)
      if (!request || request.id !== id) return null
      clear()
      publish()
      return request
    },
    cancel(id) {
      if (!pending || (id !== undefined && id !== pending.id)) return false
      clear()
      publish()
      return true
    },
    version: () => version,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

export const evidenceNavigation = createEvidenceNavigationStore()
const readiness = new WeakMap()
const readyListeners = new Set()
export function beginEvidenceContentLoad(editor, documentId, content) {
  const token = { documentId: String(documentId || ''), content, ready: false }
  readiness.set(editor, token)
  return token
}
export function completeEvidenceContentLoad(editor, token) {
  if (readiness.get(editor) !== token) return
  token.ready = true
  for (const listener of [...readyListeners]) listener()
}
export function cancelEvidenceContentLoad(editor, token) {
  if (readiness.get(editor) === token) readiness.delete(editor)
}
export function isEvidenceContentReady(editor, documentId, content) {
  const token = readiness.get(editor)
  return Boolean(token?.ready && token.documentId === String(documentId || '') && token.content === content)
}
export function subscribeEvidenceContentReady(listener) {
  readyListeners.add(listener)
  return () => readyListeners.delete(listener)
}
