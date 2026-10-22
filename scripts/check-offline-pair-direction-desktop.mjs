import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Original packaged app, production FileReader and native keyboard selection.
// Synthetic files only. No renderer/API implementation or result is replaced.
export async function verifyOfflinePairDirectionDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const original = JSON.parse(readFileSync(filename, 'utf8'))
  const a = structuredClone(original), b = structuredClone(original)
  for (const r of [a,b]) { r.records++; r.recordBytes++ }
  a.kinds[1].records++; a.kinds[1].recordBytes++
  b.kinds[0].records++; b.kinds[0].recordBytes++
  const inputs = [path.join(out,'direction-a.json'),path.join(out,'direction-b.json')]
  writeFileSync(inputs[0],JSON.stringify(a));writeFileSync(inputs[1],JSON.stringify(b))
  await click('[data-offline-pair] > summary')
  for (let i=0;i<2;i++) {
    const doc=await cdp.send('DOM.getDocument',{depth:0})
    const found=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:`[data-offline-side="${i?'b':'a'}"] input[type=file]`})
    assert.ok(found.nodeId);await cdp.send('DOM.setFileInputFiles',{nodeId:found.nodeId,files:[inputs[i]]})
  }
  await until(()=>evaluate("document.querySelector('[data-offline-compare]').disabled===false"),'Direction sources not ready')
  await click('[data-offline-compare]')
  const rows=()=>evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>({key:r.dataset.offlineMetric,a:Number(r.cells[1].textContent),b:Number(r.cells[2].textContent),delta:Number(r.cells[3].textContent)}))")
  const values = report => [report.records,report.recordBytes,report.attachmentBytes,report.baseItems,...report.kinds.flatMap(k=>[k.records,k.recordBytes])]
  const keys=['records','recordBytes','attachmentBytes','baseItems','file:records','file:bytes','tag:records','tag:bytes','file-tag:records','file-tag:bytes','attachment:records','attachment:bytes']
  const expected=values(a).map((n,i)=>({key:keys[i],a:n,b:values(b)[i],delta:values(b)[i]-n}))
  assert.deepEqual(await rows(),expected)
  await click('[data-offline-differences]');assert.equal((await rows()).length,4)
  const key=async(k,code)=>{
    for(const type of ['rawKeyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',{type,key:k,windowsVirtualKeyCode:code,nativeVirtualKeyCode:code})
  }
  await evaluate("document.querySelector('[data-offline-direction]').focus()")
  await key('Home',36);await key('ArrowDown',40)
  await until(()=>evaluate("document.querySelector('[data-offline-direction]').value==='increase'"),'Native increase selection failed')
  assert.deepEqual(await rows(),expected.filter(r=>r.delta>0))
  await key('ArrowDown',40)
  await until(()=>evaluate("document.querySelector('[data-offline-direction]').value==='decrease'"),'Native decrease selection failed')
  const negative=await rows();assert.deepEqual(negative,expected.filter(r=>r.delta<0))
  const downloadDir=path.join(out,'direction-downloads');mkdirSync(downloadDir,{recursive:true});assert.equal(readdirSync(downloadDir).length,0)
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir})
  const downloads=[]
  for(const format of ['json','csv','html']) {
    await click(`[data-offline-export-format="${format}"]`)
    const file=await until(()=>{const files=readdirSync(downloadDir).filter(n=>n.endsWith('.'+format));return files.length===1?files[0]:null},'Direction export missing '+format)
    const bytes=readFileSync(path.join(downloadDir,file)),text=bytes.toString('utf8')
    if(format==='json') assert.deepEqual(JSON.parse(text).metrics.map(({key,a,b,delta})=>({key,a,b,delta})),expected)
    if(format==='csv') assert.equal(text.trim().split(/\r?\n/).length,13)
    if(format==='html') assert.equal((text.match(/<tr data-offline-metric=/g)||[]).length,12)
    downloads.push({format,filename:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
  }
  await evaluate("document.querySelector('[data-offline-filter]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64')
  writeFileSync(path.join(out,'offline-direction.png'),png)
  await click('[data-offline-differences]');assert.deepEqual(await rows(),expected)
  await click('[data-offline-differences]');assert.equal(await evaluate("document.querySelector('[data-offline-direction]').value"),'all')
  await click('[data-offline-swap]');assert.equal((await rows()).length,0)
  await click('[data-offline-compare]');assert.deepEqual(await rows(),expected.map(({key,a,b,delta})=>({key,a:b,b:a,delta:delta===0?0:-delta})))
  assert.equal(await evaluate("document.querySelector('[data-offline-direction]')===null"),true)
  await click('[data-offline-pair] > summary')
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before)
  writeFileSync(path.join(out,'offline-direction-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,
    realPackagedApp:true,realFileReader:true,realKeyboard:true,syntheticData:true,expected,negative,downloads,
    checks:['twelve-values-from-real-files','opposing-categories-with-equal-totals','native-increase-selection','native-decrease-selection','three-downloads-keep-twelve-metrics','disable-restores-all','swap-revokes-direction','notes-unchanged'],
    screenshot:{filename:'offline-direction.png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')}
  },null,2))
}
