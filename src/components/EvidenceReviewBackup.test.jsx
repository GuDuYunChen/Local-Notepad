import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EvidenceReviewBackup from './EvidenceReviewBackup'
import EvidenceReviewArchives from './EvidenceReviewArchives'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { reviewArchives, REVIEW_ARCHIVE_PREFIX } from '~/services/evidenceReviewArchives'
import { REVIEW_ARCHIVE_FORMAT } from '~/services/evidenceReviewArchiveData'
import { REVIEW_BACKUP_FORMAT, MAX_REVIEW_BACKUP_LENGTH } from '~/services/evidenceReviewBackup'

const time = '2026-09-23T00:00:00.000Z'
const archive = (i = 1) => ({ format: REVIEW_ARCHIVE_FORMAT, version: 1, id: 'source-' + i, savedAt: time,
  data: { projectId: 'p1', entityId: 'e1', entityLabel: '测试实体' + i,
    filters: { source: 'all', query: '', volumeId: null, page: 1 },
    chapters: [{ id: 'c1', title: '第一章', ordinal: 1 }], chapterId: 'c1', reviewedIds: [],
    annotations: { c1: { text: '本轮备注' + i, needsChanges: true } } } })
const bundle = (count = 2) => JSON.stringify({ format: REVIEW_BACKUP_FORMAT, version: 1, exportedAt: time,
  archives: Array.from({ length: count }, (_, i) => archive(i + 1)) })
