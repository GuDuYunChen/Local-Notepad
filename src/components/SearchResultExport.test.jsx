import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import GlobalSearchPanel from './GlobalSearchPanel'
import { searchLibrary } from '~/services/globalSearch'
import { collectSearchResultReport, downloadSearchResultReport } from '~/services/searchResultExport'
vi.mock('~/services/globalSearch', async original => ({ ...(await original()), searchLibrary: vi.fn() }))
vi.mock('~/services/searchResultExport', async original => ({ ...(await original()), collectSearchResultReport: vi.fn(), downloadSearchResultReport: vi.fn() }))
vi.mock('./SearchPresetsPanel', () => ({default:()=>null}))
const item=i=>({id:'n'+i,title:'笔记 '+i,folder_path:'项目 / 正文',updated_at:1,is_pinned:false,title_match:true,body_count:0,content_sha256:'a'.repeat(64),snippets:[]})
const page=(number=1,patch={})=>({items:Array.from({length:number===3?3:20},(_,i)=>item((number-1)*20+i+1)),total:43,total_occurrences:0,folders:[],page:number,pages:3,page_size:20,revision:'b'.repeat(64),scanned:43,unsupported:0,query:'',...patch})
let root,container,onClose,onOpenFile
const label=name=>container.querySelector('[aria-label="'+name+'"]')
const button=text=>[...container.querySelectorAll('button')].find(el=>el.textContent===text)
const click=async el=>{expect(el).toBeTruthy();await act(async()=>el.click())}
const advance=async()=>act(async()=>vi.advanceTimersByTimeAsync(220))
async function render(props={}){await act(async()=>root.render(<GlobalSearchPanel open onClose={onClose} onOpenFile={onOpenFile} {...props}/>));await advance()}
async function query(text){await act(async()=>{const el=label('全局检索关键词');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}))});await advance()}
beforeEach(()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 searchLibrary.mockReset().mockImplementation(async f=>page(f.page||1,{query:f.query||''}))
 collectSearchResultReport.mockReset().mockImplementation(async(f,r,o)=>({count:o.mode==='all'?r.total:o.selection.length}))
 downloadSearchResultReport.mockReset().mockReturnValue('清单.md')
 onClose=vi.fn();onOpenFile=vi.fn().mockResolvedValue(false);container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals()})

