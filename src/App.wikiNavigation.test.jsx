import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import App from './App'
import { api } from './services/api'
const m = vi.hoisted(() => ({ select:null, current:null, save:vi.fn(), clear:vi.fn() }))
vi.mock('./services/api', () => ({ api:vi.fn(), searchFiles:vi.fn().mockResolvedValue([]), createFileVersionSnapshot:vi.fn(), listAllFilesWithContent:vi.fn() }))
vi.mock('./components/FileList', () => ({ default:({onSelect,updatedItem}) => { m.select=onSelect; m.current=updatedItem; return null } }))
vi.mock('./components/WorkspaceSidebar', () => ({ default:({children,onChangeWorkspace}) => <aside><button onClick={()=>onChangeWorkspace('recent')}>其他工作区</button>{children}</aside> }))
const body = title => JSON.stringify({root:{type:'root',children:[{type:'heading',tag:'h1',children:[{type:'text',text:title}]}]}})
vi.mock('./components/TextEditor', () => ({ default:React.forwardRef(function Editor({activeId,onLoaded,onChange,onStatusChange},ref) {
  React.useEffect(()=>{if(activeId){onLoaded?.(m.current.content);onStatusChange?.({dirty:false})}},[activeId])
  React.useImperativeHandle(ref,()=>({clearCache:m.clear,save:m.save,getReferenceRefactorState:()=>({savedContent:m.current?.content||''})}))
  return activeId ? <button onClick={()=>{onChange(JSON.stringify({root:{type:'root',children:[{type:'heading',tag:'h1',children:[{type:'text',text:'未保存新章节'}]}]}}));onStatusChange?.({dirty:true})}}>写入正文草稿</button> : null
}) }))
const source = {id:'source',title:'来源.md',content:body('来源章节'),updated_at:1,is_folder:false,is_deleted:false}
const target = {id:'target',title:'目标最新标题.md',content:body('目标章节'),updated_at:1,is_folder:false,is_deleted:false}
const other = { ...source,id:'other',title:'其他笔记.md' }
let root, host
const drain = async () => act(async()=>{for(let i=0;i<30;i++)await Promise.resolve()})
const settle = async () => { await act(async()=>vi.dynamicImportSettled()); await act(async()=>vi.advanceTimersByTimeAsync(250)); await drain() }
const title = () => host.querySelector('.workspace-title-button')?.textContent
const button = label => [...host.querySelectorAll('button')].find(b=>b.textContent===label || b.getAttribute('aria-label')===label)
const click = async label => { expect(button(label),'missing '+label).toBeTruthy(); await act(async()=>button(label).click()); await settle() }
const emit = async detail => { await act(async()=>window.dispatchEvent(new CustomEvent('wikiLink:open',{detail:{id:'target',title:'旧标题',headingPath:[],...detail}}))); await drain() }
beforeEach(async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();localStorage.clear();api.mockReset().mockResolvedValue(target);m.clear.mockReset().mockReturnValue(true);m.save.mockReset().mockReturnValue(null)
  host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<App/>));await settle();await act(async()=>m.select(source));await settle()
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('wiki uses the newest unsaved guard when typing happens during retrieval',async()=>{
  let release;api.mockImplementation(()=>new Promise(resolve=>release=resolve));await emit();await click('写入正文草稿')
  await act(async()=>release(target));await settle();expect(title()).toBe(source.title);expect(host.querySelector('.consumer-confirm-modal')).toBeTruthy();await click('取消')
  expect(title()).toBe(source.title);expect(host.querySelector('.workspace-save-chip.dirty')).toBeTruthy();expect(m.clear).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled()
})
test('wiki late retrieval cannot select its target after leaving the source note',async()=>{
  let release;api.mockImplementation(()=>new Promise(resolve=>release=resolve));await emit();await act(async()=>m.select(other));await settle();await act(async()=>release(target));await settle()
  expect(title()).toBe(other.title);expect(host.querySelector('.wiki-navigation-status')).toBeNull()
})
test('valid wiki target opens its latest title without writing any body',async()=>{await emit();await settle();expect(title()).toBe(target.title);expect(api.mock.calls.every(([,options])=>!options?.method)).toBe(true);expect(m.save).not.toHaveBeenCalled()})
test('wiki rejects a valid-looking response for another note identity',async()=>{api.mockResolvedValue(other);await emit();await settle();expect(title()).toBe(source.title);expect(host.querySelector('.wiki-navigation-status [role=alert]')).toBeTruthy()})
test('wiki rejects deleted targets rather than loading their content',async()=>{api.mockResolvedValue({...target,is_deleted:true});await emit();await settle();expect(title()).toBe(source.title);expect(host.textContent).toContain('已删除')})
test('explicit stop aborts reading and ignores its late completion',async()=>{let release,signal;api.mockImplementation((_,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve)});await emit();await click('停止打开引用');expect(signal.aborted).toBe(true);await act(async()=>release(target));await settle();expect(title()).toBe(source.title);expect(host.textContent).toContain('已停止打开')})
test('unknown section refuses navigation and offers only an explicit body fallback',async()=>{await emit({headingPath:['不存在']});await settle();expect(title()).toBe(source.title);expect(host.textContent).toContain('未跳到其他位置');await click('仅打开笔记正文');expect(title()).toBe(target.title)})
test('duplicate section paths do not choose the first heading',async()=>{const parsed=JSON.parse(target.content);parsed.root.children.push({...parsed.root.children[0]});api.mockResolvedValue({...target,content:JSON.stringify(parsed)});await emit({headingPath:['目标章节']});await settle();expect(title()).toBe(source.title);expect(host.textContent).toContain('同名章节路径')})
test('current-note link locates unsaved local heading without saving or replacing draft',async()=>{
 await click('写入正文草稿');api.mockResolvedValue(source);const events=[];const listener=e=>events.push(e.detail);window.addEventListener('editor:open-heading-anchor',listener)
 try{await emit({id:'source',headingPath:['未保存新章节']});await settle();expect(events.some(e=>e.documentId==='source'&&e.path[0]==='未保存新章节')).toBe(true);expect(title()).toBe(source.title);expect(host.querySelector('.workspace-save-chip.dirty')).toBeTruthy();expect(m.save).not.toHaveBeenCalled();expect(m.clear).not.toHaveBeenCalled()}
 finally{window.removeEventListener('editor:open-heading-anchor',listener)}
})
test('waiting for the user save decision does not use the network timeout',async()=>{await click('写入正文草稿');await emit();await act(async()=>vi.advanceTimersByTimeAsync(15000));expect(host.querySelector('.consumer-confirm-modal')).toBeTruthy();expect(title()).toBe(source.title);await click('取消');expect(title()).toBe(source.title)})
test('wiki request emitted outside the note workspace cannot switch an unrelated workspace',async()=>{await click('其他工作区');const before=api.mock.calls.length;await emit();await settle();expect(host.querySelector('.recent-workspace')).toBeTruthy();expect(api.mock.calls.length).toBe(before)})
test('closing failed navigation clears its status without discarding a note',async()=>{api.mockRejectedValue(Error('private details'));await emit();await settle();await click('关闭引用导航提示');expect(host.querySelector('.wiki-navigation-status')).toBeNull();expect(title()).toBe(source.title)})
