import { describe, expect, it } from 'vitest'
import { findTextMatchOffsets } from './SearchPlugin'

describe('advanced editor find rules', () => {
  it('supports case-sensitive and case-insensitive matching', () => {
    expect(findTextMatchOffsets('Note note NOTE', 'note')).toEqual([0, 5, 10])
    expect(findTextMatchOffsets('Note note NOTE', 'note', { matchCase: true })).toEqual([5])
  })

  it('supports whole-word matching for latin and Chinese text', () => {
    expect(findTextMatchOffsets('note notebook note', 'note', { wholeWord: true })).toEqual([0, 14])
    expect(findTextMatchOffsets('这是 笔记，不是笔记本', '笔记', { wholeWord: true })).toEqual([3])
  })

  it('returns no matches for empty queries', () => {
    expect(findTextMatchOffsets('anything', '')).toEqual([])
  })
})