let container, root, blob, urlSpy, clickSpy
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); evidenceReview.end(undefined, { discardAnnotations: true })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  blob = null
  urlSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value; return 'blob:test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove()
  evidenceReview.end(undefined, { discardAnnotations: true }); localStorage.clear(); vi.restoreAllMocks()
})
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent === label)
const label = name => container.querySelector('[aria-label="' + name + '"]')
async function click(element) { expect(element).toBeTruthy(); await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
async function render(props = {}) { await act(async () => root.render(<EvidenceReviewBackup entries={reviewArchives.list().entries} {...props} />)) }
async function fileInput(file) {
  const el = label('预检核对备份文件'); Object.defineProperty(el, 'files', { configurable: true, value: file ? [file] : [] })
  await act(async () => el.dispatchEvent(new Event('change', { bubbles: true })))
}
async function choose(raw = bundle()) { await fileInput({ size: raw.length, text: async () => raw }) }
async function scope(value) {
  await act(async () => {
    const el = label('存档查看范围'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('review backup workflow', () => {
  it('integrates into the archive manager and exports all pages of the selected range', async () => {
    for (let i = 1; i <= 7; i++) reviewArchives.importFile(JSON.stringify(archive(i)))
    const foreign = archive(8); foreign.data.projectId = 'p2'; reviewArchives.importFile(JSON.stringify(foreign))
    await act(async () => root.render(<EvidenceReviewArchives projectId="p1" entityId="e1" />))
    expect(container.textContent).toContain('整包备份与导入预检')
    await click(button('备份当前范围全部存档'))
    expect(JSON.parse(await blob.text()).archives).toHaveLength(7)
    expect(JSON.parse(await blob.text()).archives.every(a => a.data.projectId === 'p1')).toBe(true)
    await scope('all'); await click(button('备份当前范围全部存档'))
    expect(JSON.parse(await blob.text()).archives).toHaveLength(8)
    expect(clickSpy).toHaveBeenCalledTimes(2)
  })
  it('reading a file only previews its scope without writing or replacing an active review', async () => {
    const active = evidenceReview.restoreArchive(archive().data)
    await render(); await choose()
    expect(label('备份导入预检结果')).toBeTruthy()
    expect(container.textContent).toContain('将新增 2 份')
    expect(reviewArchives.list().entries).toHaveLength(0)
    expect(evidenceReview.getSnapshot()).toBe(active)
    expect(document.activeElement.tagName).toBe('H4')
  })
  it('requires explicit confirmation and then adds only nonduplicate records', async () => {
    reviewArchives.importFile(JSON.stringify(archive(1)))
    await render(); await choose(bundle(3))
    expect(container.textContent).toContain('将新增 2 份；重复跳过 1 份')
    await click(button('确认导入新增 2 份'))
    expect(reviewArchives.list().entries).toHaveLength(3)
    expect(container.textContent).toContain('已新增 2 份，重复跳过 1 份，尚未导入 0 份')
    expect(container.textContent).toContain('未自动恢复核对')
    expect(evidenceReview.getSnapshot()).toBeNull()
  })
  it('disables confirmation when every record already exists', async () => {
    reviewArchives.importFile(JSON.stringify(archive()))
    await render(); await choose(JSON.stringify(archive()))
    expect(button('确认导入新增 0 份').disabled).toBe(true)
    expect(container.textContent).toContain('本地已有，跳过')
    expect(reviewArchives.list().entries).toHaveLength(1)
  })
  it('renders imported labels as text and exposes foreign project scope before confirmation', async () => {
    const a = archive(); a.data.entityLabel = '<img src=x onerror=alert(1)>'; a.data.projectId = 'foreign-project'
    await render(); await choose(JSON.stringify(a))
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(container.textContent).toContain('项目 foreign-project')
    expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('lets the user inspect records beyond the first eight before importing', async () => {
    await render(); await choose(bundle(13))
    expect(label('备份内存档清单').children).toHaveLength(8)
    await click(button('下一页预检'))
    expect(label('备份内存档清单').children).toHaveLength(5)
    expect(label('备份内存档清单').textContent).toContain('测试实体13')
    expect(button('下一页预检').disabled).toBe(true)
    expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('closing a preview discards only the import preview', async () => {
    await render(); await choose(); await click(button('关闭导入预检'))
    expect(label('备份导入预检结果')).toBeNull()
    expect(reviewArchives.list().entries).toHaveLength(0)
    expect(button('重新预检此文件')).toBeUndefined()
  })
  it('shows capacity shortfall including unreadable local records and never auto-evicts', async () => {
    for (let i = 0; i < 39; i++) localStorage.setItem(REVIEW_ARCHIVE_PREFIX + 'broken' + i, '{bad')
    await render(); await choose()
    expect(container.textContent).toContain('容量不足，不能确认导入')
    expect(button('确认导入新增 2 份').disabled).toBe(true)
    expect(reviewArchives.list().entries).toHaveLength(39)
  })
  it('a bad final archive blocks the entire preflight without partial import', async () => {
    const data = JSON.parse(bundle()); data.archives[1].data = null
    await render(); await choose(JSON.stringify(data))
    expect(label('备份导入预检结果')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeTruthy()
    expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('refuses to generate an incomplete backup that would omit a corrupt selected archive', async () => {
    localStorage.setItem(REVIEW_ARCHIVE_PREFIX + 'broken', '{bad')
    await render(); await click(button('备份当前范围全部存档'))
    expect(container.textContent).toContain('不会静默遗漏')
    expect(urlSpy).not.toHaveBeenCalled()
    expect(reviewArchives.list().entries).toHaveLength(1)
  })
  it('refuses stale confirmation without requiring a delivered storage event', async () => {
    await render(); await choose()
    reviewArchives.importFile(JSON.stringify(archive(8)))
    await click(button('确认导入新增 2 份'))
    expect(container.textContent).toContain('本地存档已变化')
    expect(reviewArchives.list().entries).toHaveLength(1)
    expect(label('备份导入预检结果')).toBeNull()
    await click(button('重新预检此文件'))
    expect(button('确认导入新增 2 份')).toBeTruthy()
  })
  it('reports partial failure precisely and supports duplicate-safe retry', async () => {
    const realImport = reviewArchives.importFile.bind(reviewArchives); let n = 0
    vi.spyOn(reviewArchives, 'importFile').mockImplementation(raw => { if (++n === 2) throw new Error('测试配额不足'); return realImport(raw) })
    await render(); await choose(bundle(3)); await click(button('确认导入新增 3 份'))
    expect(container.textContent).toContain('已新增 1 份，重复跳过 0 份，尚未导入 2 份')
    expect(container.textContent).toContain('测试配额不足')
    await click(button('重新预检此文件')); await click(button('确认导入新增 2 份'))
    expect(reviewArchives.list().entries).toHaveLength(3)
    expect(container.textContent).toContain('导入处理完成')
  })
  it('rejects too-large files without invoking file.text', async () => {
    await render(); const read = vi.fn()
    await fileInput({ size: MAX_REVIEW_BACKUP_LENGTH * 3 + 1, text: read })
    expect(read).not.toHaveBeenCalled(); expect(container.textContent).toContain('文件过大')
  })
  it('a failed replacement file removes the previous actionable preview', async () => {
    await render(); await choose()
    await fileInput({ size: 1, text: async () => { throw new Error('read failed') } })
    expect(label('备份导入预检结果')).toBeNull()
    expect(container.textContent).toContain('read failed')
    expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('cancelled asynchronous reads cannot publish a late preview', async () => {
    let resolve; const pending = new Promise(r => { resolve = r })
    await render(); await fileInput({ size: 10, text: () => pending })
    await click(button('取消读取')); await act(async () => resolve(bundle()))
    expect(label('备份导入预检结果')).toBeNull()
    expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('a later chosen file wins over an earlier slow read', async () => {
    let resolve; const pending = new Promise(r => { resolve = r })
    await render(); await fileInput({ size: 10, text: () => pending })
    await choose(bundle(3)); await act(async () => resolve(bundle(2)))
    expect(button('确认导入新增 3 份')).toBeTruthy()
    expect(button('确认导入新增 2 份')).toBeUndefined()
  })
  it('unmounting during a file read cannot import or restore a review', async () => {
    let resolve; const pending = new Promise(r => { resolve = r })
    await render(); await fileInput({ size: 10, text: () => pending })
    await act(async () => root.render(null)); await act(async () => resolve(bundle()))
    expect(reviewArchives.list().entries).toHaveLength(0); expect(evidenceReview.getSnapshot()).toBeNull()
  })
  it('switching the archive viewing scope drops a pending preview/read', async () => {
    let resolve; const pending = new Promise(r => { resolve = r })
    await act(async () => root.render(<EvidenceReviewArchives projectId="p1" entityId="e1" />))
    await fileInput({ size: 10, text: () => pending }); await scope('all')
    await act(async () => resolve(bundle()))
    expect(label('备份导入预检结果')).toBeNull(); expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('handles a rapid double confirmation at most once', async () => {
    await render(); await choose()
    const target = button('确认导入新增 2 份')
    await act(async () => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true })); target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(reviewArchives.list().entries).toHaveLength(2)
    expect(container.textContent).toContain('已新增 2 份')
    expect(container.textContent).not.toContain('本地存档已变化')
  })
  it('keeps local data and an active review when the download API fails', async () => {
    reviewArchives.importFile(JSON.stringify(archive())); const active = evidenceReview.restoreArchive(archive().data)
    urlSpy.mockImplementation(() => { throw new Error('download blocked') })
    await render(); await click(button('备份当前范围全部存档'))
    expect(container.textContent).toContain('download blocked')
    expect(evidenceReview.getSnapshot()).toBe(active); expect(reviewArchives.list().entries).toHaveLength(1)
  })
  it('cancelling the native file picker retains the existing preview', async () => {
    await render(); await choose(); await fileInput(null)
    expect(button('确认导入新增 2 份')).toBeTruthy()
  })
})
