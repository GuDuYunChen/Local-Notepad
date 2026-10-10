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
  title: i === count - 1 ? '尾页' : '笔记 ' + i, kind: 'file', status: 'resolved', resolution: 'local',
  createdAt: i === count - 1 ? 0 : i + 1, resolvedAt: i === count - 1 ? 0 : 1790812800 + count - i }))
const raw = (records = rows()) => prepareHistoryExport({ snapshot: { items: records, filter: 'all', hasMore: true }, phase: 'ready' }, new Date('2026-10-01T10:00:00Z')).raw
const c = key => host.querySelector('[data-history-file-' + key + ']')
const ids = () => [...host.querySelectorAll('[data-history-file-row]')].map(n => n.querySelectorAll('code')[1].textContent)
async function mount() { await act(async () => root.render(<Viewer/>)); host.querySelector('details').open = true }
async function open(text = raw(), name = 'history.json', wait = true) {
  await act(async () => {
    Object.defineProperty(c('input'), 'files', { configurable: true, value: [new File([text], name, { type: 'application/json' })] })
    c('input').dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve()
    if (wait) await readHistoryFile.mock.results.at(-1).value.catch(() => {})
  })
}
async function click(key) { await act(async () => c(key).click()) }
async function type(value, key = 'jump-input') { await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c(key), value)
  c(key).dispatchEvent(new InputEvent('input', { bubbles: true }))
}) }
async function order(value) { await act(async () => { c('order').value = value; c('order').dispatchEvent(new Event('change', { bubbles: true })) }) }
const loaded = async () => { await mount(); await open() }
beforeEach(async () => {
  oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const actual = await vi.importActual('~/services/syncHistoryFile.mjs'); readHistoryFile.mockReset().mockImplementation(actual.readHistoryFile)
  api.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct })
it('has no order control or read before a file is loaded; defaults to file order afterwards', async () => {
  await mount(); expect(c('order')).toBeNull(); expect(readHistoryFile).not.toHaveBeenCalled()
  await open(); expect(c('order').value).toBe('file'); expect(ids()).toEqual(Array.from({length:25},(_,i)=>'r'+i))
  expect([...c('order').options].map(n=>n.value)).toEqual(['file','completed-desc','completed-asc','created-desc','created-asc'])
})
for (const value of ['completed-asc','created-desc']) it(value + ' orders all matches before paging, with missing time last', async () => {
  await loaded(); await order(value); expect(ids()).toEqual(Array.from({length:25},(_,i)=>'r'+(59-i)))
  await click('last'); expect(ids()).toEqual([...Array.from({length:10},(_,i)=>'r'+(9-i)),'r60'])
  expect(c('page').textContent).toContain('3 / 3'); await order('file'); expect(ids()[0]).toBe('r0')
})
it('changing order resets page, scroll and invalid jump draft without changing source or full-match summary', async () => {
  await loaded(); await click('last'); await type('99'); await click('jump')
  const scope=c('scope').textContent, summary=host.querySelector('[data-file-summary-scope]').textContent
  host.querySelector('.sync-history-file-list').scrollTop=100; c('order').focus(); const select=c('order')
  await order('completed-asc'); expect(ids()[0]).toBe('r59'); expect(c('page').textContent).toContain('1 / 3')
  expect(c('jump-input').value).toBe('1'); expect(c('jump-error')).toBeNull(); expect(c('order')).toBe(select)
  expect(document.activeElement).toBe(select); expect(host.querySelector('.sync-history-file-list').scrollTop).toBe(0)
  expect(c('scope').textContent).toBe(scope); expect(host.querySelector('[data-file-summary-scope]').textContent).toBe(summary)
})
it('same order and ordinary rerender preserve an unfinished jump draft and current page', async () => {
  await loaded(); await order('created-desc'); await click('next'); await type('3')
  await order('created-desc'); await act(async()=>root.render(<Viewer/>))
  expect(c('page').textContent).toContain('2 / 3'); expect(c('jump-input').value).toBe('3'); expect(c('order').value).toBe('created-desc')
})
it('clearing filters preserves the selected display order; returning to file order restores source rows', async () => {
  await loaded(); await order('completed-asc'); await type('尾页','query'); expect(ids()).toEqual(['r60'])
  await click('filter-clear'); expect(c('order').value).toBe('completed-asc'); expect(ids()[0]).toBe('r59')
  await order('file'); expect(ids()[0]).toBe('r0')
})
it('failed replacement and cancellation retain order, page and jump context; successful replacement resets all three', async () => {
  await loaded(); await order('completed-asc'); await click('last'); await type('99'); await click('jump')
  await open('bad','invalid.json'); expect(c('stale')).toBeTruthy(); expect(c('order').value).toBe('completed-asc')
  expect(c('page').textContent).toContain('3 / 3'); expect(c('jump-input').value).toBe('99')
  await act(async()=>{Object.defineProperty(c('input'),'files',{configurable:true,value:[]});c('input').dispatchEvent(new Event('change',{bubbles:true}))})
  expect(c('order').value).toBe('completed-asc'); expect(c('jump-error')).toBeTruthy()
  await open(raw(),'replacement.json'); expect(c('order').value).toBe('file'); expect(c('page').textContent).toContain('1 / 3')
  expect(c('jump-input').value).toBe('1'); expect(c('jump-error')).toBeNull()
})
it('zero results keep sorting available without creating a page or adding records', async () => {
  await loaded(); await type('不存在的记录','query'); await order('created-asc')
  expect(ids()).toEqual([]); expect(c('jump-input').readOnly).toBe(true); expect(c('page').textContent).not.toContain('1 / 0')
  await click('filter-clear'); expect(c('order').value).toBe('created-asc'); expect(ids()[0]).toBe('r0')
})
it('sorting does not commit an unfinished IME query or reset its draft', async () => {
  await loaded(); await act(async()=>c('query').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
  await type('尾页','query'); await order('completed-asc')
  expect(c('query').value).toBe('尾页'); expect(c('composing')).toBeTruthy(); expect(ids()[0]).toBe('r59')
  await act(async()=>c('query').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'尾页'})))
  expect(ids()).toEqual(['r60']); expect(c('order').value).toBe('completed-asc')
})
it('sorting performs no extra IO and does not modify live history, source declarations or the original File', async () => {
  const fetch=vi.spyOn(globalThis,'fetch'),store=vi.spyOn(Storage.prototype,'setItem'),download=vi.spyOn(HTMLAnchorElement.prototype,'click')
  await act(async()=>root.render(<Overview {...overviewFixture()}/>)); host.querySelector('[data-history-file-viewer]').open=true
  const text=raw(); await open(text); const live=host.querySelector('[data-sync-conflict-history]').textContent,scope=c('scope').textContent
  for(const value of ['created-desc','completed-asc','completed-desc','created-asc','file']) await order(value)
  expect(c('scope').textContent).toBe(scope); expect(host.querySelector('[data-sync-conflict-history]').textContent).toBe(live)
  expect(readHistoryFile).toHaveBeenCalledTimes(1); expect(readHistoryFile.mock.calls[0][0].size).toBe(new TextEncoder().encode(text).length)
  expect(fetch).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled()
})
it('a 2000-record file still allows direct page 80 after sorting with no gaps or duplicates', async () => {
  await mount(); await open(raw(rows(2000))); await order('completed-asc'); await type('80'); await click('jump')
  expect(ids()).toEqual([...Array.from({length:24},(_,i)=>'r'+(23-i)),'r1999']); expect(c('page').textContent).toContain('80 / 80')
})

