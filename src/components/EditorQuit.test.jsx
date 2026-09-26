import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextEditor from './TextEditor'
import MarkdownSourcePlugin from './Editor/plugins/MarkdownSourcePlugin'
const fakeEditor = vi.hoisted(() => ({ getEditorState: () => ({}), parseEditorState: v => v, setEditorState: vi.fn(), focus: vi.fn() }))
vi.mock('@lexical/react/LexicalComposerContext', () => ({ useLexicalComposerContext: () => [fakeEditor] }))
vi.mock('~/services/markdownSource', () => ({ analyzeMarkdownSourceCompatibility: () => ({ markdown: 'original', issues: [], editable: true }) }))
vi.mock('~/services/importContent', () => ({ markdownToLexical: value => value }))
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { installDocumentQuitBridge } from '~/services/editorQuitBridge.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('./Editor/utils/referenceUtils', () => ({ hasHeadingStructureChanged: (_a,b) => String(b).startsWith('heading:') }))
vi.mock('~/services/editorDraftCache', () => ({
  isFreshEditorDraft: () => false, readEditorDraft: () => null,
  removeEditorDraft: vi.fn(), writeEditorDraft: vi.fn(),
}))
vi.mock('./Editor/Editor', () => ({ default: ({ onChange, initialContent }) =>
  <textarea aria-label="test-editor" defaultValue={initialContent} onChange={e => onChange(e.target.value)}/> }))
let root, host, prepare, release, results, dispose, ref, failure, hold
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve() }
beforeEach(() => {
  ref=React.createRef(); results=[]; failure=false; hold=null
  for (const id of ['quit-1','prior']) editorQuit.forget(id)
  host=document.createElement('div');host.id='root';document.body.appendChild(host);root=createRoot(host)
  api.mockImplementation(async (path,init) => {
    if (init?.method==='PUT') { if (failure) throw new Error('offline'); if(hold) await hold.promise
      return {id:'quit-1',content:JSON.parse(init.body).content,updated_at:100} }
    return {id:'quit-1',content:'old',updated_at:100}
  })
  dispose=installDocumentQuitBridge({bridge:{
    onQuitPrepare(fn){prepare=fn;return()=>{}},onQuitRelease(fn){release=fn;return()=>{}},reportQuitResult(value){results.push(value)},
  }})
})
afterEach(async () => {
  dispose(); await act(async()=>{root.unmount();await flush()});host.remove()
  for (const id of ['quit-1','prior']) editorQuit.forget(id)
  vi.restoreAllMocks();vi.clearAllMocks()
})
const id='1'.repeat(32)
async function render(){await act(async()=>{root.render(<TextEditor ref={ref} activeId="quit-1" deletedIds={new Set()} />);await flush()})}
async function draft(text){await act(async()=>{ref.current.replaceDraftContent(text);await flush()})}
async function quit(){await act(async()=>{prepare({id});await flush()})}
const puts=()=>api.mock.calls.filter(([,i])=>i?.method==='PUT')
describe('editor exit save integration',()=>{
  it('flushes an unsent draft, confirms it, and stays frozen until release',async()=>{
    await render();await draft('new body');expect(puts()).toHaveLength(0);await quit()
    expect(JSON.parse(puts()[0][1].body)).toEqual({content:'new body'})
    expect(results).toEqual([{id,ready:true}]);expect(host.inert).toBe(true)
    await act(async()=>release({id}));expect(host.inert).not.toBe(true)
  })
  it('returns to the editor and keeps the dirty ledger when saving fails',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>{})
    await render();await draft('new body');failure=true;await quit()
    expect(results.at(-1)).toMatchObject({id,ready:false});expect(host.inert).not.toBe(true);expect(editorQuit.pending()).toBe(1)
  })
  it('does not bypass an unconfirmed heading/refactor change',async()=>{
    await render();await draft('heading:new section');await quit()
    expect(results).toEqual([{id,ready:false,code:'structure'}]);expect(puts()).toHaveLength(0)
  })
  it('does not approve while a real TextEditor save is still pending',async()=>{
    await render();await draft('new body');let resolve;hold={promise:new Promise(r=>{resolve=r})};await quit()
    expect(results).toHaveLength(0);expect(host.inert).toBe(true)
    await act(async()=>{resolve();await flush()});expect(results).toEqual([{id,ready:true}])
  })
  it('preserves a previous unresolved document even when the current one is clean',async()=>{
    await render();editorQuit.remember('prior','previous body');await quit()
    expect(results).toEqual([{id,ready:false,code:'unresolved'}]);expect(puts()).toHaveLength(0)
  })
  it('a clean document acknowledges without a redundant PUT',async()=>{
    await render();await quit();expect(results).toEqual([{id,ready:true}]);expect(puts()).toHaveLength(0)
  })
  it('active IME composition refuses before freezing or saving',async()=>{
    await render();await draft('new body')
    window.dispatchEvent(new Event('compositionstart'));await quit()
    expect(results).toEqual([{id,ready:false,code:'composition'}]);expect(puts()).toHaveLength(0);expect(host.inert).not.toBe(true)
  })
})

it('an open Markdown source draft must be applied explicitly before exit', async () => {
  await act(async () => { root.render(<MarkdownSourcePlugin/>); await flush() })
  await act(async () => { window.dispatchEvent(new Event('editor:toggle-source-mode')); await flush() })
  const textarea=host.querySelector('[aria-label="Markdown 源码内容"]')
  expect(textarea).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'unapplied source')
    textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.dispatchEvent(new Event('change',{bubbles:true}));await flush()
  })
  await quit();expect(results).toEqual([{id,ready:false,code:'source'}]);expect(fakeEditor.setEditorState).not.toHaveBeenCalled()
})
