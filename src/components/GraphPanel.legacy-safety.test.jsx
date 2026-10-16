import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import GraphPanel from './GraphPanel'
import {api} from '../services/api'
vi.mock('../services/api',()=>({api:vi.fn()}))
vi.mock('./LocalGraphCanvas',async()=>{const R=await import('react');return{default:R.forwardRef(()=>null)}})
let root,host
const snapshot={scope:'active-note-index-v1',complete:true,nodes:[{id:'甲',label:'中文甲',updated_at:1,incoming:0,outgoing:0,links:0},{id:'乙',label:'中文乙',updated_at:1,incoming:0,outgoing:0,links:0}],edges:[]}
const flush=async()=>act(async()=>{for(let i=0;i<10;i++)await Promise.resolve()})
async function mount(){await act(async()=>root.render(<GraphPanel onClose={()=>{}} onSelectFile={()=>{}}/>));await flush()}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();api.mockResolvedValue(snapshot);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.spyOn(console,'error').mockImplementation(()=>{});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('a failed graph read must expose an actionable error rather than an empty graph',async()=>{api.mockRejectedValue(Error('network'));await mount();expect(host.querySelector('[role=alert]')).toBeTruthy();expect([...host.querySelectorAll('button')].some(b=>b.textContent.includes('重新读取'))).toBe(true)})
test('malformed graph arrays must be rejected rather than coerced into an empty success',async()=>{api.mockResolvedValue({nodes:null,edges:null});await mount();expect(host.querySelector('[role=alert]')).toBeTruthy()})
test('Chinese composition must not apply a partial query to graph results',async()=>{await mount();const n=host.querySelector('input[aria-label="搜索知识图谱中的笔记"]');await act(async()=>n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'不存在');n.dispatchEvent(new Event('input',{bubbles:true}))});expect(host.textContent).not.toContain('0 个匹配结果')})
