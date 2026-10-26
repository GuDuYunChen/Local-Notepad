import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const tokens = [read('./index.css'), read('./redesign.css'), read('./dark-theme.css')].join('\n')
const styles = read('../components/Editor/plugins/BlockReferences.css')

test('block-reference controls only consume defined application theme tokens', () => {
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]))
  const used = [...new Set([...styles.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]))]
  expect(used.length).toBeGreaterThan(0)
  expect(used.filter(name => !defined.has(name))).toEqual([])
})

test('block panel and read-only embeds inherit the existing surface and ink themes', () => {
  for (const selector of ['.block-reference-panel', '.block-reference-embed']) {
    const rule = styles.split('\n').find(line => line.startsWith(selector + ' {'))
    expect(rule).toMatch(/background:var\(--surface(?:-hover)?,/)
    expect(rule).toContain('color:var(--ink,')
  }
  expect(styles).not.toMatch(/--(?:bg-primary|bg-secondary|text-primary|accent-color|danger-color)\b/)
})
