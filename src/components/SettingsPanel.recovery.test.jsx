import React,{act,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {webcrypto} from 'node:crypto'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import SettingsPanel from './SettingsPanel'
import useGuardedNoteOpener from '~/hooks/useGuardedNoteOpener'
import {api} from '~/services/api'
import {recoveryFixture,recoveryReceipt} from '../test/trashRecoveryFixture.mjs'
vi.mock('~/services/api',()=>({api:vi.fn()}))
for(const path of ['./LibraryReferenceHealthPanel','./SyncCenterPanel','./S3ReadInspectionPanel','./S3LocalOverviewPanel']){}
vi.mock('./LibraryReferenceHealthPanel',()=>({default:()=>null}))
vi.mock('./SyncCenterPanel',()=>({default:()=>null}))
vi.mock('./S3ReadInspectionPanel',()=>({default:()=>null}))
vi.mock('./S3LocalOverviewPanel',()=>({default:()=>null}))
let host,root,data,selected,accept
const drain=async()=>{for(let i=0;i<35;i++)await Promise.resolve()}
const find=text=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===text||n.getAttribute('aria-label')===text)
const click=async text=>act(async()=>{const n=typeof text==='string'?find(text):text;expect(n).toBeTruthy();n.focus();n.click();await drain()})
function Harness(){const epoch=useRef(0);const opener=useGuardedNoteOpener({currentId:'current',workspace:'settings',navigationEpoch:epoch,onSelectFile:(file,options)=>{if(accept&&options.shouldSelect()){selected(file);options.afterSelect()}else options.onCancel()}});return <SettingsPanel onClose={()=>{}} onOpenFile={opener}/>}
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto);localStorage.clear();localStorage.setItem('localNotepad.theme.v1','dark');document.documentElement.setAttribute('data-theme','dark');data=recoveryFixture();accept=false;selected=vi.fn()
 api.mockReset().mockImplementation(async(path,init)=>{
  if(path==='/api/settings')return{theme:'dark'}
  if(path==='/api/diagnostics')return{status:'ok',integrity:'ok'}
  if(path==='/api/trash-recovery')return structuredClone(data)
  if(path==='/api/trash-recovery/restore'){const r=recoveryReceipt(data,JSON.parse(init.body));data=r.snapshot;return r}
  if(path==='/api/files/note')return{id:'note',title:'旧笔记',content:'original-body-unchanged',is_folder:false,is_deleted:false}
  if(init?.method)throw Error('unrelated write')
  return{}
 });host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(<Harness/>);await drain()})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('entry and exit preserve theme, notes and originating focus',async()=>{const entry=find('打开回收站恢复');await click('打开回收站恢复');expect(document.querySelector('.trash-recovery')).toBeTruthy();await click('关闭恢复工作台');expect(document.querySelector('.trash-recovery')).toBe(null);expect(document.activeElement).toBe(entry);expect(document.documentElement.getAttribute('data-theme')).toBe('dark');expect(api.mock.calls.every(([,init])=>!init?.method)).toBe(true)})
for(const accepted of [false,true])it('restored note uses real original navigation guard: '+accepted,async()=>{accept=accepted;await click('打开回收站恢复');await click(document.querySelector('[data-recovery-item="gone"] input'));await click('预览整批恢复');await click('确认继续');await click('通过原保存保护打开');await act(async()=>{await new Promise(r=>setTimeout(r,20));await drain()});expect(api.mock.calls.some(([p])=>p==='/api/files/note')).toBe(true);expect(api.mock.calls.filter(([,init])=>init?.method)).toHaveLength(1);if(accepted){expect(selected).toHaveBeenCalledWith(expect.objectContaining({id:'note',content:'original-body-unchanged'}));expect(document.querySelector('.trash-recovery')).toBe(null)}else{expect(selected).not.toHaveBeenCalled();expect(document.querySelector('.trash-recovery')).toBeTruthy()}})
