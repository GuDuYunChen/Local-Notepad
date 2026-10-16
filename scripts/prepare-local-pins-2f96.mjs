import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const read=p=>fs.readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex')
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const config=JSON.parse(read('scripts/local-pins-prepare.json')),out='pin-module-evidence'
fs.mkdirSync(out,{recursive:true})
if(process.argv[2]==='apply'){
 for(const[p,h]of Object.entries(config.files))assert.equal(blob(read(p)),h,p)
 const old=JSON.parse(read('package-lock.json'));assert.equal(old.version,'4.228.0')
 execFileSync('git',['apply','--check','scripts/local-pins-integration.patch'],{stdio:'inherit'})
 execFileSync('git',['apply','scripts/local-pins-integration.patch'],{stdio:'inherit'})
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'})
 const next=JSON.parse(read('package-lock.json'));assert.equal(next.version,'4.229.0');assert.equal(next.packages[''].version,'4.229.0');next.version=old.version;next.packages[''].version=old.packages[''].version;assert.deepEqual(next,old)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.228.0'],{stdio:'inherit'})
 execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'})
 execFileSync('git',['diff','--check'],{stdio:'inherit'})
 fs.writeFileSync(out+'/integration.json',JSON.stringify({base:config.base,paths:config.paths,dependencyGraphUnchanged:true,testsExecuted:false},null,2))
}else if(process.argv[2]==='baseline'){
 const file='src/components/FileList.jsx',logic='server/internal/logic/file.go',fixed=read(file),fixedLogic=read(logic)
 try{
  const old=execFileSync('git',['show',config.base+':'+file],{encoding:'utf8'});assert.equal(blob(old),config.files[file]);fs.writeFileSync(file,old);fs.writeFileSync(out+'/original-FileList.txt',old)
  const ui=spawnSync('npx',['vitest','run','--root=.','src/components/FileListPin.legacy-safety.test.jsx','--reporter=json','--outputFile='+out+'/legacy-ui.json'],{encoding:'utf8',timeout:120000})
  fs.writeFileSync(out+'/legacy-ui.log',String(ui.stdout||'')+String(ui.stderr||''));assert.equal(ui.status,1,'Expected actual old UI assertions to fail')
  const result=JSON.parse(read(out+'/legacy-ui.json'));assert.equal(result.numTotalTests,2);assert.equal(result.numFailedTests,2)
  for(const r of result.testResults.flatMap(t=>t.assertionResults)){assert.equal(r.status,'failed');assert.ok(!r.failureMessages.join('\n').includes('timed out'));assert.match(r.failureMessages.join('\n'),/AssertionError/)}
  fs.writeFileSync(file,fixed)
  const oldLogic=execFileSync('git',['show',config.base+':'+logic],{encoding:'utf8'});assert.equal(blob(oldLogic),config.files[logic]);fs.writeFileSync(logic,oldLogic);fs.writeFileSync(out+'/original-file-logic.txt',oldLogic)
  const go=spawnSync('go',['-C','server','test','-json','./internal/logic','-run','^TestPinOnlyUpdateMustNeverWriteBodyOrEditedTime$','-count=1'],{encoding:'utf8',timeout:180000})
  fs.writeFileSync(out+'/legacy-go.jsonl',String(go.stdout||''));fs.writeFileSync(out+'/legacy-go-stderr.txt',String(go.stderr||''));assert.equal(go.status,1)
  const events=go.stdout.split('\n').filter(Boolean).map(x=>JSON.parse(x));assert.ok(events.some(x=>x.Action==='fail'&&x.Test==='TestPinOnlyUpdateMustNeverWriteBodyOrEditedTime'));assert.ok(events.some(x=>x.Output?.includes('pin-only update attempted unrelated columns')))
 }finally{fs.writeFileSync(file,fixed);fs.writeFileSync(logic,fixedLogic)}
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const p of config.paths){const content=read(p);const r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(r.status,201,p);const v=await r.json();assert.equal(v.sha,blob(content));const dest=path.join(out,'source',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);records.push({path:p,sha:v.sha,bytes:Buffer.byteLength(content),sha256:hash(content)})}
 fs.writeFileSync(out+'/objects.json',JSON.stringify({base:config.base,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2));console.log(JSON.stringify(records.map(({path,sha})=>({path,sha}))))
}else throw Error('Expected apply, baseline or publish')
