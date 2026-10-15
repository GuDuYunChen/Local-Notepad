import {readFileSync} from 'node:fs'
import {URL as NodeURL} from 'node:url'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import TagSelector from './TagSelector'
import {api} from '../services/api'
import {NOTE_TAG_PREFIX} from '../services/noteTags.mjs'
vi.mock('../services/api',()=>({api:vi.fn()}))
let root,host,current,callback
const tag={id:'tag-a',name:'写作',color:'#112233'}
const snap=(patch={})=>({file_id:'note-a',complete:true,available:[tag],tags:[],...patch})
const flush=async()=>act(async()=>{for(let n=0;n<10;n++)await Promise.resolve()})
const buttons=label=>[...host.querySelectorAll('button')].filter(n=>n.textContent===label)
async function click(label){expect(buttons(label).length).toBe(1);await act(async()=>buttons(label)[0].click());await flush()}
async function mount(id='note-a',cb=callback){await act(async()=>root.render(<TagSelector fileId={id} onChange={cb}/>));await flush()}
async function open(){await mount();await click('管理标签')}
async function field(label,value){await act(async()=>{const n=host.querySelector(`input[aria-label="${label}"]`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}))});await flush()}
async function choose(){await act(async()=>host.querySelector('.note-tag-option').click());await flush()}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();localStorage.clear();api.mockReset();current=snap();callback=vi.fn();api.mockImplementation(async(path,init)=>{if(init?.method==='POST'){const {name}=JSON.parse(init.body);const existing=current.available.find(t=>t.name===name);const t=existing||{id:'tag-b',name,color:'#7e5bef'};current={...current,available:existing?current.available:[...current.available,t],tags:[t]}}else if(init?.method==='PUT'){current={...current,tags:JSON.parse(init.body).attached?[tag]:[]}}return current});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('entry reads complete current-note tags and renders a true empty state',async()=>{await open();expect(host.textContent).toContain('暂无标签');expect(host.textContent).toContain('写作');expect(callback).toHaveBeenCalledWith([])})
test('read failure cannot masquerade as empty tags and retry uses GET',async()=>{api.mockRejectedValue(Error('private'));await open();expect(host.textContent).not.toContain('暂无标签');expect(host.textContent).toContain('本机服务请求失败');expect(host.textContent).not.toContain('private');api.mockResolvedValue(current);await click('重新读取标签');expect(host.textContent).toContain('暂无标签');expect(api.mock.calls.every(([,o])=>!o.method)).toBe(true)})
test('creating a tag atomically assigns it and clears the confirmed journal',async()=>{await open();await field('新标签名称','资料');await click('新建并分配');expect(host.textContent).toContain('已创建或复用');expect(current.tags[0].name).toBe('资料');expect(localStorage.length).toBe(0);expect(host.querySelector('input[aria-label="新标签名称"]').value).toBe('')})
test('removal needs confirmation and cancel sends no mutation',async()=>{current=snap({tags:[tag]});await open();await choose();expect(host.querySelector('[role=dialog]')).toBeTruthy();await click('取消');expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(0);await choose();await click('确认');expect(current.tags).toEqual([]);expect(host.textContent).toContain('其他笔记与标签本身保持不变')})
test('double activation sends a single mutation',async()=>{await open();api.mockReturnValue(new Promise(()=>{}));const n=host.querySelector('.note-tag-option');await act(async()=>{n.click();n.click()});await flush();expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(1)})
test('failed write keeps journal, blocks replay and only current-state GET reconciles',async()=>{await open();api.mockRejectedValue(Error('lost response'));await choose();expect(host.textContent).toContain('标签操作未确认');expect(localStorage.getItem(NOTE_TAG_PREFIX+'note-a')).toBeTruthy();current=snap({tags:[tag]});api.mockResolvedValue(current);await click('核对当前标签');expect(host.textContent).toContain('不是原请求的历史回执');expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(1);await click('结束这条操作记录');await click('确认');expect(localStorage.length).toBe(0);expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(1)})
test('stopping a pending write never clears its record or silently repeats it',async()=>{await open();let release;api.mockReturnValue(new Promise(r=>release=r));await choose();await click('停止等待');await act(async()=>release(snap({tags:[tag]})));expect(host.textContent).toContain('标签操作未确认');expect(localStorage.length).toBe(1);expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(1)})
test('switching note rejects delayed mutation callback for the previous note',async()=>{await open();let release;api.mockReturnValue(new Promise(r=>release=r));await choose();const newCallback=vi.fn();current=snap({file_id:'note-b',tags:[],available:[]});api.mockResolvedValue(current);await mount('note-b',newCallback);await act(async()=>release(snap({tags:[tag]})));expect(newCallback.mock.calls).toEqual([[[]]]);expect(host.textContent).not.toContain('写作');expect(localStorage.getItem(NOTE_TAG_PREFIX+'note-a')).toBeTruthy()})
test('same note adopts the latest parent callback rather than a stale closure',async()=>{await open();const next=vi.fn();await mount('note-a',next);await choose();expect(next).toHaveBeenCalledWith([tag]);expect(callback.mock.calls).toEqual([[[]]])})
test('unmount before a read settles never delivers its callback',async()=>{let release;api.mockReturnValue(new Promise(r=>release=r));await mount();await act(async()=>root.render(null));await act(async()=>release(current));expect(callback).not.toHaveBeenCalled()})
test('persistent unconfirmed record survives close and remount',async()=>{await open();api.mockRejectedValue(Error());await choose();await act(async()=>root.render(null));api.mockResolvedValue(current);await mount();expect(host.textContent).toContain('待核对');await click('管理标签');expect(host.textContent).toContain('标签操作待核对');expect(host.querySelector('.note-tag-option').disabled).toBe(true)})
test('corrupt journal requires explicit confirmation before deletion',async()=>{localStorage.setItem(NOTE_TAG_PREFIX+'note-a','broken');await open();expect(host.textContent).toContain('操作记录损坏');expect(host.querySelector('.note-tag-option').disabled).toBe(true);await click('清除损坏记录');await click('取消');expect(localStorage.length).toBe(1);await click('清除损坏记录');await click('确认');expect(localStorage.length).toBe(0)})
test('quota failure prevents sending any mutation',async()=>{
 await open();const storage=globalThis.localStorage
 const write=vi.fn(()=>{throw new DOMException('Quota exceeded','QuotaExceededError')})
 vi.stubGlobal('localStorage',{getItem:storage.getItem.bind(storage),setItem:write,removeItem:storage.removeItem.bind(storage)})
 try{await choose();expect(write).toHaveBeenCalledTimes(1);expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(0);expect(host.textContent).toContain('Quota exceeded')}
 finally{vi.unstubAllGlobals()}
})
test('Chinese composition does not filter or submit an unfinished name',async()=>{await open();const input=host.querySelector('input[aria-label="查找标签"]');await act(async()=>input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await field('查找标签','无匹配');expect(host.querySelectorAll('.note-tag-option')).toHaveLength(1);await act(async()=>input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));expect(host.querySelectorAll('.note-tag-option')).toHaveLength(0)})
test('unsubmitted label text needs an explicit close decision',async()=>{await open();await field('新标签名称','未提交');await click('管理标签');expect(host.querySelector('[role=dialog]')).toBeTruthy();await click('取消');expect(host.querySelector('input[aria-label="新标签名称"]').value).toBe('未提交');await click('管理标签');await click('确认');expect(host.querySelector('.note-tag-panel')).toBeNull();expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(0)})
test('timeout leaves error and does not report an empty successful load',async()=>{api.mockReturnValue(new Promise(()=>{}));await open();await act(async()=>vi.advanceTimersByTimeAsync(10001));expect(host.textContent).toContain('超时');expect(host.textContent).not.toContain('暂无标签')})
test('malformed or foreign-note snapshot cannot update the parent',async()=>{api.mockResolvedValue(snap({file_id:'other'}));await open();expect(callback).not.toHaveBeenCalled();expect(host.textContent).toContain('所属笔记不符')})

test('full note-tag editor replaces the old inline trigger layout',()=>{const css=readFileSync(new NodeURL('./TagSelector.css',import.meta.url),'utf8');expect(css).toContain('.inspector-panel .tag-selector.note-tags { display:block; width:100%; margin-right:0; }')})

test('initial loading must finish before native entry coordinates are measured',async()=>{
 let release;api.mockReturnValue(new Promise(resolve=>{release=resolve}))
 await mount()
 expect(host.querySelector('.note-tags-summary [role=status]').textContent).toContain('正在读取')
 expect(host.querySelector('.note-tags-summary .note-tag-muted')).toBeNull()
 expect(buttons('管理标签')[0].getAttribute('aria-expanded')).toBe('false')
 await act(async()=>release(current));await flush()
 expect(host.querySelector('.note-tags-summary [role=status]')).toBeNull()
 expect(host.querySelector('.note-tags-summary .note-tag-muted').textContent).toBe('暂无标签')
 await click('管理标签')
 expect(host.querySelector('.note-tag-panel')).toBeTruthy()
 expect(buttons('管理标签')[0].getAttribute('aria-expanded')).toBe('true')
 expect(api.mock.calls.filter(([,init])=>init.method)).toHaveLength(0)
})
