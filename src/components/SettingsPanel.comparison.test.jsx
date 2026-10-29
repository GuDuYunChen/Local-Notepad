import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPanel from './SettingsPanel'
import useGuardedNoteOpener from '~/hooks/useGuardedNoteOpener'
import { comparisonFixture, comparisonIndexFixture } from '../test/noteComparisonFixture.mjs'
import { api } from '~/services/api'
vi.mock('~/services/api',()=>({api:vi.fn()}))
vi.mock('./LibraryReferenceHealthPanel',()=>({default:()=>null}))
vi.mock('./SyncCenterPanel',()=>({default:()=>null}))
vi.mock('./S3ReadInspectionPanel',()=>({default:()=>null}))
vi.mock('./S3LocalOverviewPanel',()=>({default:()=>null}))
let host,root,selected,accept,mode
const rev='a'.repeat(64)
const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
const find=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text)
const click=async text=>act(async()=>{const b=find(text);expect(b,text).toBeTruthy();b.focus();b.click();await drain()})
function Harness(){const epoch=useRef(0);const opener=useGuardedNoteOpener({currentId:'current',workspace:'settings',navigationEpoch:epoch,onSelectFile:(file,options)=>{if(accept&&options.shouldSelect()){selected(file);options.afterSelect()}else options.onCancel()}});return <SettingsPanel onClose={()=>{}} onOpenFile={opener}/>}
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto);localStorage.clear();selected=vi.fn();accept=false;mode='dark';localStorage.setItem('localNotepad.theme.v1',mode);document.documentElement.setAttribute('data-theme',mode)
 api.mockReset().mockImplementation(async(path,init)=>{
  if(init?.method)throw Error('unexpected write')
  if(path==='/api/settings')return {theme:'dark'}
  if(path==='/api/diagnostics')return {status:'ok',integrity:'ok'}
  if(path==='/api/folder-workspace')return comparisonIndexFixture()
  if(path.startsWith('/api/note-comparison?'))return comparisonFixture()
  if(path==='/api/files/a')return {...comparisonFixture().notes[0],is_folder:false,is_deleted:false}
  if(path==='/api/tag-workspace')return {version:1,complete:true,revision:rev,tags:[{id:'t',name:'写作',color:'#176b4a',active_count:1,hidden_count:0,total_count:1}]}
  if(path.startsWith('/api/tag-workspace/t/notes'))return {tag_id:'t',revision:rev,complete:true,offset:0,total:1,has_more:false,notes:[{id:'n',title:'真实入口笔记'}]}
  if(path==='/api/files/n')return {id:'n',title:'真实入口笔记',content:'unchanged',is_folder:false,is_deleted:false}
  return {}
 });host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(<Harness/>);await drain()})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
const choosePair=async()=>{await act(async()=>{document.querySelector('[data-compare-note="a"] button').click();await drain()});await act(async()=>{document.querySelectorAll('[data-compare-note="b"] button')[1].click();await drain()});await click('开始比较');await act(async()=>{await new Promise(r=>setTimeout(r,10));await drain()})}
describe('comparison with real Settings and original guarded opener',()=>{
 it('entry is readonly, preserves theme and restores focus',async()=>{const entry=find('打开双笔记比较');await click('打开双笔记比较');expect(document.querySelector('.note-comparison')).not.toBeNull();await click('关闭双笔记比较');expect(document.querySelector('.note-comparison')).toBeNull();expect(document.activeElement).toBe(entry);expect(document.documentElement.getAttribute('data-theme')).toBe(mode);expect(api.mock.calls.every(([,init])=>!init?.method)).toBe(true)})
 it('preserves the panel on the original cancellation',async()=>{await click('打开双笔记比较');await choosePair();await click('打开左侧原文');expect(selected).not.toHaveBeenCalled();expect(document.querySelector('.note-comparison')).not.toBeNull()})
 it('routes fresh source through the original owner rather than selecting directly',async()=>{accept=true;await click('打开双笔记比较');await choosePair();await click('打开左侧原文');await act(async()=>{await new Promise(r=>setTimeout(r,10));await drain()});expect(selected).toHaveBeenCalledWith(expect.objectContaining({id:'a',content:comparisonFixture().notes[0].content}));expect(document.querySelector('.note-comparison')).toBeNull();expect(api.mock.calls.some(([p])=>p==='/api/files/a')).toBe(true)})
})
