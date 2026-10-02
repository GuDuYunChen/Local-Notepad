import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Viewer from './SyncHistoryFileViewer'
import Overview from './SyncOverviewPanel'
import { readHistoryFile } from '~/services/syncHistoryFile.mjs'
import { prepareHistoryExport } from '~/services/syncHistoryExport.mjs'
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs'
import { api } from '~/services/api'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/syncHistoryFile.mjs', async original => { const m = await original(); return { ...m, readHistoryFile: vi.fn(m.readHistoryFile) } })
let root, host, oldAct
const rows = (count = 61) => Array.from({ length: count }, (_, i) => ({ id: 'r' + i, itemID: 'n' + i,
  title: i === count - 1 ? '尾页' : '笔记 ' + i, kind: 'file', status: 'resolved', resolution: 'local', createdAt: 1, resolvedAt: 1790726400 }))
const raw = (records = rows()) => prepareHistoryExport({ snapshot: { items: records, filter: 'all', hasMore: true }, phase: 'ready' }, new Date('2026-10-01T10:00:00Z')).raw
const c = key => host.querySelector('[data-history-file-' + key + ']')
const ids = () => [...host.querySelectorAll('[data-history-file-row]')].map(n => n.querySelectorAll('code')[1].textContent)
async function mount() { await act(async () => root.render(<Viewer/>)); host.querySelector('details').open = true }
async function open(text = raw(), name = 'history.json') {
  await act(async () => {
    Object.defineProperty(c('input'), 'files', { configurable: true, value: [new File([text], name, { type: 'application/json' })] })
    c('input').dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve()
    await readHistoryFile.mock.results.at(-1).value.catch(() => {})
  })
}
async function click(key) { await act(async () => c(key).click()) }
async function type(value, key = 'jump-input') { await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c(key), value)
  c(key).dispatchEvent(new InputEvent('input', { bubbles: true }))
}) }
async function key(options = {}) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', ...options })
  await act(async () => c('jump-input').dispatchEvent(event)); return event
}
const loaded = async () => { await mount(); await open() }
beforeEach(async () => {
  oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const actual = await vi.importActual('~/services/syncHistoryFile.mjs'); readHistoryFile.mockReset().mockImplementation(actual.readHistoryFile)
  api.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct })
