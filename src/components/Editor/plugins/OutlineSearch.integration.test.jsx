import React,{act,useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {URL as NodeURL} from 'node:url'
import {LexicalComposer} from '@lexical/react/LexicalComposer'
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext'
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin'
import {ContentEditable} from '@lexical/react/LexicalContentEditable'
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary'
import {$getRoot,$createTextNode,$createParagraphNode} from 'lexical'
import {HeadingNode,$createHeadingNode} from '@lexical/rich-text'
import DocumentOutlinePlugin from './DocumentOutlinePlugin'
import SearchPlugin from './SearchPlugin'
let root,host,editor,frames,sequence,errors
function Capture(){const[e]=useLexicalComposerContext();useEffect(()=>{editor=e},[e]);return null}
function Harness(){return <LexicalComposer initialConfig={{namespace:'outline-search-coexistence',nodes:[HeadingNode],onError:e=>errors.push(e)}}><div className="editor-shell"><SearchPlugin documentId="A"/><DocumentOutlinePlugin documentId="A" documentTitle="笔记A"/><div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable className="editor-input"/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/><Capture/></div></div></LexicalComposer>}
const flush=async()=>act(async()=>{for(let i=0;i<12;i++)await Promise.resolve()})
const body=()=>JSON.stringify(editor.getEditorState().toJSON())
const button=label=>[...host.querySelectorAll('button')].find(n=>n.textContent===label||n.getAttribute('aria-label')===label)
async function click(label){expect(button(label),'Missing '+label).toBeTruthy();await act(async()=>button(label).click());await flush()}
async function key(key,extra={}){await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:true,cancelable:true,...extra})));await flush()}
async function tick(){await act(async()=>{for(let pass=0;pass<4;pass++){const list=[...frames.values()];frames.clear();for(const fn of list)fn();await Promise.resolve()}});await flush()}
beforeEach(async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;frames=new Map();sequence=0;errors=[]
 vi.stubGlobal('requestAnimationFrame',fn=>{const id=++sequence;frames.set(id,fn);return id});vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id))
 vi.spyOn(HTMLElement.prototype,'scrollTo').mockImplementation(()=>{});vi.spyOn(HTMLElement.prototype,'scrollIntoView').mockImplementation(()=>{})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 await act(async()=>root.render(<Harness/>));await flush()
 await act(async()=>editor.update(()=>$getRoot().clear().append($createHeadingNode('h1').append($createTextNode('章节A')),$createParagraphNode().append($createTextNode('alpha alpha tail'))),{discrete:true}));await flush()
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('closed outline stays below the active search panel without losing its entry',()=>{
 const css=readFileSync(new NodeURL('./DocumentOutline.css',import.meta.url),'utf8')
 expect(css).toContain('.editor-shell > .local-outline:not(.open) { z-index:49; }')
 expect(button('文档目录')).toBeTruthy()
})
test('Ctrl+F yields an open outline to actual search without changing body',async()=>{
 await click('文档目录');const before=body();await key('f');await tick()
 expect(host.querySelector('.document-outline-panel')).toBeNull();expect(host.querySelector('.document-search')).toBeTruthy()
 expect(document.activeElement).toBe(host.querySelector('[aria-label="查找内容"]'));expect(body()).toBe(before);expect(errors).toEqual([])
})
test('opening the current document search explicitly yields outline foreground',async()=>{
 await click('文档目录');const before=body()
 await act(async()=>window.dispatchEvent(new CustomEvent('editor:open-search',{detail:{documentId:'A',replace:true}})));await flush()
 expect(host.querySelector('.document-outline-panel')).toBeNull();expect(host.querySelector('[aria-label="替换内容"]')).toBeTruthy();expect(body()).toBe(before)
})
test('other-document search and IME or unrelated shortcuts do not close outline',async()=>{
 await click('文档目录')
 await act(async()=>window.dispatchEvent(new CustomEvent('editor:open-search',{detail:{documentId:'B'}})));await flush()
 for(const extra of [{isComposing:true},{altKey:true}]){await key('f',extra);expect(host.querySelector('.document-outline-panel')).toBeTruthy()}
 await key('x');expect(host.querySelector('.document-outline-panel')).toBeTruthy();expect(host.querySelector('.document-search')).toBeNull()
})
test('search options and query survive yielding the overlay back from outline',async()=>{
 await key('h');const n=host.querySelector('[aria-label="查找内容"]')
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'alpha');n.dispatchEvent(new Event('input',{bubbles:true}))});await flush()
 const before=body();await key('O',{shiftKey:true});expect(host.querySelector('.document-outline-panel')).toBeTruthy()
 await key('h');await tick();expect(host.querySelector('.document-outline-panel')).toBeNull();expect(n.value).toBe('alpha');expect(host.textContent).toContain('1/2');expect(body()).toBe(before)
})
test('yielding to search cancels a queued outline jump before it can steal scroll',async()=>{
 await click('文档目录');await click('章节A');await key('f');const scroll=HTMLElement.prototype.scrollTo;scroll.mockClear();await tick()
 expect(host.querySelector('.document-outline-panel')).toBeNull();expect(scroll).not.toHaveBeenCalled();expect(host.textContent).not.toContain('已定位：章节A')
})
