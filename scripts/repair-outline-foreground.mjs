import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
const BASE='3761c641cc2b0f3d3ff46f2dd6ac8a576c28db1f'
const read=p=>fs.readFileSync(p,'utf8')
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Exact source anchor mismatch');return s.replace(a,b)}
const test='src/components/Editor/plugins/OutlineSearch.integration.test.jsx'
const expected={
 'src/components/Editor/plugins/DocumentOutlinePlugin.jsx':'45bf9e78caadf0ed82fb2552d20601bcd50e18d9',
 'src/components/Editor/plugins/DocumentOutline.css':'e823b60e420f975fe82cbee3a86d61945a98eb45',
 'scripts/check-document-outline-desktop.mjs':'f55fe50ae0708d253c605c65a1524e044df2dc74',
 'AGENTS.md':'83639e6a05ffaa7b670155199ca079e1de4d00bb',
 'docs/LOCAL_DOCUMENT_OUTLINE_2F94.md':'b8b65999f978c77bf999b6f6aea9360e7c79eac9',
 'package.json':'d3d7adebb2cae1497fb3358b4ae31d53a0c9b339',
 'package-lock.json':'60c8f23abfe5586eb81e842d0e4cc3553b6b287f',
}
fs.mkdirSync('outline-foreground-evidence',{recursive:true})
if(process.argv[2]==='baseline'){
 const run=spawnSync('npx',['vitest','run','--root=.',test,'--reporter=json','--outputFile=outline-foreground-evidence/before.json'],{encoding:'utf8',timeout:60000})
 fs.writeFileSync('outline-foreground-evidence/before.log',String(run.stdout||'')+String(run.stderr||''))
 assert.equal(run.status,1)
 const r=JSON.parse(read('outline-foreground-evidence/before.json'));assert.equal(r.numTotalTests,6);assert.equal(r.numFailedTests,5)
 const failed=r.testResults.flatMap(t=>t.assertionResults).filter(t=>t.status==='failed')
 assert.equal(failed.length,5);for(const t of failed)assert.ok(!t.failureMessages.join('\n').includes('timed out'))
}else if(process.argv[2]==='apply'){
 const original={};for(const[p,h]of Object.entries(expected)){original[p]=read(p);assert.equal(blob(original[p]),h,p)}
 let s=original['src/components/Editor/plugins/DocumentOutlinePlugin.jsx']
 const old="    const keyboard=e=>{if(e.isComposing||e.keyCode===229||composing.current)return;if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();toggle()}}"
 const next=`    // The current search has foreground ownership. Leave the permanent outline
    // entry available underneath it and cancel old outline navigation/clipboard work.
    const yieldToSearch=e=>{
      if(e.detail?.documentId&&e.detail.documentId!==documentId)return
      if(ready()&&state.current.open)close()
    }
    const keyboard=e=>{
      if(e.isComposing||e.keyCode===229||composing.current)return
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&['f','h'].includes(e.key.toLowerCase())&&!e.target?.closest?.('[role="dialog"]'))yieldToSearch(e)
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();toggle()}
    }`
 s=once(s,old,next)
 s=once(s,"window.addEventListener('editor:toggle-outline',toggle);","window.addEventListener('editor:toggle-outline',toggle);window.addEventListener('editor:open-search',yieldToSearch);")
 s=once(s,"window.removeEventListener('editor:toggle-outline',toggle);","window.removeEventListener('editor:toggle-outline',toggle);window.removeEventListener('editor:open-search',yieldToSearch);")
 fs.writeFileSync('src/components/Editor/plugins/DocumentOutlinePlugin.jsx',s)
 fs.writeFileSync('src/components/Editor/plugins/DocumentOutline.css',original['src/components/Editor/plugins/DocumentOutline.css']+'\n/* A closed navigation trigger must never cover the active find/replace controls.\n   Explicitly opened outline retains its original higher layer. */\n.editor-shell > .local-outline:not(.open) { z-index:49; }\n')
 s=original['scripts/check-document-outline-desktop.mjs']
 const anchor="  await action('关闭文档目录');await openNote(multi,'outline94-original-body');await action('文档目录');await has('5 个标题')"
 const replacement=`  await key('f',70,2)
  await until(()=>evaluate("!!document.querySelector('.document-search') && !document.querySelector('.local-outline.open')"),'Search must own foreground without outline covering it')
  assert.equal(await evaluate("Number(getComputedStyle(document.querySelector('.local-outline')).zIndex)<Number(getComputedStyle(document.querySelector('.document-search')).zIndex)"),true)
  assert.equal((await api('/api/files/'+single.id)).content,single.content)
  await action('关闭文内查找','.document-search');await action('文档目录');await has('唯一标题94')
  mark('search-foreground-handoff-preserves-outline-and-body')
`+anchor
 fs.writeFileSync('scripts/check-document-outline-desktop.mjs',once(s,anchor,replacement))
 fs.writeFileSync('AGENTS.md',once(original['AGENTS.md'],'2F.94 /4.227.0','2F.94 /4.227.1'))
 let doc=once(original['docs/LOCAL_DOCUMENT_OUTLINE_2F94.md'],'2F.94 /4.227.0','2F.94 /4.227.1')
 doc+='\n## Foreground integration repair / 4.227.1\n\nCurrent-source Windows artifact11962670690 failed before outline acceptance because the new permanent single-heading outline trigger at layer55 covered the find panel next-match button at layer50. Complete original CSS and actual Chromium pointer coordinates reproduced the intercepted1008px light/dark clicks; at600px baseline was already reachable. Closed outline now sits at49, while an explicitly opened outline keeps its original layer55. Ctrl+F/H and current-note open-search yield the open outline, cancel its pending navigation and preserve existing search query/options. IME, other-document and unrelated shortcuts are ignored. No toast hiding, synthetic click or relaxed assertion. Six real Lexical/React/style contracts and the additional native search-to-outline handoff retain the earlier12 native checkpoints. Same module, standard patch4.227.1, original save/backend/installer/schema and679 dependency nodes unchanged. Original failure remains evidence; current-HEAD native and installation still required.\n'
 fs.writeFileSync('docs/LOCAL_DOCUMENT_OUTLINE_2F94.md',doc)
 const oldLock=JSON.parse(original['package-lock.json']);execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
 const lock=JSON.parse(read('package-lock.json'));assert.equal(lock.version,'4.227.1');assert.equal(lock.packages[''].version,'4.227.1');lock.version=oldLock.version;lock.packages[''].version=oldLock.packages[''].version;assert.deepEqual(lock,oldLock)
 execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.227.0'],{stdio:'inherit'});execFileSync('node',['scripts/verify-dependency-lock.mjs'],{stdio:'inherit'});execFileSync('git',['diff','--check'],{stdio:'inherit'})
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const records=[]
 for(const p of [...Object.keys(expected),test]){
  const content=read(p);const r=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});assert.equal(r.status,201,p)
  const value=await r.json();assert.equal(value.sha,blob(content));const dest=path.join('outline-foreground-evidence/source',p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content)
  records.push({path:p,sha:value.sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')})
 }
 fs.writeFileSync('outline-foreground-evidence/objects.json',JSON.stringify({base:BASE,verifier:process.env.GITHUB_SHA,productRefUpdated:false,records},null,2))
}else throw Error('Expected baseline, apply or publish')
