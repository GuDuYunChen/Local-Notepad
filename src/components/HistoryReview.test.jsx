import React,{act,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {webcrypto} from 'node:crypto'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import HistoryReview from './HistoryReview'
import {historyReviewFixture,historyIndexFixture} from '../test/historyReviewFixture.mjs'
import {api} from '~/services/api'
vi.mock('~/services/api',()=>({api:vi.fn()}))
let root,host,closed,opened,downloads,index,options,held,readError,mutate,freshSource
const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
const wait=async fn=>vi.waitFor(async()=>{await act(drain);fn()},{timeout:2500,interval:10})
const click=async text=>act(async()=>{const b=button(text);expect(b,text).toBeTruthy();expect(b.disabled,text).toBe(false);b.focus();b.click();await drain()})
const tap=async selector=>act(async()=>{const b=document.querySelector(selector);expect(b,selector).toBeTruthy();expect(b.disabled).toBe(false);b.focus();b.click();await drain()})
const change=async(selector,value)=>act(async()=>{const e=document.querySelector(selector);Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));await drain()})
const selectNote=async()=>{await tap('[data-history-file="a"]');await wait(()=>expect(document.querySelector('[data-history-version]')).not.toBeNull())}
const compare=async()=>{await selectNote();await tap('[data-history-version="3"]');await wait(()=>expect(document.querySelector('[data-history-state]')).not.toBeNull())}
function Harness(){const [show,setShow]=useState(true);return show&&<HistoryReview onClose={()=>{closed();setShow(false)}} onOpenFile={opened}/>}
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto);index=historyIndexFixture(43);options={};held=null;readError=false;mutate=null;freshSource=null;downloads=[];closed=vi.fn()
 opened=vi.fn(async(id,o)=>{await o.readFile(id,{signal:o.signal});return false})
 vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{downloads.push(b);return 'blob:history'});vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
 api.mockReset().mockImplementation(async(path,init)=>{if(init?.method)throw Error('write is prohibited');if(path==='/api/folder-workspace')return index;if(path.startsWith('/api/history-review?')){if(readError)throw Error('offline');if(held)return held.promise;const p=new URL(path,'http://local').searchParams;const v=historyReviewFixture(p.has('version')?Number(p.get('version')):null,{...options,file:p.get('file')});mutate?.(v);return v}if(path.startsWith('/api/files/'))return {...(freshSource||historyReviewFixture(null,options).current),is_folder:false,is_deleted:false};throw Error('unexpected '+path)})
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(<Harness/>);await drain()});await wait(()=>expect(document.querySelector('[data-history-file="a"]')).not.toBeNull())
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('whole index pagination and explicit history selection precede comparison',async()=>{expect(document.querySelectorAll('[data-history-file]')).toHaveLength(20);await click('下一页笔记');await click('下一页笔记');expect(document.querySelectorAll('[data-history-file]')).toHaveLength(3);await click('上一页笔记');await click('上一页笔记');await selectNote();expect(document.querySelector('[data-history-state]')).toBeNull();expect(button('导出历史对照报告').disabled).toBe(true);await tap('[data-history-version="3"]');await wait(()=>expect(document.querySelector('[data-history-state]').dataset.historyState).toBe('different'));expect(document.body.textContent).toContain('historical');expect(api.mock.calls.every(([,init])=>!init?.method)).toBe(true)})
it('complete metadata can be searched and paged without fetching unselected bodies',async()=>{options.count=43;await selectNote();expect(document.querySelectorAll('[data-history-version]')).toHaveLength(20);await click('下一页快照');await click('下一页快照');expect(document.querySelectorAll('[data-history-version]')).toHaveLength(3);await change('[aria-label="历史中心查找快照"]','历史标题 42');expect(document.querySelectorAll('[data-history-version]')).toHaveLength(1);expect(document.querySelector('[data-history-version="42"]')).not.toBeNull();expect(api.mock.calls.filter(([p])=>p.startsWith('/api/history-review')).every(([p])=>!p.includes('version='))).toBe(true)})
it('no retained history does not create a fake snapshot or allow export',async()=>{options.count=0;await tap('[data-history-file="a"]');await wait(()=>expect(document.body.textContent).toContain('暂无保留历史'));expect(button('导出历史对照报告').disabled).toBe(true);expect(button('打开当前笔记').disabled).toBe(false)})
it('distant first change and mode switches use the actual third page; repeated relocation works',async()=>{options={body:'same\n'.repeat(130)+'new\n',old:'same\n'.repeat(130)+'old\n'};await compare();expect(document.body.textContent).toContain('第 3/3 页');expect(document.querySelector('[data-history-change=true] pre').textContent).toBe('old');await click('上一页历史差异');await click('定位历史差异');await click('定位历史差异');expect(document.body.textContent).toContain('第 3/3 页');await change('[aria-label="历史对照模式"]','raw');expect(document.body.textContent).toContain('第 3/3 页');await change('[aria-label="历史对照模式"]','text');expect(document.body.textContent).toContain('第 3/3 页')})
it('raw markup is rendered as text, not executable HTML',async()=>{options={old:'<img src=x onerror=alert(1)>',body:'<script>bad()</script>'};await compare();expect(document.querySelector('.history-review img,.history-review script')).toBeNull();expect(document.body.textContent).toContain('<script>bad()</script>')})
it('unknown projection is explicit and raw is available',async()=>{options.old='{"root":{"type":"root","children":[{"type":"image","src":"x"}]}}';await compare();expect(document.querySelector('[data-history-state]').dataset.historyState).toBe('unavailable');await change('[aria-label="历史对照模式"]','raw');expect(document.querySelector('[data-history-state]').dataset.historyState).toBe('different')})
it('summary export requires confirmation and fresh complete snapshot',async()=>{await compare();await click('导出历史对照报告');expect(downloads).toHaveLength(0);expect(document.querySelector('input[type=checkbox]').checked).toBe(false);expect(button('刷新历史目录').disabled).toBe(true);await click('核对后下载');await wait(()=>expect(downloads).toHaveLength(1));const value=JSON.parse(await downloads[0].text());expect(value.selected).toBeUndefined();expect(value.contains_contents).toBe(false);expect(api.mock.calls.filter(([p])=>p.includes('version=3'))).toHaveLength(2)})
it('explicit full export includes two exact sources; cancel resets consent',async()=>{await compare();await click('导出历史对照报告');await tap('input[type=checkbox]');await click('取消导出');expect(downloads).toHaveLength(0);await click('导出历史对照报告');expect(document.querySelector('input[type=checkbox]').checked).toBe(false);await tap('input[type=checkbox]');await click('核对后下载');await wait(()=>expect(downloads).toHaveLength(1));const v=JSON.parse(await downloads[0].text());expect(v.current.content).toBe(historyReviewFixture(3).current.content);expect(v.selected.content).toBe(historyReviewFixture(3).selected.content)})
it('changed metadata despite unchanged revision refuses export',async()=>{await compare();await click('导出历史对照报告');mutate=v=>{v.versions[1].title='changed'};await click('核对后下载');await wait(()=>expect(document.querySelector('[role=alert]').textContent).toContain('资料库已变化'));expect(downloads).toHaveLength(0);expect(button('导出历史对照报告').disabled).toBe(true)})
it('explicit read failure can retry without an old result',async()=>{readError=true;await tap('[data-history-file="a"]');await wait(()=>expect(document.querySelector('[role=alert]')).not.toBeNull());expect(document.querySelector('[data-history-state]')).toBeNull();readError=false;await click('重试读取历史');await wait(()=>expect(document.querySelector('[data-history-version]')).not.toBeNull())})
it('cancels pending history and ignores a response after cancellation',async()=>{let resolve;held={promise:new Promise(r=>{resolve=r})};await tap('[data-history-file="a"]');await click('取消当前操作');await act(async()=>{resolve(historyReviewFixture());await drain()});expect(document.querySelector('[data-history-version]')).toBeNull();expect(document.body.textContent).toContain('本次操作已取消')})
it('cancelled export never downloads a late successful response',async()=>{await compare();await click('导出历史对照报告');let resolve;held={promise:new Promise(r=>{resolve=r})};await click('核对后下载');await click('取消导出');await act(async()=>{resolve(historyReviewFixture(3));await drain()});expect(downloads).toHaveLength(0);expect(document.querySelector('[role=alertdialog]')).toBeNull()})
it('refresh event invalidates the selected snapshot and cancels outstanding work',async()=>{await compare();await act(async()=>{window.dispatchEvent(new Event('library:refresh'));await drain()});expect(button('打开当前笔记').disabled).toBe(true);expect(button('导出历史对照报告').disabled).toBe(true);expect(document.querySelector('[role=alert]').textContent).toContain('已变化')})
it('source owner cancellation keeps the workbench and selection',async()=>{await compare();await click('打开当前笔记');await wait(()=>expect(document.body.textContent).toContain('打开已取消'));expect(closed).not.toHaveBeenCalled();expect(document.querySelector('[data-history-state]')).not.toBeNull();expect(opened.mock.calls[0][1]).toMatchObject({refreshCurrent:true})})
it('source owner acceptance is the only event that closes after opening',async()=>{opened.mockImplementation(async(id,o)=>{await o.readFile(id,{signal:o.signal});expect(o.shouldSelect()).toBe(true);return true});await compare();await click('打开当前笔记');await wait(()=>expect(closed).toHaveBeenCalledTimes(1))})
it('changed source is refused by the original-owner read hook',async()=>{await compare();freshSource=historyReviewFixture(null,{body:'changed'}).current;await click('打开当前笔记');await wait(()=>expect(document.querySelector('[role=alert]').textContent).toContain('已变化'));expect(closed).not.toHaveBeenCalled()})
it('Ctrl+S, composing Escape and focus trap cannot trigger background commands',async()=>{const modal=document.querySelector('.history-review-overlay');const save=new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true});await act(async()=>{modal.dispatchEvent(save);modal.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true}));await drain()});expect(save.defaultPrevented).toBe(true);expect(closed).not.toHaveBeenCalled();await compare();await click('导出历史对照报告');const first=document.querySelector('[role=alertdialog] input');first.focus();await act(async()=>{first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));await drain()});expect(document.activeElement).toBe(button('核对后下载'));await click('取消导出');expect(document.activeElement).toBe(button('导出历史对照报告'))})
it('one synchronous operation lock prevents duplicate native actions',async()=>{let resolve;held={promise:new Promise(r=>{resolve=r})};const b=document.querySelector('[data-history-file="a"]');await act(async()=>{b.click();b.click();await drain()});expect(api.mock.calls.filter(([p])=>p.startsWith('/api/history-review'))).toHaveLength(1);await click('关闭历史中心');await act(async()=>{resolve(historyReviewFixture());await drain()});expect(closed).toHaveBeenCalledTimes(1)})

