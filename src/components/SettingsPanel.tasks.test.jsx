import { webcrypto } from 'node:crypto'
import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPanel from './SettingsPanel'
import useGuardedNoteOpener from '~/hooks/useGuardedNoteOpener'
import { taskCenterFixture, taskFixtureBody } from '../test/taskCenterFixture.mjs'
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
  if(path==='/api/task-center')return taskCenterFixture(1)
  if(path==='/api/files/task-source')return {id:'task-source',title:'待办源笔记',content:taskFixtureBody(1),is_folder:false,is_deleted:false}
  if(path==='/api/tag-workspace')return {version:1,complete:true,revision:rev,tags:[{id:'t',name:'写作',color:'#176b4a',active_count:1,hidden_count:0,total_count:1}]}
  if(path.startsWith('/api/tag-workspace/t/notes'))return {tag_id:'t',revision:rev,complete:true,offset:0,total:1,has_more:false,notes:[{id:'n',title:'真实入口笔记'}]}
  if(path==='/api/files/n')return {id:'n',title:'真实入口笔记',content:'unchanged',is_folder:false,is_deleted:false}
  return {}
 });host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(<Harness/>);await drain()})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('task center in real settings and original guarded navigation',()=>{
 it('opens from settings without changing notes or theme and restores focus',async()=>{const entry=find('打开待办任务中心');await click('打开待办任务中心');expect(document.querySelector('.task-center')).not.toBeNull();await click('关闭待办任务中心');expect(document.querySelector('.task-center')).toBeNull();expect(document.activeElement).toBe(entry);expect(document.documentElement.getAttribute('data-theme')).toBe(mode);expect(api.mock.calls.every(([,init])=>!init?.method)).toBe(true)})
 it('keeps the workspace on a cancelled original decision',async()=>{await click('打开待办任务中心');await click('打开来源');await act(async()=>{await new Promise(r=>setTimeout(r,20));await drain()});expect(selected).not.toHaveBeenCalled();expect(document.querySelector('.task-center')).not.toBeNull()})
 it('opens only through the original guard after a fresh body read',async()=>{accept=true;await click('打开待办任务中心');await click('打开来源');await act(async()=>{await new Promise(r=>setTimeout(r,20));await drain()});expect(selected).toHaveBeenCalledWith(expect.objectContaining({id:'task-source',content:taskFixtureBody(1)}));expect(document.querySelector('.task-center')).toBeNull();expect(api.mock.calls.some(([path])=>path==='/api/files/task-source')).toBe(true)})
})
