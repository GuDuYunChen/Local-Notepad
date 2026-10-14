import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const BASE='89b99b57bf021315752e6809ec684a5d8d0dc3b0'
const read=p=>fs.readFileSync(p,'utf8')
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const sha256=s=>createHash('sha256').update(s).digest('hex')
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unexpected integration anchor');return s.replace(a,b)}
const expected={
 'package.json':'e283a823c50de051e2976d66a80b195ffa3b36cf',
 'package-lock.json':'cfb5e9dee520f17a2a2b0bf8c1100e8ba9d842db',
 'AGENTS.md':'571d633534870bb3a0c72f590798c7092dbd5188',
 'src/components/InspectorPanel.jsx':'20065ba8fed583f5dbbb4503bfec87f6fe2930fd',
 'server/internal/controller/tag.go':'4d01ffc3e8a22e784fac2ae2ba9e1b9be5c20780',
 'scripts/check-desktop-save.mjs':'fcd52398e3eecf23dde1c3d08552c3a2d615146b',
}
const targets=[...Object.keys(expected),'src/components/TagSelector.jsx','src/components/TagSelector.css','src/components/TagSelector.test.jsx','src/components/TagSelector.legacy-safety.test.jsx','src/services/noteTags.mjs','src/services/noteTags.test.js','server/internal/dao/note_tags.go','server/internal/dao/note_tags_test.go','server/internal/controller/note_tags.go','scripts/note-tags-cases.mjs','scripts/note-tags.node.mjs','scripts/check-note-tags-desktop.mjs','docs/LOCAL_NOTE_TAGS_2F91.md']
fs.mkdirSync('tag-module-evidence',{recursive:true})
if(process.argv[2]==='apply'){
 const before={};for(const[p,h]of Object.entries(expected)){before[p]=read(p);assert.equal(blob(before[p]),h,p)}
 let s=before['src/components/InspectorPanel.jsx'];s=once(s,"import React, { useEffect, useState }","import React, { useState }");s=once(s,"import { tagApi } from '~/services/tagApi'\n",'');s=once(s,'  const [tags, setTags] = useState([])\n','')
 const a=s.indexOf('  useEffect(() => {\n    let alive = true'),b=s.indexOf('\n\n  if (!file)',a);assert.ok(a>0&&b>a);s=s.slice(0,a)+s.slice(b)
 s=once(s,'<TagSelector fileId={file.id} tags={tags} onChange={setTags} />','<TagSelector key={file.id} fileId={file.id} />');fs.writeFileSync('src/components/InspectorPanel.jsx',s)
 s=before['server/internal/controller/tag.go'];const registration='func (c *TagController) Register(group *ghttp.RouterGroup) {';fs.writeFileSync('server/internal/controller/tag.go',once(s,registration,registration+'\n\tc.RegisterNoteTags(group)'))
 s=before['scripts/check-desktop-save.mjs'];const native='  await verifyQuickSwitcherDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })';s="import { verifyNoteTagsDesktop } from './check-note-tags-desktop.mjs'\n"+once(s,native,native+'\n  await verifyNoteTagsDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })');fs.writeFileSync('scripts/check-desktop-save.mjs',s)
 const parts=before['AGENTS.md'].split('\n\n');assert.ok(parts[1].startsWith('Current local module: 2F.90 / 4.223.0'))
 parts[1]='Current local module: 2F.91 / 4.224.0 complete local note tag organization. Read docs/LOCAL_NOTE_TAGS_2F91.md. Base89b99b5 /4.223.0 is accepted in PR2 comment6171834319; do not repeat it. Complete properties entry, current-note scoped reads, literal/IME search, atomic create-or-reuse and attach, confirmed one-note removal, persisted unconfirmed-operation recovery and current-state-only reconciliation, original editor save, and current-source Windows/package/installation acceptance. Do not silently turn errors into empty tags, replay timed-out writes, apply late callbacks to another note, delete shared tags or change note bodies/save/quit policies. No cloud/multidevice or rejected source/dependency export.';fs.writeFileSync('AGENTS.md',parts.join('\n\n'))
 execFileSync('gofmt',['-w','server/internal/dao/note_tags.go','server/internal/dao/note_tags_test.go','server/internal/controller/note_tags.go','server/internal/controller/tag.go'],{stdio:'inherit'})
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'})
 const old=JSON.parse(before['package-lock.json']),next=JSON.parse(read('package-lock.json'));assert.equal(old.version,'4.223.0');assert.equal(next.version,'4.224.0');assert.equal(next.packages[''].version,'4.224.0');next.version=old.version;next.packages[''].version=old.packages[''].version;assert.deepEqual(next,old)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.223.0'],{stdio:'inherit'});execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'});execFileSync('git',['diff','--check'],{stdio:'inherit'})
 fs.writeFileSync('tag-module-evidence/integration.json',JSON.stringify({base:BASE,targets,dependencyGraphUnchanged:true,testsExecuted:false},null,2))
}else if(process.argv[2]==='baseline'){
 const p='src/components/TagSelector.jsx',fixed=read(p),old=execFileSync('git',['show',BASE+':'+p],{encoding:'utf8'})
 try{
  fs.writeFileSync(p,old)
  const r=spawnSync('npx',['vitest','run','--root=.','src/components/TagSelector.legacy-safety.test.jsx','--reporter=json','--outputFile=tag-module-evidence/before.json'],{encoding:'utf8',timeout:60000})
  fs.writeFileSync('tag-module-evidence/before.log',String(r.stdout||'')+String(r.stderr||''));assert.equal(r.status,1)
  const result=JSON.parse(read('tag-module-evidence/before.json'));assert.equal(result.numTotalTests,3);assert.equal(result.numFailedTests,3)
  const failed=result.testResults.flatMap(t=>t.assertionResults);assert.equal(failed.length,3)
  for(const t of failed){assert.equal(t.status,'failed');assert.ok(!t.failureMessages.join('\n').includes('timed out'))}
  fs.writeFileSync('tag-module-evidence/old-TagSelector.txt',old)
 }finally{fs.writeFileSync(p,fixed)}
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const p of targets){const content=read(p),res=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(res.status,201,p);const result=await res.json();assert.equal(result.sha,blob(content));const dest=path.join('tag-module-evidence/source',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);records.push({path:p,sha:result.sha,bytes:Buffer.byteLength(content),sha256:sha256(content)})}
 fs.writeFileSync('tag-module-evidence/objects.json',JSON.stringify({base:BASE,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2));console.log(JSON.stringify(records.map(({path,sha})=>({path,sha}))))
}else throw Error('Expected apply, baseline or publish')
