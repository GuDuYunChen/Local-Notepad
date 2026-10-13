// Preserve production guards; supply the new ref to the old VM-based test only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const blob = b => createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex')
const sha256 = b => createHash('sha256').update(b).digest('hex')
const targets = {
 'scripts/editor-cache-regression.node.mjs':'3a3be015357433bd9bd47c6723eb8877c9420943',
 'scripts/check-version-history-desktop.mjs':'0cec674eede0557d1c2be8118afb15cf62a8a785',
 'src/components/EditorHistoryRestore.test.jsx':'13d986d24c811a592b6acc54da61cccd63efd566',
 'scripts/s3-local-overview-cases.mjs':'8e86cd73c108fe681f8c32aee078700d447f11ae',
}
const replace = (s,a,b) => {assert.equal(s.split(a).length,2,'Exact fixture anchor mismatch');return s.replace(a,b)}
if(process.argv[2]==='apply') {
 const src={};for(const [file,expected]of Object.entries(targets)){src[file]=fs.readFileSync(file,'utf8');assert.equal(blob(src[file]),expected,file)}
 fs.mkdirSync('source-objects/original-fixtures',{recursive:true})
 for(const [file,text]of Object.entries(src))fs.writeFileSync('source-objects/original-fixtures/'+path.basename(file)+'.before',text)
 let s=src['scripts/editor-cache-regression.node.mjs']
 s=replace(s,'    loadGenerationRef: {current: 1},','    historyBoundaryRef: {current: 0},\n    loadGenerationRef: {current: 1},')
 fs.writeFileSync('scripts/editor-cache-regression.node.mjs',s)
 s=src['scripts/check-version-history-desktop.mjs']
 s=replace(s,"import { randomUUID, createHash } from 'node:crypto'","import { createHash } from 'node:crypto'\nimport { createEditorSaveAttempt, commitEditorSave } from '../src/services/editorSaveTransaction.mjs'")
 s=replace(s," const write=async(expected,content)=>api(route,{method:'PUT',body:JSON.stringify({save_request_id:randomUUID(),expected_content:expected,content})})"," const write=(expected,content)=>commitEditorSave(api,createEditorSaveAttempt(file.id,expected,content))")
 fs.writeFileSync('scripts/check-version-history-desktop.mjs',s)
 s=src['src/components/EditorHistoryRestore.test.jsx']+`\ntest('a quit inspection invalidates pending history consent without dirtying clean content',async()=>{
 await open();const review=captureHistoryReview(ref.current.captureHistoryState(),version)
 await act(async()=>{await editorQuit.flush()})
 await expect(ref.current.restoreHistoryVersion(version,review)).rejects.toMatchObject({code:'review-changed'})
 expect(ref.current.captureHistoryState().content).toBe('当前正文');expect(editorQuit.hasDraft('history-a')).toBe(false)
 expect(api.mock.calls.filter(([,i])=>i?.method==='PUT')).toHaveLength(0)
})
`
 fs.writeFileSync('src/components/EditorHistoryRestore.test.jsx',s)
 // Prove the existing save implementation is unchanged before rebinding an
 // older module's whole-editor fingerprint to this intentional integration.
 const oldEditor=execFileSync('git',['show','HEAD:src/components/TextEditor.jsx'],{encoding:'utf8'})
 const newEditor=fs.readFileSync('src/components/TextEditor.jsx','utf8')
 assert.equal(blob(oldEditor),'fc1cfe4375891175843e513d199ba0539738c630')
 assert.equal(blob(newEditor),'ceae4e06b01d3637778dbec122a08c2b11d8777c')
 const part=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return text.slice(a,b)}
 const proof=[]
 for(const [name,start,end]of [
  ['saveNow','const saveNow = React.useCallback(', '\n  }, [beginSaving, endSaving])'],
  ['cachePendingDraft','const cachePendingDraft = React.useCallback(', '\n  }, [])'],
  ['quitCache','    cache: ', '\n    },\n    save:'],
 ]) {
  const before=part(oldEditor,start,end),after=part(newEditor,start,end).replace('      historyBoundaryRef.current += 1\n','')
  assert.equal(after,before,'Unintended save policy change: '+name)
  proof.push({name,beforeSHA256:sha256(before),afterSHA256:sha256(after),equal:true})
 }
 fs.writeFileSync('source-objects/save-policy-comparison.json',JSON.stringify({original:'048a9ca0f70b32fed1afc0f162e297789c781747',oldEditor:blob(oldEditor),newEditor:blob(newEditor),proof},null,2))
 s=replace(src['scripts/s3-local-overview-cases.mjs'],"['src/components/TextEditor.jsx', 'f6b10294e8ec07ebd40da1a840207138b3d3e455ce50539d4d35f673ff238f54']","['src/components/TextEditor.jsx', 'f8fa9aa73c9d0c9e67655d70a2021be2d0b075845e002ea833811ed073f6e377']")
 s=replace(s,'    // Capture only the untouched save/quit implementation, not unrelated main\n    // imports. These digests bind this wiring check to its accepted base.', '    // 2F.87 intentionally adds the guarded history adapter to TextEditor. Its\n    // original saveNow/cache policy is byte-compared before this exact digest\n    // update; all other save/quit files and wiring assertions remain pinned.')
 fs.writeFileSync('scripts/s3-local-overview-cases.mjs',s)
} else if(process.argv[2]==='publish') {
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const index=JSON.parse(fs.readFileSync('source-objects/objects.json','utf8'))
 for(const file of Object.keys(targets)) {
  assert.ok(!index.records.some(r=>r.path===file));const content=fs.readFileSync(file,'utf8')
  const response=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})})
  assert.equal(response.status,201,'Blob creation failed: '+file);const result=await response.json();assert.equal(result.sha,blob(content))
  const dest=path.join('source-objects',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content)
  index.records.push({path:file,sha:result.sha,bytes:Buffer.byteLength(content),sha256:sha256(content)})
 }
 fs.writeFileSync('source-objects/objects.json',JSON.stringify(index,null,2));console.log(JSON.stringify(index.records.map(({path,sha})=>({path,sha}))))
} else throw Error('Expected apply or publish')
