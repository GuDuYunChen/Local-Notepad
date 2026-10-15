import React,{act,useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {LexicalComposer} from '@lexical/react/LexicalComposer'
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext'
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin'
import {ContentEditable} from '@lexical/react/LexicalContentEditable'
import {HistoryPlugin} from '@lexical/react/LexicalHistoryPlugin'
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary'
import {$getRoot,$createTextNode,$createParagraphNode,UNDO_COMMAND,REDO_COMMAND} from 'lexical'
import SearchPlugin from './SearchPlugin'
let root,host,editor,errors
function Capture(){const [e]=useLexicalComposerContext();useEffect(()=>{editor=e},[e]);return null}
function App({id='A'}){return <LexicalComposer key={id} initialConfig={{namespace:'search-lifecycle',onError:e=>{errors.push(e)}}}><div className="editor-shell"><RichTextPlugin contentEditable={<ContentEditable className="editor-input"/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/><HistoryPlugin/><Capture/><SearchPlugin key={id} documentId={id}/></div></LexicalComposer>}
const flush=async()=>act(async()=>{for(let i=0;i<12;i++)await Promise.resolve()})
async function seed(text='alpha alpha tail'){await act(async()=>editor.update(()=>$getRoot().clear().append($createParagraphNode().append($createTextNode(text))),{discrete:true}));await flush()}
async function mount(id='A'){await act(async()=>root.render(<App id={id}/>));await seed()}
async function open(replace=true){await act(async()=>window.dispatchEvent(new CustomEvent('editor:open-search',{detail:{replace}})));await flush()}
function input(label){return host.querySelector(`input[aria-label="${label}"]`)}
async function field(label,value){await act(async()=>{const n=input(label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}))});await flush()}
function button(label){return [...document.querySelectorAll('button')].find(n=>n.textContent===label||n.getAttribute('aria-label')===label)}
async function click(label){expect(button(label),'Missing '+label).toBeTruthy();await act(async()=>button(label).click());await flush()}
function text(){let result;editor.getEditorState().read(()=>result=$getRoot().getTextContent());return result}
async function prepare(){await mount();await open();await field('查找内容','alpha');await field('替换内容','β')}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;errors=[];host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.spyOn(HTMLElement.prototype,'scrollIntoView').mockImplementation(()=>{})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('Ctrl+F opens search and find-only does not alter the document',async()=>{await mount();const before=JSON.stringify(editor.getEditorState());await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true})));await field('查找内容','alpha');expect(host.textContent).toContain('1/2');expect(JSON.stringify(editor.getEditorState())).toBe(before);expect(input('替换内容')).toBeNull()})
test('next and previous wrap without changing text or focus ownership',async()=>{await prepare();input('查找内容').focus();await click('下一个匹配');expect(host.textContent).toContain('2/2');await click('下一个匹配');expect(host.textContent).toContain('1/2');await click('上一个匹配');expect(host.textContent).toContain('2/2');expect(text()).toBe('alpha alpha tail')})
test('single replacement modifies only the reviewed current occurrence',async()=>{await prepare();await click('替换当前');expect(text()).toBe('β alpha tail');expect(host.textContent).toContain('当前草稿替换 1 处');expect(errors).toEqual([])})
test('all replacement requires explicit confirmation, cancel does not write',async()=>{await prepare();await click('全部替换…');expect(document.querySelector('[role=dialog]')).toBeTruthy();expect(text()).toBe('alpha alpha tail');await click('取消');expect(text()).toBe('alpha alpha tail')})
test('confirmed replacement is one original-history undo and redo operation',async()=>{await prepare();await click('全部替换…');await click('确认全部替换');expect(text()).toBe('β β tail');await act(async()=>editor.dispatchCommand(UNDO_COMMAND));await flush();expect(text()).toBe('alpha alpha tail');await act(async()=>editor.dispatchCommand(REDO_COMMAND));await flush();expect(text()).toBe('β β tail');expect(errors).toEqual([])})
test('editing while confirmation is visible invalidates its reviewed body',async()=>{await prepare();await click('全部替换…');await seed('changed alpha');await click('确认全部替换');expect(text()).toBe('changed alpha');expect(host.textContent).toContain('已变化')})
test('A to B to A edits do not revive stale replacement consent',async()=>{await prepare();await click('全部替换…');await seed('B');await seed('alpha alpha tail');await click('确认全部替换');expect(text()).toBe('alpha alpha tail');expect(host.textContent).toContain('已变化')})
test('switching documents closes the search and discards previous consent',async()=>{await prepare();await click('全部替换…');await mount('B');expect(host.querySelector('.document-search')).toBeNull();expect(document.querySelector('[role=dialog]')).toBeNull();expect(text()).toBe('alpha alpha tail')})
test('read-only editor permits find but never exposes replace controls',async()=>{await mount();await act(async()=>editor.setEditable(false));await open();await field('查找内容','alpha');expect(input('替换内容')).toBeNull();expect(button('显示替换').disabled).toBe(true);expect(text()).toBe('alpha alpha tail');expect(host.textContent).toContain('只读模式')})
test('becoming read-only closes a pending bulk confirmation',async()=>{await prepare();await click('全部替换…');await act(async()=>editor.setEditable(false));expect(document.querySelector('[role=dialog]')).toBeNull();expect(text()).toBe('alpha alpha tail')})
test('Chinese composition does not update match selection or submit replacement',async()=>{await prepare();const n=input('查找内容');await act(async()=>n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await field('查找内容','未完成');await act(async()=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));expect(text()).toBe('alpha alpha tail');expect(host.textContent).toContain('输入中');expect(button('替换当前').disabled).toBe(true);await act(async()=>n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));expect(host.textContent).toContain('未找到匹配')})
test('replacement IME enter never starts a write',async()=>{await prepare();const n=input('替换内容');await act(async()=>n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await act(async()=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));expect(text()).toBe('alpha alpha tail');await act(async()=>n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})))})
test('empty replacement explicitly removes matched characters',async()=>{await prepare();await field('替换内容','');await click('全部替换…');await click('确认全部替换');expect(text()).toBe('  tail')})
test('query change resets the selected match rather than reusing old index',async()=>{await prepare();await click('下一个匹配');await field('查找内容','tail');expect(host.textContent).toContain('1/1');await click('替换当前');expect(text()).toBe('alpha alpha β')})
test('closing cancels confirmation and does not modify pending input',async()=>{await prepare();await click('全部替换…');await click('关闭文内查找');expect(document.querySelector('[role=dialog]')).toBeNull();expect(text()).toBe('alpha alpha tail')})
test('oversize query clearly refuses replacement instead of truncating',async()=>{await prepare();await field('查找内容','x'.repeat(1025));expect(host.querySelector('[role=alert]')).toBeTruthy();expect(button('替换当前').disabled).toBe(true);expect(text()).toBe('alpha alpha tail')})
test('events intended for another note cannot open this note search',async()=>{await mount();await act(async()=>window.dispatchEvent(new CustomEvent('editor:open-search',{detail:{documentId:'B',replace:true}})));expect(host.querySelector('.document-search')).toBeNull()})