it('does not expose navigation or read a file on mount', async () => {
  await mount(); expect(c('jump-input')).toBeNull(); expect(readHistoryFile).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
})
it('first and last locate exact ranges, including the partial final page', async () => {
  await loaded(); expect(c('first').getAttribute('aria-disabled')).toBe('true'); await click('last')
  expect(ids()).toEqual(Array.from({ length: 11 }, (_, i) => 'r' + (50 + i))); expect(c('page').textContent).toContain('51–61')
  expect(c('jump-input').value).toBe('3'); expect(c('last').getAttribute('aria-disabled')).toBe('true')
  await click('first'); expect(ids()[0]).toBe('r0'); expect(ids()).toHaveLength(25); expect(c('jump-input').value).toBe('1')
})
it('jump via Enter uses the current filtered pages, resets scroll, and preserves keyboard focus', async () => {
  await loaded(); c('jump-input').focus(); host.querySelector('.sync-history-file-list').scrollTop = 150
  await type('２'); const event = await key()
  expect(event.defaultPrevented).toBe(true); expect(ids()[0]).toBe('r25'); expect(ids().at(-1)).toBe('r49')
  expect(c('jump-input').value).toBe('2'); expect(document.activeElement).toBe(c('jump-input'))
  expect(host.querySelector('.sync-history-file-list').scrollTop).toBe(0)
})
it('editing a draft alone does not navigate or change whole-file totals', async () => {
  await loaded(); const count = host.querySelector('[data-file-summary-scope]').textContent
  await type('3'); expect(ids()[0]).toBe('r0'); expect(c('page').textContent).toContain('1 / 3')
  expect(host.querySelector('[data-file-summary-scope]').textContent).toBe(count)
})
for (const value of ['0', '4', '1.5', '2e0', '']) it('rejects ' + JSON.stringify(value) + ' without changing the current page', async () => {
  await loaded(); await click('next'); const before = ids(); await type(value); await click('jump')
  expect(ids()).toEqual(before); expect(c('jump-error')).toBeTruthy(); expect(c('jump-input').getAttribute('aria-invalid')).toBe('true')
  expect(c('page').textContent).toContain('2 / 3')
})
it('editing an invalid jump clears its error, then explicit retry can navigate', async () => {
  await loaded(); await type('99'); await click('jump'); expect(c('jump-error')).toBeTruthy()
  await type('3'); expect(c('jump-error')).toBeNull(); await click('jump'); expect(ids()[0]).toBe('r50')
})
it('single-page and empty-match edge controls are no-ops', async () => {
  await loaded(); await type('尾页', 'query'); expect(c('page').textContent).toContain('1 / 1')
  await type('2'); await click('jump'); const error = c('jump-error').textContent
  for (const name of ['first', 'prev', 'next', 'last']) { await click(name); expect(c(name).getAttribute('aria-disabled')).toBe('true') }
  expect(c('jump-error').textContent).toBe(error); expect(ids()).toEqual(['r60'])
  await type('not-here', 'query'); for (const name of ['first', 'prev', 'next', 'last', 'jump']) await click(name)
  expect(ids()).toEqual([]); expect(c('jump-input').readOnly).toBe(true); expect(c('jump-error')).toBeNull()
  expect(c('page').textContent).not.toContain('1 / 0')
})
it('filter changes clear old jump drafts/errors even when both page counts stay the same', async () => {
  await loaded(); await type('99'); await click('jump'); await type('笔记', 'query')
  expect(c('jump-input').value).toBe('1'); expect(c('jump-error')).toBeNull(); expect(c('page').textContent).toContain('1 / 3')
  await type('', 'query'); expect(c('jump-error')).toBeNull()
})
it('same-sized replacement resets the jump draft and error, but cancelling does not', async () => {
  await loaded(); await type('99'); await click('jump')
  await act(async () => { Object.defineProperty(c('input'), 'files', { configurable: true, value: [] }); c('input').dispatchEvent(new Event('change', { bubbles: true })) })
  expect(c('jump-input').value).toBe('99'); expect(c('jump-error')).toBeTruthy()
  await open(raw(), 'replacement.json'); expect(c('jump-input').value).toBe('1'); expect(c('jump-error')).toBeNull()
})
it('invalid file replacement preserves the old file page/draft/error and marks the file stale', async () => {
  await loaded(); await click('last'); await type('99'); await click('jump'); await open('bad', 'invalid.json')
  expect(ids()[0]).toBe('r50'); expect(c('jump-input').value).toBe('99'); expect(c('jump-error')).toBeTruthy(); expect(c('stale')).toBeTruthy()
})
it('IME candidate Enter does not jump, and committing text still needs explicit navigation', async () => {
  await loaded(); await act(async () => c('jump-input').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await type('３'); const event = await key(); expect(event.defaultPrevented).toBe(false); expect(ids()[0]).toBe('r0')
  await click('jump'); expect(ids()[0]).toBe('r0')
  await act(async () => c('jump-input').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '３' })))
  expect(ids()[0]).toBe('r0'); await click('jump'); expect(ids()[0]).toBe('r50')
})
it('modified Enter and composing/keyCode229 events are not consumed', async () => {
  await loaded(); await type('3')
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    const event = await key(options); expect(event.defaultPrevented).toBe(false); expect(ids()[0]).toBe('r0')
  }
})
it('ordinary parent rerender preserves the in-progress jump input and focus', async () => {
  await loaded(); const input = c('jump-input'); input.focus(); await type('2'); await act(async () => root.render(<Viewer/>))
  expect(c('jump-input')).toBe(input); expect(input.value).toBe('2'); expect(document.activeElement).toBe(input); expect(ids()[0]).toBe('r0')
})
it('page navigation neither reads again nor changes source metadata or live history', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), store = vi.spyOn(Storage.prototype, 'setItem'), download = vi.spyOn(HTMLAnchorElement.prototype, 'click')
  await act(async () => root.render(<Overview {...overviewFixture()}/>)); host.querySelector('[data-history-file-viewer]').open = true; await open()
  const live = host.querySelector('[data-sync-conflict-history]').textContent, scope = c('scope').textContent
  await click('last'); await type('2'); await click('jump'); await click('first')
  expect(host.querySelector('[data-sync-conflict-history]').textContent).toBe(live); expect(c('scope').textContent).toBe(scope)
  expect(fetch).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(readHistoryFile).toHaveBeenCalledTimes(1)
})
it('a 2000-record file directly reaches page 80 without skipping or merging records', async () => {
  await mount(); await open(raw(rows(2000))); await type('80'); await click('jump')
  expect(ids()[0]).toBe('r1975'); expect(ids().at(-1)).toBe('r1999'); expect(c('page').textContent).toContain('80 / 80')
})
