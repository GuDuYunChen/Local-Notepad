// Preserve production guards; supply the new ref to the old VM-based test only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const blob = b => createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex')
const sha256 = b => createHash('sha256').update(b).digest('hex')
const targets = {
 'scripts/editor-cache-regression.node.mjs':'3a3be015357433bd9bd47c6723eb8877c9420943',
 'scripts/check-version-history-desktop.mjs':'0cec674eede0557d1c2be8118afb15cf62a8a785',
 'src/components/EditorHistoryRestore.test.jsx':'13d986d24c811a592b6acc54da61cccd63efd566',
}
const replace = (s,a,b) => {assert.equal(s.split(a).length,2,'Exact fixture anchor mismatch');return s.replace(a,b)}
if(process.argv[2]==='apply') {
 const src={};for(const [file,expected]of Object.entries(targets)){src[file]=fs.readFileSync(file,'utf8');assert.equal(blob(src[file]),expected,file)}
 fs.mkdirSync('source-objects/original-fixtures',{recursive:true})
 for(const [file,text]of Object.entries(src))fs.writeFileSync('source-objects/original-fixtures/'+path.basename(file),text)
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
