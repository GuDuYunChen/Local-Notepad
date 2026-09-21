import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readRedesignCss() {
  return readFileSync(join(process.cwd(), 'src', 'styles', 'redesign.css'), 'utf8')
}

function duplicateSelectorCount(css) {
  const selectors = [...css.matchAll(/(^|\})\s*([^@{}][^{}]*?)\s*\{/g)]
    .map(match => match[2].trim())
    .filter(Boolean)

  const counts = new Map()
  for (const selector of selectors) {
    counts.set(selector, (counts.get(selector) || 0) + 1)
  }

  return [...counts.values()].filter(count => count > 1).length
}

describe('redesign stylesheet architecture', () => {
  it('does not reintroduce removed legacy navigation shell selectors', () => {
    const css = readRedesignCss()
    const legacySelectors = [
      '.navigation-rail',
      '.minimal-navigation-rail',
      '.consumer-header',
      '.consumer-brand',
      '.consumer-nav',
      '.consumer-action-btn',
      '.consumer-command-area',
      '.consumer-more',
      '.consumer-theme',
    ]

    for (const selector of legacySelectors) {
      expect(css).not.toContain(selector)
    }
  })

  it('keeps the redesign stylesheet below the post-cleanup growth budget', () => {
    const css = readRedesignCss()
    expect(Buffer.byteLength(css, 'utf8')).toBeLessThan(106_000)
    expect(duplicateSelectorCount(css)).toBeLessThanOrEqual(110)
  })
})