it('starts with no selection and metadata-only export, independently of the active preview',async()=>{
 await render();expect(button('导出所选 0 篇').disabled).toBe(true)
 expect(container.querySelector('.search-result-export input[type=checkbox]').checked).toBe(false)
 expect(button('加入导出清单').getAttribute('aria-pressed')).toBe('false')
})
it('adds a single preview result and displays membership in the left result list',async()=>{
 await render();await click(button('加入导出清单'));expect(button('导出所选 1 篇').disabled).toBe(false)
 expect(label('已加入导出清单')).toBeTruthy();expect(onOpenFile).not.toHaveBeenCalled()
 await click(button('移出导出清单'));expect(button('导出所选 0 篇').disabled).toBe(true)
})
it('selects across pages, removes only current-page entries and clears the whole set',async()=>{
 await render();await click(button('加入本页结果'));await click(button('下一页'));await advance();await click(button('加入本页结果'))
 expect(button('导出所选 40 篇')).toBeTruthy();await click(button('移除本页选择'));expect(button('导出所选 20 篇')).toBeTruthy()
 await click(button('清空选择'));expect(button('导出所选 0 篇').disabled).toBe(true)
})
it('deduplicates repeated add-page operations',async()=>{
 await render();await click(button('加入本页结果'));await click(button('加入本页结果'));expect(button('导出所选 20 篇')).toBeTruthy()
})
it('preserves selected IDs over a close/reopen with the same query and revision',async()=>{
 await render();await click(button('加入导出清单'));await render({open:false});await render()
 expect(button('导出所选 1 篇')).toBeTruthy()
})
it('clears and announces old selections when criteria change',async()=>{
 await render();await click(button('加入导出清单'));await query('新词')
 expect(button('导出所选 0 篇').disabled).toBe(true);expect(container.textContent).toContain('旧选择已清空')
})
it('clears selections when the library revision changes after reopening',async()=>{
 await render();await click(button('加入导出清单'));await render({open:false})
 searchLibrary.mockImplementation(async f=>page(f.page||1,{revision:'c'.repeat(64),query:f.query||''}));await render()
 expect(button('导出所选 0 篇').disabled).toBe(true);expect(container.textContent).toContain('旧选择已清空')
})
it('exports the selected identities and never confuses current page with the full result count',async()=>{
 await render();await click(button('加入导出清单'));await click(button('导出所选 1 篇'))
 expect(collectSearchResultReport.mock.calls[0][2]).toMatchObject({mode:'selected',selection:[{id:'n1',page:1,contentSHA256:'a'.repeat(64)}],includeSnippets:false})
 expect(downloadSearchResultReport).toHaveBeenCalledWith({count:1},'markdown');expect(container.textContent).toContain('已发起 1 篇结果清单下载')
 expect(onOpenFile).not.toHaveBeenCalled()
})
it('all-result export explicitly requests the entire scope rather than the visible page or selection',async()=>{
 await render();await click(button('导出全部 43 篇结果'))
 expect(collectSearchResultReport.mock.calls[0][2].mode).toBe('all');expect(container.textContent).toContain('已发起 43 篇')
})
it('requires opt-in before including snippets and supports JSON format',async()=>{
 await render();await click(container.querySelector('.search-result-export input[type=checkbox]'))
 await act(async()=>{const el=label('检索清单导出格式');el.value='json';el.dispatchEvent(new Event('change',{bubbles:true}))})
 await click(button('导出全部 43 篇结果'))
 expect(collectSearchResultReport.mock.calls[0][2].includeSnippets).toBe(true);expect(downloadSearchResultReport.mock.calls[0][1]).toBe('json')
})
it('reports progress and disables duplicate operations and selection edits during export',async()=>{
 let resolve;collectSearchResultReport.mockImplementation((f,r,o)=>{o.onProgress({completed:1,total:3,phase:'collect'});return new Promise(done=>{resolve=done})})
 await render();await click(button('加入导出清单'));await click(button('导出所选 1 篇'))
 expect(label('检索清单准备进度')).toBeTruthy();expect(button('加入本页结果').disabled).toBe(true);expect(button('清空选择').disabled).toBe(true)
 expect(button('导出全部 43 篇结果').disabled).toBe(true);await act(async()=>resolve({count:1}));expect(button('加入本页结果').disabled).toBe(false)
})
it('cancel retains selection and cannot download a late successful response',async()=>{
 let resolve;collectSearchResultReport.mockImplementation(()=>new Promise(done=>{resolve=done}))
 await render();await click(button('加入导出清单'));await click(button('导出所选 1 篇'));const signal=collectSearchResultReport.mock.calls[0][2].signal
 await click(button('取消导出'));expect(signal.aborted).toBe(true);await act(async()=>resolve({count:1}))
 expect(downloadSearchResultReport).not.toHaveBeenCalled();expect(button('导出所选 1 篇').disabled).toBe(false)
 expect(container.textContent).toContain('已取消导出')
})
it('closing aborts an in-flight export even when the transport resolves late',async()=>{
 let resolve;collectSearchResultReport.mockImplementation(()=>new Promise(done=>{resolve=done}))
 await render();await click(button('导出全部 43 篇结果'));const signal=collectSearchResultReport.mock.calls[0][2].signal
 await render({open:false});expect(signal.aborted).toBe(true);await act(async()=>resolve({count:43}));expect(downloadSearchResultReport).not.toHaveBeenCalled()
})
it('changing queries aborts an in-flight export and never labels new results as old output',async()=>{
 let resolve;collectSearchResultReport.mockImplementation(()=>new Promise(done=>{resolve=done}))
 await render();await click(button('导出全部 43 篇结果'));const signal=collectSearchResultReport.mock.calls[0][2].signal
 await query('第二轮');expect(signal.aborted).toBe(true);await act(async()=>resolve({count:43}));expect(downloadSearchResultReport).not.toHaveBeenCalled()
})
it('handles scope failures without clearing the selection or emitting a file',async()=>{
 collectSearchResultReport.mockRejectedValue(new Error('资料库已变化，请刷新'))
 await render();await click(button('加入导出清单'));await click(button('导出所选 1 篇'));expect(container.textContent).toContain('资料库已变化')
 expect(downloadSearchResultReport).not.toHaveBeenCalled();expect(button('导出所选 1 篇').disabled).toBe(false)
})
it('a failed download is retryable and never reported as success',async()=>{
 downloadSearchResultReport.mockImplementation(()=>{throw new Error('下载被阻止')})
 await render();await click(button('导出全部 43 篇结果'));expect(container.textContent).toContain('下载被阻止')
 expect(container.textContent).not.toContain('已发起');expect(button('导出全部 43 篇结果').disabled).toBe(false)
})
it('a stale cancelled operation cannot stop a newer export',async()=>{
 const resolves=[];collectSearchResultReport.mockImplementation(()=>new Promise(done=>resolves.push(done)))
 await render();await click(button('导出全部 43 篇结果'));await click(button('取消导出'));await click(button('导出全部 43 篇结果'))
 await act(async()=>resolves[0]({count:43}));expect(button('取消导出')).toBeTruthy();expect(downloadSearchResultReport).not.toHaveBeenCalled()
 await act(async()=>resolves[1]({count:43}));expect(downloadSearchResultReport).toHaveBeenCalledOnce()
})
it('overlong drafts do not crash the workbench',async()=>{
 await render();await query('x'.repeat(129));expect(label('全局检索关键词')).toBeTruthy()
})
it('preserves selected results when an editor open is cancelled and does not write notes',async()=>{
 await render();await click(button('加入导出清单'));await click(button('打开笔记'))
 expect(button('导出所选 1 篇')).toBeTruthy();expect(onClose).not.toHaveBeenCalled()
})
it('opening a result aborts export before the save/discard/cancel flow',async()=>{
 let resolve;collectSearchResultReport.mockImplementation(()=>new Promise(done=>{resolve=done}))
 await render();await click(button('导出全部 43 篇结果'));await click(button('打开笔记'))
 await act(async()=>resolve({count:43}));expect(downloadSearchResultReport).not.toHaveBeenCalled()
})

it('over-cap all export is disabled while a small manual selection stays usable',async()=>{
 searchLibrary.mockResolvedValue(page(1,{total:2300,pages:115,scanned:2300}))
 await render();expect(button('导出全部 2300 篇结果').disabled).toBe(true)
 await click(button('加入导出清单'));expect(button('导出所选 1 篇').disabled).toBe(false)
})
it('the export panel is collapsed by default and does not change the keyboard preview controls',async()=>{
 await render();expect(container.querySelector('.search-result-export').open).toBe(false)
 expect(button('加入导出清单').getAttribute('aria-pressed')).toBe('false')
 await click(button('下一结果'));await click(button('加入导出清单'));await click(button('导出所选 1 篇'))
 expect(collectSearchResultReport.mock.calls[0][2].selection[0].id).toBe('n2')
})
