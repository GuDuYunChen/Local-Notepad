import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// A resource-kind filter is a compact tab-like control, not a 40px form action.
// Keep the real four filters, pressed state and click behavior unchanged.
test('editor resource-kind buttons use the shared compact content layout', () => {
  const source = readFileSync('src/components/Editor/plugins/ResourceManagerPlugin.jsx', 'utf8')
  const filters = source.match(/<div className="editor-resource-filters">([\s\S]*?)<\/div>/)?.[1]
  expect(filters).toBeDefined()
  expect(filters).toContain('FILTERS.map(([value, label])')
  expect(filters).toContain('<UiButton density="compact" layout="content"')
  expect(filters).toContain('type="button"')
  expect(filters).toContain("className={filter === value ? 'active' : ''}")
  expect(filters).toContain('onClick={() => setFilter(value)}')
  expect(filters).toContain('{label}')
  expect(filters?.match(/<UiButton\b/g)).toHaveLength(1)

  const adapter = readFileSync('src/components/ui/ControlKit.jsx', 'utf8')
  expect(adapter).toContain("layout === 'content' || structural ? 'content' : 'action'")
  const css = readFileSync('src/components/ui/control-kit.css', 'utf8')
  const compact = css.match(/\.app-ui-button\[data-ui-layout="content"\]\s*\{([^{}]*)\}/)?.[1]
  expect(compact).toMatch(/min-height:\s*28px/)
  // Form action rows intentionally retain their 40px target. Resource filters
  // must not inherit that exception merely because the parent ends in "-filters".
  expect(css).toMatch(/\[data-ui-control="button"\]\[data-ui-layout="action"\]\s*\{\s*min-height:40px;/)
})
