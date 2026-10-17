import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import useRecentNoteTracking from './useRecentNoteTracking'
import {recordRecentVisit} from '../services/recentNotes.mjs'
vi.mock('../services/recentNotes.mjs',()=>({recordRecentVisit:vi.fn()}))
let root,host
const note=(id='a',more={})=>({id,title:'笔记'+id,is_folder:false,is_deleted:false,content:'body',...more})
function Harness({file,workspace}){useRecentNoteTracking(file,workspace);return <div>{file?.title}</div>}
async function render(file,workspace='notes'){await act(async()=>root.render(<Harness file={file} workspace={workspace}/>))}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;recordRecentVisit.mockClear();host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('only committed ordinary note views are recorded, not a workspace preview',async()=>{await render(note(),'recent');expect(recordRecentVisit).not.toHaveBeenCalled();await render(note());expect(recordRecentVisit).toHaveBeenCalledTimes(1)})
test('typing and save-result rerenders do not create extra visits',async()=>{await render(note());await render(note('a',{content:'draft'}));await render(note('a',{title:'renamed',updated_at:3}));expect(recordRecentVisit).toHaveBeenCalledTimes(1)})
test('returning after a separate workspace records a new real entry with current title',async()=>{await render(note());await render(note(),'recent');await render(note('a',{title:'最新'}));expect(recordRecentVisit).toHaveBeenCalledTimes(2);expect(recordRecentVisit.mock.calls[1][0].title).toBe('最新')})
test('cancelled selection keeps the same note and does not record the uncommitted target',async()=>{await render(note());await render(note());expect(recordRecentVisit.mock.calls.map(([file])=>file.id)).toEqual(['a'])})
test('folder deleted and absent targets are not recorded',async()=>{await render(null);await render(note('folder',{is_folder:true}));await render(note('gone',{is_deleted:true}));expect(recordRecentVisit).not.toHaveBeenCalled()})
test('different committed note identity creates exactly one new visit',async()=>{await render(note());await render(note('b'));expect(recordRecentVisit.mock.calls.map(([file])=>file.id)).toEqual(['a','b'])})
test('StrictMode effect replay cannot duplicate a visit',async()=>{await act(async()=>root.render(<React.StrictMode><Harness file={note()} workspace="notes"/></React.StrictMode>));expect(recordRecentVisit).toHaveBeenCalledTimes(1)})
