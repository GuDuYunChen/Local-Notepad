import { describe, expect, it } from 'vitest'
import { EDITOR_READING_MODE_KEY, loadEditorMode, normalizeEditorMode, saveEditorMode } from '~/services/editorReadingMode.mjs'
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return { getItem(key) { return values.has(key) ? values.get(key) : null }, setItem(key, value) { values.set(key, String(value)) } }
}
describe('local reading/editing mode preference', () => {
  it('defaults safely to editing and rejects unknown stored values', () => {
    expect(loadEditorMode(memoryStorage())).toBe('editing')
    expect(loadEditorMode(memoryStorage({ [EDITOR_READING_MODE_KEY]: 'unknown' }))).toBe('editing')
    expect(normalizeEditorMode('reading')).toBe('reading')
    expect(normalizeEditorMode('editing')).toBe('editing')
  })
  it('restores reading preference after a renderer restart', () => {
    const storage = memoryStorage()
    expect(saveEditorMode('reading', storage)).toBe(true)
    expect(loadEditorMode(storage)).toBe('reading')
    expect(saveEditorMode('editing', storage)).toBe(true)
    expect(loadEditorMode(storage)).toBe('editing')
  })
  it('fails closed when storage is unavailable without blocking the current session', () => {
    const unavailable = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    expect(loadEditorMode(unavailable)).toBe('editing')
    expect(saveEditorMode('reading', unavailable)).toBe(false)
  })
})
