// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ThemeToggle from './ThemeToggle'
import { api } from '~/services/api'
import { applyTheme, initializeThemeFromStorage, THEME_STORAGE_KEY } from '~/services/themePreference'
import { ensureTableDarkTheme } from '../../scripts/table-operations-desktop-driver.mjs'

vi.mock('~/services/api', () => ({ api: vi.fn() }))

// The ordinary suite calls the production helper directly. An optional scratch
// file permits the same tests to exercise the exact old driver statements,
// without requiring historical Git objects in a shallow CI checkout.
const baseline = process.env.TABLE_THEME_SOURCE_FIXTURE
let runTheme = ensureTableDarkTheme
if (baseline) {
  const source = readFileSync(baseline, 'utf8')
  const start = source.indexOf('  if (await evaluate("document.documentElement.getAttribute(\'data-theme\')!==\'dark\'"))')
  const end = source.indexOf('\n  await menu(79, 1)', start)
  if (start < 0 || end <= start) throw new Error('The original Table theme statements were not found')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  runTheme = new AsyncFunction('context', 'const { evaluate, click, until } = context;\n' + source.slice(start, end))
}

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const selector = '.theme-toggle[aria-label="切换主题"]'
const errorLabel = 'Actual Table dark theme did not settle'
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve() })
let host, root, response, fixture

function Menu({ count = 1 }) {
  const [open, setOpen] = useState(true)
  return <>
    <button className="workspace-sidebar-more" aria-label="更多功能" onClick={() => setOpen(false)}>更多</button>
    {open && Array.from({ length: count }, (_, index) => <ThemeToggle key={index} />)}
  </>
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  document.documentElement.setAttribute('data-theme', 'light')
  document.documentElement.style.colorScheme = ''
  api.mockReset()
  response = deferred()
  api.mockImplementation(async (path, init) => {
    expect(path).toBe('/api/settings')
    if (!init?.method) return response.promise
    expect(init.method).toBe('PUT')
    return JSON.parse(init.body)
  })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await act(async () => root.unmount())
  host.remove()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.colorScheme = ''
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

async function release(theme) {
  await act(async () => { response.resolve({ theme }); await Promise.resolve() })
  await flush()
}

async function mount({ stored, server, count = 1 } = {}) {
  if (stored !== undefined) localStorage.setItem(THEME_STORAGE_KEY, stored)
  initializeThemeFromStorage()
  await act(async () => root.render(<Menu count={count} />))
  if (server) await release(server)
  fixture = { themeClicks: 0, expressions: [], saves: [], untilCalls: [], report: { nativeInputs: [] }, afterRead: null, afterClick: null }
  const evaluate = async expression => {
    // Execute the actual production renderer expression against the mounted
    // component. This models scheduling; it does not claim native CDP input.
    const value = new Function('document', 'localStorage', 'return (' + expression + ')')(document, localStorage)
    fixture.expressions.push(expression)
    await fixture.afterRead?.(value, fixture.expressions.length)
    return value
  }
  const click = async target => {
    const nodes = document.querySelectorAll(target)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    if (node.matches(':disabled')) throw new Error('Actual mounted control is disabled')
    if (target === selector) fixture.themeClicks++
    await act(async () => {
      for (const [type, input] of [['mousedown', 'mousePressed'], ['mouseup', 'mouseReleased']]) {
        fixture.report.nativeInputs.push({ type: input, fixtureOnly: true })
        node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
      }
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    if (target === selector) await fixture.afterClick?.()
  }
  const until = async (check, label, budget) => {
    fixture.untilCalls.push({ label, budget })
    // Deterministic observations make unresolved/failed inputs quick to test;
    // the real runner still owns its unchanged 15s and 180s deadlines.
    for (let attempt = 0; attempt < 4; attempt++) {
      const value = await check()
      if (value) return value
      await flush()
    }
    throw new Error(label)
  }
  fixture.context = { evaluate, click, until, report: fixture.report,
    save: () => fixture.saves.push(structuredClone(fixture.report.themeTransition)) }
  return fixture
}

const writes = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(init.body))
const state = () => ({ theme: document.documentElement.getAttribute('data-theme'),
  colorScheme: document.documentElement.style.colorScheme, stored: localStorage.getItem(THEME_STORAGE_KEY) })

test('fresh light settings require exactly one real component click', async () => {
  const f = await mount({ server: 'light' })
  await runTheme(f.context)
  expect(f.themeClicks).toBe(1)
  expect(state()).toEqual({ theme: 'dark', colorScheme: 'dark', stored: 'dark' })
  expect(writes()).toEqual([{ theme: 'dark' }])
})

test('retained server dark arriving after the first read never flips back to light', async () => {
  const f = await mount()
  f.afterRead = async (_value, count) => { if (count === 1) await release('dark') }
  const result = await runTheme(f.context).then(() => null, error => error.message)
  // The unchanged old source emits PUT light here before its dark wait fails.
  // Assert the complete outcome so the baseline log retains that causal fact.
  expect({ result, clicks: f.themeClicks, writes: writes(), state: state() }).toEqual({
    result: null, clicks: 0, writes: [], state: { theme: 'dark', colorScheme: 'dark', stored: 'dark' },
  })
})

test('deferred fresh light settings settle before the single requested dark click', async () => {
  const f = await mount()
  f.afterRead = async (_value, count) => { if (count === 1) await release('light') }
  await runTheme(f.context)
  expect(f.themeClicks).toBe(1)
  expect(writes()).toEqual([{ theme: 'dark' }])
  expect(state()).toEqual({ theme: 'dark', colorScheme: 'dark', stored: 'dark' })
})

test('already restored server dark needs no theme click', async () => {
  const f = await mount({ server: 'dark' })
  await runTheme(f.context)
  expect(f.themeClicks).toBe(0); expect(writes()).toEqual([])
  expect(state()).toEqual({ theme: 'dark', colorScheme: 'dark', stored: 'dark' })
})

test('persisted light remains authoritative over a late dark settings response', async () => {
  const f = await mount({ stored: 'light' })
  await runTheme(f.context)
  await release('dark')
  expect(f.themeClicks).toBe(1); expect(writes()).toEqual([{ theme: 'dark' }])
  expect(state()).toEqual({ theme: 'dark', colorScheme: 'dark', stored: 'dark' })
})

test('persisted dark needs no click and a late light response cannot reverse it', async () => {
  const f = await mount({ stored: 'dark' })
  await runTheme(f.context)
  await release('light')
  expect(f.themeClicks).toBe(0)
  expect(writes().every(value => value.theme === 'dark')).toBe(true)
  expect(state()).toEqual({ theme: 'dark', colorScheme: 'dark', stored: 'dark' })
})

test('a user dark choice before the pending settings response is not clicked twice', async () => {
  const f = await mount()
  await f.context.click(selector)
  f.afterRead = async (_value, count) => { if (count === 1) await release('light') }
  await runTheme(f.context)
  expect(f.themeClicks).toBe(1)
  expect(writes().every(value => value.theme === 'dark')).toBe(true)
  expect(state()).toEqual({ theme: 'dark', colorScheme: 'dark', stored: 'dark' })
})

test('cold failed settings are an unmet acceptance prerequisite, with no blind click', async () => {
  const f = await mount()
  await act(async () => { response.reject(new Error('settings offline')); await Promise.resolve() })
  await flush()
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.themeClicks).toBe(0); expect(writes()).toEqual([])
  expect(state()).toEqual({ theme: 'light', colorScheme: 'light', stored: null })
})

test('a cold settings request that never resolves is not treated as initialized', async () => {
  const f = await mount()
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.themeClicks).toBe(0); expect(writes()).toEqual([])
})

