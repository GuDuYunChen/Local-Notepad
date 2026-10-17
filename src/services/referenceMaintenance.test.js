import { it, expect, vi } from 'vitest'
import { maintainSavedReferences } from './referenceMaintenance.mjs'
const body = (...titles) => JSON.stringify({root:{children:titles.map(text=>({type:'heading',tag:'h1',children:[{type:'text',text}]}))}})
const linked = sectionPath => JSON.stringify({root:{children:[{type:'wiki-link',id:'target',title:'正文',sectionPath}]}})
function fixture({before=body('旧章'),after=body('新章'),source=linked(['旧章'])}={}){
 const job={request_id:'a'.repeat(32),file_id:'target',before_content:before,after_content:after,section_mappings:'[]',state:'pending'}
 const files=[{id:'target',title:'正文',content:after},{id:'source',title:'引用笔记',content:source}]
 const load=vi.fn(async(url)=>url==='/api/editor-reference-jobs'?[job]:true)
 return {job,files,load,listFiles:vi.fn(async()=>structuredClone(files)),hasDraft:()=>false}
}
it('uniquely determined heading references use the actual repair planner after the body is saved',async()=>{
 const f=fixture(),r=await maintainSavedReferences(f)
 expect(r).toEqual({done:1,pending:0,limited:false})
 const sent=JSON.parse(f.load.mock.calls[1][1].body)
 expect(sent.state).toBe('done');expect(sent.target_content).toBe(f.job.after_content)
 expect(sent.updates).toHaveLength(1);expect(sent.updates[0].expected_content).toBe(f.files[1].content)
 expect(JSON.parse(sent.updates[0].content).root.children[0].sectionPath).toEqual(['新章'])
})
it('unrelated text edits do not prevent a deterministic heading maintenance job',async()=>{
 const f=fixture();f.files[0].content=JSON.stringify({...JSON.parse(f.files[0].content),extra:'body-only change'})
 await maintainSavedReferences(f)
 expect(JSON.parse(f.load.mock.calls[1][1].body).target_content).toBe(f.files[0].content)
})
it('changed newer headings are not overwritten and original durable work stays pending',async()=>{
 const f=fixture();f.files[0].content=body('第三次改名')
 expect((await maintainSavedReferences(f)).pending).toBe(1);expect(f.load).toHaveBeenCalledTimes(1)
})
it('ambiguous multi-heading changes preserve manual review without rewriting source bodies',async()=>{
 const f=fixture({before:body('旧章','另一章'),after:body('新章','也改名')})
 expect((await maintainSavedReferences(f)).pending).toBe(1)
 const sent=JSON.parse(f.load.mock.calls[1][1].body);expect(sent.state).toBe('manual');expect(sent.updates).toEqual([])
})
it('unsaved source drafts never get automatic reference writes',async()=>{
 const f=fixture();f.hasDraft=id=>id==='source'
 await maintainSavedReferences(f)
 expect(JSON.parse(f.load.mock.calls[1][1].body)).toMatchObject({state:'manual',updates:[]})
})
it('failed scans and failed completion receipts preserve pending jobs, not body-save errors',async()=>{
 const f=fixture();f.listFiles.mockRejectedValue(new Error('offline'))
 expect((await maintainSavedReferences(f)).pending).toBe(1);expect(f.load).toHaveBeenCalledTimes(1)
 f.listFiles.mockResolvedValue(f.files);f.load.mockImplementation(async url=>url==='/api/editor-reference-jobs'?[f.job]:false)
 expect((await maintainSavedReferences(f)).pending).toBe(1)
})
it('manual jobs do not retry silently; an explicit retry can finish them',async()=>{
 const f=fixture();f.job.state='manual'
 expect((await maintainSavedReferences(f)).pending).toBe(1);expect(f.listFiles).not.toHaveBeenCalled()
 expect((await maintainSavedReferences({...f,retryManual:true})).done).toBe(1)
})
