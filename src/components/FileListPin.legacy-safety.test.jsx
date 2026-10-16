import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {DndProvider} from 'react-dnd'
import {TestBackend} from 'react-dnd-test-backend'
import {test,beforeEach,afterEach,expect,vi} from 'vitest'
import FileList from './FileList'
import {api,listAllFiles} from '~/services/api'
import {toast} from '~/services/toast'
vi.mock('~/services/api',()=>({api:Object.assign(vi.fn(),{updateFile:vi.fn()}),listAllFiles:vi.fn()}))
vi.mock('~/services/toast',()=>({toast:{success:vi.fn(),error:vi.fn(),warning:vi.fn()}}))
let host,root,current
const flush=async()=>act(async()=>{for(let i=0;i<14;i++)await Promise.resolve()})
async function mount(){await act(async()=>root.render(<DndProvider backend={TestBackend}><FileList selectedId="pin-a" onSelect={()=>{}}/></DndProvider>));await flush()}
async function menu(){await act(async()=>host.querySelector('[data-file-id="pin-a"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100})));await flush();return [...host.querySelectorAll('[role=menuitem]')].find(n=>n.querySelector('.menu-item-label')?.textContent===(current.is_pinned?'取消置顶':'置顶'))}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();current={id:'pin-a',title:'常用.md',content:'keep',is_pinned:false,is_folder:false,is_deleted:false,parent_id:'',sort_order:1,created_at:1,updated_at:1};api.mockReset();api.updateFile.mockReset();listAllFiles.mockReset();listAllFiles.mockImplementation(async()=>[{...current}]);api.updateFile.mockImplementation(async(_,p)=>{current={...current,...p};return {...current}});api.mockImplementation(async(_,i)=>{if(i?.method==='PUT')current={...current,is_pinned:JSON.parse(i.body).pinned};return {...current}});for(const fn of Object.values(toast))fn.mockClear();vi.spyOn(console,'error').mockImplementation(()=>{});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();localStorage.clear();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('confirmed original-menu pin refreshes the list instead of reporting failure after commit',async()=>{await mount();const before=listAllFiles.mock.calls.length;const b=await menu();expect(b).toBeTruthy();await act(async()=>b.click());await flush();expect(current.is_pinned).toBe(true);expect(listAllFiles.mock.calls.length).toBeGreaterThan(before);expect(host.querySelector('.pin-icon')).toBeTruthy();expect(toast.error).not.toHaveBeenCalled()})
test('original-menu unpin requires an explicit decision and cancellation sends nothing',async()=>{current.is_pinned=true;await mount();const b=await menu();await act(async()=>b.click());await flush();expect(host.querySelector('[role=dialog]')).toBeTruthy();expect(api.updateFile).not.toHaveBeenCalled();expect(api.mock.calls.filter(([,i])=>i?.method)).toHaveLength(0);await act(async()=>[...host.querySelectorAll('.consumer-confirm-modal button')].find(n=>n.textContent==='取消').click());expect(current.is_pinned).toBe(true)})
