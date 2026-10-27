const MEMORY_CACHE = new Map()
const IDB_NAME = 'local-notepad-editor-drafts'
const IDB_STORE = 'drafts'
const IDB_VERSION = 1
const IDB_MAX_TEXT_LENGTH = 16 * 1024 * 1024
const IDB_DEADLINE_MS = 5000
const generations = new Map()
const removed = new Set()
const queues = new Map()
let databasePromise = null

function nextGeneration(id) {
  const generation = (generations.get(id) || 0) + 1
  generations.set(id, generation)
  return generation
}

function persistenceResult(id, generation, persistent) {
  if (generations.get(id) !== generation) return
  try {
    globalThis.dispatchEvent?.(new CustomEvent(persistent
      ? 'editor:draft-persistence-ready' : 'editor:draft-persistence-error', { detail: { id } }))
  } catch { /* Persistence reporting must not interrupt the original save path. */ }
}

function queueDurableOperation(id, generation, operation) {
  const previous = queues.get(id) || Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    if (generations.get(id) !== generation) return
    await operation()
  })
  queues.set(id, next)
  next.finally(() => {
    if (queues.get(id) === next) queues.delete(id)
  }).catch(() => {})
  return next
}

function openDraftDatabase() {
  if (databasePromise) return databasePromise
  let pending
  pending = new Promise((resolve, reject) => {
    let settled = false, request
    const timer = setTimeout(() => fail(new Error('Draft database open timed out')), IDB_DEADLINE_MS)
    const fail = error => {
      if (settled) return
      settled = true; clearTimeout(timer); reject(error)
    }
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable')
      request = indexedDB.open(IDB_NAME, IDB_VERSION)
      request.onupgradeneeded = () => {
        if (settled) { try { request.transaction?.abort() } catch {} return }
        const db = request.result
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        // A blocked/timed-out open can still finish later. Do not retain it or
        // let its version-change callback invalidate a newer connection.
        if (settled) { db.close(); return }
        settled = true; clearTimeout(timer)
        db.onversionchange = () => { db.close(); if (databasePromise === pending) databasePromise = null }
        resolve(db)
      }
      request.onerror = () => fail(request.error || new Error('IndexedDB open failed'))
      request.onblocked = () => fail(new Error('IndexedDB upgrade blocked'))
    } catch (error) { fail(error) }
  }).catch(error => {
    if (databasePromise === pending) databasePromise = null
    throw error
  })
  databasePromise = pending
  return pending
}

async function durableRequest(mode, action) {
  const db = await openDraftDatabase()
  return new Promise((resolve, reject) => {
    let transaction, value, requestError, settled = false
    const finish = error => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      try { transaction?.abort() } catch {}
      finish(new Error('Draft transaction timed out'))
    }, IDB_DEADLINE_MS)
    try {
      transaction = db.transaction(IDB_STORE, mode)
      transaction.oncomplete = () => finish(requestError)
      transaction.onabort = () => finish(transaction.error || requestError || new Error('Draft transaction aborted'))
      transaction.onerror = () => { requestError ||= transaction.error || new Error('Draft transaction failed') }
      const request = action(transaction.objectStore(IDB_STORE))
      request.onsuccess = () => { value = request.result }
      request.onerror = () => { requestError = request.error || new Error('Draft request failed') }
      // Request success is not commit: a quota/error/explicit abort can still
      // roll back the transaction. The per-note queue waits for oncomplete.
    } catch (error) {
      try { transaction?.abort() } catch {}
      finish(error)
    }
  })
}

function readLocalEditorDraft(id) {
  if (MEMORY_CACHE.has(id)) return MEMORY_CACHE.get(id)
  try {
    if (typeof localStorage === 'undefined') return null
    // A read does not require free write quota; do not gate it on a probe write.
    const raw = localStorage.getItem(`editor:cache:${id}`)
    if (!raw) return null
    const value = JSON.parse(raw)
    return value && typeof value.content === 'string' && (!value.id || value.id === id) ? value : null
  } catch { return null }
}

export function readEditorDraft(id) {
  if (!id) return null
  return readLocalEditorDraft(id)
}

// Recheck the generation after EVERY asynchronous boundary. A late durable
// read must never resurrect a removal or replace a newer in-memory edit.
export async function readEditorDraftDurable(id) {
  if (!id) return null
  const generation = generations.get(id) || 0
  await (queues.get(id) || Promise.resolve()).catch(() => {})
  if ((generations.get(id) || 0) !== generation) return readLocalEditorDraft(id)
  try {
    const durable = await durableRequest('readonly', store => store.get(id))
    const local = readLocalEditorDraft(id)
    if ((generations.get(id) || 0) !== generation) return local
    if (removed.has(id)) return local
    if (!durable || durable.id !== id || typeof durable.content !== 'string') return local
    // A locally removed note stays removed for this process even if a store
    // could not clear its old bytes. This null marker is not an empty draft.
    if (MEMORY_CACHE.has(id) && local === null) return null
    if (!local || (Number.isFinite(durable.editedAt) && durable.editedAt > (Number(local.editedAt) || 0))) {
      MEMORY_CACHE.set(id, durable)
      return durable
    }
    return local
  } catch { return readLocalEditorDraft(id) }
}

export function writeEditorDraft(id, content, savedAt, recovery = null) {
  if (!id) return
  const text = String(content ?? '')
  const previous = readLocalEditorDraft(id)
  const payload = {
    id, content: text,
    editedAt: Math.max(Date.now(), (Number(previous?.editedAt) || 0) + 1),
    savedAt,
    ...(recovery ? { recovery } : {}),
  }
  const generation = nextGeneration(id)
  removed.delete(id)
  MEMORY_CACHE.set(id, payload)
  let localStored = false
  try {
    if (typeof localStorage !== 'undefined' && text.length <= 1024 * 1024) {
      localStorage.setItem(`editor:cache:${id}`, JSON.stringify(payload))
      localStored = true
    }
  } catch { /* The durable mirror is attempted below; memory remains intact. */ }
  if (text.length > IDB_MAX_TEXT_LENGTH) {
    persistenceResult(id, generation, localStored)
    return
  }
  queueDurableOperation(id, generation, async () => {
    await durableRequest('readwrite', store => store.put(payload))
    persistenceResult(id, generation, true)
  }).catch(() => persistenceResult(id, generation, localStored))
}

export function removeEditorDraft(id) {
  if (!id) return
  const generation = nextGeneration(id)
  removed.add(id)
  MEMORY_CACHE.set(id, null)
  let localRemoved = false
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(`editor:cache:${id}`)
    localRemoved = true
  } catch { /* Do not expose an old local copy in the current process. */ }
  // A later, explicitly supplied localStorage record remains readable. The
  // separate removal marker still rejects a stale IndexedDB copy this run.
  if (localRemoved) MEMORY_CACHE.delete(id)
  queueDurableOperation(id, generation, async () => {
    await durableRequest('readwrite', store => store.delete(id))
    persistenceResult(id, generation, localRemoved)
  }).catch(() => {
    // A failed delete is never advertised as a committed cleanup.
    persistenceResult(id, generation, false)
  })
}

export function isFreshEditorDraft(draft, now = Date.now(), maxAge = 5 * 60 * 1000) {
  return Boolean(draft && draft.editedAt && now - draft.editedAt < maxAge)
}
