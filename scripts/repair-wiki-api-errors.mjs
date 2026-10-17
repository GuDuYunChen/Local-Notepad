import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
import path from 'node:path'
const read=p=>readFileSync(p,'utf8'),out='wiki-api-evidence'
const config=JSON.parse(read('scripts/wiki-api-repair-config.json'))
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
mkdirSync(out,{recursive:true})
const verify=()=>Object.entries(config.expected).map(([file,sha])=>{const content=read(file);assert.equal(blob(content),sha,file);return {path:file,sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')}})
if(process.argv[2]==='baseline'){
 for(const[file,sha]of Object.entries(config.baseline))assert.equal(blob(read(file)),sha,file)
 const r=spawnSync(process.execPath,['--test','--test-reporter=tap','scripts/wiki-api-errors.node.mjs'],{encoding:'utf8',timeout:45000})
 writeFileSync(out+'/before.tap',String(r.stdout||''));writeFileSync(out+'/before.stderr.txt',String(r.stderr||''))
 assert.equal(r.status,1);assert.match(r.stdout,/# tests 12\b/);assert.match(r.stdout,/# pass 8\b/);assert.match(r.stdout,/# fail 4\b/)
 assert.deepEqual([...r.stdout.matchAll(/^not ok (\d+) - /gm)].map(x=>Number(x[1])),[1,2,6,7])
 assert.doesNotMatch(r.stdout,/ERR_MODULE_NOT_FOUND|timed out|hookFailed/)
 for(const file of ['src/services/api.js','src/services/wikiNavigation.mjs'])writeFileSync(path.join(out,path.basename(file)+'.before.txt'),read(file))
 console.log('Real API decoder negative control: 4 exact failures / 8 passes.')
}else if(process.argv[2]==='apply'){
 for(const[file,sha]of Object.entries(config.baseline))assert.equal(blob(read(file)),sha,file)
 const oldLock=JSON.parse(read('package-lock.json'));assert.equal(oldLock.version,'4.231.0')
 for(const[file,[before,after]]of Object.entries(config.changes)){
  const text=read(file);assert.equal(text.split(before).length,2,file)
  let next=text.replace(before,after);if(file==='docs/LOCAL_WIKI_NAVIGATION_2F98.md')next+=config.notes
  writeFileSync(file,next)
 }
 execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
 const lock=JSON.parse(read('package-lock.json'));assert.equal(lock.version,'4.231.1');assert.equal(lock.packages[''].version,'4.231.1')
 lock.version=oldLock.version;lock.packages[''].version=oldLock.packages[''].version;assert.deepEqual(lock,oldLock)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.231.0'],{stdio:'inherit'})
 execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'})
 execFileSync('git',['diff','--check'],{stdio:'inherit'})
 writeFileSync(out+'/source-identity.json',JSON.stringify({base:config.base,records:verify(),dependencyGraphUnchanged:true,testsExecuted:false},null,2)+'\n')
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=verify()
 for(const r of records){const content=read(r.path),response=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(response.status,201,r.path);assert.equal((await response.json()).sha,r.sha);const dest=path.join(out,'source',r.path);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,content)}
 writeFileSync(out+'/objects.json',JSON.stringify({base:config.base,verifier:process.env.GITHUB_SHA,records,productRefUpdated:false},null,2)+'\n')
}else if(process.argv[2]==='check'){verify();console.log('Exact 10 repaired product objects unchanged')}
else throw Error('Expected baseline, apply, check or publish')
