import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
const blob=b=>createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex')
const testFile='src/components/TemplateCreationHandoff.test.jsx'
const target='src/components/FileList.jsx'
if(process.argv[2]==='baseline'){
 assert.equal(blob(fs.readFileSync(target)),'4078bef081d1013a917f926b15b46b44a1980a14')
 const report='template-module-evidence/template-handoff-before.json'
 const result=spawnSync('npx',['vitest','run','--root=.',testFile,'--reporter=json','--outputFile='+report],{encoding:'utf8',timeout:120000})
 fs.writeFileSync('template-module-evidence/template-handoff-before.log',(result.stdout||'')+'\n'+(result.stderr||''))
 assert.notEqual(result.status,0,'The original navigation error must reproduce')
 const data=JSON.parse(fs.readFileSync(report,'utf8'));assert.equal(data.numTotalTests,1);assert.equal(data.numFailedTests,1)
 const failure=data.testResults.flatMap(r=>r.assertionResults).find(r=>r.status==='failed')
 assert.ok(failure.fullName.includes('confirmed template handoff keeps the new note selected'))
 assert.match(failure.failureMessages.join('\n'),/old-note/);assert.match(failure.failureMessages.join('\n'),/new-note/)
 console.log('Original real FileList handoff reproduced old-note instead of new-note.')
}else if(process.argv[2]==='apply'){
 let source=fs.readFileSync(target,'utf8');assert.equal(blob(source),'4078bef081d1013a917f926b15b46b44a1980a14')
 const before=`          setItems(previous => { const next = [item, ...previous.filter(x => x.id !== item.id)]; onItemsChanged?.(next); return next })
          if (item.parent_id) setExpanded(previous => new Set([...previous, item.parent_id]))
          setShowTemplate(false); onSelect(item); void load()`
 const after=`          // Publish metadata before selection. A deferred updater or an old
          // load callback must not replace the newly selected note's identity.
          const next = [item, ...items.filter(x => x.id !== item.id)]
          setItems(next); onItemsChanged?.(next)
          if (item.parent_id) setExpanded(previous => new Set([...previous, item.parent_id]))
          setShowTemplate(false); onSelect(item)`
 assert.equal(source.split(before).length,2);fs.writeFileSync(target,source.replace(before,after))
 fs.appendFileSync('docs/LOCAL_TEMPLATE_LIBRARY_2F89.md','\n## Original list-to-editor handoff\n\nWindows b1dc870 passed template create/edit but the copied note was not kept selected. The old asynchronous list refresh called an App metadata callback captured for the prior note after selecting the copy, restoring the old identity. The new handoff synchronously publishes the updated list before selecting the validated copy, with no trailing stale load. Original App/save/navigation guards remain unchanged. A real FileList/React-parent regression reproduces old-note selection before the fix and verifies the new identity after all callbacks settle; Windows still uses actual clicks and original editor.\n')
}else if(process.argv[2]==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-history-2f87')
 const index=JSON.parse(fs.readFileSync('template-module-evidence/objects.json','utf8'));assert.equal(index.records.length,20);assert.ok(!index.records.some(r=>r.path===testFile))
 const content=fs.readFileSync(testFile,'utf8'),response=await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})})
 assert.equal(response.status,201);const result=await response.json();assert.equal(result.sha,blob(content))
 const dest=path.join('template-module-evidence','source',testFile);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content)
 index.records.push({path:testFile,sha:result.sha,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')})
 fs.writeFileSync('template-module-evidence/objects.json',JSON.stringify(index,null,2));console.log('Verified21-source manifest completed.')
}else throw Error('Expected baseline, apply or publish')
