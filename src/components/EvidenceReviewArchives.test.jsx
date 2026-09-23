import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EvidenceReviewArchives, { SaveReviewArchiveButton } from './EvidenceReviewArchives'
import EvidenceReviewRecords from './EvidenceReviewRecords'
import ProjectEntityEvidencePanel from './ProjectEntityEvidencePanel'
import { buildProjectEntityIntelligence } from './projectEntityIntelligenceUtils'
import { createEvidenceReviewSession, evidenceReview } from '~/services/evidenceReviewSession'
import { reviewArchives, REVIEW_ARCHIVE_PREFIX } from '~/services/evidenceReviewArchives'
import { toast } from '~/services/toast'

let container, root
function fixture(count = 13) {
  const indexes = { characters: [{ id: 'char-a', title: '关关.md' }] }
  const meta = { entityAliases: { 'index:char-a': ['小关'] } }
  const notes = Array.from({ length: count }, (_, i) => ({ id: 'c' + (i + 1), title: '第' + (i + 1) + '章.md',
    content: JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: '关关与小关。' }] }] } }) }))
  const intelligence = buildProjectEntityIntelligence({ project: { id: 'p1' }, volumes: [{ id: '', title: '未分卷', notes }] }, indexes, meta)
  const review = createEvidenceReviewSession()
  const session = review.start({ projectId: 'p1', entityId: 'index:char-a', entityLabel: '关关',
    filters: { source: 'alias', query: '', volumeId: '', page: 3 } }, notes.map((n, i) => ({ id: n.id, title: n.title, ordinal: i + 1 })), notes.at(-1).id)
  review.commitStart(session.id)
  review.setAnnotation(session.id, notes.at(-1).id, { text: '称呼需核对', needsChanges: true })
  review.setReviewed(session.id, notes[0].id, true)
  return { intelligence, meta, data: review.getSnapshot() }
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  evidenceReview.end(undefined, { discardAnnotations: true })
  localStorage.clear()
  vi.spyOn(toast, 'error').mockImplementation(() => {})
  vi.spyOn(toast, 'success').mockImplementation(() => {})
  vi.spyOn(toast, 'warning').mockImplementation(() => {})
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  evidenceReview.end(undefined, { discardAnnotations: true })
  container.remove(); localStorage.clear(); vi.restoreAllMocks()
})
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent === label)
const byLabel = label => container.querySelector('[aria-label="' + label + '"]')
async function click(node) { expect(node).toBeTruthy(); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
async function render(data, props = {}) { await act(async () => root.render(<EvidenceReviewArchives projectId="p1" entityId="index:char-a" intelligence={data.intelligence} {...props} />)) }
async function inputFile(file) {
  const input = byLabel('导入核对存档文件')
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

describe('explicit local review archives', () => {
  it('does not write automatically, and stores only on explicit save', async () => {
    const data = fixture()
    evidenceReview.restoreArchive(data.data)
    await act(async () => root.render(<SaveReviewArchiveButton />))
    expect(reviewArchives.list().entries).toHaveLength(0)
    await click(button('保存本地存档'))
    expect(reviewArchives.list().entries).toHaveLength(1)
    expect(button('保存本地存档').disabled).toBe(true)
    expect(container.textContent).toContain('此份记录已存档')
    await act(async () => evidenceReview.setAnnotation(evidenceReview.getSnapshot().id, 'c13', { text: '新备注' }))
    expect(container.textContent).toContain('尚未再次存档')
    expect(reviewArchives.list().entries[0].archive.data.annotations.c13.text).toBe('称呼需核对')
  })
  it('exposes saving in the actual review records and retains archives after ending', async () => {
    const data = fixture(); const session = evidenceReview.restoreArchive(data.data)
    await act(async () => root.render(<EvidenceReviewRecords documentId="c13" />))
    await click(button('保存本地存档'))
    await act(async () => evidenceReview.end(session.id, { discardAnnotations: true }))
    expect(reviewArchives.list().entries).toHaveLength(1)
    expect(container.textContent).toBe('')
  })
  it('shows saved records after remount but never automatically starts a round', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    await render(data)
    expect(container.textContent).toContain('本地核对存档 · 1 份')
    expect(container.textContent).toContain('历史已核对 1')
    expect(evidenceReview.getSnapshot()).toBeNull()
    await act(async () => root.render(null)); await render(data)
    expect(container.textContent).toContain('本地核对存档 · 1 份')
    expect(evidenceReview.getSnapshot()).toBeNull()
  })
  it('restores only after confirmation, retains annotations and resets historical review', async () => {
    const data = fixture(); reviewArchives.save(data.data); const onRestored = vi.fn()
    await render(data, { onRestored })
    await click(button('恢复此存档'))
    expect(evidenceReview.getSnapshot()).toBeNull()
    expect(container.textContent).toContain('1 章历史已核对标记不会沿用')
    await click(button('取消'))
    expect(evidenceReview.getSnapshot()).toBeNull()
    await click(button('恢复此存档')); await click(button('恢复并重新核对'))
    expect(evidenceReview.getSnapshot().annotations.c13.text).toBe('称呼需核对')
    expect(evidenceReview.getSnapshot().reviewedIds).toEqual([])
    expect(onRestored).toHaveBeenCalledOnce()
    expect(reviewArchives.list().entries).toHaveLength(1)
  })
  it('integrates restore with evidence filters and returns to the matching last page', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    await act(async () => root.render(<ProjectEntityEvidencePanel projectId="p1" entityId="index:char-a" intelligence={data.intelligence} projectMeta={data.meta} onOpenFile={vi.fn()} />))
    await click(button('恢复此存档')); await click(button('恢复并重新核对'))
    expect(byLabel('实体证据来源筛选').value).toBe('alias')
    expect(byLabel('实体证据卷筛选').value).toBe(JSON.stringify(''))
    expect(byLabel('正文证据章节 13')).toBeTruthy()
    expect(container.querySelector('.project-entity-evidence-pagination').textContent).toContain('第 3 / 3 页')
  })
  it('does not overwrite an existing round, even when it has no annotations', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    const active = evidenceReview.restoreArchive({ ...data.data, annotations: {}, reviewedIds: [] })
    await render(data, { onRestored: vi.fn() })
    await click(button('恢复此存档'))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(evidenceReview.getSnapshot()).toBe(active)
    expect(toast.warning).toHaveBeenCalled()
  })
  it('does not overwrite a round that started after opening the confirmation', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    await render(data, { onRestored: vi.fn() }); await click(button('恢复此存档'))
    const active = evidenceReview.restoreArchive(data.data)
    await click(button('恢复并重新核对'))
    expect(evidenceReview.getSnapshot()).toBe(active)
    expect(toast.error).toHaveBeenCalled()
  })
  it('refuses missing evidence chapters while leaving their archive exportable', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    const changed = fixture(12)
    await render(changed, { onRestored: vi.fn() }); await click(button('恢复此存档'))
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('1 个原证据章节'))
    expect(evidenceReview.getSnapshot()).toBeNull()
    expect(button('导出存档 JSON')).toBeTruthy()
    expect(reviewArchives.list().entries).toHaveLength(1)
  })
  it('requires a new preview if evidence changed while confirming', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    await render(data, { onRestored: vi.fn() }); await click(button('恢复此存档'))
    await render(fixture(14), { onRestored: vi.fn() }); await click(button('恢复并重新核对'))
    expect(evidenceReview.getSnapshot()).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('范围已变化'))
  })
  it('switching project cancels an obsolete restore dialog', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    await render(data, { onRestored: vi.fn() }); await click(button('恢复此存档'))
    await render(data, { projectId: 'p2', onRestored: vi.fn() })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(evidenceReview.getSnapshot()).toBeNull()
  })
  it('delete is confirmed and does not delete the active review', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    const active = evidenceReview.restoreArchive(data.data)
    await render(data)
    await click(button('删除此存档')); await click(button('取消'))
    expect(reviewArchives.list().entries).toHaveLength(1)
    await click(button('删除此存档')); await click(button('确认删除存档'))
    expect(reviewArchives.list().entries).toHaveLength(0)
    expect(evidenceReview.getSnapshot()).toBe(active)
  })
  it('stale delete confirmation cannot remove a changed archive', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    await render(data); await click(button('删除此存档'))
    const entry = reviewArchives.list().entries[0]
    localStorage.setItem(entry.key, entry.raw + ' ')
    await click(button('确认删除存档'))
    expect(reviewArchives.list().entries).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('另一窗口'))
  })
  it('handles another window adding a record through the storage event', async () => {
    const data = fixture(); const archive = reviewArchives.save(data.data)
    localStorage.clear(); await render(data)
    localStorage.setItem(REVIEW_ARCHIVE_PREFIX + archive.id, JSON.stringify(archive))
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_ARCHIVE_PREFIX + archive.id })))
    expect(container.textContent).toContain('本地核对存档 · 1 份')
  })
  it('import validates JSON and never restores or replaces the active round automatically', async () => {
    const data = fixture(); const archive = reviewArchives.save(data.data)
    localStorage.clear(); const active = evidenceReview.restoreArchive(data.data)
    await render(data)
    await inputFile({ size: 10, text: async () => '{broken' })
    expect(reviewArchives.list().entries).toHaveLength(0)
    await inputFile({ size: 2000, text: async () => JSON.stringify(archive) })
    expect(reviewArchives.list().entries).toHaveLength(1)
    expect(evidenceReview.getSnapshot()).toBe(active)
    expect(byLabel('存档查看范围').value).toBe('all')
  })
  it('does not import a file after the owning component was unmounted', async () => {
    const data = fixture(); const archive = reviewArchives.save(data.data); localStorage.clear()
    let resolve
    const pending = new Promise(r => { resolve = r })
    await render(data); await inputFile({ size: 1000, text: () => pending })
    await act(async () => root.render(null))
    await act(async () => resolve(JSON.stringify(archive)))
    expect(reviewArchives.list().entries).toHaveLength(0)
  })
  it('displays corrupt archives in all-scope without attempting to restore them', async () => {
    localStorage.setItem(REVIEW_ARCHIVE_PREFIX + 'broken', '{bad')
    await render(fixture(), { projectId: undefined, entityId: undefined })
    expect(container.textContent).toContain('不可读取的存档')
    expect(button('恢复此存档')).toBeUndefined()
    expect(button('导出存档 JSON')).toBeTruthy()
  })
  it('paginated archives remain reachable and are not truncated to the first page', async () => {
    const data = fixture()
    for (let i = 0; i < 7; i++) reviewArchives.save(data.data)
    await render(data)
    expect(container.querySelectorAll('li')).toHaveLength(5)
    await click(button('下一页存档'))
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(button('下一页存档').disabled).toBe(true)
  })
  it('does not claim success when saving fails, and keeps the current annotations', async () => {
    const data = fixture(); const active = evidenceReview.restoreArchive(data.data)
    vi.spyOn(reviewArchives, 'save').mockImplementation(() => { throw new Error('本地存档写入失败') })
    await act(async () => root.render(<SaveReviewArchiveButton />))
    await click(button('保存本地存档'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('本地存档写入失败')
    expect(evidenceReview.getSnapshot()).toBe(active)
    expect(button('保存本地存档').disabled).toBe(false)
  })
  it('exports a portable JSON record without changing the active round or archives', async () => {
    const data = fixture(); reviewArchives.save(data.data)
    const active = evidenceReview.restoreArchive(data.data)
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:archive')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await render(data); await click(button('导出存档 JSON'))
    const file = JSON.parse(await create.mock.calls[0][0].text())
    expect(file.version).toBe(1)
    expect(file.data.chapters).toHaveLength(13)
    expect(file.data.annotations.c13.text).toBe('称呼需核对')
    expect(reviewArchives.list().entries).toHaveLength(1)
    expect(evidenceReview.getSnapshot()).toBe(active)
  })

})
