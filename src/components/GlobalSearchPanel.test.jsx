import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import GlobalSearchPanel from './GlobalSearchPanel'
import { searchLibrary, prepareSearchLocation } from '~/services/globalSearch'
import { evidenceNavigation } from '~/services/evidenceNavigation'
vi.mock('~/services/globalSearch', async importOriginal => ({ ...(await importOriginal()), searchLibrary: vi.fn(), prepareSearchLocation: vi.fn() }))
let container, root, onClose, onOpenFile
const row = (id, patch = {}) => ({ id, title: '笔记 ' + id, folder_path: '项目 / 第一卷', updated_at: 1, is_pinned: false, title_match: false, body_count: 1, content_sha256: 'a'.repeat(64), snippets: [{ kind: 'body', before: '清晨，', match: '关关', after: '来了。', leading: false, trailing: false, start: 3, end: 5 }], ...patch })
const reply = (patch = {}) => ({ items: [row('a'), row('b')], total: 43, total_occurrences: 43, folders: [{ id: 'p', label: '项目' }], page: 1, pages: 3, page_size: 20, revision: 'b'.repeat(64), scanned: 50, unsupported: 0, query: '关关', ...patch })
const find = label => container.querySelector('[aria-label="' + label + '"]')
const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text)
const click = async element => { expect(element).toBeTruthy(); await act(async () => element.click()) }
async function advance() { await act(async () => { await vi.advanceTimersByTimeAsync(220) }) }
async function render(patch = {}) { await act(async () => root.render(<GlobalSearchPanel open onClose={onClose} onOpenFile={onOpenFile} {...patch} />)); await advance() }
async function change(element, value) {
 await act(async () => {
   const proto = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
   Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
   element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }))
 })
 await advance()
}
beforeEach(() => {
 vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); searchLibrary.mockReset(); prepareSearchLocation.mockReset(); evidenceNavigation.cancel()
 searchLibrary.mockResolvedValue(reply()); onClose = vi.fn(); onOpenFile = vi.fn().mockResolvedValue(true)
 container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); evidenceNavigation.cancel(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('global search workbench', () => {
 it('renders total counts, directory context, highlighted excerpts and a focused query', async () => {
   await render(); expect(container.textContent).toContain('43 篇笔记'); expect(container.textContent).toContain('项目 / 第一卷'); expect(container.querySelector('mark').textContent).toBe('关关'); expect(document.activeElement).toBe(find('全局检索关键词'))
 })
 it('requests later pages with the exact snapshot revision instead of slicing the first twenty', async () => {
   await render(); searchLibrary.mockResolvedValue(reply({ page: 2, items: [row('21')] })); await click(button('下一页')); await advance()
   expect(searchLibrary.mock.calls.at(-1)[0]).toMatchObject({ page: 2, revision: 'b'.repeat(64) }); expect(container.textContent).toContain('笔记 21')
 })
 it('composes directory, body, case, pinned and date filters and resets pagination', async () => {
   await render(); await change(find('检索目录范围'), 'p'); await change(find('检索命中位置'), 'body'); await change(find('检索修改时间'), '7')
   const checks = container.querySelectorAll('input[type=checkbox]'); await click(checks[0]); await click(checks[1]); await advance()
   expect(searchLibrary.mock.calls.at(-1)[0]).toMatchObject({ source: 'body', folderId: 'p', pinned: true, matchCase: true, page: 1, revision: '' }); expect(searchLibrary.mock.calls.at(-1)[0].since).toBeGreaterThan(0)
 })
 it('keeps the changed-library failure distinct from empty results and refreshes without an old revision', async () => {
   await render(); searchLibrary.mockRejectedValue(new Error('资料库已变化，请刷新检索后重新翻页'))
   await click(button('下一页')); await advance(); expect(container.textContent).toContain('不能据此判断没有结果'); expect(container.textContent).not.toContain('当前范围没有匹配')
   searchLibrary.mockResolvedValue(reply()); await click(button('重新检索')); await advance(); expect(searchLibrary.mock.calls.at(-1)[0].revision).toBe('')
 })
 it('cannot show stale results or navigate while a new query is loading', async () => {
   await render(); let resolve; searchLibrary.mockReturnValue(new Promise(done => { resolve = done }))
   await change(find('全局检索关键词'), 'new'); expect(button('打开笔记')).toBeUndefined()
   await act(async () => resolve(reply({ query: 'new', items: [row('new')] }))); expect(container.textContent).toContain('笔记 new')
 })
 it('ignores out-of-order responses and aborts the previous request', async () => {
   let first; searchLibrary.mockReturnValueOnce(new Promise(done => { first = done })); await render()
   const signal = searchLibrary.mock.calls[0][1]; searchLibrary.mockResolvedValue(reply({ items: [row('new')] })); await change(find('全局检索关键词'), 'new')
   expect(signal.aborted).toBe(true); await act(async () => first(reply({ items: [row('old')] }))); expect(container.textContent).not.toContain('笔记 old')
 })
 it('preserves filters across closing/reopening and aborts closed requests', async () => {
   await render(); await change(find('检索目录范围'), 'p'); const signal = searchLibrary.mock.calls.at(-1)[1]
   await render({ open: false }); expect(signal.aborted).toBe(true); expect(find('全局检索关键词')).toBeNull()
   await render(); expect(find('检索目录范围').value).toBe('p')
 })
 it('uses an explicit quick-switcher seed without losing it on the first mount', async () => {
   const seed = { query: '青崖' }; await render({ seed }); expect(find('全局检索关键词').value).toBe('青崖')
 })
 it('opens through the guarded callback and only closes after accepted selection', async () => {
   let resolve; onOpenFile.mockImplementation(() => new Promise(done => { resolve = done }))
   await render(); await click(button('打开笔记')); expect(onOpenFile).toHaveBeenCalledWith('a'); expect(onClose).not.toHaveBeenCalled(); expect(container.querySelector('[role=dialog]')).toBeNull()
   await act(async () => resolve(true)); expect(onClose).toHaveBeenCalledOnce()
 })
 it('returns to the same search when draft confirmation is cancelled, without a navigation request', async () => {
   onOpenFile.mockResolvedValue(false); await render(); await click(button('打开笔记'))
   expect(onClose).not.toHaveBeenCalled(); expect(container.textContent).toContain('原草稿与检索条件均已保留'); expect(evidenceNavigation.peek()).toBeNull()
 })
 it('starts exact navigation only after the guarded open has succeeded', async () => {
   const target = { version: 1, kind: 'text', snapshot: '关关', start: 0, end: 2, match: '关关' }; prepareSearchLocation.mockResolvedValue(target)
   let resolve; onOpenFile.mockImplementation(() => new Promise(done => { resolve = done })); await render(); await click(button('定位第 1 处'))
   expect(evidenceNavigation.peek()).toBeNull(); await act(async () => resolve(true)); expect(evidenceNavigation.peek('a').target).toEqual(target)
 })
 it('does not navigate or close after a failed content hash check', async () => {
   prepareSearchLocation.mockRejectedValue(new Error('正文已变化')); await render(); await click(button('定位第 1 处'))
   expect(container.textContent).toContain('正文已变化'); expect(onOpenFile).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
 })
 it('renders code and hostile markup only as text and avoids fake code location buttons', async () => {
   searchLibrary.mockResolvedValue(reply({ items: [row('a', { title: '<img src=x>', snippets: [{ kind: 'code', before: '<script>', match: '关关', after: '</script>' }] })] }))
   await render(); expect(container.querySelector('img')).toBeNull(); expect(container.querySelector('script')).toBeNull(); expect(button('定位第 1 处')).toBeUndefined(); expect(container.textContent).toContain('不模拟字符定位')
 })
 it('exposes partial unsupported-body coverage and a genuine empty state', async () => {
   searchLibrary.mockResolvedValue(reply({ unsupported: 1, total: 0, items: [], total_occurrences: 0 })); await render()
   expect(container.textContent).toContain('正文结果可能不完整'); expect(container.textContent).toContain('当前范围没有匹配')
 })
 it('does not use IME Enter to submit or choose a result', async () => {
   await render(); const count = searchLibrary.mock.calls.length
   await act(async () => find('全局检索关键词').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))); await advance()
   expect(searchLibrary).toHaveBeenCalledTimes(count); expect(onOpenFile).not.toHaveBeenCalled()
 })
 it('supports keyboard result selection and Escape without mutating data', async () => {
   await render(); await act(async () => find('全局检索关键词').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
   expect(document.activeElement.getAttribute('data-search-result')).not.toBeNull()
   await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
   expect(find('检索上下文预览').textContent).toContain('笔记 b')
   await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(onClose).toHaveBeenCalledOnce(); expect(onOpenFile).not.toHaveBeenCalled()
 })
})

