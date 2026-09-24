import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createHash, randomUUID } from 'node:crypto'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import CollectionStudyHub from './CollectionStudyHub'
import { createCollectionStudyHub } from '../services/collectionStudyHub'
import { createCollectionStudyStore, COLLECTION_STUDY_PREFIX } from '../services/collectionStudy'
import { createSearchCollectionStore } from '../services/searchCollections'
import { collectionReport, memoryStorage } from '../test/collectionFixtures'
import { downloadCollectionReviewReport } from '../services/collectionReviewReport'
vi.mock('../services/collectionReviewReport', async original => ({ ...await original(), downloadCollectionReviewReport: vi.fn() }))
let storage, source, study, service, root, host, target, index
const button = text => [...host.querySelectorAll('button')].find(el => el.textContent === text)
const label = text => host.querySelector(`[aria-label="${text}"]`)
const cards = () => host.querySelectorAll('.study-hub-rows article')
const click = text => act(async () => { expect(button(text)).toBeTruthy(); button(text).click() })
async function change(text, value) { await act(async () => { const el = label(text); Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }) }
const render = (props = {}) => act(async () => root.render(<CollectionStudyHub active service={service} sourceStore={source} studyStore={study} onLocate={target} {...props} />))
function add(name = '关关资料') { const value = source.save(name, collectionReport(23)); return source.list().entries.find(row => row.collection.id === value.id) }
const save = async (entry, id = 'n22', status = 'revisit', note = '待复看批注') => study.saveNote(await study.load(entry, source), id, status, note, { sourceStore: source })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_algorithm, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } })
  storage = memoryStorage(); index = 0; source = createSearchCollectionStore({ storage: () => storage, createId: () => 'c' + (++index) })
  study = createCollectionStudyStore({ storage: () => storage, locks: () => ({ request: (_name, _opts, callback) => Promise.resolve().then(callback) }) })
  service = createCollectionStudyHub({ storage: () => storage, sourceStore: source, studyStore: study }); target = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('shows saved annotations from multiple collections and separate same-ID rows', async () => {
  const a = add('人物'), b = add('地点'); await save(a); await save(b, 'n22', 'read', '另一个批注'); await render()
  expect(cards()).toHaveLength(2); expect(host.textContent).toContain('另一个批注'); expect(host.textContent).toContain('2条已存批注')
})
it('notes-only is explicit and unchecked browsing reaches every page', async () => {
  add(); await render(); expect(cards()).toHaveLength(0)
  await act(async () => host.querySelector('input[type=checkbox]').click()); expect(cards()).toHaveLength(12)
  await click('批注下一页'); expect(cards()).toHaveLength(11); expect(button('批注下一页').disabled).toBe(true)
})
it('filters notes by query and status without modifying storage', async () => {
  const entry = add(); await save(entry); const raw = storage.getItem(COLLECTION_STUDY_PREFIX + entry.collection.id)
  await render(); await change('跨资料集批注关键词', '没有'); expect(cards()).toHaveLength(0)
  await change('跨资料集批注关键词', '待复看'); expect(cards()).toHaveLength(1)
  await change('阅读工作台状态筛选', 'read'); expect(cards()).toHaveLength(0)
  await click('重置阅读筛选'); expect(cards()).toHaveLength(1); expect(storage.getItem(COLLECTION_STUDY_PREFIX + entry.collection.id)).toBe(raw)
})
it('action targets the source collection and exact last-page note', async () => {
  const entry = add(); await save(entry); await render(); await click('查看并编辑此批注')
  expect(target).toHaveBeenCalledWith({ entry: { key: entry.key, raw: entry.raw }, documentId: 'n22' })
})
it('exports the entire filtered set not just twelve visible cards', async () => {
  add(); await render(); await act(async () => host.querySelector('input[type=checkbox]').click()); await click('批注下一页')
  await click('导出筛选批注 JSON'); expect(JSON.parse(downloadCollectionReviewReport.mock.calls[0][0].text).count).toBe(23)
})
it('renders markup inside titles and annotations as ordinary text', async () => {
  const entry = add('<img src=x>'); await save(entry, 'n0', 'read', '<script>alert(1)</script>'); await render()
  expect(host.querySelectorAll('img,script')).toHaveLength(0); expect(host.textContent).toContain('<script>alert(1)</script>')
})
it('same-window saves disable stale actions until manual refresh', async () => {
  const entry = add(); await save(entry); await render(); await act(async () => save(entry, 'n21', 'read', '新批注'))
  expect(button('查看并编辑此批注').disabled).toBe(true); expect(button('导出筛选批注 JSON').disabled).toBe(true)
  await click('刷新阅读工作台'); expect(cards()).toHaveLength(2); expect(button('查看并编辑此批注').disabled).toBe(false)
})
it('cross-window events invalidate but do not read or write a new snapshot automatically', async () => {
  const entry = add(); await save(entry); await render(); const spy = vi.spyOn(service, 'load')
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: COLLECTION_STUDY_PREFIX + entry.collection.id })))
  expect(button('导出筛选批注 JSON').disabled).toBe(true); expect(spy).not.toHaveBeenCalled()
})
it('focus checks catch stale bytes even when storage events were missed', async () => {
  const entry = add(); await save(entry); await render(); storage.removeItem(entry.key)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(button('查看并编辑此批注').disabled).toBe(true)
})
it('corrupt and missing-source records show incomplete coverage and prevent export', async () => {
  const entry = add(); await save(entry); storage.setItem(COLLECTION_STUDY_PREFIX + 'orphan', 'bad'); await render()
  expect(cards()).toHaveLength(1); expect(host.textContent).toContain('1 份记录未计入'); expect(button('导出筛选批注 JSON').disabled).toBe(true)
})
it('storage failure has a retry path and does not masquerade as empty results', async () => {
  vi.spyOn(service, 'load').mockRejectedValueOnce(new Error('存储拒绝访问')); await render()
  expect(label('跨资料集阅读批注工作台').textContent).toContain('存储拒绝访问')
  await click('刷新阅读工作台'); expect(host.textContent).toContain('0 条'); expect(host.querySelector('[role=alert]')).toBeNull()
})
it('cancelling an asynchronous read ignores its late completion', async () => {
  const entry = add(); await save(entry); const model = await service.load(); let finish
  vi.spyOn(service, 'load').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); await click('取消工作台读取'); await act(async () => finish(model)); expect(cards()).toHaveLength(0)
  expect(host.textContent).toContain('已取消读取')
})
it('hiding and reopening refreshes data but retains chosen query', async () => {
  const entry = add(); await save(entry); await render(); await change('跨资料集批注关键词', '批注')
  await render({ active: false }); await act(async () => save(entry, 'n21', 'read', '后来批注')); await render()
  expect(label('跨资料集批注关键词').value).toBe('批注'); expect(cards()).toHaveLength(2)
})
it('late work from a hidden view cannot replace the refreshed snapshot', async () => {
  add(); const old = await service.load(); let resolve
  vi.spyOn(service, 'load').mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await render(); await render({ active: false }); await act(async () => { const entry = add('新资料'); await save(entry) }); await render()
  await act(async () => resolve(old)); expect(cards()).toHaveLength(1); expect(host.textContent).toContain('新资料')
})
it('source deletion before action does not call the target callback', async () => {
  const entry = add(); await save(entry); await render(); storage.removeItem(entry.key); await click('查看并编辑此批注')
  expect(target).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]').textContent).toContain('变化')
})
it('download errors are reported without falsely confirming success', async () => {
  const entry = add(); await save(entry); await render(); downloadCollectionReviewReport.mockImplementationOnce(() => { throw new Error('下载失败') })
  await click('导出筛选批注 Markdown'); expect(host.querySelector('[role=alert]').textContent).toBe('下载失败'); expect(host.textContent).not.toContain('已发起')
})
