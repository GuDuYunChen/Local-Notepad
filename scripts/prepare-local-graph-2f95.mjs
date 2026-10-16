import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const BASE='996cb1cf330530292a8baa1723585e0990d94265'
const read=p=>fs.readFileSync(p,'utf8'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex'),sha256=s=>createHash('sha256').update(s).digest('hex')
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unexpected exact integration anchor');return s.replace(a,b)}
const expected={
 'AGENTS.md':'e6ca52892cbbe239bde3e243dc3adde61e023692',
 'package.json':'a168b1b9d41880c18e392cba799d5cab8ada2226',
 'package-lock.json':'d5865b5c469e3b33f864ab1f37bfb33d4a12c155',
 'server/internal/controller/file.go':'2f484ee0e0e81358f9e02e8a9c6ad14c12b875d1',
 'scripts/check-desktop-save.mjs':'808b95a2b324efd3264ce8ce59c985694028e26a',
}
const targets=[...Object.keys(expected),'src/components/GraphPanel.jsx','src/components/GraphPanel.css','src/components/LocalGraphCanvas.jsx','src/services/localGraph.mjs','src/services/localGraph.test.js','scripts/local-graph-cases.mjs','scripts/local-graph.node.mjs','src/components/GraphPanel.test.jsx','src/components/GraphPanel.legacy-safety.test.jsx','src/components/LocalGraphCanvas.test.jsx','server/internal/dao/local_graph.go','server/internal/dao/local_graph_test.go','server/internal/controller/local_graph.go','scripts/check-local-graph-desktop.mjs','docs/LOCAL_KNOWLEDGE_GRAPH_2F95.md']
fs.mkdirSync('graph-module-evidence',{recursive:true})
if(process.argv[2]==='apply'){
 const old={};for(const[p,sha]of Object.entries(expected)){old[p]=read(p);assert.equal(blob(old[p]),sha,p)}
 fs.writeFileSync('server/internal/controller/file.go',once(old['server/internal/controller/file.go'],'\tgroup.GET("/graph", c.Graph)','\tgroup.GET("/graph", c.Graph)\n\tgroup.GET("/local-graph", c.LocalGraph)'))
 const line='  await verifyDocumentOutlineDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })'
 fs.writeFileSync('scripts/check-desktop-save.mjs',"import { verifyLocalGraphDesktop } from './check-local-graph-desktop.mjs'\n"+once(old['scripts/check-desktop-save.mjs'],line,line+'\n  await verifyLocalGraphDesktop({ evaluate, click, cdp, until, api, out, noteIDs: [a.id, b.id] })'))
 const paragraphs=old['AGENTS.md'].split('\n\n');assert.ok(paragraphs[1].startsWith('Current local module: 2F.94 /4.227.1'))
 paragraphs[1]='Current local module: 2F.95 /4.228.0 complete local knowledge graph exploration and safe note opening. Read docs/LOCAL_KNOWLEDGE_GRAPH_2F95.md. Accepted base996cb1c /4.227.1 is PR2 comment6194308839. Complete original graph entry, consistent bounded metadata/link snapshot, real errors/empty/stop/retry, literal/IME filters, isolated and linked notes, accessible selection/relations and one-hop focus, real zoom/reset, latest target identity and original save/discard/cancel guard, close/reopen and current-source Windows/package/installation. Graph views never save bodies, rewrite indexes, drop partial results into success or open from stale metadata. Preserve all previous local modules/save/receipt/draft/quit, schema14 and locked dependencies. No cloud/multidevice or rejected source/dependency export.'
 fs.writeFileSync('AGENTS.md',paragraphs.join('\n\n'))
 execFileSync('gofmt',['-w','server/internal/dao/local_graph.go','server/internal/dao/local_graph_test.go','server/internal/controller/local_graph.go','server/internal/controller/file.go'],{stdio:'inherit'})
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'})
 const original=JSON.parse(old['package-lock.json']),next=JSON.parse(read('package-lock.json'));assert.equal(original.version,'4.227.1');assert.equal(next.version,'4.228.0');assert.equal(next.packages[''].version,'4.228.0');next.version=original.version;next.packages[''].version=original.packages[''].version;assert.deepEqual(next,original)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.227.1'],{stdio:'inherit'});execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'});execFileSync('git',['diff','--check'],{stdio:'inherit'})
 fs.writeFileSync('graph-module-evidence/integration.json',JSON.stringify({base:BASE,targets,dependencyGraphUnchanged:true,testsExecuted:false},null,2))
}else if(process.argv[2]==='baseline'){
 const file='src/components/GraphPanel.jsx',fixed=read(file),old=execFileSync('git',['show',BASE+':'+file],{encoding:'utf8'})
 assert.equal(blob(old),'f6e071fddab6058a3605595102c045c9478ba839')
 try{
  fs.writeFileSync(file,old)
  const r=spawnSync('npx',['vitest','run','--root=.','src/components/GraphPanel.legacy-safety.test.jsx','--reporter=json','--outputFile=graph-module-evidence/before.json'],{encoding:'utf8',timeout:60000})
  fs.writeFileSync('graph-module-evidence/before.log',String(r.stdout||'')+String(r.stderr||''));assert.equal(r.status,1)
  const result=JSON.parse(read('graph-module-evidence/before.json'));assert.equal(result.numTotalTests,3);assert.equal(result.numFailedTests,3)
  const tests=result.testResults.flatMap(t=>t.assertionResults);assert.equal(tests.length,3)
  for(const t of tests){assert.equal(t.status,'failed');assert.ok(!t.failureMessages.join('\n').includes('timed out'))}
  fs.writeFileSync('graph-module-evidence/original-graph.txt',old)
 }finally{fs.writeFileSync(file,fixed)}
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const file of targets){const content=read(file);const response=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(response.status,201,file);const result=await response.json();assert.equal(result.sha,blob(content));const dest=path.join('graph-module-evidence/source',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);records.push({path:file,sha:result.sha,bytes:Buffer.byteLength(content),sha256:sha256(content)})}
 fs.writeFileSync('graph-module-evidence/objects.json',JSON.stringify({base:BASE,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2));console.log(JSON.stringify(records.map(({path,sha})=>({path,sha}))))
}else throw Error('Expected apply, baseline or publish')