test('unreadable theme storage refuses the acceptance action without changing the fallback', async () => {
  const f = await mount({ server: 'light' })
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.themeClicks).toBe(0); expect(writes()).toEqual([])
  expect(document.documentElement.getAttribute('data-theme')).toBe('light')
})

test('unwritable cold storage does not turn an applied fallback into initialized evidence', async () => {
  const f = await mount()
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'QuotaExceededError') })
  await release('light')
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.themeClicks).toBe(0); expect(writes()).toEqual([])
  expect(state()).toEqual({ theme: 'light', colorScheme: 'light', stored: null })
})

test('an applied mode inconsistent with stored preference and committed button is refused', async () => {
  const f = await mount({ stored: 'light' })
  applyTheme('dark', { persist: false, notify: false })
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.themeClicks).toBe(0); expect(writes()).toEqual([])
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
})

test('an ambiguous mounted theme entry is refused even when the document is dark', async () => {
  const f = await mount({ stored: 'dark', count: 2 })
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.themeClicks).toBe(0); expect(writes()).toEqual([])
})

test('a mode changed back after the requested click fails without a second click', async () => {
  const f = await mount({ stored: 'light' })
  f.afterClick = () => act(async () => { applyTheme('light'); await Promise.resolve() })
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.themeClicks).toBe(1)
  expect(writes()).toEqual([{ theme: 'dark' }])
  expect(state()).toEqual({ theme: 'light', colorScheme: 'light', stored: 'light' })
})

test('diagnostics retain actual renderer observations and only one original wait', async () => {
  const f = await mount({ server: 'light' })
  await runTheme(f.context)
  const receipt = f.report.themeTransition
  expect(receipt).toMatchObject({ complete: true, inputStart: 0, inputEnd: 2, clickRequired: true, clicked: true,
    clickInputStart: 0, clickInputEnd: 2,
    before: { theme: 'light', storedTheme: 'light', title: '切换为深色主题', ready: true },
    ready: { theme: 'light', ready: true }, after: { theme: 'dark', storedTheme: 'dark', title: '切换为浅色主题', ready: true } })
  expect(f.untilCalls).toEqual([{ label: errorLabel, budget: undefined }])
  expect(f.expressions.length).toBeGreaterThan(1)
  expect(new Set(f.expressions).size).toBe(1)
  expect(f.saves).toHaveLength(3)
  expect(f.saves.at(-1)).toEqual(receipt)
})

test('diagnostics preserve the last failed observation without writing on every poll', async () => {
  const f = await mount()
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.report.themeTransition).toMatchObject({ complete: false, inputStart: 0, inputEnd: 0,
    clicked: false, clickRequired: null, ready: null, after: null, error: errorLabel,
    last: { theme: 'light', storedTheme: null, storageReadable: true, ready: false } })
  expect(f.untilCalls).toEqual([{ label: errorLabel, budget: undefined }])
  expect(f.expressions).toHaveLength(4)
  expect(f.saves).toHaveLength(2)
  expect(f.saves.at(-1)).toEqual(f.report.themeTransition)
})

test('a failed diagnostic save cannot replace the original initialization deadline', async () => {
  const f = await mount()
  const save = f.context.save
  f.context.save = () => {
    if (f.report.themeTransition?.error) throw new Error('diagnostic disk unavailable')
    save()
  }
  await expect(runTheme(f.context)).rejects.toThrow(errorLabel)
  expect(f.report.themeTransition).toMatchObject({ complete: false, error: errorLabel, saveError: 'diagnostic disk unavailable' })
})
