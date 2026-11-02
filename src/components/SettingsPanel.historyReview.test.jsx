import React,{act,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {webcrypto} from 'node:crypto'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import SettingsPanel from './SettingsPanel'
import useGuardedNoteOpener from '~/hooks/useGuardedNoteOpener'
import {historyReviewFixture,historyIndexFixture} from '../test/historyReviewFixture.mjs'
import {api} from '~/services/api'
vi.mock('~/services/api',()=>({api:vi.fn()}))
vi.mock('./LibraryReferenceHealthPanel',()=>({default:()=>null}));vi.mock('./SyncCenterPanel',()=>({default:()=>null}));vi.mock('./S3ReadInspectionPanel',()=>({default:()=>null}));vi.mock('./S3LocalOverviewPanel',()=>({default:()=>null}))
let host,root,accept,selected
const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
const click=async text=>act(async()=>{const b=button(text);expect(b,text).toBeTruthy();b.focus();b.click();await drain()})
const wait=async check=>vi.waitFor(async()=>{await act(drain);check()},{timeout:2500,interval:10})
function Harness(){const epoch=useRef(0),open=useGuardedNoteOpener({currentId:'current',workspace:'settings',navigationEpoch:epoch,onSelectFile:(file,options)=>{if(accept&&options.shouldSelect()){selected(file);options.afterSelect()}else options.onCancel()}});return <SettingsPanel onClose={()=>{}} onOpenFile={open}/>}
beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto);localStorage.clear();localStorage.setItem('localNotepad.theme.v1','dark');document.documentElement.setAttribute('data-theme','dark');accept=false;selected=vi.fn();api.mockReset().mockImplementation(async(path,init)=>{if(init?.method)throw Error('unexpected write');if(path==='/api/settings')return {theme:'dark'};if(path==='/api/diagnostics')return {status:'ok',integrity:'ok'};if(path==='/api/folder-workspace')return historyIndexFixture();if(path.startsWith('/api/history-review?')){const p=new URL(path,'http://local').searchParams;return historyReviewFixture(p.has('version')?Number(p.get('version')):null)};if(path==='/api/files/a')return {...historyReviewFixture().current,is_folder:false,is_deleted:false};return {}});host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(<Harness/>);await drain()})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('actual Settings entry preserves theme and restores entry focus',async()=>{const entry=button('打开历史中心');await click('打开历史中心');expect(document.querySelector('.history-review')).not.toBeNull();await click('关闭历史中心');expect(document.activeElement).toBe(entry);expect(document.documentElement.getAttribute('data-theme')).toBe('dark');expect(api.mock.calls.every(([,i])=>!i?.method)).toBe(true)})
for(const decision of [false,true])it('original owner '+(decision?'accepts':'cancels')+' source after fresh body validation',async()=>{accept=decision;await click('打开历史中心');await wait(()=>expect(document.querySelector('[data-history-file="a"]')).not.toBeNull());await act(async()=>{document.querySelector('[data-history-file="a"]').click();await drain()});await wait(()=>expect(document.querySelector('[data-history-version="3"]')).not.toBeNull());await click('打开当前笔记');await wait(()=>{if(decision){expect(selected).toHaveBeenCalledWith(expect.objectContaining({id:'a',content:historyReviewFixture().current.content}));expect(document.querySelector('.history-review')).toBeNull()}else{expect(selected).not.toHaveBeenCalled();expect(document.querySelector('.history-review')).not.toBeNull();expect(document.body.textContent).toContain('打开已取消')}});expect(api.mock.calls.some(([p])=>p==='/api/files/a')).toBe(true);expect(api.mock.calls.every(([,i])=>!i?.method)).toBe(true)})
