import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Native drag delivery to the production batch path; isolated fixture files.
export async function verifyOfflineBatchDropDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, second }) {
  const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id))), list=await api('/api/files'), url=await evaluate('location.href')
  await click('[data-offline-pair] > summary');await click('[data-offline-batch-toggle]')
  const drag=async(files,items=[])=>{
    const point=await evaluate("(()=>{const n=document.querySelector('[data-offline-batch-drop-label]');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
    await cdp.send('Page.bringToFront')
    for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,...point,data:{files,items,dragOperationsMask:1}})
  }
  const ready=()=>evaluate("['a','b'].every(s=>document.querySelector('[data-offline-side='+s+'] [data-offline-state]').getAttribute('data-offline-state')==='ready') && document.querySelector('[data-offline-batch-reading]').getAttribute('data-offline-batch-reading')==='false'")
  const rows=()=>evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>[+r.cells[1].textContent,+r.cells[2].textContent,+r.cells[3].textContent])")
  const status=()=>evaluate("document.querySelector('[data-offline-batch-drop-status]').getAttribute('data-offline-batch-drop-status')")
  const values=r=>[r.records,r.recordBytes,r.attachmentBytes,r.baseItems,...r.kinds.flatMap(k=>[k.records,k.recordBytes])]
  const a=values(JSON.parse(readFileSync(filename,'utf8'))),b=values(JSON.parse(readFileSync(second,'utf8')))
  const expected=a.map((n,i)=>[n,b[i],b[i]-n])
  await drag([filename,second]);await until(ready,'Dropped batch was not ready');assert.equal((await rows()).length,0)
  await click('[data-offline-compare]');const forward=await rows();assert.deepEqual(forward,expected)
  await drag([filename]);await until(async()=>await status()==='batch-count','Single-file refusal missing');assert.deepEqual(await rows(),expected)
  await drag([filename,second,filename]);await until(async()=>await status()==='batch-count','Three-file refusal missing');assert.deepEqual(await rows(),expected)
  await drag([],[{mimeType:'text/plain',data:'not a report'}]);await until(async()=>await status()==='batch-file-required','Text-hover refusal missing');assert.deepEqual(await rows(),expected)
  const invalid=path.join(out,'batch-drop-invalid.json');writeFileSync(invalid,'{')
  await drag([filename,invalid]);await until(()=>evaluate("document.querySelector('[data-offline-batch]').innerText.includes('未采用任何新报告')"),'Invalid batch was not refused')
  assert.equal((await rows()).length,0);assert.equal(await ready(),true)
  await click('[data-offline-compare]');assert.deepEqual(await rows(),expected)
  await drag([second,filename]);await until(()=>evaluate("document.querySelector('[data-offline-batch]').innerText.includes('两份报告已一起替换')"),'Reverse dropped batch incomplete')
  assert.equal((await rows()).length,0);await click('[data-offline-compare]');const reverse=await rows();assert.deepEqual(reverse,b.map((n,i)=>[n,a[i],a[i]-n]))
  assert.equal(await evaluate("document.querySelectorAll('[data-offline-export] button').length"),3)
  await evaluate("document.querySelector('[data-offline-batch-drop]').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');writeFileSync(path.join(out,'offline-batch-drop.png'),png)
  await click('[data-offline-pair] > summary');await until(()=>evaluate("!document.querySelector('[data-offline-batch-drop]') && ['a','b'].every(s=>document.querySelector('[data-offline-side='+s+'] [data-offline-state]').getAttribute('data-offline-state')==='idle')"),'Closing retained dropped reports')
  assert.equal(await evaluate('location.href'),url);assert.deepEqual(await api('/api/files'),list);assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before)
  writeFileSync(path.join(out,'offline-batch-drop-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,realPackagedApp:true,realFileReader:true,nativeChromiumDrag:true,syntheticData:true,forward,reverse,
    checks:['actual-two-file-drag','explicit-confirmation-and-twelve-values','one-and-three-file-refusal-preserves','text-hover-refusal-preserves','invalid-batch-no-partial-adoption','reverse-order-and-complete-exports','close-clears-batch','no-navigation-or-note-write'],
    screenshot:{filename:'offline-batch-drop.png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')}},null,2))
}
