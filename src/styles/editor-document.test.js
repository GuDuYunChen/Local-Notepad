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

    expect(css).toContain('var(--editor-view-page-width, 860px)')
    expect(css).toContain('var(--editor-view-font-size, 16px)')
    expect(css).toContain('var(--editor-view-line-height, 1.7)')
    expect(css).toContain('var(--editor-view-font-family')
    expect(css).not.toContain('font-size: 15px !important')
    expect(css).not.toContain('line-height: 1.85 !important')
  })

  it('keeps Office-inspired document rhythm and neutral block presentation', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('--document-canvas: color-mix(in srgb, var(--ink) 4%, var(--surface))')
    expect(css).toContain('margin-top: 24px')
    expect(css).toContain('margin-bottom: 16px')
    expect(css).toContain('border-left: 5px solid')
    expect(css).toContain('border-collapse: collapse !important')
    expect(css).toContain('.editor-input .code-block-wrapper')
    expect(css).toContain('.editor-input .callout-block')
    expect(css).toContain('.editor-input .formula-rendered.block')
  })

  it('keeps focus writing free of the page-card chrome', () => {
    const css = read(['src', 'styles', 'editor-document.css'])

    expect(css).toContain('.focus-mode .editor-input')
    expect(css).toContain('box-shadow: none !important')
    expect(css).toContain('.focus-session-active .editor-input')
  })
})
