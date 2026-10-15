// Auxiliary verification only. Never updates a product ref or uploads dependencies.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const BASE='921cb2553a8783b882618f7ba90c125d99ce3c42'
const read=p=>fs.readFileSync(p,'utf8')
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const digest=s=>createHash('sha256').update(s).digest('hex')
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Exact source anchor mismatch');return s.replace(a,b)}
const targets=['src/services/documentOutline.mjs','src/services/documentOutline.test.js','src/components/Editor/plugins/DocumentOutlinePlugin.jsx','src/components/Editor/plugins/DocumentOutline.css','src/components/Editor/plugins/DocumentOutline.lifecycle.test.jsx','src/components/Editor/plugins/DocumentOutline.legacy-safety.test.jsx','src/components/Editor/Editor.jsx','scripts/document-outline-cases.mjs','scripts/document-outline.node.mjs','scripts/check-document-outline-desktop.mjs','scripts/check-desktop-save.mjs','docs/LOCAL_DOCUMENT_OUTLINE_2F94.md','AGENTS.md','package.json','package-lock.json']
fs.mkdirSync('outline-module-evidence',{recursive:true})
if(process.argv[2]==='apply'){
 const expected={'src/components/Editor/Editor.jsx':'692f304fafd205a25a3b1791693d728f568966b9','scripts/check-desktop-save.mjs':'2a7cc28162d441a99ab798c8fb5437ed0b0e3a2d','AGENTS.md':'7b73faddf063473ad265538a8fd29497c10db5f2','package.json':'4667b169d763a2005a3b1e847c4bd7dc363ceb78','package-lock.json':'4072a1ea9921b51730d79e47567903bd57038018'}
 for(const [p,h]of Object.entries(expected))assert.equal(blob(read(p)),h,p)
 let p='src/components/Editor/Editor.jsx';fs.writeFileSync(p,once(read(p),'<DocumentOutlinePlugin documentId={documentId} documentTitle={documentTitle} />','<DocumentOutlinePlugin documentId={documentId} documentTitle={documentTitle} initialContent={initialContent} requireLoaded />'))
 p='scripts/check-desktop-save.mjs';const anchor='  await verifyDocumentSearchDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })'
 fs.writeFileSync(p,"import { verifyDocumentOutlineDesktop } from './check-document-outline-desktop.mjs'\n"+once(read(p),anchor,anchor+'\n  await verifyDocumentOutlineDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })'))
 p='AGENTS.md';const paragraphs=read(p).split('\n\n');assert.ok(paragraphs[1].startsWith('Current local module: 2F.93 / 4.226.0'))
 paragraphs[1]='Current local module: 2F.94 /4.227.0 complete local outline and safe section navigation. Read docs/LOCAL_DOCUMENT_OUTLINE_2F94.md. Accepted base921cb25 /4.226.0 is PR2 comment6188125472. Complete always-available empty/single-heading entry, current-loaded-body read, literal/IME hierarchy search, exact-key navigation/return, fold/reveal, unique-path anchors, bounded actual clipboard outcomes, cancellation/late-result isolation, original body/save/quit and installed lifecycle. Never select the first ambiguous path, report failed clipboard fallback as success, scroll a stale document or treat outline navigation as a content save. No cloud/multidevice or rejected dependency export.'
 fs.writeFileSync(p,paragraphs.join('\n\n'))
 const lock=JSON.parse(read('package-lock.json'));assert.equal(lock.version,'4.226.0')
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'})
 const next=JSON.parse(read('package-lock.json'));assert.equal(next.version,'4.227.0');assert.equal(next.packages[''].version,'4.227.0');next.version=lock.version;next.packages[''].version=lock.packages[''].version;assert.deepEqual(next,lock)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.226.0'],{stdio:'inherit'});execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'});execFileSync('git',['diff','--check'],{stdio:'inherit'})
 fs.writeFileSync('outline-module-evidence/integration.json',JSON.stringify({base:BASE,targets,version:'4.227.0',dependencyGraphUnchanged:true,testsExecuted:false},null,2))
}else if(process.argv[2]==='baseline'){
 const p='src/components/Editor/plugins/DocumentOutlinePlugin.jsx',fixed=read(p),old=execFileSync('git',['show',BASE+':'+p],{encoding:'utf8'})
 try{
  fs.writeFileSync(p,old)
  const r=spawnSync('npx',['vitest','run','--root=.','src/components/Editor/plugins/DocumentOutline.legacy-safety.test.jsx','--reporter=json','--outputFile=outline-module-evidence/before.json'],{encoding:'utf8',timeout:60000})
  fs.writeFileSync('outline-module-evidence/before.log',String(r.stdout||'')+String(r.stderr||''));assert.equal(r.status,1)
  const report=JSON.parse(read('outline-module-evidence/before.json'));assert.equal(report.numTotalTests,3);assert.equal(report.numFailedTests,3)
  const tests=report.testResults.flatMap(t=>t.assertionResults);assert.equal(tests.length,3)
  for(const t of tests){assert.equal(t.status,'failed');assert.ok(!t.failureMessages.join('\n').includes('timed out'))}
  fs.writeFileSync('outline-module-evidence/old-outline.txt',old)
 }finally{fs.writeFileSync(p,fixed)}
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const p of targets){const content=read(p);const r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(r.status,201,p);const result=await r.json();assert.equal(result.sha,blob(content));const dest=path.join('outline-module-evidence/source',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);records.push({path:p,sha:result.sha,bytes:Buffer.byteLength(content),sha256:digest(content)})}
 fs.writeFileSync('outline-module-evidence/objects.json',JSON.stringify({base:BASE,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2));console.log(JSON.stringify(records.map(({path,sha})=>({path,sha}))))
}else throw Error('Expected apply, baseline or publish')
