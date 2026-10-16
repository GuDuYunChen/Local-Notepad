import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import PinnedNotesPanel from './PinnedNotesPanel'
import {api} from '~/services/api'
import {pinJournal,PIN_JOURNAL_KEY} from '../services/localPins.mjs'
vi.mock('~/services/api',()=>({api:vi.fn()}))
const note=(id='a',extra={})=>({id,title:id==='a'?'常用甲.md':'笔记'+id,is_folder:false,is_pinned:false,updated_at:1,...extra})
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)}}
let root,host,items,close,select,adopt
const flush=async()=>act(async()=>{for(let i=0;i<14;i++)await Promise.resolve()})
const button=label=>[...host.querySelectorAll('button')].find(n=>n.textContent===label)
async function click(label){expect(button(label),'missing '+label).toBeTruthy();await act(async()=>button(label).click());await flush()}
async function mount(opener=select){await act(async()=>root.render(<PinnedNotesPanel onSelectFile={opener} onClose={close}/>));await flush()}
async function all(){await click('从全部笔记中选择')}
async function choose(id='a'){const n=host.querySelector(`[data-pinned-note-id="${id}"]`);expect(n).toBeTruthy();await act(async()=>n.click());await flush()}
async function input(text){const n=host.querySelector('input');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,text);n.dispatchEvent(new Event('input',{bubbles:true}))});await flush()}
const writes=()=>api.mock.calls.filter(([,i])=>i?.method==='PUT')
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();localStorage.clear();items=[note(),note('b')];api.mockReset();api.mockImplementation(async(p,i={})=>{if(p==='/api/local-pins')return{scope:'active-note-pins-v1',complete:true,items:items.map(n=>({...n}))};const id=decodeURIComponent(p.split('/').pop()),row=items.find(n=>n.id===id);if(i.method==='PUT'){const body=JSON.parse(i.body);if(body.expected_pinned!==row.is_pinned||body.title!==row.title)throw Error('stale');row.is_pinned=body.pinned}return p.startsWith('/api/files/')?{...row,content:'latest body',is_deleted:false}:{...row}});close=vi.fn();adopt=vi.fn();select=vi.fn(async(id,options)=>{const file=await options.readFile(id,{signal:options.signal});if(!options.shouldSelect())return false;adopt(file);return false});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();localStorage.clear();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('empty pinned state offers ordinary notes without creating or opening anything',async()=>{await mount();expect(host.textContent).toContain('还没有置顶笔记');await all();expect(host.querySelectorAll('[data-pinned-note-id]')).toHaveLength(2);await choose();expect(select).not.toHaveBeenCalled();expect(writes()).toHaveLength(0)})
test('pin confirmation refreshes view without writing body or leaving a record',async()=>{await mount();await all();await choose();await click('置顶这篇笔记');expect(items[0].is_pinned).toBe(true);expect(host.textContent).toContain('列表已更新');expect(writes()).toHaveLength(1);expect(JSON.parse(writes()[0][1].body).content).toBeUndefined();expect(localStorage.getItem(PIN_JOURNAL_KEY)).toBeNull()})
test('unpin cancellation sends nothing; confirmation keeps note available',async()=>{items[0].is_pinned=true;await mount();await choose();await click('取消这篇笔记置顶…');await click('取消');expect(writes()).toHaveLength(0);await click('取消这篇笔记置顶…');await click('确认');expect(items).toHaveLength(2);expect(items[0].is_pinned).toBe(false);expect(host.textContent).toContain('笔记和正文仍然保留')})
test('read errors are not empty success and explicit retry recovers',async()=>{api.mockRejectedValue(Error('PRIVATE_SQL'));await mount();expect(host.textContent).toContain('请求失败');expect(host.textContent).not.toContain('PRIVATE_SQL');expect(host.textContent).not.toContain('还没有置顶笔记');api.mockResolvedValue({scope:'active-note-pins-v1',complete:true,items:[]});await click('重新读取置顶笔记');expect(host.textContent).toContain('还没有可用笔记')})
test('invalid snapshot is visibly rejected without actionable rows',async()=>{api.mockResolvedValue({scope:'active-note-pins-v1',complete:true,items:[note(),note()]});await mount();expect(host.textContent).toContain('重复身份');expect(host.querySelectorAll('[data-pinned-note-id]')).toHaveLength(0)})
test('search is literal and IME waits for completed composition',async()=>{await mount();await all();const n=host.querySelector('input');await act(async()=>n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await input('[*]');expect(host.querySelectorAll('[data-pinned-note-id]')).toHaveLength(2);await act(async()=>n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));expect(host.textContent).toContain('没有匹配');await click('清除查找');expect(host.querySelectorAll('[data-pinned-note-id]')).toHaveLength(2)})
test('oversized query clears old actionable selection',async()=>{await mount();await all();await choose();await input('字'.repeat(101));expect(host.textContent).toContain('最多100');expect(button('打开选中笔记')).toBeUndefined()})
test('pagination can reach all results and changing search resets the page',async()=>{items=Array.from({length:21},(_,i)=>note(String(i),{is_pinned:true}));await mount();expect(host.querySelectorAll('[data-pinned-note-id]')).toHaveLength(20);await click('下一页');expect(host.querySelectorAll('[data-pinned-note-id]')).toHaveLength(1);await input('笔记0');expect(host.querySelectorAll('[data-pinned-note-id]')).toHaveLength(1)})
test('double pin sends one PUT and stopping preserves recovery instead of replay',async()=>{await mount();await all();await choose();const d=deferred();api.mockReturnValue(d.promise);const b=button('置顶这篇笔记');await act(async()=>{b.click();b.click()});await flush();expect(writes()).toHaveLength(1);await click('停止等待');await act(async()=>d.resolve(note('a',{is_pinned:true})));expect(host.textContent).toContain('置顶结果未确认');expect(localStorage.getItem(PIN_JOURNAL_KEY)).toBeTruthy()})
test('committed response loss is reconciled by GET without repeated PUT',async()=>{await mount();await all();await choose();const original=api.getMockImplementation();api.mockImplementation(async(p,i)=>{const response=await original(p,i);if(i?.method)throw Error('lost');return response});await click('置顶这篇笔记');expect(items[0].is_pinned).toBe(true);expect(host.textContent).toContain('待核对');expect(writes()).toHaveLength(1);await click('核对当前置顶状态');expect(host.textContent).toContain('不是原请求的历史回执');await click('结束这条操作记录');await click('取消');expect(localStorage.getItem(PIN_JOURNAL_KEY)).toBeTruthy();await click('结束这条操作记录');await click('确认');expect(localStorage.getItem(PIN_JOURNAL_KEY)).toBeNull();expect(writes()).toHaveLength(1)})
test('failed reconciliation of a missing target still permits explicit ending, not retry-write',async()=>{pinJournal().save({version:1,started_at:1,item:note(),pinned:true});await mount();const original=api.getMockImplementation();api.mockImplementation((p,i)=>p==='/api/local-pins'?original(p,i):Promise.reject(Error('missing')));await click('核对当前置顶状态');expect(button('结束这条操作记录').disabled).toBe(false);await click('结束这条操作记录');await click('确认');expect(writes()).toHaveLength(0);expect(localStorage.getItem(PIN_JOURNAL_KEY)).toBeNull()})
test('corrupt journal is preserved and needs exact clear confirmation',async()=>{localStorage.setItem(PIN_JOURNAL_KEY,'broken');await mount();expect(host.textContent).toContain('记录损坏');await click('清除损坏记录');localStorage.setItem(PIN_JOURNAL_KEY,'new record');await click('确认');expect(localStorage.getItem(PIN_JOURNAL_KEY)).toBe('new record');expect(host.textContent).toContain('记录已变化')})
test('unmount while a write is pending preserves its durable record and never opens',async()=>{await mount();await all();await choose();const d=deferred();api.mockReturnValue(d.promise);await click('置顶这篇笔记');await act(async()=>root.render(null));await act(async()=>d.resolve(note('a',{is_pinned:true})));expect(localStorage.getItem(PIN_JOURNAL_KEY)).toBeTruthy();expect(adopt).not.toHaveBeenCalled()})
test('cancelled original opener retains search, selection and no pin writes',async()=>{items[0].is_pinned=true;await mount();await input('常用甲');await choose();await click('打开选中笔记');expect(adopt.mock.calls[0][0].content).toBe('latest body');expect(host.textContent).toContain('草稿已保留');expect(host.querySelector('input').value).toBe('常用甲');expect(writes()).toHaveLength(0)})
test('changed title or pin is not passed through guarded selection',async()=>{items[0].is_pinned=true;await mount();await choose();items[0].title='新标题';await click('打开选中笔记');expect(adopt).not.toHaveBeenCalled();expect(host.textContent).toContain('状态已变化')})
test('close cancels delayed open and suppresses late navigation',async()=>{items[0].is_pinned=true;await mount();await choose();const d=deferred();api.mockReturnValue(d.promise);await click('打开选中笔记');await click('返回笔记');await act(async()=>root.render(null));await act(async()=>d.resolve({...note('a',{is_pinned:true}),content:'late',is_deleted:false}));expect(adopt).not.toHaveBeenCalled();expect(close).toHaveBeenCalledTimes(1)})
test('initial read timeout provides retry and does not report success',async()=>{api.mockReturnValue(new Promise(()=>{}));await mount();await act(async()=>vi.advanceTimersByTimeAsync(10001));expect(host.textContent).toContain('超时');expect(button('重新读取置顶笔记')).toBeTruthy()})
test('refresh cannot resurrect old asynchronous catalog',async()=>{const d=deferred();api.mockReturnValue(d.promise);await mount();await click('停止等待');api.mockResolvedValue({scope:'active-note-pins-v1',complete:true,items:[note('new',{is_pinned:true})]});await click('重新读取置顶笔记');await act(async()=>d.resolve({scope:'active-note-pins-v1',complete:true,items:[]}));expect(host.querySelector('[data-pinned-note-id="new"]')).toBeTruthy()})