it('clearing the viewer removes order state; a later file starts in its original order', async () => {
  await loaded(); await order('created-desc'); await click('clear'); expect(c('order')).toBeNull()
  await open(); expect(c('order').value).toBe('file'); expect(ids()[0]).toBe('r0')
})
it('sorting preserves an unapplied UTC date draft and applies it only on explicit confirmation', async () => {
  await loaded(); const d = key => c('date-filter').querySelector('[data-history-time-' + key + ']')
  await act(async () => { d('mode').value = 'range'; d('mode').dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(d('from'), '2026-10-02')
    d('from').dispatchEvent(new Event('input', { bubbles: true })); d('from').dispatchEvent(new Event('change', { bubbles: true }))
  })
  await order('completed-asc'); expect(d('from').value).toBe('2026-10-02'); expect(d('pending')).toBeTruthy()
  expect(ids()[0]).toBe('r59'); expect(c('matches').textContent).toContain('61 条 / 文件内共 61 条')
  await act(async () => d('apply').click()); expect(ids()).toEqual([]); expect(c('order').value).toBe('completed-asc')
})
it('stopping a replacement preserves ordering and ignores its late successful response', async () => {
  await loaded(); await order('completed-asc'); await click('last'); await type('99'); await click('jump')
  let finish; readHistoryFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await open(raw(), 'pending.json', false); await click('stop')
  const actual = await vi.importActual('~/services/syncHistoryFile.mjs')
  await act(async () => finish(actual.parseHistoryFile(raw())))
  expect(c('stale')).toBeTruthy(); expect(c('order').value).toBe('completed-asc'); expect(c('page').textContent).toContain('3 / 3')
  expect(c('jump-input').value).toBe('99'); expect(c('jump-error')).toBeTruthy(); expect(ids().at(-1)).toBe('r60')
})
