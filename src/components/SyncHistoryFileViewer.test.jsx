import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Viewer from './SyncHistoryFileViewer'
import Overview from './SyncOverviewPanel'
import { readHistoryFile, parseHistoryFile } from '~/services/syncHistoryFile.mjs'
import { prepareHistoryExport } from '~/services/syncHistoryExport.mjs'
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs'
import { historyPage, historyRow } from '../../scripts/fixtures/sync-conflict-history.mjs'
import { api } from '~/services/api'
vi.mock('~/services/api',()=>({api:vi.fn()}))
vi.mock('~/services/syncHistoryFile.mjs',async original=>{const module=await original();return {...module,readHistoryFile:vi.fn(module.readHistoryFile)}})
let host, root, actMode, actualRead
const row=(id='r0',patch={})=>({id,itemID:'note-'+id,title:'离线文件 '+id,kind:'file',status:'resolved',resolution:'local',createdAt:1,resolvedAt:1790726400,...patch})
const raw=(rows=[row()],extra={})=>prepareHistoryExport({snapshot:{items:rows,filter:'all',hasMore:true},phase:'ready',...extra},new Date('2026-09-30T10:00:00Z')).raw
const control=name=>host.querySelector('[data-history-file-'+name+']')
const notice=()=>control('notice').textContent
const until=fn=>vi.waitFor(async()=>{await act(async()=>{await Promise.resolve()});fn()},{timeout:2000,interval:10})
async function mount(){await act(async()=>root.render(<Viewer/>));host.querySelector('details').open=true}
async function choose(file){await act(async()=>{Object.defineProperty(control('input'),'files',{configurable:true,value:file?[file]:[]});control('input').dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve()})}
async function openFile(text=raw(),name='history.json'){await choose(new File([text],name,{type:'application/json'}));await until(()=>expect(notice()).not.toContain('正在读取'))}
async function click(name){await act(async()=>{control(name).click();await Promise.resolve()})}
beforeEach(async()=>{
 actMode=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 actualRead=(await vi.importActual('~/services/syncHistoryFile.mjs')).readHistoryFile
 readHistoryFile.mockReset().mockImplementation(actualRead);api.mockReset()
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();globalThis.IS_REACT_ACT_ENVIRONMENT=actMode})
it('mount, disclosure and cancelled file selection do not read anything',async()=>{
 await mount();await choose(null);expect(readHistoryFile).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();expect(notice()).toContain('尚未选择')
})
it('reads an actual UTF8 File and presents v1 provenance without importing data',async()=>{
 const net=vi.spyOn(globalThis,'fetch'),writes=vi.spyOn(Storage.prototype,'setItem')
 await mount();await openFile();expect(notice()).toContain('文件格式检查通过');expect(control('scope').textContent).toContain('文件内有 1 条')
 expect(control('source').textContent).toContain('不代表当前');expect(control('dates').textContent).toContain('全部处理日期')
 expect(host.textContent).toContain('格式检查不证明来源真实');expect(api).not.toHaveBeenCalled();expect(net).not.toHaveBeenCalled();expect(writes).not.toHaveBeenCalled()
})
it('reads v2 dated and missing-time files and preserves their declared boundaries',async()=>{
 await mount();await openFile(raw(undefined,{timeFilter:{mode:'range',from:'2026-09-30',to:'2026-09-30'}}))
 expect(control('dates').textContent).toContain('包含结束当日')
 await openFile(raw([row('x',{resolvedAt:0})],{timeFilter:{mode:'missing',from:'',to:''},phase:'stopped'}))
 expect(control('dates').textContent).toContain('时间缺失');expect(control('source').textContent).toContain('已停止')
 expect(control('row').textContent).not.toContain('1970-01-01T00:00:00.000Z')
})
it('paginates every file row locally and guards both edges without requests',async()=>{
 await mount();await openFile(raw(Array.from({length:31},(_,i)=>row('r'+i))))
 expect(host.querySelectorAll('[data-history-file-row]')).toHaveLength(25);expect(control('page').textContent).toContain('1 / 2')
 host.querySelector('.sync-history-file-list').scrollTop=180;await click('prev');await click('next');expect(host.querySelector('.sync-history-file-list').scrollTop).toBe(0);expect(host.querySelectorAll('[data-history-file-row]')).toHaveLength(6)
 expect(control('page').textContent).toContain('26–31');expect(control('row').textContent).toContain('r25')
 await click('next');expect(control('page').textContent).toContain('2 / 2');await click('prev');expect(control('page').textContent).toContain('1 / 2');expect(api).not.toHaveBeenCalled()
})
it('file JSON text and filename are inert, and untrusted notice instructions are not displayed',async()=>{
 const d=JSON.parse(raw([row('x',{title:'<img src=x onerror=alert(1)>'})]));d.notices=['PRIVATE_INSTRUCTION'];
 await mount();await openFile(JSON.stringify(d),'C:\\PRIVATE_PATH\\<script>.json')
 expect(control('name').textContent).toBe('<script>.json');expect(host.querySelector('img,script,iframe,a')).toBeNull()
 expect(host.textContent).not.toContain('PRIVATE_');expect(control('row').textContent).toContain('<img')
})
it('invalid replacement preserves previous successful file and page with an explicit stale notice',async()=>{
 await mount();await openFile(raw(Array.from({length:31},(_,i)=>row('r'+i))));await click('next')
 await openFile('{"PRIVATE_ERROR":','invalid.json');expect(control('name').textContent).toBe('history.json')
 expect(control('stale').textContent).toContain('上一次成功');expect(control('page').textContent).toContain('2 / 2');expect(notice()).not.toContain('PRIVATE_ERROR')
})
it('choosing the same file again clears old read errors and resets pagination',async()=>{
 await mount();await openFile();await openFile('bad');await openFile();expect(control('stale')).toBeNull();expect(notice()).toContain('检查通过');expect(readHistoryFile).toHaveBeenCalledTimes(3)
})
it('cancelled chooser retains the current successful view and does not reset it',async()=>{
 await mount();await openFile();const before=notice();await choose(null);expect(notice()).toBe(before);expect(control('name').textContent).toBe('history.json');expect(readHistoryFile).toHaveBeenCalledTimes(1)
})
it('an older file that resolves late cannot replace a newly chosen file',async()=>{
 let late,signal
 readHistoryFile.mockImplementationOnce((_f,opts)=>{signal=opts.signal;return new Promise(r=>late=r)})
 await mount();await choose(new File([raw()],'old.json'));await openFile(raw([row('new')]),'new.json')
 expect(signal.aborted).toBe(true);await act(async()=>late(parseHistoryFile(raw())))
 expect(control('name').textContent).toBe('new.json');expect(control('row').textContent).toContain('new')
})
it('stop retains previous data and ignores late completion; keyboard focus returns to choose',async()=>{
 let late;await mount();await openFile()
 readHistoryFile.mockImplementationOnce(()=>new Promise(r=>late=r));await choose(new File([raw()],'slow.json'))
 control('stop').focus();await click('stop');await act(async()=>late(parseHistoryFile(raw([row('wrong')]))))
 expect(notice()).toContain('已停止');expect(control('stale')).toBeTruthy();expect(control('name').textContent).toBe('history.json');expect(document.activeElement).toBe(control('choose'))
})
it('clear cancels an outstanding read and removes view, not the original file or local storage',async()=>{
 let late;const remove=vi.spyOn(Storage.prototype,'removeItem'),clear=vi.spyOn(Storage.prototype,'clear')
 await mount();await openFile();readHistoryFile.mockImplementationOnce(()=>new Promise(r=>late=r));await choose(new File([raw()],'slow.json'))
 control('clear').focus();await click('clear');await act(async()=>late(parseHistoryFile(raw())))
 expect(control('result')).toBeNull();expect(notice()).toContain('没有删除原文件');expect(document.activeElement).toBe(control('choose'));expect(remove).not.toHaveBeenCalled();expect(clear).not.toHaveBeenCalled()
})
it('unmount aborts pending read and cannot update a fresh viewer',async()=>{
 let late,signal;readHistoryFile.mockImplementationOnce((_f,opts)=>{signal=opts.signal;return new Promise(r=>late=r)})
 await mount();await choose(new File([raw()],'slow.json'));await act(async()=>root.unmount());root=createRoot(host);await mount()
 expect(signal.aborted).toBe(true);await act(async()=>late(parseHistoryFile(raw())))
 expect(control('result')).toBeNull();expect(notice()).toContain('尚未选择')
})
it('timeout reports failure, permits explicit retry and does not persist private paths',async()=>{
 await mount();readHistoryFile.mockRejectedValueOnce(Object.assign(Error('文件读取超时，请重试'),{code:'timeout'}))
 await openFile();expect(notice()).toContain('超时');await openFile();expect(notice()).toContain('检查通过')
})
it('a fresh successful file replaces the previous metadata and resets to the first page',async()=>{
 await mount();await openFile(raw(Array.from({length:31},(_,i)=>row('r'+i))));await click('next')
 await openFile(raw([row('only')],{phase:'error'}),'replacement.json')
 expect(control('name').textContent).toBe('replacement.json');expect(control('page').textContent).toContain('1 / 1');expect(control('source').textContent).toContain('最近一次读取失败')
})
it('opening an offline file in the real overview leaves the live history selection untouched',async()=>{
 api.mockResolvedValue(historyPage([{...historyRow('live'),current_title:'本机历史'}]))
 await act(async()=>root.render(<Overview {...overviewFixture()}/>))
 host.querySelector('[data-sync-conflict-history]').open=true;host.querySelector('[data-history-file-viewer]').open=true
 await act(async()=>host.querySelector('[data-history-read]').click())
 const live=host.querySelector('[data-history-row]').textContent,guidance=host.querySelector('[data-sync-guidance]').textContent
 await openFile();await click('clear')
 expect(host.querySelector('[data-history-row]').textContent).toBe(live);expect(host.querySelector('[data-sync-guidance]').textContent).toBe(guidance);expect(api).toHaveBeenCalledTimes(1)
})