it('continuously previews results across page boundaries without opening notes', async () => {
 await render();await click(button('下一结果'));expect(find('检索上下文预览').textContent).toContain('笔记 b')
 searchLibrary.mockResolvedValue(reply({page:2,items:[row('21'),row('22')]}));await click(button('下一结果'));await advance()
 expect(searchLibrary.mock.calls.at(-1)[0]).toMatchObject({page:2,revision:'b'.repeat(64)});expect(find('检索上下文预览').textContent).toContain('笔记 21')
 searchLibrary.mockResolvedValue(reply({page:1,items:[row('a'),row('b')]}));await click(button('上一结果'));await advance();expect(find('检索上下文预览').textContent).toContain('笔记 b');expect(onOpenFile).not.toHaveBeenCalled()
})
it('stops continuous browsing at the first and last result', async () => {
 searchLibrary.mockResolvedValue(reply({total:1,pages:1,items:[row('a')]}));await render();expect(button('上一结果').disabled).toBe(true);expect(button('下一结果').disabled).toBe(true)
})
it('recomputes rolling dates and returns to page one on refresh', async () => {
 await render();await change(find('检索修改时间'),'7');const old=searchLibrary.mock.calls.at(-1)[0].since
 vi.setSystemTime(Date.now()+86400000);await click(button('搜索 / 刷新'));await advance()
 expect(searchLibrary.mock.calls.at(-1)[0].since).toBeGreaterThanOrEqual(old+86400);expect(searchLibrary.mock.calls.at(-1)[0].page).toBe(1)
})
it('keeps cache metrics informational and never uses them as a saved-content indicator', async () => {
 searchLibrary.mockResolvedValue(reply({cache_hits:49,parsed:1}));await render();expect(container.textContent).toContain('复用 49 篇解析，新解析 1 篇');expect(container.textContent).toContain('仍核验当前正文')
})
it('restores list scroll during an editor round trip on the same page', async () => {
 await render();const list=find('全局检索结果');list.scrollTop=170;await act(async()=>list.dispatchEvent(new Event('scroll',{bubbles:true})))
 await render({open:false});await render();expect(find('全局检索结果').scrollTop).toBe(170)
})
it('changed-library errors during cross-page browsing never open a stale result', async () => {
 await render();await click(button('下一结果'));searchLibrary.mockRejectedValue(new Error('资料库已变化'));await click(button('下一结果'));await advance()
 expect(button('打开笔记')).toBeUndefined();expect(onOpenFile).not.toHaveBeenCalled();expect(container.textContent).toContain('资料库已变化')
})
it('refreshes rolling dates when reopening on another day', async () => {
 await render();await change(find('检索修改时间'),'7');const old=searchLibrary.mock.calls.at(-1)[0].since
 await render({open:false});vi.setSystemTime(Date.now()+2*86400000);await render();expect(searchLibrary.mock.calls.at(-1)[0].since).toBeGreaterThanOrEqual(old+2*86400)
})

