export const EDITOR_READING_MODE_KEY = 'localNotepad.editorMode.v1'
export function normalizeEditorMode(value) { return value === 'reading' ? 'reading' : 'editing' }
export function loadEditorMode(storage) {
  try { const target = storage ?? globalThis.localStorage; return normalizeEditorMode(target?.getItem(EDITOR_READING_MODE_KEY)) }
  catch { return 'editing' }
}
export function saveEditorMode(value, storage) {
  const mode = normalizeEditorMode(value)
  try { const target = storage ?? globalThis.localStorage; if (!target || typeof target.setItem !== 'function') return false; target.setItem(EDITOR_READING_MODE_KEY, mode); return true }
  catch { return false }
}
