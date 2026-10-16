import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const read=p=>fs.readFileSync(p,'utf8'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const config=JSON.parse(read('scripts/recent-reopen-integration.json')),out='recent-reopen-evidence'
fs.mkdirSync(out,{recursive:true})
const records=()=>Object.entries(config.expected).map(([p,sha])=>{const s=read(p);assert.equal(blob(s),sha,p);return{path:p,sha,bytes:Buffer.byteLength(s),sha256:createHash('sha256').update(s).digest('hex')}})
if(process.argv[2]==='apply'){
 for(const[p,h]of Object.entries(config.original))assert.equal(blob(read(p)),h,p)
 const old=JSON.parse(read('package-lock.json'));assert.equal(old.version,'4.230.0')
 execFileSync('git',['apply','--check','scripts/recent-reopen-integration.patch'],{stdio:'inherit'});execFileSync('git',['apply','scripts/recent-reopen-integration.patch'],{stdio:'inherit'})
 execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
 const lock=JSON.parse(read('package-lock.json'));assert.equal(lock.version,'4.230.1');assert.equal(lock.packages[''].version,'4.230.1');lock.version=old.version;lock.packages[''].version=old.packages[''].version;assert.deepEqual(lock,old)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.230.0'],{stdio:'inherit'});execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'});execFileSync('git',['diff','--check'],{stdio:'inherit'})
 fs.writeFileSync(out+'/source-identity.json',JSON.stringify({base:config.base,verifier:process.env.GITHUB_SHA,records:records(),dependencyGraphUnchanged:true},null,2))
}else if(process.argv[2]==='baseline'){
 const files=['src/App.jsx','src/hooks/useGuardedNoteOpener.js','src/components/RecentNotesPanel.jsx'],fixed=Object.fromEntries(files.map(p=>[p,read(p)]))
 try{
  for(const p of files){const original=execFileSync('git',['show',config.base+':'+p],{encoding:'utf8'});assert.equal(blob(original),config.original[p]);fs.writeFileSync(p,original)}
  const node=spawnSync('node',['--test','scripts/recent-reopen.node.mjs'],{encoding:'utf8',timeout:30000});fs.writeFileSync(out+'/before-node.tap',String(node.stdout||'')+String(node.stderr||''));assert.equal(node.status,1);assert.match(node.stdout,/# tests 8/);assert.match(node.stdout,/# fail 1/);assert.match(node.stdout,/not ok 1 - explicit clean same-note/)
  const ui=spawnSync('npx',['vitest','run','--root=.','src/App.recentNotes.test.jsx','--reporter=json','--outputFile='+out+'/before-ui.json'],{encoding:'utf8',timeout:90000});fs.writeFileSync(out+'/before-ui.log',String(ui.stdout||'')+String(ui.stderr||''));assert.equal(ui.status,1)
  const report=JSON.parse(read(out+'/before-ui.json'));assert.equal(report.numTotalTests,6);assert.equal(report.numFailedTests,2);assert.equal(report.numPassedTests,4)
  const failed=report.testResults.flatMap(x=>x.assertionResults).filter(x=>x.status==='failed');assert.equal(failed.length,2)
  for(const t of failed){assert.match(t.fullName,/real App recent-panel reopening|explicit clean same-ID return/);assert.ok(!t.failureMessages.join('\n').includes('timed out'))}
 }finally{for(const[p,s]of Object.entries(fixed))fs.writeFileSync(p,s)}
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const result=records(),ui=JSON.parse(read(out+'/full-ui.json'));assert.equal(ui.numFailedTests,0);assert.equal(ui.numPendingTests,0);assert.ok(ui.numTotalTests>=4319)
 for(const r of result){const content=read(r.path);const response=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(response.status,201);assert.equal((await response.json()).sha,r.sha);const p=path.join(out,'source',r.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content)}
 fs.writeFileSync(out+'/objects.json',JSON.stringify({base:config.base,verifier:process.env.GITHUB_SHA,records:result,productRefUpdated:false},null,2))
}else throw Error('Expected apply, baseline or publish')