it('records return metadata only after an accepted guarded open', async () => {
 const onOpened=vi.fn();await render({onOpened});onOpenFile.mockResolvedValue(false);await click(button('打开笔记'));expect(onOpened).not.toHaveBeenCalled()
 onOpenFile.mockResolvedValue(true);await click(button('打开笔记'))
 expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({documentId:'a',page:1}))
 expect(JSON.stringify(onOpened.mock.calls[0][0])).not.toContain('snippets')
})
it('does not publish return metadata for late opens after the workbench closes', async () => {
 const onOpened=vi.fn();let finish;onOpenFile.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 await render({onOpened});await click(button('打开笔记'));await render({open:false,onOpened});await act(async()=>finish(true));expect(onOpened).not.toHaveBeenCalled()
})
const origin = () => ({documentId:'b',title:'笔记 b',page:3,scrollTop:180,filters:{query:'关关',source:'body',folderId:'p',days:'7',pinned:false,matchCase:true,sort:'updated'}})
it('restores exact filters and follows a moved result to its new page', async () => {
 await render();await render({open:false})
 searchLibrary.mockResolvedValue(reply({page:2,anchor_id:'b',anchor_found:true,items:[row('b'),row('other')]}))
 await render({returnRequest:{context:origin()}})
 expect(searchLibrary.mock.calls.at(-1)[0]).toMatchObject({anchorId:'b',page:3,revision:'',source:'body',folderId:'p',days:'7'})
 expect(find('检索上下文预览').textContent).toContain('笔记 b');expect(container.textContent).toContain('已按笔记标识找回原结果')
 expect(document.activeElement.getAttribute('aria-selected')).toBe('true')
})
it('reports an out-of-scope result while keeping the original directory filter', async () => {
 searchLibrary.mockResolvedValue(reply({anchor_id:'b',anchor_found:false,items:[row('a')]}))
 await render({returnRequest:{context:origin()}})
 expect(container.textContent).toContain('原笔记已不在当前检索结果中');expect(find('检索目录范围').value).toBe('p')
 expect(onOpenFile).not.toHaveBeenCalled()
})
it('clears the anchor before later manual pagination so it cannot pin every request to one page', async () => {
 searchLibrary.mockResolvedValue(reply({page:2,anchor_id:'b',anchor_found:true,items:[row('b')]}))
 await render({returnRequest:{context:origin()}});await click(button('下一页'));await advance()
 expect(searchLibrary.mock.calls.at(-1)[0]).toMatchObject({page:3,anchorId:'',revision:'b'.repeat(64)})
})
it('new return requests can restore the same origin after changed search conditions', async () => {
 const c=origin();searchLibrary.mockResolvedValue(reply({anchor_id:'b',anchor_found:true}))
 await render({returnRequest:{context:c}});await change(find('全局检索关键词'),'new');await render({returnRequest:{context:c}})
 expect(find('全局检索关键词').value).toBe('关关')
})
