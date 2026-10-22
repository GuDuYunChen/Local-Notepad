import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import BacklinksPanel from './BacklinksPanel'
import {api,getBacklinks} from '../services/api'
vi.mock('../services/api',()=>({api:vi.fn(),getBacklinks:vi.fn()}))
let root,host,select
const link={id:1,source_id:'source',target_id:'target',created_at:1}
const file={id:'source',title:'来源',content:'',is_folder:false,is_deleted:false,updated_at:1}
const snap={file_id:'target',complete:true,indexed_count:1,sources:[{link_id:1,source_id:'source',indexed_at:1,available:true,file}]}
const flush=async()=>act(async()=>{for(let i=0;i<20;i++)await Promise.resolve()})
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();getBacklinks.mockReset();select=vi.fn();getBacklinks.mockResolvedValue([link]);api.mockImplementation(async p=>p.endsWith('/backlink-sources')?snap:file);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
async function mount(){await act(async()=>root.render(<BacklinksPanel fileId="target" onSelectFile={select}/>));await flush()}
test('failed backlinks read must show a visible error rather than empty success',async()=>{vi.spyOn(console,'error').mockImplementation(()=>{});api.mockRejectedValue(Error('failure'));getBacklinks.mockRejectedValue(Error('failure'));await mount();expect(host.querySelector('[role=alert]')).toBeTruthy()})
test('deleted indexed source cannot directly invoke note selection',async()=>{api.mockImplementation(async p=>p.endsWith('/backlink-sources')?{...snap,sources:[{...snap.sources[0],available:false,file:null}]}:{...file,is_deleted:true});await mount();await act(async()=>host.querySelector('.backlink-source-select,.backlink-item')?.click());expect(select).not.toHaveBeenCalled();expect(host.textContent).toContain('不可用')})
test('wrong source identity cannot be displayed as a valid source',async()=>{api.mockImplementation(async p=>p.endsWith('/backlink-sources')?{...snap,sources:[{...snap.sources[0],file:{...file,id:'wrong',title:'不应显示'}}]}:{...file,id:'wrong',title:'不应显示'});await mount();expect(host.textContent).not.toContain('不应显示');expect(host.querySelector('[role=alert]')).toBeTruthy()})
