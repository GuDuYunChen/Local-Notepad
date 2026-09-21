import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isFreshEditorDraft,
  readEditorDraft,
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

  it('distinguishes fresh and stale drafts', () => {
    const now = Date.now()

    expect(isFreshEditorDraft({ editedAt: now - 60_000 }, now)).toBe(true)
    expect(isFreshEditorDraft({ editedAt: now - 6 * 60_000 }, now)).toBe(false)
    expect(isFreshEditorDraft(null, now)).toBe(false)
  })
})
