import { describe, expect, it } from 'vitest'
import {
  calculateReadingProgress,
  findHeadingByPath,
  findOutlineHeadingForKey,
  getCollapsedOutlineKeys,
  getOutlineBreadcrumb,
} from './DocumentOutlinePlugin'

const outlineNodes = [
  { key: 'h1-a', isHeading: true, level: 1, text: '第一卷' },
  { key: 'p-a', isHeading: false, level: null, text: '' },
  { key: 'h2-a', isHeading: true, level: 2, text: '第一章' },
  { key: 'p-b', isHeading: false, level: null, text: '' },
  { key: 'h3-a', isHeading: true, level: 3, text: '第一场' },
  { key: 'p-c', isHeading: false, level: null, text: '' },
  { key: 'h2-b', isHeading: true, level: 2, text: '第二章' },
  { key: 'p-d', isHeading: false, level: null, text: '' },
  { key: 'h1-b', isHeading: true, level: 1, text: '第二卷' },
]

describe('document outline helpers', () => {
  it('calculates reading progress from the real scroll range', () => {
    expect(calculateReadingProgress(0, 2000, 500)).toBe(0)
    expect(calculateReadingProgress(750, 2000, 500)).toBe(50)
    expect(calculateReadingProgress(1500, 2000, 500)).toBe(100)
    expect(calculateReadingProgress(9999, 2000, 500)).toBe(100)
    expect(calculateReadingProgress(-20, 2000, 500)).toBe(0)
  })

  it('treats a fully visible short document as complete', () => {
    expect(calculateReadingProgress(0, 500, 700)).toBe(100)
  })

  it('builds the nearest heading hierarchy for the active section', () => {
    expect(getOutlineBreadcrumb(outlineNodes, 'h3-a').map(item => item.key)).toEqual([
      'h1-a',
      'h2-a',
      'h3-a',
    ])

    expect(getOutlineBreadcrumb(outlineNodes, 'h2-b').map(item => item.key)).toEqual([
      'h1-a',
      'h2-b',
    ])

    expect(getOutlineBreadcrumb(outlineNodes, 'missing')).toEqual([])
  })

  it('finds the heading that owns an ordinary top-level block', () => {
    expect(findOutlineHeadingForKey(outlineNodes, 'p-c')?.key).toBe('h3-a')
    expect(findOutlineHeadingForKey(outlineNodes, 'p-d')?.key).toBe('h2-b')
  })

  it('resolves a hierarchical heading anchor to the intended section', () => {
    expect(findHeadingByPath(outlineNodes, ['第一卷', '第一章', '第一场'])?.key).toBe('h3-a')
    expect(findHeadingByPath(outlineNodes, ['第一卷', '第二章'])?.key).toBe('h2-b')
    expect(findHeadingByPath(outlineNodes, ['第二章'])).toBeNull()
  })

  it('hides only the collapsed heading descendants until a sibling boundary', () => {
    expect([...getCollapsedOutlineKeys(outlineNodes, new Set(['h2-a']))]).toEqual([
      'p-b',
      'h3-a',
      'p-c',
    ])

    expect([...getCollapsedOutlineKeys(outlineNodes, new Set(['h1-a']))]).toEqual([
      'p-a',
      'h2-a',
      'p-b',
      'h3-a',
      'p-c',
      'h2-b',
      'p-d',
    ])
  })
})
