import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const BASE='30ba71615682ef9ee06cacca18620ca9efea0576'
const expected={'src/components/Editor/Editor.jsx':'8eccd17824d6d444013835368d3fe8455a43b945','scripts/check-desktop-save.mjs':'1d52d179087f6bea0b169cd667e2b124ec20ff2c','AGENTS.md':'dca7e80adde8b0a9b69daa890b87a678ed7f60cc','package.json':'e0ca633d4a6e2803f2ac5795fa9dab3c2b17d17b','package-lock.json':'37d85551ead2c5466a609aea0ebc3054d8a62d53'}
const targets=[...Object.keys(expected),'src/services/documentSearch.mjs','src/components/Editor/plugins/documentSearchLexical.jsx','src/components/Editor/plugins/SearchPlugin.jsx','src/components/Editor/plugins/DocumentSearch.css','scripts/document-search-cases.mjs','scripts/document-search.node.mjs','src/services/documentSearch.test.js','src/components/Editor/plugins/SearchPlugin.legacy-safety.test.jsx','src/components/Editor/plugins/documentSearchLexical.test.jsx','src/components/Editor/plugins/SearchPlugin.lifecycle.test.jsx','scripts/check-document-search-desktop.mjs','docs/LOCAL_DOCUMENT_SEARCH_2F93.md']
const read=p=>fs.readFileSync(p,'utf8'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Integration anchor mismatch');return s.replace(a,b)}
fs.mkdirSync('document-search-evidence',{recursive:true})
if(process.argv[2]==='apply'){
 const source={};for(const[p,h]of Object.entries(expected)){source[p]=read(p);assert.equal(blob(source[p]),h,p)}
 fs.writeFileSync('src/components/Editor/Editor.jsx',once(source['src/components/Editor/Editor.jsx'],'<SearchPlugin />','<SearchPlugin key={documentId} documentId={documentId} />'))
 const mark='  await verifyBacklinksDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })'
 fs.writeFileSync('scripts/check-desktop-save.mjs',"import { verifyDocumentSearchDesktop } from './check-document-search-desktop.mjs'\n"+once(source['scripts/check-desktop-save.mjs'],mark,mark+'\n  await verifyDocumentSearchDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })'))
 const parts=source['AGENTS.md'].split('\n\n');assert.ok(parts[1].startsWith('Current local module: 2F.92 / 4.225.0'))
 parts[1]='Current local module: 2F.93 / 4.226.0 complete local document search and safe replacement. Read docs/LOCAL_DOCUMENT_SEARCH_2F93.md. Base30ba716 /4.225.0 is accepted in PR2 comment6186029766. Complete Ctrl+F/H entry, original-offset literal Unicode matching, IME/case/word controls, adjacent-formatted-leaf matching, current navigation, reviewed single/bulk replacement, readonly and stale-consent refusal, original undo/redo/save and close/reopen, current-source Windows/package/installation. Never apply a stale search index, replace a readonly editor, use folded-string offsets, hide partial match limits, or bypass original draft/save/quit. No cloud/multidevice or rejected dependency export.'
 fs.writeFileSync('AGENTS.md',parts.join('\n\n'))
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'})
 const old=JSON.parse(source['package-lock.json']),next=JSON.parse(read('package-lock.json'));assert.equal(old.version,'4.225.0');assert.equal(next.version,'4.226.0');assert.equal(next.packages[''].version,'4.226.0');next.version=old.version;next.packages[''].version=old.packages[''].version;assert.deepEqual(next,old)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.225.0'],{stdio:'inherit'});execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'})
 fs.writeFileSync('document-search-evidence/integration.json',JSON.stringify({base:BASE,targets,dependencyGraphUnchanged:true,testsExecuted:false},null,2))
}else if(process.argv[2]==='baseline'){
 const p='src/components/Editor/plugins/SearchPlugin.jsx',fixed=read(p),old=execFileSync('git',['show',BASE+':'+p],{encoding:'utf8'})
 try{fs.writeFileSync(p,old);const run=spawnSync('npx',['vitest','run','--root=.','src/components/Editor/plugins/SearchPlugin.legacy-safety.test.jsx','--reporter=json','--outputFile=document-search-evidence/before.json'],{encoding:'utf8',timeout:60000});fs.writeFileSync('document-search-evidence/before.log',String(run.stdout||'')+String(run.stderr||''));assert.equal(run.status,1);const r=JSON.parse(read('document-search-evidence/before.json'));assert.equal(r.numTotalTests,3);assert.equal(r.numFailedTests,3);for(const t of r.testResults.flatMap(s=>s.assertionResults)){assert.equal(t.status,'failed');assert.ok(!t.failureMessages.join('\n').includes('timed out'))};fs.writeFileSync('document-search-evidence/old-search.txt',old)}finally{fs.writeFileSync(p,fixed)}
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const p of targets){const content=read(p),res=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(res.status,201,p);const value=await res.json();assert.equal(value.sha,blob(content));const dest=path.join('document-search-evidence/source',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);records.push({path:p,sha:value.sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')})}
 fs.writeFileSync('document-search-evidence/objects.json',JSON.stringify({base:BASE,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2))
}else throw Error('Expected apply, baseline or publish')
