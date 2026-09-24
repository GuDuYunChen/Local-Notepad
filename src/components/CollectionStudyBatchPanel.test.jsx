import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createHash, randomUUID } from 'node:crypto'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import CollectionStudyHub from './CollectionStudyHub'
import { createCollectionStudyHub } from '../services/collectionStudyHub'
import { createCollectionStudyStore } from '../services/collectionStudy'
import { createSearchCollectionStore } from '../services/searchCollections'
import { collectionStudyDrafts, studyDraftKey } from '../services/collectionStudyDrafts'
import { collectionReport, memoryStorage } from '../test/collectionFixtures'

let storage, source, study, hub, root, host, index, locks, locate
const button = text => [...host.querySelectorAll('button')].find(el => el.textContent === text)
const label = text => host.querySelector(`[aria-label="${text}"]`)
async function click(text) { await act(async () => { const el = button(text); expect(el).toBeTruthy(); el.click() }) }
async function toggle(name) { await act(async () => { expect(label(name)).toBeTruthy(); label(name).click() }) }
async function change(name, value) { await act(async () => { const el = label(name); Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }) }
const render = (props = {}) => act(async () => root.render(<CollectionStudyHub active service={hub} sourceStore={source} studyStore={study} onLocate={locate} {...props} />))
function add(count = 23, name = '资料集') { const c = source.save(name, collectionReport(count)); return source.list().entries.find(e => e.collection.id === c.id) }
const snapshot = e => study.load(e, source)
const mark = async (e, id, status = 'unread', note = '原批注') => study.saveNote(await snapshot(e), id, status, note, { sourceStore: source })
const showAll = () => act(async () => host.querySelector('.study-hub-check input').click())
async function selectAndPrepare() { await click('选择本页批注'); await click('预检批量标记') }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_alg, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } })
  storage = memoryStorage(); index = 0; locate = vi.fn()
  source = createSearchCollectionStore({ storage: () => storage, createId: () => 'c' + (++index) })
  locks = { request: vi.fn((_name, _opts, fn) => Promise.resolve().then(fn)) }
  study = createCollectionStudyStore({ storage: () => storage, locks: () => locks })
  hub = createCollectionStudyHub({ storage: () => storage, sourceStore: source, studyStore: study })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  for (const { key } of collectionStudyDrafts.list()) collectionStudyDrafts.remove(key)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('collects multiple pages and preflights without mutation until confirmed', async () => {
  const entry = add(); await render(); await showAll(); await click('选择本页批注'); await click('批注下一页'); await click('选择本页批注')
  expect(host.textContent).toContain('已选 23 / 200 条'); await click('预检批量标记')
  expect(label('批量标记预检').textContent).toContain('将把 23 条改为“待复看”')
  expect((await snapshot(entry)).data.records).toHaveLength(0)
  await click('确认批量标记'); expect((await snapshot(entry)).data.records).toHaveLength(23)
  expect(host.textContent).toContain('已修改 23 条'); expect(host.textContent).toContain('已选 0 / 200 条')
})
it('cancelling the preview does not write or discard the selection', async () => {
  const e = add(2); await render(); await showAll(); await selectAndPrepare(); await click('取消批量预检')
  expect((await snapshot(e)).data.records).toHaveLength(0); expect(label('批量标记预检')).toBeNull(); expect(host.textContent).toContain('已选 2 / 200 条')
})
it('supports explicit row selection, deselection and clearing', async () => {
  add(2); await render(); await showAll(); await toggle('选择批注 c1 n0'); expect(host.textContent).toContain('已选 1 / 200 条')
  await toggle('选择批注 c1 n0'); expect(host.textContent).toContain('已选 0 / 200 条')
  await click('选择本页批注'); await click('清空批量选择'); expect(label('选择批注 c1 n0').checked).toBe(false)
})
it('filter changes clear selections rather than modifying hidden old choices', async () => {
  add(23); await render(); await showAll(); await click('选择本页批注'); await change('跨资料集批注关键词', '章节 22')
  expect(host.textContent).toContain('已选 0 / 200 条'); expect(button('预检批量标记').disabled).toBe(true)
})
it('changes target status without changing notes or bookmark', async () => {
  const e = add(2); const before = await mark(e, 'n0', 'revisit', '中文\n😀'); await render(); await click('选择本页批注')
  await change('批量阅读目标状态', 'read'); await click('预检批量标记'); await click('确认批量标记')
  const after = await snapshot(e); expect(after.data.records[0].note).toBe('中文\n😀'); expect(after.data.bookmark).toEqual(before.data.bookmark)
  expect(locate).not.toHaveBeenCalled()
})
it('no-op preview cannot be confirmed and does not alter timestamps', async () => {
  const e = add(1); const before = await mark(e, 'n0', 'revisit'); await render(); await selectAndPrepare()
  expect(button('确认批量标记').disabled).toBe(true); expect(label('批量标记预检').textContent).toContain('将把 0 条')
  expect((await snapshot(e)).raw).toBe(before.raw)
})
it('can undo committed marks after the workbench has refreshed', async () => {
  const e = add(1); await mark(e, 'n0', 'unread'); await render(); await selectAndPrepare(); await click('确认批量标记')
  expect((await snapshot(e)).data.records[0].status).toBe('revisit')
  await click('撤销本轮标记'); expect((await snapshot(e)).data.records[0].status).toBe('unread')
  expect(host.textContent).toContain('本次已撤销 1 条，未撤销 0 条')
})
it('retains newer annotations when undo conflicts and leaves a clear remaining count', async () => {
  const e = add(1); await mark(e, 'n0'); await render(); await selectAndPrepare(); await click('确认批量标记')
  await act(async () => mark(e, 'n0', 'read', '后来批注'))
  await click('撤销本轮标记'); expect((await snapshot(e)).data.records[0].note).toBe('后来批注')
  expect(host.textContent).toContain('未撤销 1 条'); expect(host.textContent).toContain('已在其他操作中更新')
})
it('requires finishing the prior undo round before preparing another batch', async () => {
  add(1); await render(); await showAll(); await selectAndPrepare(); await click('确认批量标记'); await click('选择本页批注')
  expect(button('预检批量标记').disabled).toBe(true); await click('结束本轮并保留当前状态')
  expect(button('预检批量标记').disabled).toBe(false)
})
it('blocks a selected annotation draft without erasing it', async () => {
  const e = add(1), s = await snapshot(e), key = studyDraftKey(s, 'n0'); collectionStudyDrafts.set(key, { note: '草稿未存', status: 'read' })
  await render(); await showAll(); await selectAndPrepare(); expect(host.textContent).toContain('所选条目有未保存批注')
  expect(collectionStudyDrafts.get(key).note).toBe('草稿未存'); expect(label('批量标记预检')).toBeNull()
})
it('invalidates pending preflight when another save changes the model', async () => {
  const e = add(1); await mark(e, 'n0'); await render(); await selectAndPrepare(); await act(async () => mark(e, 'n0', 'read', '新文字'))
  expect(label('批量标记预检')).toBeNull(); expect(button('预检批量标记').disabled).toBe(true)
})
it('shows an actual write failure with no false success or discarded draft', async () => {
  const e = add(1); await render(); await showAll(); await selectAndPrepare()
  vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await click('确认批量标记'); expect(host.textContent).toContain('已修改 0 条'); expect(host.textContent).toContain('尚未修改 1 条')
  expect((await snapshot(e)).data.records).toHaveLength(0)
})
it('stopping during lock wait prevents the pending mutation', async () => {
  const e = add(1); await render(); await showAll(); await selectAndPrepare(); let release
  locks.request.mockImplementationOnce((_name, _opts, fn) => new Promise((resolve, reject) => { release = () => Promise.resolve().then(fn).then(resolve, reject) }))
  await click('确认批量标记'); await click('停止批量处理'); await act(async () => release())
  expect((await snapshot(e)).data.records).toHaveLength(0); expect(host.textContent).toContain('已修改 0 条')
})
it('hiding the tab cancels pending writes and clears selection', async () => {
  const e = add(1); await render(); await showAll(); await selectAndPrepare(); let release
  locks.request.mockImplementationOnce((_name, _opts, fn) => new Promise((resolve, reject) => { release = () => Promise.resolve().then(fn).then(resolve, reject) }))
  await click('确认批量标记'); await render({ active: false }); await act(async () => release()); await render()
  expect((await snapshot(e)).data.records).toHaveLength(0); expect(host.textContent).toContain('已选 0 / 200 条')
})
it('failed automatic refresh does not erase an already committed receipt', async () => {
  const e = add(1); await render(); await showAll(); await selectAndPrepare()
  vi.spyOn(hub, 'load').mockRejectedValueOnce(new Error('刷新失败'))
  await click('确认批量标记'); expect((await snapshot(e)).data.records[0].status).toBe('revisit')
  expect(host.textContent).toContain('已修改 1 条'); expect(button('撤销本轮标记').disabled).toBe(false)
})
it('keeps selection cap explicit without silently selecting part of a page', async () => {
  add(205); await render(); await showAll()
  for (let i = 0; i < 16; i++) { await click('选择本页批注'); await click('批注下一页') }
  expect(host.textContent).toContain('已选 192 / 200 条'); await click('选择本页批注')
  expect(host.textContent).toContain('每次最多选择 200 条'); expect(host.textContent).toContain('已选 192 / 200 条')
})
it('source issues disable mutations while leaving diagnostics readable', async () => {
  add(1); storage.setItem('localNotepad.collectionStudy.v1:orphan', '{}'); await render(); await showAll()
  expect(button('选择本页批注').disabled).toBe(true); expect(label('选择批注 c1 n0').disabled).toBe(true)
})
it('preview treats markup-like titles and collection names as text', async () => {
  const e = add(1, '<img src=x onerror=alert(1)>'); await mark(e, 'n0'); await render(); await selectAndPrepare()
  expect(label('批量标记预检').textContent).toContain('<img src=x'); expect(host.querySelector('img')).toBeNull()
})
it('ignores a preflight completed after the search filter changed', async () => {
  add(2); await render(); await showAll(); await click('选择本页批注')
  const original = study.load; let release
  vi.spyOn(study, 'load').mockImplementationOnce((...args) => new Promise(resolve => { release = async () => resolve(await original(...args)) }))
  await click('预检批量标记'); await change('跨资料集批注关键词', '章节 1'); await act(async () => release())
  expect(label('批量标记预检')).toBeNull(); expect(host.textContent).toContain('已选 0 / 200 条')
})
it('closing the workbench prevents a delayed save from writing to storage', async () => {
  const e = add(1); await render(); await showAll(); await selectAndPrepare(); let release
  locks.request.mockImplementationOnce((_name, _opts, fn) => new Promise((resolve, reject) => { release = () => Promise.resolve().then(fn).then(resolve, reject) }))
  await click('确认批量标记'); await act(async () => root.render(null)); await act(async () => release())
  expect((await snapshot(e)).data.records).toHaveLength(0)
})