// Shared node contracts execute the storage boundary; these mounted-React
// assertions remain part of the required full-project CI acceptance.
test('disabled browser storage does not crash the workspace and can be retried',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Storage disabled')}})
  await mount();expect(host.querySelector('.pinned-workspace')).toBeTruthy()
  expect(host.textContent).toContain('本机置顶记录无法读取');expect(writes()).toHaveLength(0)
 }finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage}
 await click('刷新列表');expect(host.textContent).not.toContain('记录损坏')
 await all();await choose();await click('置顶这篇笔记');expect(writes()).toHaveLength(1)
})
test('replacing a reviewed operation requires reading back that new operation',async()=>{
 pinJournal().save({version:1,started_at:1,item:note(),pinned:true})
 await mount();await click('核对当前置顶状态')
 expect(button('结束这条操作记录').disabled).toBe(false)
 localStorage.setItem(PIN_JOURNAL_KEY,JSON.stringify({version:1,started_at:2,item:note('b'),pinned:true}))
 await click('刷新列表')
 expect(button('结束这条操作记录').disabled).toBe(true)
 expect(host.textContent).not.toContain('不是原请求的历史回执')
 expect(writes()).toHaveLength(0)
})
test('escaped long-title response loss remains a readable pending operation',async()=>{
 items=[note('a',{title:'\u0001'.repeat(16384)})];await mount();await all();await choose()
 const original=api.getMockImplementation()
 api.mockImplementation(async(p,i)=>{const result=await original(p,i);if(i?.method==='PUT')throw Error('lost response');return result})
 await click('置顶这篇笔记')
 expect(host.textContent).toContain('置顶操作待核对')
 expect(host.textContent).not.toContain('记录损坏')
 expect(pinJournal().read().item.title).toBe(items[0].title)
 expect(writes()).toHaveLength(1)
})
