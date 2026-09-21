import { beforeEach, describe, expect, it } from 'vitest'
import {
  getDocumentSessionKey,
  readDocumentSession,
  writeDocumentSession,
} from './DocumentSessionPlugin'

describe('document session persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores scroll state independently for each note', () => {
    writeDocumentSession('note-a', { scrollTop: 420 })
    writeDocumentSession('note-b', { scrollTop: 36 })

    expect(readDocumentSession('note-a')).toEqual({ scrollTop: 420 })
    expect(readDocumentSession('note-b')).toEqual({ scrollTop: 36 })
  })

  it('normalizes invalid scroll values and ignores missing ids', () => {
    writeDocumentSession('note-a', { scrollTop: -20 })

    expect(readDocumentSession('note-a')).toEqual({ scrollTop: 0 })
    expect(getDocumentSessionKey('')).toBe('')
    expect(readDocumentSession('')).toBeNull()
  })
})
