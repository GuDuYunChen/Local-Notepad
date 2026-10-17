import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Panel from './SyncConflictHistoryPanel'
import { api } from '~/services/api'
import { requestHistoryDownload } from '~/services/syncHistoryExport.mjs'
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs'
vi.mock('~/services/api', () => ({api:vi.fn()}))
vi.mock('~/services/syncHistoryExport.mjs', async original => ({...await original(),requestHistoryDownload:vi.fn()}))
let host,root,oldAct
const control = name => host.querySelector('[data-history-'+name+']')
const message = () => control('export-feedback').textContent
const fixture = () => historyPage([
 {...historyRow('a'), current_title:'星图 ABC'},
 {...historyRow('b','resolved','remote',1790586500),current_title:'另一册'},
])
async function render(){await act(async()=>root.render(<Panel/>));await act(async()=>{host.querySelector('details').open=true})}
async function click(name){await act(async()=>{control(name).click();await Promise.resolve()})}
async function input(value,composing=false){await act(async()=>{
 const n=control('query');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value)
 n.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:composing}))
})}
async function read(){await render();await click('read')}
const captured = () => JSON.parse(requestHistoryDownload.mock.calls.at(-1)[0].raw)
beforeEach(()=>{
 oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 api.mockReset();api.mockResolvedValue(fixture());requestHistoryDownload.mockReset()
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct})
it('does not export on mount, disclosure or ordinary filtering and refuses an unread history',async()=>{
 await render();await input('ABC');await click('export-button')
 expect(requestHistoryDownload).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled()
 expect(control('export-reason').textContent).toContain('请先读取')
})
it('exports exactly the current selection and acknowledges only a download request',async()=>{
 await read();await input('abc');control('export-button').focus();await click('export-button')
 expect(captured().records.map(r=>r.id)).toEqual(['a']);expect(captured().scope.loadedCount).toBe(2)
 expect(message()).toContain('已请求下载 1 条');expect(message()).toContain('尚未确认落盘')
 expect(api).toHaveBeenCalledTimes(1);expect(document.activeElement).toBe(control('export-button'))
})
it('retains all existing filtering and never fetches unread pages for export',async()=>{
 api.mockResolvedValue(historyPage(fixture().items,'all','more'));await read();await input('abc');await click('export-button')
 expect(captured().scope.hasUnreadOlderRecords).toBe(true);expect(control('more')).toBeTruthy();expect(api).toHaveBeenCalledTimes(1)
})
it('does not export empty matches and does not replace filters or rows',async()=>{
 await read();await input('missing');await click('export-button')
 expect(requestHistoryDownload).not.toHaveBeenCalled();expect(control('query').value).toBe('missing')
 expect(control('export-reason').textContent).toContain('没有匹配')
})
it('blocks export during an in-flight refresh; stopping permits only the retained snapshot',async()=>{
 let resolve;await read();api.mockImplementationOnce(()=>new Promise(r=>resolve=r));await click('read');await click('export-button')
 expect(requestHistoryDownload).not.toHaveBeenCalled();await click('stop');await click('export-button')
 expect(captured().scope.sourceState).toBe('stopped');await act(async()=>resolve(historyPage([])))
 expect(captured().records).toHaveLength(2)
})
it('records a failed refresh as old data without exposing server diagnostics',async()=>{
 await read();api.mockRejectedValueOnce(Error('PRIVATE_SERVER'));await click('read');await click('export-button')
 expect(captured().scope.sourceState).toBe('error');expect(captured().notices.join('')).toContain('最近读取失败')
 expect(JSON.stringify(captured())).not.toContain('PRIVATE_SERVER');expect(host.textContent).not.toContain('PRIVATE_SERVER')
})
it('blocks candidate text and exports the committed Chinese condition after composition finishes',async()=>{
 await read();await input('abc');await act(async()=>control('query').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
 await input('xingtu',true);await click('export-button');expect(requestHistoryDownload).not.toHaveBeenCalled()
 await act(async()=>{const n=control('query');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'星图');n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'星图'}))})
 await click('export-button');expect(captured().records.map(r=>r.id)).toEqual(['a'])
 expect(captured().filters.textFilterApplied).toBe(true);expect(captured().filters).not.toHaveProperty('query')
})
it('download failure retains data and permits a new explicit retry without server requests',async()=>{
 requestHistoryDownload.mockImplementationOnce(()=>{throw Error('PRIVATE_DISK_PATH')})
 await read();await click('export-button');expect(message()).toContain('未能发起下载');expect(message()).not.toContain('PRIVATE_DISK_PATH')
 expect(host.querySelectorAll('[data-history-row]')).toHaveLength(2)
 await click('export-button');expect(message()).toContain('已请求下载');expect(api).toHaveBeenCalledTimes(1)
})
it('a changed filter or snapshot does not leave a success message describing previous rows',async()=>{
 await read();await click('export-button');expect(message()).toContain('2 条')
 await input('abc');expect(message()).toBe('');await click('export-button');expect(message()).toContain('1 条')
 await click('read');expect(message()).toBe('')
})
it('exports the latest snapshot after appending an explicitly requested page',async()=>{
 api.mockResolvedValueOnce(historyPage(fixture().items,'all','more')).mockResolvedValueOnce(historyPage([{...historyRow('c','resolved','local',1790586400),current_title:'ABC 更早'}]))
 await read();await input('abc');await click('more');await click('export-button')
 expect(captured().records.map(r=>r.id)).toEqual(['a','c']);expect(captured().scope.loadedCount).toBe(3)
 expect(api).toHaveBeenCalledTimes(2)
})
it('unmount drops download feedback and leaves no new local storage entries',async()=>{
 const write=vi.spyOn(Storage.prototype,'setItem');await read();await click('export-button')
 await act(async()=>root.unmount());root=createRoot(host);await render()
 expect(message()).toBe('');expect(write).not.toHaveBeenCalled();expect(requestHistoryDownload).toHaveBeenCalledTimes(1)
})
