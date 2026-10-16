import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import App from './App'
import {api} from './services/api'
import {recentStore} from './services/recentNotes.mjs'
const m=vi.hoisted(()=>({select:null,current:null,clear:vi.fn(),save:vi.fn()}))
vi.mock('./services/api',()=>({api:vi.fn(),searchFiles:vi.fn().mockResolvedValue([]),createFileVersionSnapshot:vi.fn(),listAllFilesWithContent:vi.fn()}))
vi.mock('./components/FileList',()=>({default:({onSelect,updatedItem})=>{m.select=onSelect;m.current=updatedItem;return null}}))
vi.mock('./components/WorkspaceSidebar',()=>({default:({children,onChangeWorkspace})=><aside><button onClick={()=>onChangeWorkspace('recent')}>打开最近访问</button>{children}</aside>}))
vi.mock('./components/TextEditor',()=>({default:React.forwardRef(function Editor({activeId,onLoaded,onChange,onStatusChange},ref){
 React.useEffect(()=>{if(activeId){onLoaded?.(m.current.content);onStatusChange?.({dirty:false})}},[activeId])
 React.useImperativeHandle(ref,()=>({clearCache:m.clear,save:m.save,getReferenceRefactorState:()=>({savedContent:m.current?.content||''})}))
 return activeId?<button onClick={()=>{onChange('未保存的当前草稿');onStatusChange?.({dirty:true})}}>写入当前草稿</button>:null
})}))
let root,host
const old={id:'a',title:'旧标题.md',content:'old saved body',is_folder:false,is_deleted:false},fresh={...old,title:'更名后的标题.md',content:'latest saved body'}
const settle=async()=>{await act(async()=>vi.dynamicImportSettled());await act(async()=>vi.advanceTimersByTimeAsync(250))}
const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)
const click=async text=>{expect(button(text),'missing '+text).toBeTruthy();await act(async()=>button(text).click());await settle()}
const title=()=>host.querySelector('.workspace-title-button').textContent
beforeEach(async()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();localStorage.clear();api.mockReset();api.mockResolvedValue(fresh);m.clear.mockReset().mockReturnValue(true);m.save.mockReset().mockReturnValue(null);host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<App/>));await settle();await act(async()=>m.select(old));await settle()})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('real App recent-panel reopening adopts current-note fresh metadata and records its new title',async()=>{
 await click('打开最近访问');const row=host.querySelector('[data-recent-note-id="a"]');expect(row).toBeTruthy();await act(async()=>row.click());await click('重新打开笔记')
 expect(title()).toBe(fresh.title);expect(m.current.content).toBe(fresh.content);expect(recentStore().read().data.entries[0].title).toBe(fresh.title)
 expect(m.clear).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();expect(api.mock.calls.some(([,o])=>o?.method==='PUT')).toBe(false)
})
test('explicit clean same-ID return from another workspace uses the fresh selected file',async()=>{
 await click('打开最近访问');await act(async()=>m.select(fresh,{refreshCurrent:true}));await settle();expect(title()).toBe(fresh.title);expect(m.current.content).toBe(fresh.content)
})
test('ordinary same-ID shortcut still retains its current file without explicit refresh',async()=>{
 await click('打开最近访问');await act(async()=>m.select(fresh));await settle();expect(title()).toBe(old.title);expect(m.current.content).toBe(old.content)
})
test('same-ID refresh cannot replace or implicitly save a dirty current editor',async()=>{
 await click('写入当前草稿');await act(async()=>m.select(fresh,{refreshCurrent:true}));await settle();expect(title()).toBe(old.title);expect(host.querySelector('.workspace-save-chip').textContent).toBe('未保存');expect(m.current.content).toBe(old.content);expect(m.clear).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled()
})
test('refresh flag cannot bypass the original different-note draft cancellation',async()=>{
 await click('写入当前草稿');await act(async()=>m.select({...fresh,id:'b'},{refreshCurrent:true}));await settle();await click('取消');expect(title()).toBe(old.title);expect(host.querySelector('.workspace-save-chip').textContent).toBe('未保存');expect(m.clear).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled()
})
test('stale source ownership prevents same-ID refresh before any selection',async()=>{
 await click('打开最近访问');const cancelled=vi.fn();await act(async()=>m.select(fresh,{refreshCurrent:true,shouldSelect:()=>false,onCancel:cancelled}));await settle();expect(host.querySelector('.recent-workspace')).toBeTruthy();expect(m.current.title).toBe(old.title);expect(cancelled).toHaveBeenCalledOnce()
})
