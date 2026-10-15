// The tag load summary changes the native button coordinate; await the real
// initial read before measuring and sending the original mouse events.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
const read=p=>fs.readFileSync(p,'utf8'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const targets=['scripts/check-note-tags-desktop.mjs','src/components/TagSelector.test.jsx']
fs.mkdirSync('document-search-evidence',{recursive:true})
if(process.argv[2]==='apply'){
 const original=read(targets[0]);assert.equal(blob(original),'bdeb1996ee94c327a65a6a224265e495861339d2')
 const a='await until(()=>evaluate("!!document.querySelector(\'.note-tags\')"),\'Tag entry missing\');await action(\'管理标签\');await has(\'已分配\')'
 const b=`await until(()=>evaluate("!!document.querySelector('.note-tags')"),'Tag entry missing')
  // Loading text and the empty-summary text have different widths. Wait for
  // the actual owned note's initial read before measuring real click coordinates.
  await until(()=>evaluate("document.querySelector('.note-tags-summary .note-tag-muted')?.textContent==='暂无标签' && !document.querySelector('.note-tags-summary [role=status]') && document.querySelector('.note-tags button[aria-label=\\\"管理标签\\\"]')?.getAttribute('aria-expanded')==='false'"),'Owned note initial tag read not ready')
  report.entryReadCompleteBeforeClick=true;save()
  await action('管理标签');await has('已分配')`
 assert.equal(original.split(a).length,2);fs.writeFileSync(targets[0],original.replace(a,b));fs.writeFileSync('document-search-evidence/original-tag-native.txt',original)
 const before=read(targets[1]);assert.equal(blob(before),'2a2fe23be39dbb938689cb1a06660ab7ce75df1e')
 fs.writeFileSync(targets[1],before+`
test('initial loading must finish before native entry coordinates are measured',async()=>{
 let release;api.mockReturnValue(new Promise(resolve=>{release=resolve}))
 await mount()
 expect(host.querySelector('.note-tags-summary [role=status]').textContent).toContain('正在读取')
 expect(host.querySelector('.note-tags-summary .note-tag-muted')).toBeNull()
 expect(buttons('管理标签')[0].getAttribute('aria-expanded')).toBe('false')
 await act(async()=>release(current));await flush()
 expect(host.querySelector('.note-tags-summary [role=status]')).toBeNull()
 expect(host.querySelector('.note-tags-summary .note-tag-muted').textContent).toBe('暂无标签')
 await click('管理标签')
 expect(host.querySelector('.note-tag-panel')).toBeTruthy()
 expect(buttons('管理标签')[0].getAttribute('aria-expanded')).toBe('true')
 expect(api.mock.calls.filter(([,init])=>init.method)).toHaveLength(0)
})
`)
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const p of targets){const content=read(p);const res=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(res.status,201,p);const result=await res.json();assert.equal(result.sha,blob(content));const dest=path.join('document-search-evidence/source',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);records.push({path:p,sha:result.sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')})}
 fs.writeFileSync('document-search-evidence/objects.json',JSON.stringify({base:'f24c8c393716d9a7e19406910ffdabd8de1688e1',records},null,2))
}else throw Error('Expected apply or publish')
