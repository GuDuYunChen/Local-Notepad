const MEMORY_CACHE = new Map()
const IDB_NAME = 'local-notepad-editor-drafts'
const IDB_STORE = 'drafts'
const IDB_VERSION = 1
const IDB_MAX_TEXT_LENGTH = 16 * 1024 * 1024
const generations = new Map()
const queues = new Map()
let databasePromise = null

function supportsLocalStorage() {
  try {
    const key = '__local_notepad_storage_probe__'
    localStorage.setItem(key, '1')
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function nextGeneration(id) {
  const generation = (generations.get(id) || 0) + 1
  generations.set(id, generation)
  return generation
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
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    let request
    try { request = indexedDB.open(IDB_NAME, IDB_VERSION) } catch (error) { reject(error); return }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); databasePromise = null }
      resolve(db)
    }
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'))
  }).catch(error => {
    databasePromise = null
    throw error
  })
  return databasePromise
}

async function durableRequest(id, mode, action) {
  const db = await openDraftDatabase()
  return new Promise((resolve, reject) => {
    let transaction
    try {
      transaction = db.transaction(IDB_STORE, mode)
      const store = transaction.objectStore(IDB_STORE)
      action(store, resolve, reject)
      transaction.onabort = () => reject(transaction.error || new Error('Draft transaction aborted'))
      transaction.onerror = () => reject(transaction.error || new Error('Draft transaction failed'))
    } catch (error) { reject(error) }
  })
}

function readLocalEditorDraft(id) {
  if (MEMORY_CACHE.has(id)) return MEMORY_CACHE.get(id)
  try {
    if (typeof localStorage === 'undefined' || !supportsLocalStorage()) return null
    const raw = localStorage.getItem(`editor:cache:${id}`)
    if (!raw) return null
    const value = JSON.parse(raw)
    return value && typeof value.content === 'string' ? value : null
  } catch {
    return null
  }
}

export function readEditorDraft(id) {
  if (!id) return null
  return readLocalEditorDraft(id)
}

// Startup reads the synchronous cache first, then consults the durable mirror.
// A failed IndexedDB read falls back without inventing a blank draft or write.
export async function readEditorDraftDurable(id) {
  if (!id) return null
  const local = readLocalEditorDraft(id)
  await (queues.get(id) || Promise.resolve()).catch(() => {})
  try {
    const durable = await durableRequest(id, 'readonly', (store, resolve, reject) => {
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('Draft read failed'))
    })
    if (!durable || typeof durable.content !== 'string') return local
    if (!local) {
      MEMORY_CACHE.set(id, durable)
      return durable
    }
    // Local storage is synchronous and may contain a newer edit from this run.
    // Durable data only wins when its persisted edit timestamp is strictly newer.
    if (Number.isFinite(durable.editedAt) && durable.editedAt > (Number(local.editedAt) || 0)) {
      MEMORY_CACHE.set(id, durable)
      return durable
    }
    return local
  } catch {
    return local
  }
}

export function writeEditorDraft(id, content, savedAt, recovery = null) {
  if (!id) return
  const text = String(content ?? '')
  const payload = {
    id,
    content: text,
    editedAt: Date.now(),
    savedAt,
    ...(recovery ? { recovery } : {}),
  }
  const generation = nextGeneration(id)
  MEMORY_CACHE.set(id, payload)

  try {
    if (typeof localStorage !== 'undefined' && supportsLocalStorage() && text.length <= 1024 * 1024) {
      localStorage.setItem(`editor:cache:${id}`, JSON.stringify(payload))
    }
  } catch {
    // Durable storage is attempted below; memory remains the last-resort copy.
  }

  if (text.length <= IDB_MAX_TEXT_LENGTH) {
    queueDurableOperation(id, generation, async () => {
      await durableRequest(id, 'readwrite', (store, resolve, reject) => {
        const request = store.put(payload)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error || new Error('Draft write failed'))
      })
    }).catch(() => {
      // Never mark a draft as durable when the browser refuses the write.
      try { globalThis.dispatchEvent?.(new CustomEvent('editor:draft-persistence-error', { detail: { id } })) } catch {}
    })
  }
}

export function removeEditorDraft(id) {
  if (!id) return
  const generation = nextGeneration(id)
  MEMORY_CACHE.delete(id)
  try {
    if (typeof localStorage !== 'undefined' && supportsLocalStorage()) localStorage.removeItem(`editor:cache:${id}`)
  } catch {
    // Cache cleanup must never block editing.
  }
  queueDurableOperation(id, generation, async () => {
    await durableRequest(id, 'readwrite', (store, resolve, reject) => {
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error || new Error('Draft removal failed'))
    })
  }).catch(() => {
    try { globalThis.dispatchEvent?.(new CustomEvent('editor:draft-persistence-error', { detail: { id } })) } catch {}
  })
}

export function isFreshEditorDraft(draft, now = Date.now(), maxAge = 5 * 60 * 1000) {
  return Boolean(draft && draft.editedAt && now - draft.editedAt < maxAge)
}
