import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import TagSelector from './TagSelector'
import {api} from '../services/api'
import {tagApi} from '../services/tagApi'
vi.mock('../services/api',()=>({api:vi.fn()}))
vi.mock('../services/tagApi',()=>({tagApi:{list:vi.fn(),create:vi.fn(),getFileTags:vi.fn(),addFileTag:vi.fn(),removeFileTag:vi.fn()}}))
let root,host,callback,resolveWrite
const tag={id:'tag-a',name:'写作',color:'#112233'},snap={file_id:'note-a',complete:true,available:[tag],tags:[]}
const flush=async()=>act(async()=>{for(let i=0;i<10;i++)await Promise.resolve()})
async function mount(){await act(async()=>root.render(<TagSelector fileId="note-a" tags={[]} onChange={callback}/>));await flush();await act(async()=>host.querySelector('button[aria-label="管理标签"]').click());await flush()}
const option=()=>host.querySelector('.note-tag-option,[role=option]')
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();callback=vi.fn();for(const v of Object.values(tagApi))v.mockReset();api.mockReset();const pending=new Promise(r=>resolveWrite=r);tagApi.list.mockResolvedValue([tag]);tagApi.getFileTags.mockResolvedValue([tag]);tagApi.addFileTag.mockReturnValue(pending);tagApi.removeFileTag.mockReturnValue(pending);api.mockImplementation(async(_,init)=>init?.method?pending:snap);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete globalThis.IS_REACT_ACT_ENVIRONMENT;vi.restoreAllMocks()})
test('tag read failure must be visible instead of an apparently empty picker',async()=>{tagApi.list.mockRejectedValue(Error('read'));api.mockRejectedValue(Error('read'));vi.spyOn(console,'error').mockImplementation(()=>{});await mount();expect(host.textContent).toContain('失败')})
test('unmounted note must not receive a late tag mutation callback',async()=>{await mount();callback.mockClear();await act(async()=>option().click());await flush();await act(async()=>root.render(null));await act(async()=>resolveWrite({...snap,tags:[tag]}));await flush();expect(callback).not.toHaveBeenCalled()})
test('double clicking an available tag starts only one mutation',async()=>{await mount();const n=option();await act(async()=>{n.click();n.click()});await flush();const writes=tagApi.addFileTag.mock.calls.length+api.mock.calls.filter(([,i])=>i?.method).length;expect(writes).toBe(1);await act(async()=>resolveWrite({...snap,tags:[tag]}))})
