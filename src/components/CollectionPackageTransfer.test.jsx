import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import CollectionPackageTransfer from './CollectionPackageTransfer'
import SearchCollectionsPanel from './SearchCollectionsPanel'
import useSearchCollections from '~/hooks/useSearchCollections'
import { createCollectionPackageService, MAX_COLLECTION_PACKAGE_BYTES } from '~/services/collectionPackage'
import { createCollectionStudyStore } from '~/services/collectionStudy'
import { collectionFixture, memoryStorage } from '../test/collectionFixtures'
import { createSearchCollectionStore } from '~/services/searchCollections'

const locks = { request: (_name, options, cb) => options.signal.aborted ? Promise.reject(new DOMException('aborted', 'AbortError')) : Promise.resolve().then(cb) }
let host, root, source, target, raw, download, onImported
function environment(storage = memoryStorage()) {
  const store = createSearchCollectionStore({ storage: () => storage })
  const study = createCollectionStudyStore({ storage: () => storage, locks: () => locks })
  return { storage, store, study, service: createCollectionPackageService({ storage: () => storage, locks: () => locks, sourceStore: store, studyStore: study }) }
}
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const f = collectionFixture(65); source = { ...environment(f.storage), entry: f.entry }
  await source.study.saveNote(await source.study.load(f.entry, source.store), 'n64', 'read', '末页批注\n😀', { sourceStore: source.store })
  raw = await source.service.exportPackage(source.entry); target = environment()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  download = vi.fn(); onImported = vi.fn()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const button = text => [...host.querySelectorAll('button')].find(node => node.textContent === text)