// Regression for HISTORY-01 in BOTH new search inputs. These are React input-
// method event tests, not a claim of Windows IME execution.
const historySearchScopes=[
 {name:'note source',label:'历史中心查找笔记',rows:'[data-history-file]',prepare:async()=>{},final:'比较笔记 a.md',expected:'a'},
 {name:'retained snapshot',label:'历史中心查找快照',rows:'[data-history-version]',prepare:selectNote,final:'历史标题 2',expected:'2'},
]
const searchRows=scope=>[...document.querySelectorAll(scope.rows)].map(n=>n.getAttribute(scope.rows.slice(1,-1)))
const searchInput=scope=>document.querySelector(`[aria-label="${scope.label}"]`)
async function ime(scope,type,value){await act(async()=>{
 const input=searchInput(scope)
 if(value!==undefined)Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value)
 input.dispatchEvent(new CompositionEvent(type,{bubbles:true,data:value??''}));await drain()
})}
async function candidate(scope,value,composing=true){await act(async()=>{
 const input=searchInput(scope);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value)
 input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:composing,inputType:composing?'insertCompositionText':'insertText'}));await drain()
})}
for(const scope of historySearchScopes){
 it('IME '+scope.name+': candidate does not change committed results or fetch bodies',async()=>{
  await scope.prepare();const before=searchRows(scope),reads=api.mock.calls.length
  await ime(scope,'compositionstart');await candidate(scope,'xingtu')
  expect(searchInput(scope).value).toBe('xingtu');expect(searchRows(scope)).toEqual(before)
  expect(document.body.textContent).toContain('输入法文字尚未确认');expect(api).toHaveBeenCalledTimes(reads)
 })
 it('IME '+scope.name+': isComposing input without start still holds results',async()=>{
  await scope.prepare();const before=searchRows(scope)
  await candidate(scope,'xingtu');expect(searchRows(scope)).toEqual(before)
 })
 it('IME '+scope.name+': end commits Chinese text and filters the full index',async()=>{
  await scope.prepare();await ime(scope,'compositionstart');await candidate(scope,'zhongwen')
  await ime(scope,'compositionend',scope.final)
  expect(searchInput(scope).value).toBe(scope.final);expect(searchRows(scope)).toEqual([scope.expected])
 })
 it('IME '+scope.name+': no browser maxlength truncates an active candidate',async()=>{
  await scope.prepare();expect(searchInput(scope).hasAttribute('maxlength')).toBe(false)
 })
}
for(const scope of historySearchScopes){
 it('IME '+scope.name+': long candidate stays intact and commit is code-point bounded',async()=>{
  await scope.prepare();const prefix='文'.repeat(127)
  await candidate(scope,prefix,false);await ime(scope,'compositionstart');await candidate(scope,prefix+'zhong')
  expect(searchInput(scope).value).toBe(prefix+'zhong')
  await ime(scope,'compositionend',prefix+'中文');expect(searchInput(scope).value).toBe(prefix+'中')
 })
 it('IME '+scope.name+': emoji limit never splits a surrogate pair or crashes filtering',async()=>{
  await scope.prepare();const prefix='🌱'.repeat(127)
  await candidate(scope,prefix,false);expect(searchInput(scope).value).toBe(prefix)
  await ime(scope,'compositionstart');await candidate(scope,prefix+'zhong')
  expect(searchInput(scope).value).toBe(prefix+'zhong')
  await ime(scope,'compositionend',prefix+'🌿多余');expect(searchInput(scope).value).toBe(prefix+'🌿')
  expect(Array.from(searchInput(scope).value)).toHaveLength(128);expect(document.querySelector('.history-review')).not.toBeNull()
 })
 it('IME '+scope.name+': blur commits once and late compositionend does not revive a condition',async()=>{
  await scope.prepare();searchInput(scope).focus();await ime(scope,'compositionstart');await candidate(scope,scope.final)
  await act(async()=>{searchInput(scope).blur();await drain()});expect(searchRows(scope)).toEqual([scope.expected])
  await candidate(scope,'',false)
  await act(async()=>{searchInput(scope).dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:scope.final}));await drain()})
  expect(searchInput(scope).value).toBe('');expect(searchRows(scope).length).toBeGreaterThan(1)
 })
 it('IME '+scope.name+': ending before final input and cancelled composition are safe',async()=>{
  await scope.prepare();await ime(scope,'compositionstart');await candidate(scope,'unfinished')
  await ime(scope,'compositionend','');await candidate(scope,'',false);expect(searchRows(scope).length).toBeGreaterThan(1)
  await ime(scope,'compositionstart');await ime(scope,'compositionend',scope.final);await candidate(scope,scope.final,false)
  expect(searchRows(scope)).toEqual([scope.expected])
 })
 it('IME '+scope.name+': confirmed typing filters immediately and does not issue a query request',async()=>{
  await scope.prepare();const n=api.mock.calls.length;await candidate(scope,scope.final,false)
  expect(searchRows(scope)).toEqual([scope.expected]);expect(api).toHaveBeenCalledTimes(n)
 })
}
it('IME snapshot reset when changing note cannot be undone by an old end event',async()=>{
 const scope=historySearchScopes[1];await selectNote();await ime(scope,'compositionstart');await candidate(scope,'oldcandidate')
 await tap('[data-history-file="b"]');await wait(()=>expect(document.querySelector('[data-history-version]')).not.toBeNull())
 expect(searchInput(scope).value).toBe('')
 await act(async()=>{searchInput(scope).dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'oldcandidate'}));await drain()})
 expect(searchInput(scope).value).toBe('');expect(searchRows(scope)).toEqual(['3','2','1'])
})
it('IME search is read-only and does not invalidate selected comparison or export consent',async()=>{
 await compare();const before=document.querySelector('[data-history-state]').dataset.historyState,requests=api.mock.calls.length
 const scope=historySearchScopes[1];await ime(scope,'compositionstart');await candidate(scope,'snapshot')
 expect(document.querySelector('[data-history-state]').dataset.historyState).toBe(before)
 expect(api).toHaveBeenCalledTimes(requests);expect(downloads).toHaveLength(0)
 await ime(scope,'compositionend','missing');expect(document.body.textContent).toContain('当前对照的快照不在查找结果中')
 await click('导出历史对照报告');expect(document.querySelector('input[type=checkbox]').checked).toBe(false)
 await click('取消导出');expect(api).toHaveBeenCalledTimes(requests)
})
