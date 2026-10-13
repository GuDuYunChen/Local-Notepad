import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { captureHistoryReview } from '../services/versionHistory.mjs'
import { readEditorDraft, removeEditorDraft } from '../services/editorDraftCache'
import { editorQuit } from '../services/editorQuit.mjs'
vi.mock('~/services/api', async()=>{const {editorSaveReceiptFixture}=await import('../test/editorSaveReceiptFixture.mjs');return {api:editorSaveReceiptFixture(vi.fn())}})
vi.mock('./Editor/Editor',()=>({default:({initialContent,onChange})=>{globalThis.__historyChange=onChange;return <div data-body={initialContent}/>}}))
let root,host,ref,files
const version={id:1,file_id:'history-a',title:'历史旧名',content:'历史正文',created_at:10}
const flush=async()=>act(async()=>{for(let i=0;i<12;i++)await Promise.resolve()})
beforeEach(()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();for(const id of ['history-a','history-b']){removeEditorDraft(id);editorQuit.forget(id)}
 api.mockReset();files={'history-a':{id:'history-a',title:'现有标题',content:'当前正文',updated_at:20},'history-b':{id:'history-b',title:'B',content:'B正文',updated_at:20}}
 api.mockImplementation(async(path,init)=>{const id=path.split('/').pop();if(init?.method==='PUT'){const input=JSON.parse(init.body);files[id]={...files[id],content:input.content};return files[id]}return files[id]})
 host=document.createElement('div');document.body.append(host);root=createRoot(host);ref=React.createRef()
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();for(const id of ['history-a','history-b']){removeEditorDraft(id);editorQuit.forget(id)}delete globalThis.__historyChange;delete globalThis.IS_REACT_ACT_ENVIRONMENT})
async function open(id='history-a'){await act(async()=>root.render(<TextEditor ref={ref} activeId={id} deletedIds={new Set()} autoSaveOnSwitch={false}/>));await flush()}
test('real TextEditor restoration uses receipt-backed PUT and preserves title',async()=>{
 await open();const review=captureHistoryReview(ref.current.captureHistoryState(),version)
 await act(async()=>{await ref.current.restoreHistoryVersion(version,review)})
 const writes=api.mock.calls.filter(([,i])=>i?.method==='PUT');expect(writes).toHaveLength(1)
 const data=JSON.parse(writes[0][1].body);expect(data.save_request_id).toBeTruthy();expect(data.expected_content).toBe('当前正文');expect(data.content).toBe('历史正文');expect(data.title).toBeUndefined()
 expect(ref.current.captureHistoryState().saved).toBe('历史正文');expect(files['history-a'].title).toBe('现有标题');expect(editorQuit.hasDraft('history-a')).toBe(false)
})
test('real editor refuses a reviewed restoration after an A-B-A edit',async()=>{
 await open();const review=captureHistoryReview(ref.current.captureHistoryState(),version)
 await act(async()=>{globalThis.__historyChange('暂时编辑');globalThis.__historyChange('当前正文')})
 await expect(ref.current.restoreHistoryVersion(version,review)).rejects.toMatchObject({code:'review-changed'})
 expect(api.mock.calls.filter(([,i])=>i?.method==='PUT')).toHaveLength(0)
})
test('reviewed history cannot be applied after switching away and back',async()=>{
 await open();const review=captureHistoryReview(ref.current.captureHistoryState(),version);await open('history-b');await open()
 await expect(ref.current.restoreHistoryVersion(version,review)).rejects.toMatchObject({code:'review-changed'})
})
test('failed original editor save retains restored draft, original baseline and quit protection',async()=>{
 await open();const review=captureHistoryReview(ref.current.captureHistoryState(),version)
 api.mockImplementation(async(path,init)=>{if(init?.method==='PUT')throw Error('write failed');return files['history-a']})
 await act(async()=>{await expect(ref.current.restoreHistoryVersion(version,review)).rejects.toBeTruthy()})
 expect(ref.current.captureHistoryState().content).toBe('历史正文');expect(ref.current.captureHistoryState().saved).toBe('当前正文');expect(readEditorDraft('history-a').content).toBe('历史正文');expect(editorQuit.hasDraft('history-a')).toBe(true)
})
