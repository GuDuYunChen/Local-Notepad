import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isFreshEditorDraft,
  readEditorDraft,
  readEditorDraftDurable,
  removeEditorDraft,
  writeEditorDraft,
} from './editorDraftCache'

describe('editor draft cache', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T10:00:00Z'))
  })

  it('writes reads and removes a local draft', () => {
    writeEditorDraft('note-1', 'draft content', 123)

    expect(readEditorDraft('note-1')).toMatchObject({
      content: 'draft content',
      savedAt: 123,
    })

    removeEditorDraft('note-1')
    expect(readEditorDraft('note-1')).toBeNull()
  })

  it('restores a durable-cache read through the synchronous fallback when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    writeEditorDraft('note-durable-fallback', 'unconfirmed local draft', 456, {
      version: 1, id: 'note-durable-fallback', expectedContent: 'database', conflicted: false, attempt: null,
    })

    await expect(readEditorDraftDurable('note-durable-fallback')).resolves.toMatchObject({
      content: 'unconfirmed local draft',
      savedAt: 456,
      recovery: { expectedContent: 'database' },
    })
    vi.unstubAllGlobals()
    removeEditorDraft('note-durable-fallback')
  })

  it('keeps the current in-memory draft when durable storage cannot be opened', async () => {
    vi.stubGlobal('indexedDB', undefined)
    writeEditorDraft('note-memory-fallback', 'latest in-memory text', 789)
    await expect(readEditorDraftDurable('note-memory-fallback')).resolves.toMatchObject({
      content: 'latest in-memory text',
      savedAt: 789,
    })
    vi.unstubAllGlobals()
    removeEditorDraft('note-memory-fallback')
  })

  it('distinguishes fresh and stale drafts', () => {
    const now = Date.now()

    expect(isFreshEditorDraft({ editedAt: now - 60_000 }, now)).toBe(true)
    expect(isFreshEditorDraft({ editedAt: now - 6 * 60_000 }, now)).toBe(false)
    expect(isFreshEditorDraft(null, now)).toBe(false)
  })
})
