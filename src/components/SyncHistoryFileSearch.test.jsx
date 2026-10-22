import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Viewer from './SyncHistoryFileViewer'
import Overview from './SyncOverviewPanel'
import { readHistoryFile, parseHistoryFile } from '~/services/syncHistoryFile.mjs'
import { prepareHistoryExport } from '~/services/syncHistoryExport.mjs'
import { api } from '~/services/api'
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs'
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/syncHistoryFile.mjs', async original => {
  const module = await original(); return { ...module, readHistoryFile: vi.fn(module.readHistoryFile) }
})
let host, root, previousAct
const records = () => Array.from({ length: 61 }, (_, i) => ({
  id: 'r' + i, itemID: 'object-' + i, title: i === 60 ? '尾页 星图 ＡＢＣ Café 🌱' : '笔记 ' + i,
  kind: i % 2 ? 'tag' : 'file', status: i === 60 ? 'superseded' : 'resolved',
  resolution: i === 60 ? 'remote-rebind' : i % 3 ? 'remote' : 'local', createdAt: 1, resolvedAt: 1790726400,
}))
const raw = (rows = records(), extra = {}) => prepareHistoryExport({ snapshot: { items: rows, filter: 'all', hasMore: true }, phase: 'ready', ...extra }, new Date('2026-09-30T10:00:00Z')).raw
const c = key => host.querySelector('[data-history-file-' + key + ']')
const ids = () => [...host.querySelectorAll('[data-history-file-row]')].map(n => n.querySelectorAll('code')[1].textContent)
async function mount() { await act(async () => root.render(<Viewer/>)); host.querySelector('details').open = true }
async function select(file, wait = true) {
  await act(async () => {
    Object.defineProperty(c('input'), 'files', { configurable: true, value: file ? [file] : [] })
    c('input').dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve()
    if (file && wait) await readHistoryFile.mock.results.at(-1).value.catch(() => {})
  })
}
const open = async (text = raw(), name = 'history.json') => select(new File([text], name, { type: 'application/json' }))
async function type(value, composing = false) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c('query'), value)
    c('query').dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }))
  })
}
async function click(key) { await act(async () => c(key).click()) }
async function choose(key, value) { await act(async () => { c(key).value = value; c(key).dispatchEvent(new Event('change', { bubbles: true })) }) }
async function compose(typeName, value) {
  await act(async () => {
    if (value !== undefined) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c('query'), value)
    c('query').dispatchEvent(new CompositionEvent(typeName, { bubbles: true, data: value || '' }))
  })
}
const loaded = async () => { await mount(); await open() }
beforeEach(async () => {
  previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const module = await vi.importActual('~/services/syncHistoryFile.mjs'); readHistoryFile.mockReset().mockImplementation(module.readHistoryFile)
  api.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct })
