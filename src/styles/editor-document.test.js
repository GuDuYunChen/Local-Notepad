import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path) {
  return readFileSync(join(process.cwd(), ...path), 'utf8')
}

describe('editor document presentation', () => {
  it('loads the document visual layer after the global redesign', () => {
    const main = read(['src', 'main.jsx'])
    const redesign = main.indexOf("import './styles/redesign.css'")
    const document = main.indexOf("import './styles/editor-document.css'")

    expect(redesign).toBeGreaterThanOrEqual(0)
    expect(document).toBeGreaterThan(redesign)
  })

  it('uses editor view variables instead of hard-coded content dimensions', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('var(--editor-view-page-width, 100%)')
    expect(css).toContain('var(--editor-view-font-size, 13px)')
    expect(css).toContain('var(--editor-view-line-height, 1.7)')
    expect(css).toContain('var(--editor-view-font-family')
    expect(css).not.toContain('font-size: 15px !important')
    expect(css).not.toContain('line-height: 1.85 !important')
  })

  it('keeps Office-inspired continuous document rhythm and neutral blocks', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('--document-canvas: var(--surface)')
    expect(css).toContain('Continuous document surface')
    expect(css).toContain('padding: 32px 60px 96px')
    expect(css).toContain('.editor-input > :first-child')
    expect(css).not.toContain('--document-page-shadow')
    expect(css).toContain('margin-top: 0')
    expect(css).toContain('margin-bottom: 16px')
    expect(css).toContain('border-left: 5px solid')
    expect(css).toContain('border-collapse: collapse !important')
    expect(css).toContain('.editor-input .code-block-wrapper')
    expect(css).toContain('.editor-input .callout-block')
    expect(css).toContain('.editor-input .formula-rendered.block')
  })

  it('uses a fluid 60px content gutter by default', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('.editor-shell.editor-fluid-page .editor-input')
    expect(css).toContain('padding: 32px 60px 96px !important')
    expect(css).toContain('var(--editor-view-page-width, 100%)')
  })

  it('keeps stable top breathing room across viewport sizes', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('padding: 32px 60px 96px !important')
    expect(css).toContain('padding: 28px 44px 84px !important')
    expect(css).toContain('padding: 22px 22px 64px !important')
    expect(css).toContain('.editor-input > :first-child {\n  margin-top: 0;')
  })

  it('sizes markdown tables by content instead of stretching them', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('width: max-content !important')
    expect(css).toContain('max-width: 100% !important')
    expect(css).toContain('padding: 6px 13px')
    expect(css).toContain('max-width: 300px')
    expect(css).not.toContain('.editor-input .editor-table {\n  width: 100% !important')
  })

  it('matches Vditor divider inline-code and table density', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('height: 2px')
    expect(css).toContain('margin: 24px 0')
    expect(css).toContain('font-size: 0.85em')
    expect(css).toContain('width: max-content !important')
    expect(css).toContain('padding: 6px 13px')
    expect(css).toContain('min-height: 24px')
    expect(css).not.toContain('nth-child(even)')
  })

  it('refines document block typography and long-table scrolling', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('font-variant-ligatures: no-common-ligatures')
    expect(css).toContain('text-rendering: optimizeLegibility')
    expect(css).toContain('font-weight: 600')
    expect(css).toContain('color-mix(in srgb, var(--ink) 68%, var(--surface))')
    expect(css).toContain('scrollbar-width: thin')
    expect(css).toContain('overscroll-behavior-x: contain')
    expect(css).toContain('min-height: 26px')
    expect(css).toContain('font-size: 0.85em')
    expect(css).toContain('line-height: 1.6')
  })

  it('aligns the fluid placeholder with the 32px document inset', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('.editor-shell.editor-fluid-page .editor-placeholder {\n  top: 32px !important')
  })

  it('keeps long CJK tables compact and proportioned', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('line-break: strict')
    expect(css).toContain('hyphens: auto')
    expect(css).toContain('.editor-input .editor-table-cell .editor-paragraph {\n  margin: 0;')
    expect(css).toContain('max-width: 180px')
    expect(css).toContain('min-width: 150px')
    expect(css).toContain('max-width: 360px')
    expect(css).toContain('.editor-input .editor-heading-h3 + .editor-table')
  })

  it('uses explicit document contrast tokens for dark mode', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('--document-table-border')
    expect(css).toContain('--document-table-head')
    expect(css).toContain('--document-quote-border')
    expect(css).toContain('--document-quote-text')
    expect(css).toContain('[data-theme="dark"] .editor-shell')
    expect(css).toContain('color-mix(in srgb, #ffffff 16%, var(--surface))')
    expect(css).toContain('color-mix(in srgb, #ffffff 72%, var(--surface))')
  })

  it('keeps focus writing on the same continuous document surface', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('.focus-mode .editor-input')
    expect(css).toContain('box-shadow: none !important')
    expect(css).toContain('.focus-session-active .editor-input')
  })
})
