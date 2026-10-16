import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const read=p=>fs.readFileSync(p,'utf8'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const config=JSON.parse(read('scripts/recent-notes-integration.json')),out='recent-module-evidence'
fs.mkdirSync(out,{recursive:true})
function verify(){
 return Object.entries(config.expected).map(([p,sha])=>{const s=read(p);assert.equal(blob(s),sha,p);return{path:p,sha,bytes:Buffer.byteLength(s),sha256:createHash('sha256').update(s).digest('hex')}})
}
if(process.argv[2]==='apply'){
 for(const[p,h]of Object.entries(config.original))assert.equal(blob(read(p)),h,p)
 const old=JSON.parse(read('package-lock.json'));assert.equal(old.version,'4.229.0')
 execFileSync('git',['apply','--check','scripts/recent-notes-integration.patch'],{stdio:'inherit'})
 execFileSync('git',['apply','scripts/recent-notes-integration.patch'],{stdio:'inherit'})
 execFileSync('npm',['run','version:minor'],{stdio:'inherit'})
 const lock=JSON.parse(read('package-lock.json'));assert.equal(lock.version,'4.230.0');assert.equal(lock.packages[''].version,'4.230.0');lock.version=old.version;lock.packages[''].version=old.packages[''].version;assert.deepEqual(lock,old)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.229.0'],{stdio:'inherit'})
 execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'})
 execFileSync('git',['diff','--check'],{stdio:'inherit'})
 fs.writeFileSync(out+'/source-identity.json',JSON.stringify({base:config.base,verifier:process.env.GITHUB_SHA,records:verify(),dependencyGraphUnchanged:true,productRefUpdated:false},null,2))
}else if(process.argv[2]==='verify'){
 verify();execFileSync('git',['diff','--check'],{stdio:'inherit'})
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=verify(),tests=JSON.parse(read(out+'/full-ui.json'))
 assert.equal(tests.numFailedTests,0);assert.equal(tests.numPendingTests,0);assert.ok(tests.numTotalTests>=4253)
 for(const row of records){const content=read(row.path);const res=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(res.status,201,row.path);assert.equal((await res.json()).sha,row.sha);const file=path.join(out,'source',row.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content)}
 fs.writeFileSync(out+'/objects.json',JSON.stringify({base:config.base,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2))
}else throw Error('Expected apply, verify or publish')
