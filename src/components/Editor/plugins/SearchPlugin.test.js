import { describe, expect, it } from 'vitest'
import { findTextMatchOffsets } from './SearchPlugin'

describe('findTextMatchOffsets', () => {
  it('finds case-insensitive matches by default', () => {
    expect(findTextMatchOffsets('Alpha alpha ALPHA', 'alpha')).toEqual([0, 6, 12])
  })

  it('supports case-sensitive matching', () => {
    expect(findTextMatchOffsets('Alpha alpha ALPHA', 'Alpha', { matchCase: true })).toEqual([0])
  })

  it('supports whole-word matching without consuming partial identifiers', () => {
    expect(findTextMatchOffsets(
      'cat scatter cat_1 cat 中文cat中文',
      'cat',
      { wholeWord: true },
    )).toEqual([0, 18])
  })

  it('matches CJK phrases as complete phrases when boundaries are non-word characters', () => {
    expect(findTextMatchOffsets(
      '测试 文本测试 测试。',
      '测试',
      { wholeWord: true },
    )).toEqual([0, 8])
  })

  it('returns no matches for an empty query', () => {
    expect(findTextMatchOffsets('anything', '')).toEqual([])
  })
})