const label = value => host.querySelector(`[aria-label="${value}"]`)
const flush = () => new Promise(resolve => setTimeout(resolve, 25))
async function render(props = {}) { await act(async () => { root.render(<CollectionPackageTransfer service={target.service} download={download} onImported={onImported} {...props} />); await flush() }) }
async function ready() {
  for (let attempt = 0; attempt < 100 && button('取消便携备份操作'); attempt++) { await act(async () => { await flush() }) }
  expect(button('取消便携备份操作')).toBeUndefined()
}
async function click(node, pending = false) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }); if (!pending) await ready() }
async function file(input = { size: raw.length, text: async () => raw }, pending = false) {
  await act(async () => { const node = label('选择资料集便携备份'); Object.defineProperty(node, 'files', { configurable: true, value: [input] }); node.dispatchEvent(new Event('change', { bubbles: true })); await flush() }); if (!pending) await ready()
}
it('allows importing without selecting a local collection and performs no preflight write', async () => {
  await render(); expect(button('备份资料集及阅读记录').disabled).toBe(true)
  await file(); expect(label('便携备份恢复预检').textContent).toContain('资料 65 篇 · 已读 1')
  expect(target.storage.length).toBe(0); expect(onImported).not.toHaveBeenCalled()
})
it('confirmation restores the complete pair and notifies its new identity', async () => {
  await render(); await file(); await click(button('确认恢复便携备份'))
  expect(target.store.list().entries).toHaveLength(1)
  expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringMatching(/^pack-/) }))
  expect(host.textContent).toContain('配套恢复完成')
  expect((await target.study.load(target.store.list().entries[0], target.store)).data.records[0].note).toBe('末页批注\n😀')
})
it('canceling a preview never writes and returns focus to the file input', async () => {
  await render(); await file(); await click(button('取消便携备份恢复'))
  expect(target.storage.length).toBe(0); expect(label('便携备份恢复预检')).toBeNull()
  expect(document.activeElement).toBe(label('选择资料集便携备份'))
})
it('reimport keeps a later local annotation and explains the skip', async () => {
  await render(); await file(); await click(button('确认恢复便携备份'))
  const entry = target.store.list().entries[0], snapshot = await target.study.load(entry, target.store)
  await target.study.saveNote(snapshot, 'n0', 'revisit', '更新后的批注', { sourceStore: target.store })
  await file(); expect(label('便携备份恢复预检').textContent).toContain('保留其当前阅读记录')
  await click(button('确认恢复便携备份'))
  expect(host.textContent).toContain('未重复新增或覆盖')
  expect((await target.study.load(entry, target.store)).data.records).toHaveLength(2)
})
it('exports a single paired JSON including all entries without writing or marking read', async () => {
  await render({ entry: source.entry, service: source.service }); await click(button('备份资料集及阅读记录'))
  expect(download).toHaveBeenCalledOnce()
  const result = JSON.parse(download.mock.calls[0][0].text)
  expect(result.collection.report.items).toHaveLength(65); expect(result.study.records).toHaveLength(1)
  expect(host.textContent).toContain('不是正文备份')
})
it('rejects an oversize file before calling its text reader', async () => {
  const text = vi.fn(); await render(); await file({ size: MAX_COLLECTION_PACKAGE_BYTES + 1, text })
  expect(text).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]').textContent).toContain('4 MiB')
})
it('renders a malformed file error with a usable retry input', async () => {
  await render(); await file({ size: 3, text: async () => 'bad' })
  expect(host.querySelector('[role="alert"]').textContent).toContain('有效')
  expect(label('选择资料集便携备份').disabled).toBe(false)
  await file(); expect(label('便携备份恢复预检')).toBeTruthy()
})
it('canceling a slow read prevents a late preview from appearing', async () => {
  let resolve; await render(); await file({ size: 100, text: () => new Promise(done => { resolve = done }) }, true)
  await click(button('取消便携备份操作'))
  await act(async () => { resolve(raw); await flush() })
  expect(label('便携备份恢复预检')).toBeNull(); expect(target.storage.length).toBe(0)
})
it('switching the selected source cancels an in-flight read', async () => {
  let resolve; await render(); await file({ size: 100, text: () => new Promise(done => { resolve = done }) }, true)
  await render({ entry: source.entry })
  await act(async () => { resolve(raw); await flush() })
  expect(label('便携备份恢复预检')).toBeNull(); expect(onImported).not.toHaveBeenCalled()
})
it('unmounting before fingerprint completion prevents download and UI callbacks', async () => {
  let resolve
  const service = { exportPackage: () => new Promise(done => { resolve = done }) }
  await render({ entry: source.entry, service }); await click(button('备份资料集及阅读记录'), true)
  await act(async () => { root.render(null) })
  await act(async () => { resolve(raw); await flush() })
  expect(download).not.toHaveBeenCalled(); expect(onImported).not.toHaveBeenCalled()
})
it('a changed local shelf refuses stale confirmation without a success callback', async () => {
  await render(); await file(); target.storage.setItem('localNotepad.searchCollection.v1:other', 'bad')
  await click(button('确认恢复便携备份'))
  expect(host.querySelector('[role="alert"]').textContent).toContain('重新预检')
  expect(onImported).not.toHaveBeenCalled(); expect(target.storage.length).toBe(1)
})
it('reports interrupted writes, preserving the same file for repreview and completion', async () => {
  await render(); await file()
  const original = target.storage.setItem, spy = vi.spyOn(target.storage, 'setItem').mockImplementation((key, value) => {
    if (key.startsWith('localNotepad.searchCollection')) throw new Error('quota')
    original(key, value)
  })
  await click(button('确认恢复便携备份'))
  expect(host.textContent).toContain('恢复未完成'); expect(onImported).not.toHaveBeenCalled()
  spy.mockRestore(); await click(button('取消便携备份恢复')); await file()
  expect(label('便携备份恢复预检').textContent).toContain('继续上次中断')
  await click(button('确认恢复便携备份')); expect(onImported).toHaveBeenCalledOnce()
})
it('does not misreport successful persistence when the parent refresh throws', async () => {
  onImported.mockImplementation(() => { throw new Error('view failed') })
  await render(); await file(); await click(button('确认恢复便携备份'))
  expect(target.storage.length).toBe(2); expect(host.textContent).toContain('已完成，请刷新')
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
it('disabling the panel cancels preview and prevents confirmation', async () => {
  await render(); await file(); await render({ disabled: true })
  expect(label('便携备份恢复预检')).toBeNull()
  expect(label('选择资料集便携备份').disabled).toBe(true)
})
it('integrates the portable entry into the actual collection manager even with an empty shelf', async () => {
  function Harness() { const model = useSearchCollections({ active: true, store: target.store }); return <SearchCollectionsPanel model={model} /> }
  await act(async () => { root.render(<Harness />); await flush() })
  expect(label('选择资料集便携备份')).toBeTruthy()
  expect(host.textContent).toContain('资料集便携备份与恢复')
  expect(host.textContent).toContain('导入资料集备份')
})
