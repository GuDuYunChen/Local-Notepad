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
const details = () => [...host.querySelectorAll('[data-history-file-identifiers]')]
const opened = () => details().filter(n => n.open).length
it('has no bulk controls or IO before a successful file read', async () => {
  await mount(); expect(c('expand-identifiers')).toBeNull(); expect(c('collapse-identifiers')).toBeNull(); expect(readHistoryFile).not.toHaveBeenCalled()
})
it('expands and collapses all 25 current rows without changing page or sort', async () => {
  await loaded(); const page=c('page').textContent, select=c('order').value
  expect(opened()).toBe(0); await click('expand-identifiers'); expect(opened()).toBe(25)
  await click('collapse-identifiers'); expect(opened()).toBe(0)
  expect(c('page').textContent).toBe(page); expect(c('order').value).toBe(select)
})
it('repeated actions are idempotent and retain the clicked control focus', async () => {
  await loaded(); const button=c('expand-identifiers'); button.focus()
  await click('expand-identifiers'); await click('expand-identifiers')
  expect(opened()).toBe(25); expect(document.activeElement).toBe(button)
  c('collapse-identifiers').focus(); await click('collapse-identifiers'); await click('collapse-identifiers')
  expect(opened()).toBe(0); expect(document.activeElement).toBe(c('collapse-identifiers'))
})
it('bulk controls only affect identifier details, not date filters, metadata or the viewer', async () => {
  await loaded(); const unrelated=[...host.querySelectorAll('details')].filter(n=>!n.hasAttribute('data-history-file-identifiers'))
  const before=unrelated.map(n=>n.open); await click('expand-identifiers')
  expect(unrelated.map(n=>n.open)).toEqual(before); await click('collapse-identifiers'); expect(unrelated.map(n=>n.open)).toEqual(before)
})
it('the partial final page reports and expands exactly eleven rows', async () => {
  await loaded(); await click('last'); expect(details()).toHaveLength(11)
  expect(c('record-tools').textContent).toContain('本页 11 条记录'); await click('expand-identifiers'); expect(opened()).toBe(11)
})
for (const context of ['page','order','filter','file']) it(context+' changes close identifiers in the new context',async()=>{
  await loaded(); await click('expand-identifiers'); expect(opened()).toBe(25)
  if(context==='page') await click('next')
  if(context==='order') await order('completed-asc')
  if(context==='filter') await type('尾页','query')
  if(context==='file') await open(raw(),'new-with-same-ids.json')
  expect(opened()).toBe(0)
})
it('manual expansion, jump draft and focus survive ordinary rerender and same-order selection', async()=>{
  await loaded(); details()[0].open=true; await type('2'); c('jump-input').focus()
  await act(async()=>root.render(<Viewer/>)); await order('file')
  expect(opened()).toBe(1); expect(c('jump-input').value).toBe('2'); expect(document.activeElement).toBe(c('jump-input'))
})
it('failed replacement and picker cancellation retain expanded identifiers and jump error',async()=>{
  await loaded(); await click('expand-identifiers'); await type('99'); await click('jump')
  await open('bad','invalid.json'); expect(opened()).toBe(25); expect(c('stale')).toBeTruthy(); expect(c('jump-error')).toBeTruthy()
  await act(async()=>{Object.defineProperty(c('input'),'files',{configurable:true,value:[]});c('input').dispatchEvent(new Event('change',{bubbles:true}))})
  expect(opened()).toBe(25); expect(c('jump-input').value).toBe('99')
})
it('an unfinished IME query does not collapse rows or get committed by bulk display controls',async()=>{
  await loaded(); await click('expand-identifiers')
  await act(async()=>c('query').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
  await type('尾页','query'); await click('collapse-identifiers'); expect(c('composing')).toBeTruthy()
  expect(c('query').value).toBe('尾页'); expect(ids()).toHaveLength(25)
  await act(async()=>c('query').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'尾页'})))
  expect(ids()).toEqual(['r60']); expect(opened()).toBe(0)
})
it('empty results retain disabled, focusable no-op controls and honest page-only scope',async()=>{
  await loaded(); await type('no-such-record','query'); expect(details()).toHaveLength(0)
  for(const name of ['expand-identifiers','collapse-identifiers']){expect(c(name).getAttribute('aria-disabled')).toBe('true');await click(name)}
  expect(c('record-tools').textContent).toContain('本页 0 条记录'); expect(c('page').textContent).not.toContain('1 / 0')
})
it('bulk display keeps full-match summary, file declarations, live history and IO counts unchanged',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch'),store=vi.spyOn(Storage.prototype,'setItem'),download=vi.spyOn(HTMLAnchorElement.prototype,'click')
  await act(async()=>root.render(<Overview {...overviewFixture()}/>));host.querySelector('[data-history-file-viewer]').open=true;await open()
  const live=host.querySelector('[data-sync-conflict-history]').textContent,scope=c('scope').textContent,summary=host.querySelector('[data-file-summary-scope]').textContent
  await click('expand-identifiers');await click('collapse-identifiers')
  expect(host.querySelector('[data-sync-conflict-history]').textContent).toBe(live);expect(c('scope').textContent).toBe(scope);expect(host.querySelector('[data-file-summary-scope]').textContent).toBe(summary)
  expect(readHistoryFile).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled()
})
it('clearing the viewer removes controls and new files start collapsed',async()=>{
  await loaded();await click('expand-identifiers');await click('clear');expect(c('expand-identifiers')).toBeNull()
  await open();expect(opened()).toBe(0)
})
it('the controls point to the actual list and describe their current-page scope',async()=>{
  await loaded();const list=host.querySelector('.sync-history-file-list')
  for(const name of ['expand-identifiers','collapse-identifiers'])expect(c(name).getAttribute('aria-controls')).toBe(list.id)
  expect(document.getElementById(c('record-tools').getAttribute('aria-describedby')).textContent).toContain('不改变筛选、排序或文件')
})
