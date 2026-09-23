import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import EvidenceReviewBar from './EvidenceReviewBar'
import EvidenceReviewRecords from './EvidenceReviewRecords'
import ProjectEntityEvidencePanel from './ProjectEntityEvidencePanel'
import { buildProjectEntityIntelligence } from './projectEntityIntelligenceUtils'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { toast } from '~/services/toast'

const context = { projectId: 'p1', entityId: 'index:a', entityLabel: '关关', filters: { source: 'all', volumeId: null } }
const chapters = Array.from({ length: 19 }, (_, i) => ({ id: 'c' + i, title: '第' + (i + 1) + '章.md', ordinal: i + 1 }))
function start() { const s = evidenceReview.start(context, chapters, 'c0'); evidenceReview.commitStart(s.id); return s }
function model() {
  const workspace = { project: { id: 'p1' }, volumes: [{ id: 'v', notes: chapters.map(c => ({ ...c,
    content: JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: '关关早市' }] }] } }) })) }] }
  return buildProjectEntityIntelligence(workspace, { characters: [{ id: 'a', title: '关关.md' }] })
}
let root, host
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  evidenceReview.end(undefined, { discardAnnotations: true }); evidenceNavigation.cancel()
  for (const method of ['success', 'error', 'warning']) vi.spyOn(toast, method).mockImplementation(() => {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  evidenceReview.end(undefined, { discardAnnotations: true }); evidenceNavigation.cancel()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const label = text => host.querySelector(`[aria-label="${text}"]`)
const note = () => label('本章核对备注内容')
async function render(props = {}) { await act(async () => root.render(<EvidenceReviewBar documentId="c0" {...props} />)) }
async function click(el) { expect(el).toBeTruthy(); await act(async () => { el.click(); await Promise.resolve() }) }
async function change(el, value) {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('review notes, issues and reports', () => {
  it('records notes against the visible chapter without altering the chapter metadata', async () => {
    start(); const before = evidenceReview.getSnapshot().chapters; await render(); await change(note(), '称呼需核对')
    expect(evidenceReview.getSnapshot().annotations.c0.text).toBe('称呼需核对')
    expect(evidenceReview.getSnapshot().chapters).toBe(before)
    expect(note().maxLength).toBe(2000)
  })
  it('flags changes, blocks reviewed completion, and preserves notes when resolving', async () => {
    start(); await render(); await click(button('标记已核对')); await change(note(), '有疑点'); await click(button('标记待修改'))
    expect(evidenceReview.getSnapshot().reviewedIds).toEqual([])
    expect(button('处理待修改后可标记').disabled).toBe(true)
    await click(button('取消待修改标记')); expect(evidenceReview.getSnapshot().reviewedIds).toEqual([])
    expect(note().value).toBe('有疑点'); await click(button('标记已核对')); expect(evidenceReview.getSnapshot().reviewedIds).toEqual(['c0'])
  })
  it('retains chapter-specific notes through navigation and dirty-state changes', async () => {
    start(); await render(); await change(note(), '甲章'); await render({ dirty: true }); expect(note().value).toBe('甲章')
    await render({ documentId: 'c1' }); expect(note().value).toBe(''); await change(note(), '乙章')
    await render(); expect(note().value).toBe('甲章'); expect(evidenceReview.getSnapshot().annotations.c1.text).toBe('乙章')
  })
  it('skips reviewed chapters but does not advance after the unsaved guard cancels', async () => {
    const s = start(); evidenceReview.setReviewed(s.id, 'c1', true)
    const open = vi.fn().mockResolvedValue(false); await render({ onOpenFile: open }); await click(button('下一未核对章'))
    expect(open).toHaveBeenCalledWith('c2'); expect(evidenceReview.getSnapshot().chapterId).toBe('c0')
    open.mockResolvedValue(true); await click(button('下一未核对章')); expect(evidenceReview.getSnapshot().chapterId).toBe('c2')
  })
  it('filters notes and statuses over the entire queue rather than only the first page', async () => {
    const s = start(); evidenceReview.setAnnotation(s.id, 'c18', { text: '末章疑点', needsChanges: true }); await render({ onOpenFile: vi.fn() })
    await change(label('核对清单状态'), 'changes'); await change(label('核对清单搜索'), '末章')
    expect(label('本轮核对章节清单').querySelectorAll('li')).toHaveLength(1)
    expect(label('本轮核对章节清单').textContent).toContain('第19章')
    await change(label('核对清单搜索'), '没有记录'); expect(host.textContent).toContain('没有匹配的核对记录')
  })
  it('paginates and clamps the page when matching records shrink', async () => {
    const s = start(); for (const c of chapters) evidenceReview.setAnnotation(s.id, c.id, { needsChanges: true })
    await render({ onOpenFile: vi.fn() }); await change(label('核对清单状态'), 'changes')
    await click(button('下一页清单')); await click(button('下一页清单'))
    expect(label('本轮核对章节清单').querySelectorAll('li')).toHaveLength(3)
    await act(async () => { for (const c of chapters.slice(2)) evidenceReview.setAnnotation(s.id, c.id, { needsChanges: false }) })
    expect(label('本轮核对章节清单').querySelectorAll('li')).toHaveLength(2)
    expect(label('核对清单分页')).toBeNull()
  })
  it('keeps position and notes when opening a listed chapter fails or is cancelled', async () => {
    const s = start(); evidenceReview.setAnnotation(s.id, 'c0', { text: '保留' }); const open = vi.fn().mockResolvedValue(false)
    await render({ onOpenFile: open }); await click(label('打开核对清单章节 第2章.md'))
    expect(evidenceReview.getSnapshot().chapterId).toBe('c0'); expect(note().value).toBe('保留')
    open.mockRejectedValue(new Error('offline')); await click(label('打开核对清单章节 第2章.md'))
    expect(evidenceReview.getSnapshot().chapterId).toBe('c0'); expect(toast.error).toHaveBeenCalled()
  })
  it('requires explicit confirmation before clearing annotations and cancellation preserves them', async () => {
    start(); await render(); await change(note(), '不可误删'); await click(button('结束核对'))
    expect(host.querySelector('[role="dialog"]')).toBeTruthy(); expect(evidenceReview.getSnapshot()).not.toBeNull()
    await click(button('保留并继续')); expect(evidenceReview.getSnapshot().annotations.c0.text).toBe('不可误删')
    await click(button('结束核对')); await click(button('确认结束并清除')); expect(evidenceReview.getSnapshot()).toBeNull()
  })
  it('shows notes as text, never active HTML', async () => {
    start(); await render(); await change(note(), '<img src=x onerror=alert(1)>')
    expect(host.querySelector('img')).toBeNull(); expect(label('本轮核对章节清单').textContent).toContain('<img')
  })
  it('exports the full queue including off-page notes, without clearing the session', async () => {
    const s = start(); evidenceReview.setAnnotation(s.id, 'c18', { text: '末章记录' }); await render()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await click(button('导出本轮清单'))
    const blob = create.mock.calls[0][0]; const text = await blob.text()
    expect(text).toContain('末章记录'); expect((text.match(/^## /gm)||[])).toHaveLength(19)
    expect(clicked).toHaveBeenCalled(); expect(evidenceReview.getSnapshot().annotations.c18.text).toBe('末章记录')
    expect(host.querySelector('a[download]')).toBeNull()
  })
  it('reports export failure without losing records or claiming success', async () => {
    const s = start(); evidenceReview.setAnnotation(s.id, 'c0', { text: '留存' }); await render()
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('cannot export') })
    await click(button('导出本轮清单')); expect(toast.error).toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
    expect(evidenceReview.getSnapshot().annotations.c0.text).toBe('留存')
  })
  it('makes the prior report available on a different entity page and blocks silent scope replacement', async () => {
    const s = start(); evidenceReview.setAnnotation(s.id, 'c0', { text: '上轮记录' }); const prior = evidenceReview.getSnapshot(); const open = vi.fn()
    await act(async () => root.render(<ProjectEntityEvidencePanel projectId="p2" entityId="index:a" intelligence={model()} onOpenFile={open} />))
    expect(button('导出本轮清单')).toBeTruthy(); await click(label('打开证据章节 第1章'))
    expect(open).not.toHaveBeenCalled(); expect(evidenceReview.getSnapshot()).toBe(prior)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('更换核对范围'), 6)
  })
  it('rolls back the previous annotations and reviewed progress when reopening is rejected', async () => {
    const s = start(); evidenceReview.setAnnotation(s.id, 'c0', { text: '上轮记录' }); evidenceReview.setReviewed(s.id, 'c1', true)
    const prior = evidenceReview.getSnapshot()
    await act(async () => root.render(<ProjectEntityEvidencePanel projectId="p1" entityId="index:a" intelligence={model()} onOpenFile={() => false} />))
    await click(label('打开证据章节 第2章')); expect(evidenceReview.getSnapshot()).toBe(prior)
  })
  it('does not navigate behind the Markdown source editor', async () => {
    start(); const open = vi.fn(); await render({ onOpenFile: open })
    const overlay = document.createElement('textarea'); overlay.className = 'markdown-source-overlay'; overlay.value = '未应用'; document.body.append(overlay)
    try {
      await click(button('下一未核对章')); await click(label('打开核对清单章节 第2章.md'))
      expect(open).not.toHaveBeenCalled(); expect(overlay.value).toBe('未应用')
    } finally { overlay.remove() }
  })
  it('allows opening the original queue from an unrelated currently displayed note', async () => {
    start(); const open = vi.fn().mockResolvedValue(true); await render({ documentId: 'outside', onOpenFile: open })
    expect(note()).toBeNull(); await click(label('打开核对清单章节 第1章.md'))
    expect(open).toHaveBeenCalledWith('c0')
  })
  it('standalone list opening uses the same cancellation guard and does not infer review', async () => {
    start(); const open = vi.fn().mockResolvedValue(false)
    await act(async () => root.render(<React.StrictMode><EvidenceReviewRecords onOpenFile={open} /></React.StrictMode>))
    await click(label('打开核对清单章节 第3章.md'))
    expect(evidenceReview.getSnapshot().chapterId).toBe('c0'); expect(evidenceReview.getSnapshot().reviewedIds).toEqual([])
  })
})
