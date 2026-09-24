import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createHash, randomUUID } from 'node:crypto'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import CollectionStudyPanel from './CollectionStudyPanel'
import CollectionReadingBar from './CollectionReadingBar'
import { collectionFixture } from '../test/collectionFixtures'
import { createCollectionStudyStore, COLLECTION_STUDY_PREFIX } from '../services/collectionStudy'
import { collectionStudyDrafts } from '../services/collectionStudyDrafts'
import { createCollectionReadingContext } from '../services/collectionReading'
import { downloadCollectionReviewReport } from '../services/collectionReviewReport'
vi.mock('../services/collectionReviewReport', async original => ({ ...await original(), downloadCollectionReviewReport: vi.fn() }))
let f, study, root, host, onResume, origin, onOpenFile, onMove
const label = name => host.querySelector(`[aria-label="${name}"]`)
const button = name => [...host.querySelectorAll('button')].find(node => node.textContent === name)
const click = name => act(async () => { expect(button(name)).toBeTruthy(); button(name).click() })
async function change(name, value) {
  await act(async () => {
    const node = label(name), prototype = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const panel = (props = {}) => act(async () => root.render(<CollectionStudyPanel entry={f.entry} sourceStore={f.store} studyStore={study} onResume={onResume} {...props} />))
const bar = (props = {}) => act(async () => root.render(<CollectionReadingBar origin={origin} documentId={origin.documentId} store={f.store} studyStore={study} onOpenFile={onOpenFile} onMove={onMove} {...props} />))
const options = () => ({ sourceStore: f.store })
const snapshot = () => study.load(f.entry, f.store)
async function seed(id = 'n22', status = 'revisit', note = '保存批注') {
  const value = await study.saveNote(await snapshot(), id, status, note, options())
  return value
}
async function importFile(raw) {
  await act(async () => { const node = label('选择阅读记录备份'); Object.defineProperty(node, 'files', { value: [{ size: raw.length, text: async () => raw }], configurable: true }); node.dispatchEvent(new Event('change', { bubbles: true })) })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // UI helper uses the same SHA-256 algorithm with a deterministic microtask;
  // actual WebCrypto is covered by the service tests.
  vi.stubGlobal('crypto', { randomUUID, subtle: { digest: async (_algorithm, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } })
  f = collectionFixture(); let tail = Promise.resolve()
  const locks = { request: (_name, _options, callback) => { const next = tail.then(callback); tail = next.catch(() => {}); return next } }
  study = createCollectionStudyStore({ storage: () => f.storage, locks: () => locks })
  origin = createCollectionReadingContext(f.entry, null, { query: '', status: 'all' }, 'n7')
  onResume = vi.fn(); onOpenFile = vi.fn().mockResolvedValue(true); onMove = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  collectionStudyDrafts.list().forEach(({ key }) => collectionStudyDrafts.remove(key))
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks()
})
it('displays saved totals and resumes the bookmarked note with an explicitly unfiltered queue', async () => {
  await seed(); await panel()
  expect(host.textContent).toContain('未读 22 · 已读 0 · 待复看 1 · 有批注 1')
  await click('从上次位置继续（全部条目）')
  expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: 'n22' }), { unfiltered: true })
})
it('does not create a bookmark or mark a note read merely by displaying either panel', async () => {
  await panel(); expect(button('从上次位置继续（全部条目）').disabled).toBe(true)
  await bar(); expect((await snapshot()).data.records).toEqual([]); expect((await snapshot()).data.bookmark).toBeNull()
})
it('saves status and exact multiline annotation only after explicit confirmation', async () => {
  await bar(); await change('当前资料阅读状态', 'read'); await change('当前资料批注', '  疑问\n😀  ')
  expect((await snapshot()).data.records).toEqual([])
  await click('保存批注与进度')
  expect((await snapshot()).data.records[0]).toMatchObject({ id: 'n7', status: 'read', note: '  疑问\n😀  ' })
  expect(host.textContent).not.toContain('批注尚未保存')
})
it('bookmark button does not accidentally mark the current note as read', async () => {
  await bar(); await click('记住当前阅读位置')
  expect((await snapshot()).data.bookmark.id).toBe('n7'); expect((await snapshot()).data.records).toEqual([])
})
it('moves to the next unread beyond the current page while including revisit notes', async () => {
  await seed('n8', 'read', ''); await seed('n9', 'revisit', '')
  await bar(); await click('下一未读资料')
  expect(onOpenFile).toHaveBeenCalledWith('n9', expect.objectContaining({ shouldSelect: expect.any(Function) }))
  expect(onMove.mock.calls[0][1].index).toBe(9)
})
it('cancelled next-unread navigation neither advances nor changes saved progress', async () => {
  onOpenFile.mockResolvedValue(false); await bar(); await click('下一未读资料')
  expect(onMove).not.toHaveBeenCalled(); expect((await snapshot()).data.bookmark).toBeNull()
})
it('keeps unsaved annotations while moving away and back in the same window', async () => {
  await bar(); await change('当前资料批注', '不能丢失的草稿')
  await act(async () => root.render(<div>另一笔记</div>)); await bar()
  expect(label('当前资料批注').value).toBe('不能丢失的草稿')
  expect((await snapshot()).data.records).toEqual([])
})
it('load notifications do not replace an unsaved local annotation', async () => {
  await bar(); await change('当前资料批注', '我的草稿')
  await act(async () => { await seed('n7', 'read', '另一个窗口') })
  expect(label('当前资料批注').value).toBe('我的草稿')
  await click('保存批注与进度')
  expect(host.textContent).toContain('未覆盖你的批注')
  expect((await snapshot()).data.records[0].note).toBe('另一个窗口')
})
it('quota failure keeps the form input and original saved state', async () => {
  await bar(); await change('当前资料批注', '空间不足也要保留')
  vi.spyOn(f.storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await click('保存批注与进度')
  expect(label('当前资料批注').value).toBe('空间不足也要保留'); expect(host.textContent).toContain('保存失败')
  expect((await snapshot()).data.records).toEqual([])
})
it('discard needs explicit confirmation and cancel keeps the local draft', async () => {
  await seed('n7', 'read', '已存'); await bar(); await change('当前资料批注', '未存')
  await click('舍弃未存批注'); await click('保留批注草稿'); expect(label('当前资料批注').value).toBe('未存')
  await click('舍弃未存批注'); await click('确认舍弃未存批注'); expect(label('当前资料批注').value).toBe('已存')
})
it('exporting a draft does not silently save it or put HTML into the page', async () => {
  await bar(); await change('当前资料批注', '<img onerror=x>😀</img>'); await click('导出当前批注草稿')
  expect(host.querySelector('img')).toBeNull()
  expect(downloadCollectionReviewReport).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('<img onerror=x>😀</img>'), type: 'text/plain;charset=utf-8' }))
  expect((await snapshot()).data.records).toEqual([])
})
it('paginates saved study records and searches annotations beyond the first page', async () => {
  await seed('n22', 'revisit', '独特批注'); await panel()
  await click('阅读记录下一页'); await click('阅读记录下一页')
  expect(button('编辑批注：章节 22')).toBeTruthy()
  await change('搜索资料批注', '独特批注'); expect(button('编辑批注：章节 22')).toBeTruthy(); expect(button('编辑批注：章节 0')).toBeUndefined()
})
it('filters reading status separately from body change classifications', async () => {
  await seed('n22', 'read', ''); await panel(); await change('资料集阅读筛选', 'read')
  expect(button('编辑批注：章节 22')).toBeTruthy(); expect(button('编辑批注：章节 0')).toBeUndefined()
  expect(f.storage.getItem(f.key)).toBe(f.entry.raw)
})
it('edits the selected note from the full study list without opening the editor', async () => {
  await panel(); await click('编辑批注：章节 0'); await change('当前资料批注', '只保存批注'); await click('保存批注与进度')
  expect((await snapshot()).data.records[0].id).toBe('n0'); expect(onResume).not.toHaveBeenCalled()
})
it('backs up every saved record regardless of the list query and page', async () => {
  await seed('n0', 'read', '首'); await seed('n22', 'revisit', '末'); await panel(); await change('搜索资料批注', '首')
  await click('备份阅读记录 JSON')
  expect(JSON.parse(downloadCollectionReviewReport.mock.calls[0][0].text).records.map(item => item.id)).toEqual(['n0','n22'])
})
it('preflights an imported backup and leaves state unchanged when cancelled', async () => {
  const old = await seed('n22', 'revisit', '旧'), backup = study.export(old, f.store)
  await seed('n22', 'read', '新'); await panel(); await importFile(backup)
  expect(label('阅读记录导入预检')).toBeTruthy(); await click('取消阅读记录导入')
  expect((await snapshot()).data.records[0].note).toBe('新')
})
it('confirmed import replaces the manual state only, not collection or manuscript', async () => {
  const old = await seed('n22', 'revisit', '旧'), backup = study.export(old, f.store)
  await seed('n22', 'read', '新'); await panel(); await importFile(backup); await click('确认替换已存阅读记录')
  expect((await snapshot()).data.records[0].note).toBe('旧'); expect(f.storage.getItem(f.key)).toBe(f.entry.raw)
})
it('changing state after import preflight rejects stale confirmation', async () => {
  const old = await seed(), backup = study.export(old, f.store)
  await panel(); await importFile(backup); await act(async () => { await seed('n1', 'read', '新记录') })
  await click('确认替换已存阅读记录')
  expect(host.textContent).toContain('其他操作中更新'); expect((await snapshot()).data.records).toHaveLength(2)
})
it('a cancelled file read cannot publish a late import preview', async () => {
  await panel(); let finish
  await act(async () => { const node = label('选择阅读记录备份'); Object.defineProperty(node, 'files', { value: [{ size: 10, text: () => new Promise(resolve => { finish = resolve }) }] }); node.dispatchEvent(new Event('change', { bubbles: true })) })
  await click('取消读取阅读备份'); await act(async () => finish('{}'))
  expect(label('阅读记录导入预检')).toBeNull()
})
it('corrupt storage is an error, not a misleading zero-progress display', async () => {
  f.storage.setItem(COLLECTION_STUDY_PREFIX + f.collection.id, 'broken'); await panel()
  expect(host.querySelector('[role=alert]')).toBeTruthy(); expect(button('备份阅读记录 JSON')).toBeUndefined()
})
it('source disappearance leaves a typed annotation exportable but unsavable', async () => {
  await bar(); await change('当前资料批注', '来源删除仍可导出')
  await act(async () => f.store.remove(f.entry))
  expect(label('当前资料批注').value).toBe('来源删除仍可导出'); expect(button('保存批注与进度').disabled).toBe(true)
  await click('导出当前批注草稿'); expect(downloadCollectionReviewReport).toHaveBeenCalled()
})
it('unsaved draft warns on normal unload until explicitly saved or discarded', async () => {
  await bar(); await change('当前资料批注', '未存')
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
  await click('保存批注与进度')
  const later = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(later); expect(later.defaultPrevented).toBe(false)
})
