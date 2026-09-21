import { describe, expect, it } from 'vitest'
import {
  buildHeadingAnchor,
  isHeadingAnchor,
  isPasteableLink,
  normalizeLinkUrl,
  parseHeadingAnchor,
} from './linkUtils'

describe('link utilities', () => {
  it('builds and parses hierarchical heading anchors without losing separators', () => {
    const href = buildHeadingAnchor(['第一卷', '第一章 / 起势', '第二场'])
    expect(href).toBe('#heading/%E7%AC%AC%E4%B8%80%E5%8D%B7/%E7%AC%AC%E4%B8%80%E7%AB%A0%20%2F%20%E8%B5%B7%E5%8A%BF/%E7%AC%AC%E4%BA%8C%E5%9C%BA')
    expect(parseHeadingAnchor(href)).toEqual(['第一卷', '第一章 / 起势', '第二场'])
    expect(isHeadingAnchor(href)).toBe(true)
  })

  it('normalizes web links and rejects unsafe schemes', () => {
    expect(normalizeLinkUrl('www.example.com/path')).toBe('https://www.example.com/path')
    expect(normalizeLinkUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeLinkUrl('mailto:test@example.com')).toBe('mailto:test@example.com')
    expect(normalizeLinkUrl('javascript:alert(1)')).toBe('')
    expect(normalizeLinkUrl('file:///tmp/a.txt')).toBe('')
  })

  it('treats only explicit URLs or heading anchors as smart-paste links', () => {
    expect(isPasteableLink('https://example.com')).toBe(true)
    expect(isPasteableLink('www.example.com')).toBe(true)
    expect(isPasteableLink('#heading/%E7%AC%AC%E4%B8%80%E7%AB%A0')).toBe(true)
    expect(isPasteableLink('example.com')).toBe(false)
    expect(isPasteableLink('这是一段普通文字')).toBe(false)
  })

  it('rejects malformed heading anchors', () => {
    expect(parseHeadingAnchor('#heading/')).toBeNull()
    expect(parseHeadingAnchor('#heading/%E0%A4%A')).toBeNull()
    expect(parseHeadingAnchor('#other/第一章')).toBeNull()
  })
})
