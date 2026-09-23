import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EvidenceReviewBar from './EvidenceReviewBar'
import ProjectEntityEvidencePanel from './ProjectEntityEvidencePanel'
import ProjectWorkspacePanel from './ProjectWorkspacePanel'
import { buildProjectEntityIntelligence } from './projectEntityIntelligenceUtils'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { listAllFilesWithContent } from '~/services/api'
import { tagApi } from '~/services/tagApi'
import { toast } from '~/services/toast'

vi.mock('~/services/api', () => ({ api: vi.fn(), listAllFilesWithContent: vi.fn() }))
vi.mock('~/services/tagApi', () => ({ tagApi: { list: vi.fn(), getFilesByTag: vi.fn() } }))
const chapters = Array.from({ length: 15 }, (_, index) => ({ id: 'c' + index, title: `第${index + 1}章.md`, ordinal: index + 1 }))
const context = { projectId: 'p1', entityId: 'index:a', entityLabel: '关关', filters: { query: '', source: 'alias', volumeId: '', page: 3 } }
function fixture() {
  const notes = chapters.map(c => ({ ...c, content: JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', children: [
    { type: 'text', text: '关关来到早市。小关买了豆浆。' },
  ] }] } }) }))
  const meta = { entityAliases: { 'index:a': ['小关'] } }
  const workspace = { project: { id: 'p1' }, volumes: [{ id: '', title: '未分卷', notes }] }
  return { meta, workspace, model: buildProjectEntityIntelligence(workspace, { characters: [{ id: 'a', title: '关关.md' }] }, meta) }
}
let host, root, frames, frameId
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  frames = new Map(); frameId = 0
  vi.stubGlobal('requestAnimationFrame', fn => { frames.set(++frameId, fn); return frameId })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  vi.spyOn(toast, 'warning').mockImplementation(() => {})
  vi.spyOn(toast, 'error').mockImplementation(() => {})
  evidenceReview.end(); evidenceNavigation.cancel(); localStorage.clear()
  listAllFilesWithContent.mockReset(); tagApi.list.mockReset(); tagApi.getFilesByTag.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  evidenceReview.end(); evidenceNavigation.cancel(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const find = name => [...host.querySelectorAll('button')].find(b => b.textContent === name)
const labeled = name => host.querySelector(`[aria-label="${name}"]`)
async function click(element) { expect(element).toBeTruthy(); await act(async () => { element.click(); await Promise.resolve() }) }
async function flush() { await act(async () => { for (const fn of [...frames.values()]) fn(); frames.clear(); await Promise.resolve() }) }
async function bar(props = {}) { await act(async () => root.render(<EvidenceReviewBar documentId="c12" {...props} />)) }

describe('review continuation and return', () => {
  it('stays absent outside a review and does not mutate document data', async () => {
    await bar(); expect(labeled('证据连续核对')).toBeNull()
  })
  it('shows only valid neighboring actions and does not infer completion', async () => {
    evidenceReview.start(context, chapters, 'c0'); await bar({ documentId: 'c0', onOpenFile: vi.fn() })
    expect(find('上一证据章').disabled).toBe(true)
    expect(find('下一证据章').disabled).toBe(false)
    expect(evidenceReview.getSnapshot().reviewedIds).toEqual([])
  })
  it('advances only after the navigation guard accepts', async () => {
    evidenceReview.start(context, chapters, 'c12')
    let settle; const open = vi.fn(() => new Promise(resolve => { settle = resolve }))
    await bar({ onOpenFile: open }); await click(find('下一证据章'))
    expect(open).toHaveBeenCalledWith('c13')
    expect(evidenceReview.getSnapshot().chapterId).toBe('c12')
    expect(find('返回证据列表').disabled).toBe(true)
    await act(async () => { settle(true); await Promise.resolve() })
    expect(evidenceReview.getSnapshot().chapterId).toBe('c13')
  })
  it('keeps position after cancellation or failure and releases the busy state', async () => {
    evidenceReview.start(context, chapters, 'c12')
    await bar({ onOpenFile: () => Promise.resolve(false) }); await click(find('下一证据章'))
    expect(evidenceReview.getSnapshot().chapterId).toBe('c12')
    expect(find('下一证据章').disabled).toBe(false)
    await bar({ onOpenFile: () => Promise.reject(new Error('unavailable')) }); await click(find('下一证据章'))
    expect(evidenceReview.getSnapshot().chapterId).toBe('c12')
    expect(toast.error).toHaveBeenCalled()
  })
  it('clears pending precise navigation before an ordinary chapter step', async () => {
    evidenceReview.start(context, chapters, 'c12'); evidenceNavigation.start('c12', { version: 1 })
    await bar({ onOpenFile: () => true }); await click(find('下一证据章'))
    expect(evidenceNavigation.peek()).toBeNull()
  })
  it('clears manual reviewed state when the current manuscript is edited', async () => {
    evidenceReview.start(context, chapters, 'c12'); await bar(); await click(find('标记已核对'))
    expect(evidenceReview.getSnapshot().reviewedIds).toEqual(['c12'])
    await bar({ dirty: true })
    expect(evidenceReview.getSnapshot().reviewedIds).toEqual([])
    expect(find('保存后可标记').disabled).toBe(true)
  })
  it('preserves a Markdown source draft rather than switching or returning behind it', async () => {
    evidenceReview.start(context, chapters, 'c12')
    const source = document.createElement('textarea'); source.className = 'markdown-source-overlay'; source.value = '未应用源码'; host.append(source)
    // Render replaces the host, so use a separate sibling as the real overlay.
    document.body.append(source)
    try {
      const open = vi.fn(); const back = vi.fn(); await bar({ onOpenFile: open, onReturn: back })
      await click(find('下一证据章')); await click(find('返回证据列表'))
      expect(open).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled()
      expect(source.value).toBe('未应用源码'); expect(toast.warning).toHaveBeenCalled()
    } finally { source.remove() }
  })
  it('lets the App decide when return is permitted, and clears state on explicit end', async () => {
    const session = evidenceReview.start(context, chapters, 'c12'); const back = vi.fn()
    await bar({ onReturn: back }); await click(find('返回证据列表'))
    expect(back).toHaveBeenCalledWith(session.id); expect(evidenceReview.getReturn()).toBeNull()
    await click(find('结束核对')); expect(evidenceReview.getSnapshot()).toBeNull()
  })
  it('does not mark or advance unrelated notes', async () => {
    evidenceReview.start(context, chapters, 'c12'); await bar({ documentId: 'outside', onOpenFile: vi.fn() })
    expect(find('下一证据章').disabled).toBe(true); expect(find('标记已核对').disabled).toBe(true)
    expect(evidenceReview.getSnapshot().chapterId).toBe('c12')
  })
  it('restores the original source, volume, page and focused chapter under StrictMode', async () => {
    const data = fixture(); const session = evidenceReview.start(context, chapters, 'c12'); evidenceReview.requestReturn(session.id)
    await act(async () => root.render(<React.StrictMode><ProjectEntityEvidencePanel projectId="p1" entityId="index:a"
      intelligence={data.model} projectMeta={data.meta} onOpenFile={vi.fn()} /></React.StrictMode>))
    await flush()
    expect(labeled('实体证据来源筛选').value).toBe('alias')
    expect(labeled('实体证据卷筛选').value).toBe(JSON.stringify(''))
    expect(labeled('实体证据分页').textContent).toContain('第 3 / 3 页')
    expect(document.activeElement.getAttribute('aria-label')).toBe('打开证据章节 第13章')
    expect(evidenceReview.getReturn()).toBeNull()
  })
  it('creates a full filter-scoped queue when opening from the actual evidence panel', async () => {
    const data = fixture(); const open = vi.fn(() => true)
    await act(async () => root.render(<ProjectEntityEvidencePanel projectId="p1" entityId="index:a"
      intelligence={data.model} projectMeta={data.meta} onOpenFile={open} />))
    await click(labeled('打开证据章节 第1章'))
    expect(evidenceReview.getSnapshot().chapters).toHaveLength(15)
    expect(JSON.stringify(evidenceReview.getSnapshot())).not.toContain('买了豆浆')
  })
  it('removes a just-created session when an actual open is cancelled', async () => {
    const data = fixture()
    await act(async () => root.render(<ProjectEntityEvidencePanel projectId="p1" entityId="index:a"
      intelligence={data.model} projectMeta={data.meta} onOpenFile={() => false} />))
    await click(host.querySelector('.project-entity-evidence-excerpt button'))
    expect(evidenceReview.getSnapshot()).toBeNull(); expect(evidenceNavigation.peek()).toBeNull()
  })
  it('reports missing return evidence instead of claiming a different chapter was restored', async () => {
    const data = fixture(); data.model.entityById.get('index:a').evidence = []
    const session = evidenceReview.start(context, chapters, 'c12'); evidenceReview.requestReturn(session.id)
    await act(async () => root.render(<ProjectEntityEvidencePanel projectId="p1" entityId="index:a"
      intelligence={data.model} projectMeta={data.meta} />))
    await flush(); expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('已不符合筛选'))
    expect(evidenceReview.getReturn()).toBeNull()
  })
  it('does not restore an unrelated project or overwrite its filter controls', async () => {
    const data = fixture(); const session = evidenceReview.start(context, chapters, 'c12'); evidenceReview.requestReturn(session.id)
    await act(async () => root.render(<ProjectEntityEvidencePanel projectId="p2" entityId="index:a"
      intelligence={data.model} projectMeta={data.meta} />))
    expect(labeled('实体证据来源筛选').value).toBe('all')
    expect(evidenceReview.getReturn('p1')).not.toBeNull()
  })
  it('does not silently resume a different project when the source project was deleted', async () => {
    const session = evidenceReview.start(context, chapters, 'c12'); evidenceReview.requestReturn(session.id)
    listAllFilesWithContent.mockResolvedValue([{ id: 'p2', title: '另一个项目', is_folder: true, parent_id: '' }])
    tagApi.list.mockResolvedValue([])
    await act(async () => { root.render(<ProjectWorkspacePanel onClose={vi.fn()} />); await Promise.resolve() })
    expect(host.textContent).toContain('原项目已不存在')
    expect(evidenceReview.getReturn()).toBeNull()
    expect(host.textContent).not.toContain('另一个项目')
  })
})
