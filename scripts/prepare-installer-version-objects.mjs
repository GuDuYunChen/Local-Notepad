import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const hash = b => createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')
const files = ['package.json','package-lock.json']
const before = files.map(f => readFileSync(f))
assert.equal(hash(before[0]),'0d467513a70bba89e4703001b55b68ff754e8f9e')
assert.equal(hash(before[1]),'df80502240ff73700df26976b053c25d2839bd44')
execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.219.0'],{stdio:'inherit'})
execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'})
const expected=['075b963750dbaf9cf0a5323dcaf6f298c94aee85','d7d71adacdad04f80abb94b8fca80417bed7505c']
const out='test-results/installer-version';mkdirSync(out,{recursive:true});const result=[]
for(let i=0;i<files.length;i++) {
 const b=readFileSync(files[i]);assert.equal(hash(b),expected[i]);
 assert.deepEqual(b,Buffer.from(before[i].toString().replaceAll('"version": "4.219.0"','"version": "4.219.1"')))
 const r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content:b.toString(),encoding:'utf-8'}),signal:AbortSignal.timeout(15000)})
 assert.equal(r.status,201);const object=await r.json();assert.equal(object.sha,expected[i]);
 writeFileSync(out+'/'+files[i],b);result.push({path:files[i],sha:object.sha,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})
}
writeFileSync(out+'/objects.json',JSON.stringify({version:'4.219.1',base:'191439e04ddbf6b4423194d2978ae72da926df3c',objects:result,branchModified:false},null,2))
