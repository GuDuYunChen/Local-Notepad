import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Git line-ending conversion is not stylesheet growth; normalize separators only.
function readRedesignCss() {
  return readFileSync(join(process.cwd(), 'src', 'styles', 'redesign.css'), 'utf8').replace(/\r\n/g, '\n')
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

  it('reserves a scrollable library rather than shrinking its 40px row actions in short windows', () => {
    const css = readRedesignCss()
    const rules = css.match(/@media \(max-height: 560px\) \{\s*\.workspace-sidebar:not\(\.collapsed\) \.workspace-sidebar-top \{([^}]+)\}\s*\.workspace-sidebar:not\(\.collapsed\) \.workspace-sidebar-library \{([^}]+)\}/)
    expect(rules).not.toBeNull()
    expect(rules[1]).toMatch(/flex:\s*0 1 auto\s*;/)
    expect(rules[1]).toMatch(/min-height:\s*0\s*;/)
    expect(rules[1]).toMatch(/overflow-y:\s*auto\s*;/)
    expect(rules[2]).toMatch(/flex:\s*1 0 136px\s*;/)
    expect(rules[2]).toMatch(/min-height:\s*136px\s*;/)
    expect(rules[2]).not.toMatch(/\bheight:\s*\d+px\s*!important/)
  })

  it('keeps the collapsed More action at the official 40px in narrow windows', () => {
    const css = readRedesignCss()
    const narrowRail = css.lastIndexOf('@media (max-width: 820px)')
    const guard = css.match(/\/\* The persistent collapsed More action[\s\S]*?\*\/\s*\.workspace-sidebar\.collapsed \.workspace-sidebar-more \{([^}]+)\}/)
    expect(guard).not.toBeNull()
    expect(css.indexOf(guard[0])).toBeGreaterThan(narrowRail)
    expect(guard[1]).toMatch(/\bheight:\s*40px\s*!important;/)
    expect(guard[1]).toMatch(/\bmin-height:\s*40px\s*!important;/)
  })

  it('keeps the redesign stylesheet below the post-cleanup growth budget', () => {
    const css = readRedesignCss()
    expect(Buffer.byteLength(css, 'utf8')).toBeLessThan(106_000)
    expect(duplicateSelectorCount(css)).toBeLessThanOrEqual(110)
  })
})
