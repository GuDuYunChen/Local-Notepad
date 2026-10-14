import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
const targets=['scripts/check-template-library-desktop.mjs','src/components/TemplateLibrary.test.jsx']
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const read=p=>readFileSync(p,'utf8')
mkdirSync('tag-module-evidence',{recursive:true})
if(process.argv[2]==='apply'){
 const original=read(targets[0]);assert.equal(blob(original),'c440d9bf107fe6f1d4bef1f06f845139b57fe9ef')
 const a=" const row=async title=>{assert.equal(await evaluate(`(()=>{const n=[...document.querySelectorAll('.template-library-index li')].find(n=>n.querySelector('strong')?.textContent===${JSON.stringify(title)});if(!n)return false;n.setAttribute('data-owned-template','');return true})()`),true);return '[data-owned-template]'}"
 const b=" const row=async title=>{\n  await until(()=>evaluate(`(()=>{const n=[...document.querySelectorAll('.template-library-index li')].find(n=>n.querySelector('strong')?.textContent===${JSON.stringify(title)});return !!n?.querySelector('.template-library-row:not(:disabled)')})()`),'Template row not ready: '+title)\n  assert.equal(await evaluate(`(()=>{const n=[...document.querySelectorAll('.template-library-index li')].find(n=>n.querySelector('strong')?.textContent===${JSON.stringify(title)});if(!n?.querySelector('.template-library-row:not(:disabled)'))return false;n.setAttribute('data-owned-template','');return true})()`),true)\n  return '[data-owned-template]'\n }"
 assert.equal(original.split(a).length,2);writeFileSync(targets[0],original.replace(a,b))
 const test=read(targets[1]);assert.equal(blob(test),'ca9500110d3e560d48f797679905364b0ec06d9c')
 writeFileSync(targets[1],test+`
// A confirmed write and the following catalog read are separate events.
// Native navigation must await the actual enabled row, not the receipt text.
test('confirmed creation remains valid while its catalog row is still loading',async()=>{
 await mount();await click('新建模板');await fill('模板名称','迟到列表');await fill('模板正文','正文')
 const original=api.getMockImplementation();let afterWrite=false,release
 api.mockImplementation(async(p,i={})=>{
  if(p==='/api/template-library'&&afterWrite)return new Promise(resolve=>{release=()=>resolve({complete:true,items:templates.map(t=>({...t}))})})
  const value=await original(p,i);if(i.method==='POST')afterWrite=true;return value
 })
 await act(async()=>button('保存模板').click())
 try{
  for(let i=0;i<100&&(!release||!host.textContent.includes('创建回执已确认'));i++)await act(async()=>{await new Promise(r=>setTimeout(r,5))})
  expect(release).toBeTypeOf('function');expect(host.textContent).toContain('创建回执已确认')
  const currentRow=()=>[...host.querySelectorAll('.template-library-index li')].find(n=>n.querySelector('strong')?.textContent==='迟到列表')
  expect(currentRow()).toBeUndefined();expect(writes()).toHaveLength(1)
  await act(async()=>release());await tick()
  expect(currentRow()).toBeTruthy();expect([...currentRow().querySelectorAll('button')].every(n=>!n.disabled)).toBe(true)
  await click('编辑',currentRow());expect(host.querySelector('[aria-label="模板正文"]').value).toBe('正文');expect(writes()).toHaveLength(1)
 }finally{release?.()}
})
`)
 writeFileSync('tag-module-evidence/template-native-original.txt',original)
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const p of targets){const content=read(p);const r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(r.status,201);const result=await r.json();assert.equal(result.sha,blob(content));const dest=path.join('tag-module-evidence/source',p);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,content);records.push({path:p,sha:result.sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')})}
 writeFileSync('tag-module-evidence/objects.json',JSON.stringify({base:'d63987f39bf928d8c3c0a67242a8197b40333172',records},null,2))
}else throw Error('Expected apply or publish')
