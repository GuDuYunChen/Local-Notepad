import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BackupPanel from './BackupPanel'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { reviewArchives, REVIEW_ARCHIVE_PREFIX } from '~/services/evidenceReviewArchives'
import { REVIEW_ARCHIVE_FORMAT } from '~/services/evidenceReviewArchiveData'
import { toast } from '~/services/toast'

const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const archive = (i = 1) => ({ format: REVIEW_ARCHIVE_FORMAT, version: 1, id: 'source-' + i, savedAt: '2026-09-23T00:00:00.000Z',
  data: { projectId: 'p1', entityId: 'e1', entityLabel: '关关', filters: { source: 'all', query: '', volumeId: null, page: 1 },
    chapterId: 'c1', chapters: [{ id: 'c1', title: '第一章', ordinal: 1 }], reviewedIds: [],
    annotations: { c1: { text: '备注' + i, needsChanges: true } } } })
const dbResult = name => ({ success: true, directory: 'D:/notepad/backups', backups: name ? [{ path: name, name, date: '2026-09-23T00:00:00Z', size: 1024 }] : [] })
let container, root, opener, close, blob
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); evidenceReview.end(undefined, { discardAnnotations: true })
  opener = document.createElement('button'); opener.textContent = '入口'; document.body.append(opener); opener.focus()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); close = vi.fn()
  window.electronAPI = { backupList: vi.fn().mockResolvedValue(dbResult()), backupOpenFolder: vi.fn().mockResolvedValue({ success: true }) }
  blob = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value; return 'blob:test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  for (const method of ['error', 'warning', 'success']) vi.spyOn(toast, method).mockImplementation(() => {})
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); opener.remove()
  evidenceReview.end(undefined, { discardAnnotations: true }); localStorage.clear(); delete window.electronAPI; vi.restoreAllMocks()
})
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text)
const label = name => container.querySelector('[aria-label="' + name + '"]')
const tab = id => container.querySelector('#backup-tab-' + id)
async function render(open = true) { await act(async () => root.render(<BackupPanel open={open} onClose={close} />)) }
async function click(node) { expect(node).toBeTruthy(); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
async function key(node, value, rest = {}) { await act(async () => node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...rest }))) }
async function reviews() { await click(tab('reviews')) }
async function readFile(file) {
  const input = label('预检核对备份文件'); Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

describe('unified backup center', () => {
  it('does not read backups or write archives while closed', async () => {
    await render(false); expect(window.electronAPI.backupList).not.toHaveBeenCalled(); expect(container.textContent).toBe('')
    expect(localStorage.length).toBe(0)
  })
  it('separates database and review coverage without claiming full app backup', async () => {
    await render(); expect(label('备份数据类型')).toBeTruthy()
    expect(tab('database').getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('不包含核对存档、未保存正文草稿、外部附件文件')
    expect(container.textContent).toContain('不会自动合并')
  })
  it('shows a readable empty database directory only on successful responses', async () => {
    await render(); expect(container.textContent).toContain('暂时还没有数据库备份')
    expect(container.textContent).toContain('D:/notepad/backups')
  })
  it('shows read errors without a false empty state and supports retry', async () => {
    window.electronAPI.backupList.mockRejectedValueOnce(new Error('磁盘不可用')).mockResolvedValueOnce(dbResult('recovered.db'))
    await render(); expect(container.textContent).toContain('磁盘不可用'); expect(container.textContent).not.toContain('暂时还没有数据库备份')
    await click(button('刷新列表')); expect(container.textContent).toContain('recovered.db'); expect(container.textContent).not.toContain('磁盘不可用')
  })
  it('rejects malformed successful responses instead of displaying zero backups', async () => {
    window.electronAPI.backupList.mockResolvedValue({ success: true })
    await render(); expect(container.textContent).toContain('列表格式不完整'); expect(container.textContent).not.toContain('已读取 0 份')
  })
  it('keeps review tools usable in a browser without Electron', async () => {
    delete window.electronAPI; reviewArchives.importFile(JSON.stringify(archive()))
    await render(); expect(container.textContent).toContain('当前环境不支持读取桌面数据库备份')
    await reviews(); expect(container.textContent).toContain('本地共 1 份'); expect(button('备份当前范围全部存档').disabled).toBe(false)
  })
  it('opens the desktop folder once while pending and exposes failures', async () => {
    const task = pending(); window.electronAPI.backupOpenFolder.mockReturnValue(task.promise)
    await render(); const trigger = button('打开备份文件夹'); await click(trigger); await click(trigger)
    expect(window.electronAPI.backupOpenFolder).toHaveBeenCalledTimes(1)
    await act(async () => task.resolve({ success: false, message: '无法访问目录' }))
    expect(container.textContent).toContain('无法访问目录'); expect(button('打开备份文件夹').disabled).toBe(false)
  })
  it('can close while loading; old replies cannot replace a later opening', async () => {
    const first = pending(), second = pending(); window.electronAPI.backupList.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await render(); await click(label('关闭备份中心')); expect(close).toHaveBeenCalledTimes(1)
    await render(false); await render(true)
    await act(async () => second.resolve(dbResult('new.db'))); await act(async () => first.resolve(dbResult('old.db')))
    expect(container.textContent).toContain('new.db'); expect(container.textContent).not.toContain('old.db')
  })
  it('switching tabs invalidates a database read and does not focus a hidden panel', async () => {
    const old = pending(); window.electronAPI.backupList.mockReturnValueOnce(old.promise).mockResolvedValue(dbResult('fresh.db'))
    await render(); await reviews(); await act(async () => old.resolve(dbResult('stale.db')))
    expect(container.textContent).not.toContain('stale.db'); await click(tab('database')); expect(container.textContent).toContain('fresh.db')
  })
  it('global archive tools include all projects and all pages', async () => {
    for (let i = 1; i <= 7; i++) { const a = archive(i); a.data.projectId = i === 7 ? 'p2' : 'p1'; reviewArchives.importFile(JSON.stringify(a)) }
    await render(); await reviews()
    expect(label('存档查看范围')).toBeNull(); expect(button('导入存档 JSON')).toBeUndefined()
    expect(button('恢复此存档')).toBeUndefined()
    await click(button('备份当前范围全部存档'))
    const result = JSON.parse(await blob.text()); expect(result.archives).toHaveLength(7); expect(result.archives.some(a => a.data.projectId === 'p2')).toBe(true)
  })
  it('detects unsaved active metadata and saves only after the explicit action', async () => {
    const active = evidenceReview.restoreArchive(archive().data); await render()
    expect(container.textContent).toContain('当前核对有尚未存档'); expect(reviewArchives.list().entries).toHaveLength(0)
    await click(button('保存本地存档')); expect(reviewArchives.list().entries).toHaveLength(1)
    expect(evidenceReview.getSnapshot()).toBe(active); expect(container.textContent).toContain('当前核对记录与本地存档一致')
    expect(button('保存本地存档').disabled).toBe(true)
  })
  it('new notes make a saved record unsaved without changing old archives', async () => {
    const active = evidenceReview.restoreArchive(archive().data); reviewArchives.save(active); await render()
    await act(async () => evidenceReview.setAnnotation(active.id, 'c1', { text: '新备注' }))
    expect(container.textContent).toContain('尚未存档的记录'); expect(reviewArchives.list().entries[0].archive.data.annotations.c1.text).toBe('备注1')
  })
  it('deleting the matching archive re-enables saving during the same opening', async () => {
    const active = evidenceReview.restoreArchive(archive().data); reviewArchives.save(active); await render()
    await act(async () => reviewArchives.remove(reviewArchives.list().entries[0]))
    expect(button('保存本地存档').disabled).toBe(false); expect(container.textContent).toContain('尚未存档的记录')
  })
  it('storage errors are unknown, and current Markdown export remains available', async () => {
    evidenceReview.restoreArchive(archive().data)
    vi.spyOn(reviewArchives, 'list').mockReturnValue({ entries: [], error: '无法读取本地核对存档' })
    await render(); await reviews(); expect(container.textContent).toContain('暂不能确认当前核对是否已存档')
    expect(container.textContent).not.toContain('本地共 0 份')
    await click(button('导出本轮清单')); expect(await blob.text()).toContain('备注1')
  })
  it('save failure preserves active work and does not report it as saved', async () => {
    const active = evidenceReview.restoreArchive(archive().data); vi.spyOn(reviewArchives, 'save').mockImplementation(() => { throw new Error('空间不足') })
    await render(); await click(button('保存本地存档'))
    expect(container.textContent).toContain('空间不足'); expect(evidenceReview.getSnapshot()).toBe(active)
    expect(container.textContent).not.toContain('当前核对记录与本地存档一致')
  })
  it('counts damaged archives without silently producing a partial backup', async () => {
    localStorage.setItem(REVIEW_ARCHIVE_PREFIX + 'broken', '{broken'); await render(); await reviews()
    expect(container.textContent).toContain('不可读取 1 份'); await click(button('备份当前范围全部存档'))
    expect(container.textContent).toContain('不会静默遗漏'); expect(blob).toBeNull()
  })
  it('imports with preflight and duplicate checks without starting a review', async () => {
    await render(); await reviews(); const raw = JSON.stringify(archive())
    await readFile({ size: raw.length, text: async () => raw }); expect(reviewArchives.list().entries).toHaveLength(0)
    await click(button('确认导入新增 1 份')); expect(reviewArchives.list().entries).toHaveLength(1)
    expect(container.textContent).toContain('本地共 1 份'); expect(evidenceReview.getSnapshot()).toBeNull()
  })
  it('switching away cancels pending file reads without importing', async () => {
    await render(); await reviews(); const file = pending()
    await readFile({ size: 10, text: () => file.promise }); await click(tab('database'))
    await act(async () => file.resolve(JSON.stringify(archive())))
    await reviews(); expect(label('备份导入预检结果')).toBeNull(); expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('closing with active notes does not end, mutate or automatically save the review', async () => {
    const active = evidenceReview.restoreArchive(archive().data); await render(); await render(false)
    expect(evidenceReview.getSnapshot()).toBe(active); expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('rechecks external changes on window focus even without a storage event', async () => {
    const active = evidenceReview.restoreArchive(archive().data); reviewArchives.save(active); await render()
    localStorage.removeItem(reviewArchives.list().entries[0].key)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(container.textContent).toContain('尚未存档的记录')
  })
  it('updates the archive count after native-shaped storage events', async () => {
    await render(); await reviews(); const a = archive(); localStorage.setItem(REVIEW_ARCHIVE_PREFIX + a.id, JSON.stringify(a))
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_ARCHIVE_PREFIX + a.id })))
    expect(container.textContent).toContain('本地共 1 份')
  })
  it('supports arrow/Home/End tabs with roving focus', async () => {
    await render(); await key(tab('database'), 'ArrowRight')
    expect(tab('reviews').getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(tab('reviews'))
    await key(tab('reviews'), 'Home'); expect(document.activeElement).toBe(tab('database'))
    await key(tab('database'), 'End'); expect(document.activeElement).toBe(tab('reviews'))
  })
  it('moves focus inside, makes the background inert and restores the opener', async () => {
    await render(); expect(document.activeElement.id).toBe('backup-dialog-title'); expect(opener.hasAttribute('inert')).toBe(true)
    await render(false); expect(opener.hasAttribute('inert')).toBe(false); expect(document.activeElement).toBe(opener)
  })
  it('keeps Tab within visible controls, excluding collapsed disclosures', async () => {
    await render(); const closeButton = label('关闭备份中心'); closeButton.focus(); await key(closeButton, 'Tab', { shiftKey: true })
    expect(document.activeElement.tagName).toBe('SUMMARY')
    await key(document.activeElement, 'Tab'); expect(document.activeElement).toBe(closeButton)
  })
  it('Escape cancels nested delete only, then closes the center on the next Escape', async () => {
    reviewArchives.importFile(JSON.stringify(archive())); await render(); await reviews(); await click(button('删除此存档'))
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    await key(button('取消'), 'Escape'); expect(close).not.toHaveBeenCalled()
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(reviewArchives.list().entries).toHaveLength(1)
    expect(document.activeElement).toBe(button('删除此存档'))
    await key(label('关闭备份中心'), 'Escape'); expect(close).toHaveBeenCalledTimes(1)
  })
  it('traps focus inside a nested confirmation instead of the parent center', async () => {
    reviewArchives.importFile(JSON.stringify(archive())); await render(); await reviews(); await click(button('删除此存档'))
    button('确认删除存档').focus(); await key(document.activeElement, 'Tab')
    expect(document.activeElement).toBe(button('取消')); await key(document.activeElement, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(button('确认删除存档'))
  })
  it('IME composition Escape does not close and workspace shortcuts do not leak', async () => {
    await render(); await key(label('关闭备份中心'), 'Escape', { isComposing: true }); expect(close).not.toHaveBeenCalled()
    const listener = vi.fn(); document.addEventListener('keydown', listener)
    try { await key(label('关闭备份中心'), 'k', { ctrlKey: true }); expect(listener).not.toHaveBeenCalled() }
    finally { document.removeEventListener('keydown', listener) }
  })
  it('renders IPC file names as text rather than executable markup', async () => {
    window.electronAPI.backupList.mockResolvedValue(dbResult('<img src=x onerror=alert(1)>.db'))
    await render(); expect(container.querySelector('img')).toBeNull(); expect(container.textContent).toContain('<img src=x')
  })
  it('manual archive refresh updates the active save status as well as the list', async () => {
    const active = evidenceReview.restoreArchive(archive().data); reviewArchives.save(active)
    await render(); await reviews(); localStorage.removeItem(reviewArchives.list().entries[0].key)
    await click(button('刷新存档列表'))
    expect(container.textContent).toContain('尚未存档的记录'); expect(container.textContent).toContain('本地共 0 份')
  })
  it('backdrop clicks close only the outer backdrop, not clicks within content', async () => {
    await render()
    await act(async () => container.querySelector('.backup-center-modal').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(close).not.toHaveBeenCalled()
    await act(async () => container.querySelector('.backup-center-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('restores pre-existing background inert state instead of making it interactive', async () => {
    opener.setAttribute('inert', ''); await render(); await render(false)
    expect(opener.hasAttribute('inert')).toBe(true)
  })
  it('strict mode late initial reads cannot replace the final ready data', async () => {
    const first = pending(), second = pending()
    window.electronAPI.backupList.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await act(async () => root.render(<React.StrictMode><BackupPanel open onClose={close} /></React.StrictMode>))
    await act(async () => second.resolve(dbResult('strict-current.db')))
    await act(async () => first.resolve(dbResult('strict-old.db')))
    expect(container.textContent).toContain('strict-current.db'); expect(container.textContent).not.toContain('strict-old.db')
  })

  it('after a confirmed deletion moves focus to an existing archive control', async () => {
    reviewArchives.importFile(JSON.stringify(archive())); await render(); await reviews()
    await click(button('删除此存档')); await click(button('确认删除存档'))
    expect(reviewArchives.list().entries).toHaveLength(0)
    expect(document.activeElement).toBe(button('刷新存档列表'))
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  })

})

const safetyName = 'backup-manual-20260923-120000-aabbccddeeff.db'
const receipt = { name: safetyName, sha256: 'a'.repeat(64), size: 2048, files: 3, schemaVersion: 9 }
function safetyBridge() {
  window.electronAPI.backupCreate = vi.fn().mockResolvedValue({ success: true, backup: receipt })
  window.electronAPI.backupInspect = vi.fn().mockResolvedValue({ success: true, backup: receipt })
  window.electronAPI.backupExport = vi.fn().mockResolvedValue({ success: true, backup: receipt, path: 'E:/Safe/copy.db' })
  window.electronAPI.backupList.mockResolvedValue(dbResult(safetyName))
}
describe('database safety workflow', () => {
  it('creates a verified snapshot only after clicking and refreshes the actual list', async () => {
    safetyBridge(); await render(); expect(window.electronAPI.backupCreate).not.toHaveBeenCalled()
    await click(button('立即创建备份')); expect(window.electronAPI.backupCreate).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.backupList).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('新备份已创建并通过完整性校验')
    expect(container.textContent).toContain('未保存草稿、外部附件与核对存档不包含')
  })
  it('verifies the requested filename and shows explicit record/schema counts', async () => {
    safetyBridge(); await render(); await click(label('校验备份 ' + safetyName))
    expect(window.electronAPI.backupInspect).toHaveBeenCalledWith(safetyName)
    expect(container.textContent).toContain('3 条记录（含目录及回收站）· 数据版本 9')
  })
  it('refresh invalidates old validation badges', async () => {
    safetyBridge(); await render(); await click(label('校验备份 ' + safetyName)); await click(button('刷新列表'))
    expect(container.querySelector('.backup-verified')).toBeNull()
  })
  it('confirms a real native export path instead of claiming only a download', async () => {
    safetyBridge(); await render(); await click(label('另存备份 ' + safetyName))
    expect(window.electronAPI.backupExport).toHaveBeenCalledWith(safetyName)
    expect(container.textContent).toContain('E:/Safe/copy.db'); expect(container.textContent).toContain('确认 SHA-256 与源文件一致')
  })
  it('canceling native save is not reported as success', async () => {
    safetyBridge(); window.electronAPI.backupExport.mockResolvedValue({ success: false, canceled: true })
    await render(); await click(label('另存备份 ' + safetyName))
    expect(container.textContent).toContain('已取消另存'); expect(container.textContent).not.toContain('备份已写入所选位置')
  })
  it('bad integrity reports an error and does not preserve a previously verified badge', async () => {
    safetyBridge(); await render(); await click(label('校验备份 ' + safetyName))
    window.electronAPI.backupInspect.mockResolvedValue({ success: false, message: 'SQLite 文件损坏' })
    await click(label('校验备份 ' + safetyName)); expect(container.querySelector('.backup-verified')).toBeNull()
    expect(container.querySelector('.backup-center-safety-result[role="alert"]').textContent).toContain('损坏')
  })
  it('rejects incomplete or mismatched successful receipts', async () => {
    safetyBridge(); window.electronAPI.backupInspect.mockResolvedValue({ success: true, backup: { ...receipt, name: 'other.db' } })
    await render(); await click(label('校验备份 ' + safetyName))
    expect(container.textContent).toContain('回执不完整'); expect(container.querySelector('.backup-verified')).toBeNull()
  })
  it('prevents repeat clicks and disables other DB actions during a pending operation', async () => {
    safetyBridge(); const task = pending(); window.electronAPI.backupCreate.mockReturnValue(task.promise)
    await render(); const trigger = button('立即创建备份'); await click(trigger); await click(trigger)
    expect(window.electronAPI.backupCreate).toHaveBeenCalledTimes(1)
    expect(label('校验备份 ' + safetyName).disabled).toBe(true); expect(button('刷新列表').disabled).toBe(true)
    await act(async () => task.resolve({ success: false, message: '空间不足' }))
    expect(button('立即创建备份').disabled).toBe(false)
  })
  it('closed/reopened panels cannot receive old operation receipts', async () => {
    safetyBridge(); const task = pending(); window.electronAPI.backupCreate.mockReturnValue(task.promise)
    await render(); await click(button('立即创建备份')); await render(false); await render(true)
    await act(async () => task.resolve({ success: true, backup: receipt }))
    expect(container.textContent).not.toContain('新备份已创建并通过完整性校验')
  })
  it('does not change active review notes while backing up the DB', async () => {
    safetyBridge(); const active = evidenceReview.restoreArchive(archive().data)
    await render(); await click(button('立即创建备份'))
    expect(evidenceReview.getSnapshot()).toBe(active); expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('distinguishes manual retention and explains safe recovery without a destructive live restore', async () => {
    safetyBridge(); await render()
    expect(container.textContent).toContain('手动保留'); expect(container.textContent).toContain('recovery-preserved')
    expect(container.textContent).toContain('不提供运行中回退'); expect(button('立即恢复数据库')).toBeUndefined()
  })
  it('disables DB-only operations when the desktop bridge is absent', async () => {
    delete window.electronAPI; await render(); expect(button('立即创建备份').disabled).toBe(true)
    await reviews(); expect(container.textContent).toContain('所有项目的核对存档')
  })
})
