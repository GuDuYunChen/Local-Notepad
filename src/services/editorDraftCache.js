const MEMORY_CACHE = new Map()

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

export function readEditorDraft(id) {
  if (!id) return null
  try {
    if (!supportsLocalStorage()) return MEMORY_CACHE.get(id) || null
    const raw = localStorage.getItem(`editor:cache:${id}`)
    if (!raw) return MEMORY_CACHE.get(id) || null
    return JSON.parse(raw)
  } catch {
    return MEMORY_CACHE.get(id) || null
  }
}

export function writeEditorDraft(id, content, savedAt) {
  if (!id) return
  const text = String(content ?? '')
  const payload = {
    content: text,
    editedAt: Date.now(),
    savedAt,
  }

  MEMORY_CACHE.set(id, payload)

  if (!supportsLocalStorage()) return
  if (text.length > 1024 * 1024) return

  try {
    localStorage.setItem(`editor:cache:${id}`, JSON.stringify(payload))
  } catch {
    // The in-memory copy remains available when storage quota is exhausted.
  }
}

export function removeEditorDraft(id) {
  if (!id) return
  MEMORY_CACHE.delete(id)
  if (!supportsLocalStorage()) return

  try {
    localStorage.removeItem(`editor:cache:${id}`)
  } catch {
    // Cache cleanup must never block editing.
  }
}

export function isFreshEditorDraft(draft, now = Date.now(), maxAge = 5 * 60 * 1000) {
  return Boolean(
    draft &&
    draft.editedAt &&
    now - draft.editedAt < maxAge
  )
}
