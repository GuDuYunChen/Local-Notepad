import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import App from './App'
import {api} from './services/api'
const m=vi.hoisted(()=>({select:null,clear:vi.fn()}))
vi.mock('./services/api',()=>({api:vi.fn(),searchFiles:vi.fn().mockResolvedValue([]),createFileVersionSnapshot:vi.fn(),listAllFilesWithContent:vi.fn()}))
vi.mock('./components/FileList',()=>({default:({onSelect})=>{m.select=onSelect;return null}}))
vi.mock('./components/WorkspaceSidebar',()=>({default:({children})=><aside>{children}</aside>}))
vi.mock('./components/TextEditor',()=>({default:React.forwardRef(function Draft({activeId,onLoaded,onChange,onStatusChange},ref){
 React.useEffect(()=>{if(activeId){onLoaded?.('原正文');onStatusChange?.({dirty:false})}},[activeId])
 React.useImperativeHandle(ref,()=>({clearCache:m.clear,save:()=>null,getReferenceRefactorState:()=>({savedContent:'原正文'})}))
 return activeId?<button onClick={()=>{onChange('用户未保存草稿');onStatusChange?.({dirty:true})}}>写入测试草稿</button>:null
})}))
let host,root
const settle=async()=>{await act(async()=>vi.dynamicImportSettled());await act(async()=>vi.advanceTimersByTimeAsync(250))}
const btn=t=>[...host.querySelectorAll('button')].find(n=>n.textContent===t)
const click=async t=>{expect(btn(t)).toBeTruthy();await act(async()=>btn(t).click());await settle()}
const open=async()=>{await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true})));await settle()}
const choose=async()=>{expect(host.querySelector('[role=option]')).toBeTruthy();await act(async()=>host.querySelector('[role=option]').click());await settle()}
beforeEach(async()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();localStorage.clear();m.clear.mockReset().mockReturnValue(true);api.mockReset();api.mockImplementation(async p=>p==='/api/files?size=200'?[{id:'b',title:'列表旧标题.md',content:'原正文'}]:{id:'b',title:'数据库新标题.md',content:'原正文'});host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<App/>));await settle();await act(async()=>m.select({id:'a',title:'当前笔记.md',content:'原正文'}))})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('actual App cancellation preserves draft and quick search instead of closing it',async()=>{await click('写入测试草稿');await open();await choose();await click('取消');expect(host.querySelector('.quick-switcher')).toBeTruthy();expect(host.querySelector('.workspace-title-button').textContent).toBe('当前笔记.md');expect(host.querySelector('.workspace-save-chip').textContent).toBe('未保存');expect(m.clear).not.toHaveBeenCalled()})
test('actual App explicit discard opens current database identity then closes quick search',async()=>{await click('写入测试草稿');await open();await choose();await click('不保存');expect(host.querySelector('.quick-switcher')).toBeNull();expect(host.querySelector('.workspace-title-button').textContent).toBe('数据库新标题.md');expect(m.clear).toHaveBeenCalledOnce()})
test('clean App opens a freshly read result without writing either note',async()=>{await open();await choose();expect(host.querySelector('.workspace-title-button').textContent).toBe('数据库新标题.md');expect(host.querySelector('.quick-switcher')).toBeNull();expect(api.mock.calls.some(([,init])=>init?.method==='PUT')).toBe(false)})
