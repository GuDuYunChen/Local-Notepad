import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
const config=JSON.parse(readFileSync('scripts/wiki-integration.json','utf8'))
const out='wiki-evidence';mkdirSync(out,{recursive:true})
const read=file=>readFileSync(file,'utf8')
const blob=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex')
const records=()=>Object.entries(config.expected).map(([file,sha])=>{
 const content=read(file);assert.equal(blob(content),sha,file)
 return {path:file,sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')}
})
if(process.argv[2]==='apply'){
 for(const [file,sha] of Object.entries(config.baseline))assert.equal(blob(read(file)),sha,file)
 const oldLock=JSON.parse(read('package-lock.json'));assert.equal(oldLock.version,'4.230.1')
 execFileSync('git',['apply','--check','scripts/wiki-integration.patch'],{stdio:'inherit'})
 execFileSync('git',['apply','scripts/wiki-integration.patch'],{stdio:'inherit'})
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'})
 const next=JSON.parse(read('package-lock.json'));assert.equal(next.version,'4.231.0');assert.equal(next.packages[''].version,'4.231.0')
 next.version=oldLock.version;next.packages[''].version=oldLock.packages[''].version;assert.deepEqual(next,oldLock)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.230.1'],{stdio:'inherit'})
 execFileSync('git',['diff','--check'],{stdio:'inherit'})
 writeFileSync(out+'/source-identity.json',JSON.stringify({base:config.base,records:records(),dependencyGraphUnchanged:true,testsExecuted:false},null,2))
}else if(process.argv[2]==='baseline'){
 const file='src/App.jsx',fixed=read(file),old=execFileSync('git',['show',config.base+':'+file],{encoding:'utf8'})
 assert.equal(blob(old),config.baseline[file])
 try{
  writeFileSync(file,old)
  const run=spawnSync('npx',['vitest','run','--root=.','src/App.wikiNavigation.test.jsx','-t','wiki uses the newest|wiki late retrieval','--reporter=json','--outputFile='+out+'/old-app.json'],{encoding:'utf8',timeout:90000})
  writeFileSync(out+'/old-app.log',String(run.stdout||'')+String(run.stderr||''));assert.equal(run.status,1)
  const report=JSON.parse(read(out+'/old-app.json')),failed=report.testResults.flatMap(r=>r.assertionResults).filter(r=>r.status==='failed')
  assert.equal(failed.length,2);assert.equal(report.numFailedTests,2)
  for(const result of failed){const message=result.failureMessages.join('\n');assert.match(message,/目标最新标题/);assert.doesNotMatch(message,/timed out|beforeEach hook/)}
  writeFileSync(out+'/original-App.jsx',old)
 }finally{writeFileSync(file,fixed)}
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const verified=records()
 for(const record of verified){const content=read(record.path),response=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(response.status,201,record.path);assert.equal((await response.json()).sha,record.sha);const dest=path.join(out,'source',record.path);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,content)}
 writeFileSync(out+'/objects.json',JSON.stringify({base:config.base,verifier:process.env.GITHUB_SHA,records:verified,productRefUpdated:false},null,2))
}else if(process.argv[2]==='check'){records();console.log('All candidate file identities unchanged')}
else throw Error('Expected apply, baseline, check or publish')