it('does not expose file search before a successful explicit file read', async () => {
  await mount(); expect(c('query')).toBeNull(); await select(null)
  expect(readHistoryFile).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
})
it('searches the entire file, including records outside the visible page', async () => {
  await loaded(); expect(ids()).not.toContain('r60'); await type('星图')
  expect(ids()).toEqual(['r60']); expect(c('matches').textContent).toContain('当前匹配 1 条 / 文件内共 61 条')
  expect(c('page').textContent).toContain('1 / 1'); expect(readHistoryFile).toHaveBeenCalledTimes(1); expect(api).not.toHaveBeenCalled()
})
it('supports case folding, full-width letters, accents and IDs with literal matching', async () => {
  await loaded()
  for (const q of ['abc', 'CAFÉ', '🌱', 'OBJECT-60', 'r60']) { await type(q); expect(ids()).toEqual(['r60']) }
  await type('.*'); expect(ids()).toEqual([])
})
it('intersects all three conditions and does not reclassify invalidation as a remote choice', async () => {
  await loaded(); await type('笔记'); await choose('kind', 'tag'); await choose('outcome', 'local')
  expect(ids()).toHaveLength(10); expect(c('matches').textContent).toContain('10 条 / 文件内共 61 条')
  await type('星图'); await choose('kind', 'file'); await choose('outcome', 'remote'); expect(ids()).toEqual([])
  await choose('outcome', 'superseded'); expect(ids()).toEqual(['r60']); expect(c('row').textContent).toContain('不代表已选边')
})
it('resets pagination and scroll on a changed condition but keeps input focus', async () => {
  await loaded(); await click('next'); await click('next'); c('query').focus()
  host.querySelector('.sync-history-file-list').scrollTop = 120; await type('笔记')
  expect(c('page').textContent).toContain('1 / 3'); expect(ids()[0]).toBe('r0')
  expect(host.querySelector('.sync-history-file-list').scrollTop).toBe(0); expect(document.activeElement).toBe(c('query'))
})
it('zero matches disable both paging directions without inventing page 1 of 0', async () => {
  await loaded(); await type('missing'); await click('prev'); await click('next')
  expect(c('prev').getAttribute('aria-disabled')).toBe('true'); expect(c('next').getAttribute('aria-disabled')).toBe('true')
  expect(c('page').textContent).toContain('暂无可翻页'); expect(c('page').textContent).not.toContain('1 / 0')
  expect(c('empty').textContent).toContain('不是本机或全部历史没有记录')
})
it('clear restores all file records and first page without clearing the file or its declared scope', async () => {
  await loaded(); const declaration = c('scope').textContent, source = c('source').textContent
  await type('星图'); await choose('kind', 'file'); await choose('outcome', 'superseded'); c('filter-clear').focus(); await click('filter-clear')
  expect(c('name').textContent).toBe('history.json'); expect(ids()).toHaveLength(25)
  expect(c('matches').textContent).toContain('61 条 / 文件内共 61 条'); expect(document.activeElement).toBe(c('query'))
  expect(c('scope').textContent).toBe(declaration); expect(c('source').textContent).toBe(source); expect(readHistoryFile).toHaveBeenCalledTimes(1)
})
it('IME candidate input leaves the committed selection and page intact until confirmation', async () => {
  await loaded(); await type('笔记'); await click('next'); const before = ids()
  await compose('compositionstart'); await type('xingtu', true)
  expect(ids()).toEqual(before); expect(c('query').value).toBe('xingtu'); expect(c('composing')).toBeTruthy()
  await compose('compositionend', '星图'); expect(ids()).toEqual(['r60']); expect(c('page').textContent).toContain('1 / 1')
})
it('does not truncate a composition candidate before selection at the Unicode limit', async () => {
  await loaded(); await type('中'.repeat(127)); await compose('compositionstart'); await type('中'.repeat(127) + 'zhong', true)
  expect(c('query').value).toBe('中'.repeat(127) + 'zhong')
  await compose('compositionend', '中'.repeat(129)); expect(c('query').value).toBe('中'.repeat(128))
  await type('🌱'.repeat(130)); expect(c('query').value).toBe('🌱'.repeat(128))
})
it('clear during composition prevents a late end event from reviving old text', async () => {
  await loaded(); await type('星图'); await compose('compositionstart'); await type('xingtu', true); await click('filter-clear')
  await compose('compositionend'); expect(c('query').value).toBe(''); expect(c('composing')).toBeNull(); expect(ids()).toHaveLength(25)
})
it('cancelled composition returns to the prior query without resetting the current page', async () => {
  await loaded(); await type('笔记'); await click('next'); const before = ids()
  await compose('compositionstart'); await type('pin', true); await compose('compositionend', '笔记')
  expect(ids()).toEqual(before); expect(c('page').textContent).toContain('2 / 3')
})
it('invalid replacement preserves the previous file selection and page, labelled stale', async () => {
  await loaded(); await type('笔记'); await click('next'); const before = ids()
  await open('invalid', 'bad.json'); expect(ids()).toEqual(before); expect(c('query').value).toBe('笔记')
  expect(c('name').textContent).toBe('history.json'); expect(c('stale')).toBeTruthy(); expect(c('page').textContent).toContain('2 / 3')
})
it('successful replacement resets file-only filters and page without hiding the new contents', async () => {
  await loaded(); await type('星图'); await choose('outcome', 'superseded')
  await open(raw([{ ...records()[0], id: 'fresh', title: '新文件' }]), 'replacement.json')
  expect(c('query').value).toBe(''); expect(c('outcome').value).toBe('all'); expect(ids()).toEqual(['fresh'])
})
it('stopping a replacement preserves filters, rejects late results and allows further local search', async () => {
  await loaded(); await type('笔记'); let finish
  readHistoryFile.mockImplementationOnce(() => new Promise(r => finish = r))
  await select(new File([raw()], 'slow.json'), false); await choose('kind', 'tag'); await click('stop')
  await act(async () => finish(parseHistoryFile(raw())))
  expect(c('kind').value).toBe('tag'); expect(c('query').value).toBe('笔记'); expect(c('stale')).toBeTruthy()
  await type('object-59'); expect(ids()).toEqual(['r59'])
})
it('cancelled picker and parent rerender preserve current file criteria and page', async () => {
  await loaded(); await type('笔记'); await click('next'); const input = c('query'), before = ids()
  await select(null); await act(async () => root.render(<Viewer/>))
  expect(c('query')).toBe(input); expect(ids()).toEqual(before); expect(c('query').value).toBe('笔记')
})
it('a late older file cannot overwrite new file filters after a newer read succeeds', async () => {
  await loaded(); let finish
  readHistoryFile.mockImplementationOnce(() => new Promise(r => finish = r)); await select(new File([raw()], 'slow.json'), false)
  await open(raw(), 'new.json'); await type('星图'); await act(async () => finish(parseHistoryFile(raw())))
  expect(c('name').textContent).toBe('new.json'); expect(c('query').value).toBe('星图'); expect(ids()).toEqual(['r60'])
})
it('clear-view then reopen and component remount forget file-only search state', async () => {
  await loaded(); await type('星图'); await click('clear'); expect(c('query')).toBeNull()
  await open(); expect(c('query').value).toBe(''); await type('私人标题')
  await act(async () => root.unmount()); root = createRoot(host); await mount(); await open(); expect(c('query').value).toBe('')
})
it('file filter actions do not download, store criteria, fetch or re-read the original file', async () => {
  const network = vi.spyOn(globalThis, 'fetch'), write = vi.spyOn(Storage.prototype, 'setItem'), download = vi.spyOn(HTMLAnchorElement.prototype, 'click')
  await loaded(); await type('星图'); await choose('kind', 'file'); await choose('outcome', 'superseded'); await click('filter-clear')
  expect(network).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled()
  expect(readHistoryFile).toHaveBeenCalledTimes(1); expect(api).not.toHaveBeenCalled()
})
it('escapes file text and query markup and does not treat private notices as searchable records', async () => {
  const d = JSON.parse(raw([{ ...records()[0], title: '<img src=x onerror=alert(1)>' }]))
  d.notices = ['PRIVATE_INSTRUCTION']; await mount(); await open(JSON.stringify(d)); await type('<img')
  expect(ids()).toEqual(['r0']); expect(host.querySelector('script,img,a,iframe')).toBeNull()
  await type('PRIVATE_INSTRUCTION'); expect(ids()).toEqual([])
})
it('the current file keeps original v2 date/source declarations while the local view is narrowed', async () => {
  await mount(); await open(raw(undefined, { phase: 'error', timeFilter: { mode: 'range', from: '2026-09-30', to: '2026-09-30' } }))
  const scope = c('scope').textContent, dates = c('dates').textContent; await type('星图')
  expect(c('scope').textContent).toBe(scope); expect(c('dates').textContent).toBe(dates); expect(c('source').textContent).toContain('最近一次读取失败')
  expect(c('matches').textContent).toContain('1 条 / 文件内共 61 条')
})
it('searching an offline file never changes live history filters, summary or export metadata', async () => {
  api.mockResolvedValue(historyPage([{ ...historyRow('live'), current_title: '本机历史' }]))
  const navigate = vi.fn(); await act(async () => root.render(<Overview {...overviewFixture()} onNavigate={navigate}/>))
  host.querySelector('[data-sync-conflict-history]').open = true; host.querySelector('[data-history-file-viewer]').open = true
  await act(async () => host.querySelector('[data-history-read]').click())
  const live = host.querySelector('[data-sync-conflict-history]').textContent, guidance = host.querySelector('[data-sync-guidance]').textContent
  await open(); await type('星图'); await choose('outcome', 'superseded'); await click('filter-clear')
  expect(host.querySelector('[data-sync-conflict-history]').textContent).toBe(live)
  expect(host.querySelector('[data-sync-guidance]').textContent).toBe(guidance); expect(api).toHaveBeenCalledTimes(1); expect(navigate).not.toHaveBeenCalled()
})
