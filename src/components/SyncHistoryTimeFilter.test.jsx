import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Panel from './SyncConflictHistoryPanel'
import { api } from '~/services/api'
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs'
vi.mock('~/services/api',()=>({api:vi.fn()}))
let root, host, oldAct, blobs, oldURL, oldRevoke
const at=s=>Date.parse(s+'Z')/1000
const pageRows=()=>[
 {...historyRow('after','resolved','remote',at('2026-10-02T00:00:00')),current_title:'星图后记'},
 {...historyRow('last','resolved','local',at('2026-10-01T23:59:59')),current_title:'星图末秒'},
 {...historyRow('first','superseded','remote',at('2026-10-01T00:00:00')),current_title:'星图首秒',kind:'attachment'},
 {...historyRow('before','resolved','local',at('2026-09-30T23:59:59')),current_title:'之前'},
 {...historyRow('missing','resolved','unknown',0),current_title:'时间缺失',kind:'tag'},
]
const el=k=>host.querySelector('[data-history-'+k+']')
const ids=()=>[...host.querySelectorAll('[data-history-row] code')].filter((_,i)=>i%2===1).map(n=>n.textContent)
const captured=async()=>JSON.parse(await blobs.at(-1).text())
async function render(){await act(async()=>root.render(<Panel/>));await act(async()=>{host.querySelector('details').open=true})}
async function click(k){await act(async()=>{el(k).focus();el(k).click();await Promise.resolve()})}
async function choose(k,value){await act(async()=>{el(k).value=value;el(k).dispatchEvent(new Event('change',{bubbles:true}))})}
async function input(k,value){await act(async()=>{const n=el(k);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}))})}
async function dates(from,to){await choose('time-mode','range');await input('time-from',from);await input('time-to',to)}
async function read(){await render();await click('read');await act(async()=>{el('time-controls').open=true})}
beforeEach(()=>{oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 api.mockReset();api.mockResolvedValue(historyPage(pageRows()));host=document.createElement('div');document.body.append(host);root=createRoot(host)
 blobs=[];oldURL=URL.createObjectURL;oldRevoke=URL.revokeObjectURL;URL.createObjectURL=vi.fn(b=>{blobs.push(b);return 'blob:test'});URL.revokeObjectURL=vi.fn()
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();URL.createObjectURL=oldURL;URL.revokeObjectURL=oldRevoke;globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct})
it('unread dates can be applied without fetching or fabricating a summary',async()=>{
 await render();await dates('2026-10-01','2026-10-01');await click('time-apply')
 expect(api).not.toHaveBeenCalled();expect(el('summary')).toBeNull();expect(el('time-applied').textContent).toContain('UTC')
 await click('read');expect(ids()).toEqual(['last','first']);expect(api).toHaveBeenCalledTimes(1)
})
it('date drafts do not change list, summary or exported data before applying',async()=>{
 await read();await dates('2026-10-01','2026-10-01')
 expect(ids()).toHaveLength(5);expect(el('time-pending').textContent).toContain('尚未应用');await click('export-button')
 expect((await captured()).version).toBe(1);expect((await captured()).records).toHaveLength(5)
 await click('time-apply');expect(ids()).toEqual(['last','first']);expect(el('summary-scope').textContent).toContain('2 条')
 expect(el('export-feedback').textContent).toBe('');expect(el('time-pending')).toBeNull()
})
it('applied dates create the exact same subset in list, summary and v2 export',async()=>{
 await read();await dates('2026-10-01','2026-10-01');await click('time-apply');await click('export-button')
 const j=await captured();expect(j.version).toBe(2);expect(j.records.map(r=>r.id)).toEqual(ids())
 expect(j.filters.completedDateUTC).toEqual({mode:'range',from:'2026-10-01',to:'2026-10-01'})
 expect(el('summary-scope').textContent).toContain('2 条');expect(api).toHaveBeenCalledTimes(1)
})
it('reversed dates keep the prior applied scope and counts instead of fake empty success',async()=>{
 await read();await dates('2026-10-01','2026-10-01');await click('time-apply')
 await input('time-from','2026-10-02');await click('time-apply')
 expect(el('time-error').textContent).toContain('起始日期不能晚于');expect(ids()).toEqual(['last','first'])
 expect(el('time-applied').textContent).toContain('2026-10-01 至 2026-10-01');expect(api).toHaveBeenCalledTimes(1)
})
it('empty date range is rejected but a one-sided range can be applied using Enter',async()=>{
 await read();await dates('','');await click('time-apply');expect(el('time-error').textContent).toContain('至少')
 expect(ids()).toHaveLength(5);await input('time-from','2026-10-02')
 await act(async()=>el('time-from').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter'})))
 expect(ids()).toEqual(['after']);expect(el('time-error')).toBeNull()
})
it('date controls never intercept Ctrl+S or treat it as Apply',async()=>{
 await read();await dates('2026-10-01','2026-10-01')
 const event=new KeyboardEvent('keydown',{bubbles:true,key:'s',ctrlKey:true,cancelable:true})
 await act(async()=>el('time-from').dispatchEvent(event))
 expect(event.defaultPrevented).toBe(false);expect(ids()).toHaveLength(5);expect(api).toHaveBeenCalledTimes(1)
})
it('only-time-missing mode excludes dated records and emits null rather than epoch',async()=>{
 await read();await choose('time-mode','missing');await click('time-apply')
 expect(ids()).toEqual(['missing']);expect(el('summary-no-time').textContent).toContain('没有已知')
 await click('export-button');const j=await captured();expect(j.filters.completedDateUTC.mode).toBe('missing');expect(j.records[0].completedAtUTC).toBeNull()
})
it('appending older pages applies the same date condition without an implicit request',async()=>{
 api.mockResolvedValueOnce(historyPage(pageRows().slice(0,2),'all','next')).mockResolvedValueOnce(historyPage(pageRows().slice(2)))
 await read();await dates('2026-10-01','2026-10-01');await click('time-apply');expect(ids()).toEqual(['last'])
 expect(api).toHaveBeenCalledTimes(1);await click('more');expect(ids()).toEqual(['last','first']);expect(el('summary-scope').textContent).toContain('2 条')
})
it('failed refresh retains dates, previous results and explicit stale export provenance',async()=>{
 await read();await dates('2026-10-01','2026-10-01');await click('time-apply');api.mockRejectedValueOnce(Error('PRIVATE'))
 await click('read');expect(ids()).toEqual(['last','first']);expect(el('summary-provenance').textContent).toContain('读取失败')
 await click('export-button');expect((await captured()).scope.sourceState).toBe('error');expect(host.textContent).not.toContain('PRIVATE')
})
it('stop and late response preserve applied dates and prior counts',async()=>{
 let finish;await read();await dates('2026-10-01','2026-10-01');await click('time-apply')
 api.mockImplementationOnce(()=>new Promise(r=>finish=r));await click('read');await click('stop');await act(async()=>finish(historyPage([])))
 expect(ids()).toEqual(['last','first']);expect(el('summary-provenance').textContent).toContain('已停止')
})
it('date A to B to A does not revive old download feedback or create a new download',async()=>{
 await read();await dates('2026-10-01','2026-10-01');await click('time-apply');await click('export-button');expect(blobs).toHaveLength(1)
 await choose('time-mode','missing');await click('time-apply');await dates('2026-10-01','2026-10-01');await click('time-apply')
 expect(el('export-feedback').textContent).toBe('');expect(blobs).toHaveLength(1)
})
it('no-op Apply retains the current feedback and does not reset disclosure or focus',async()=>{
 await read();await dates('2026-10-01','2026-10-01');await click('time-apply');await click('export-button')
 const feedback=el('export-feedback').textContent,details=el('time-controls');await click('time-apply')
 expect(el('export-feedback').textContent).toBe(feedback);expect(el('time-controls')).toBe(details);expect(details.open).toBe(true);expect(document.activeElement).toBe(el('time-apply'))
})
it('global clear resets applied dates, unapplied edits and all local filters without fetching',async()=>{
 await read();await dates('2026-10-01','2026-10-01');await click('time-apply');await input('query','星');await choose('outcome','local');await input('time-from','2026-10-02')
 await click('clear');expect(ids()).toHaveLength(5);expect(el('time-mode').value).toBe('all');expect(el('time-from')).toBeNull();expect(el('time-applied')).toBeNull()
 expect(el('time-error')).toBeNull();expect(el('query').value).toBe('');expect(document.activeElement).toBe(el('query'));expect(api).toHaveBeenCalledTimes(1)
})
it('global clear also discards a draft when no date condition was ever applied',async()=>{
 await read();await dates('2026-10-01','');await click('clear');expect(el('time-mode').value).toBe('all');expect(el('time-pending')).toBeNull();expect(ids()).toHaveLength(5)
})
it('composition retains the committed query intersected with applied dates',async()=>{
 await read();await dates('2026-10-01','2026-10-01');await click('time-apply');await input('query','星')
 await act(async()=>el('query').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
 await input('query','不存在');expect(ids()).toEqual(['last','first']);expect(el('export-button').getAttribute('aria-disabled')).toBe('true')
 await act(async()=>el('query').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})))
 expect(ids()).toEqual([]);expect(el('summary-scope').textContent).toContain('0 条');expect(api).toHaveBeenCalledTimes(1)
})
it('disclosure and invalid dates never write preferences, navigate or call a mutation API',async()=>{
 const store=vi.spyOn(Storage.prototype,'setItem');await read();await dates('2026-10-02','2026-10-01');await click('time-apply')
 expect(store).not.toHaveBeenCalled();expect(blobs).toHaveLength(0);expect(api.mock.calls.every(([,opts])=>opts.method==='GET')).toBe(true)
})
