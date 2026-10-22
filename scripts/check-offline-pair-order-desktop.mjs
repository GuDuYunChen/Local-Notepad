import { verifyOfflinePairViewResetDesktop } from './check-offline-pair-view-reset-desktop.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Real file inputs, native keyboard and downloads in the existing isolated app.
// Restore the prior statistics before returning to the older acceptance chain.
export async function verifyOfflinePairOrderDesktop({ evaluate, click, cdp, until, api, out, noteIDs, metrics }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const keys = ['records','recordBytes','attachmentBytes','baseItems','file:records','file:bytes','tag:records','tag:bytes','file-tag:records','file-tag:bytes','attachment:records','attachment:bytes']
  const units = ['项','B','B','项','项','B','项','B','项','B','项','B']
  const envelope = values => ({ format:'local-notepad-local-inventory-report',version:1,
    generatedAtUTC:'2026-10-01T00:00:00.000Z',scope:'previously-read-local-observation',readOnly:true,
    completeForPreview:false,notice:'Isolated test statistics',generationTimeIsObservationTime:false,
    records:values[0],recordBytes:values[1],attachmentBytes:values[2],baseItems:values[3],
    kinds:['file','tag','file-tag','attachment'].map((kind,i)=>({kind,records:values[4+i*2],recordBytes:values[5+i*2]})) })
  const original = ['a','b'].map(side => envelope(keys.map(key => metrics.find(row=>row.key===key)[side])))
  const values = (files,tags) => [files+tags,(files+tags)*64,0,0,files,files*64,tags,tags*64,0,0,0,0]
  const left=values(12,2),right=values(3,13)
  const expected=keys.map((key,i)=>({key,a:left[i],b:right[i],delta:right[i]-left[i],unit:units[i]}))
  const inputs=[]
  for(const [name,data] of [['a',envelope(left)],['b',envelope(right)],['restore-a',original[0]],['restore-b',original[1]]]) {
    const filename='offline-order-'+name+'.json',raw=Buffer.from(JSON.stringify(data))
    writeFileSync(path.join(out,filename),raw);inputs.push({filename,bytes:raw.length,sha256:hash(raw)})
  }
  const choose=async(side,filename)=>{
    const doc=await cdp.send('DOM.getDocument',{depth:0})
    const input=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:`[data-offline-side="${side}"] input[type=file]`})
    assert.ok(input.nodeId);await cdp.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[path.join(out,filename)]})
    await until(()=>evaluate(`document.querySelector('[data-offline-side="${side}"] [data-offline-state]').dataset.offlineState==='ready'`),'Order report did not become ready')
  }
  const select=async(selector,index,value)=>{
    await evaluate(`document.querySelector('${selector}').focus()`)
    for(const key of ['Home',...Array(index).fill('ArrowDown'),'Enter'])for(const type of ['keyDown','keyUp'])
      await cdp.send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:{Home:36,ArrowDown:40,Enter:13}[key]})
    await until(()=>evaluate(`document.querySelector('${selector}').value==='${value}'`),'Order native selector did not update')
  }
  const snapshot=()=>evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>({key:r.dataset.offlineMetric,a:Number(r.cells[1].textContent),b:Number(r.cells[2].textContent),delta:Number(r.cells[3].textContent),unit:r.cells[4].textContent}))")
  const overview=()=>evaluate("document.querySelector('[data-offline-summary]').textContent")
  await choose('a',inputs[0].filename);await choose('b',inputs[1].filename);await click('[data-offline-compare]')
  assert.deepEqual(await snapshot(),expected);const completeOverview=await overview()
  await click('[data-offline-differences]');assert.equal(await evaluate("!!document.querySelector('[data-offline-order]')"),false)
  await select('[data-offline-scope]',1,'counts');await select('[data-offline-order]',1,'largest')
  const largest=['tag:records','file:records','records'].map(key=>expected.find(row=>row.key===key))
  assert.deepEqual(await snapshot(),largest)
  await select('[data-offline-order]',2,'smallest');assert.deepEqual((await snapshot()).map(r=>r.delta),[2,-9,11])
  await select('[data-offline-order]',1,'largest');await select('[data-offline-direction]',1,'increase')
  assert.deepEqual((await snapshot()).map(r=>r.delta),[11,2]);await select('[data-offline-scope]',2,'bytes')
  assert.equal(await evaluate("document.querySelector('[data-offline-order]').value"),'original')
  await select('[data-offline-order]',1,'largest');assert.deepEqual((await snapshot()).map(r=>r.delta),[704,128])
  await select('[data-offline-direction]',0,'all');assert.deepEqual((await snapshot()).map(r=>r.delta),[704,-576,128])
  assert.equal(await overview(),completeOverview)
  const directory=path.join(out,'offline-order-exports');mkdirSync(directory,{recursive:true});assert.equal(readdirSync(directory).length,0)
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory})
  const files=[],contents={}
  for(const format of ['json','csv','html']) {
    await click(`[data-offline-export-format="${format}"]`)
    const filename=await until(()=>{const n=readdirSync(directory).filter(n=>n.startsWith('Local-Notepad-offline-pair-')&&n.endsWith('.'+format));return n.length===1?n[0]:null},'Sorted download missing: '+format)
    const raw=readFileSync(path.join(directory,filename));assert.ok(raw.length>0&&raw.length<=16384)
    contents[format]=raw.toString('utf8');files.push({filename,format,bytes:raw.length,sha256:hash(raw)})
  }
  const project=r=>({key:r.key,a:r.a,b:r.b,delta:r.delta,unit:r.unit})
  assert.deepEqual(JSON.parse(contents.json).metrics.map(project),expected)
  assert.equal(contents.csv.replace(/^\uFEFF/,'').trimEnd().split('\r\n').length,13)
  const html=[...contents.html.matchAll(/<tr data-offline-metric="([^"]+)"><th scope="row">([^<]+)<\/th><td>(\d+)<\/td><td>(\d+)<\/td><td>([+-]?\d+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
  assert.deepEqual(html.map(m=>({key:m[1],a:+m[3],b:+m[4],delta:+m[5],unit:m[6]})),expected)
  for(const text of Object.values(contents))for(const value of [...noteIDs,'Desktop save A.md','Desktop save B.md','native-close-latest'])assert.ok(!text.includes(value))
  await evaluate("document.querySelector('[data-offline-filter]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');writeFileSync(path.join(out,'offline-order.png'),png)
  await click('[data-offline-differences]');assert.deepEqual(await snapshot(),expected)
  await click('[data-offline-differences]');await select('[data-offline-scope]',1,'counts');assert.equal(await evaluate("document.querySelector('[data-offline-order]').value"),'original')
  await select('[data-offline-order]',1,'largest');await click('[data-offline-swap]');assert.equal(await evaluate("!!document.querySelector('[data-offline-order]')"),false)
  await click('[data-offline-compare]');assert.deepEqual(await snapshot(),expected.map(r=>({...r,a:r.b,b:r.a,delta:-r.delta||0})))
  await choose('a',inputs[2].filename);await choose('b',inputs[3].filename);await click('[data-offline-compare]');assert.deepEqual(await snapshot(),metrics.map(project))
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before)
  writeFileSync(path.join(out,'offline-order-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,
    realPackagedApp:true,realFileReader:true,realDownload:true,syntheticData:true,metrics:expected,inputs,files,largest,
    checks:['native-magnitude-order-with-real-files','both-directions-and-sizes','single-unit-only-and-scope-reset','direction-retains-order',
      'overview-and-three-complete-downloads-unchanged','disable-restores-canonical-twelve','swap-revokes-old-sort','restore-prior-pair-and-notes-unchanged'],
    screenshot:{filename:'offline-order.png',bytes:png.length,sha256:hash(png)}},null,2))
  await verifyOfflinePairViewResetDesktop({ evaluate, click, cdp, until, api, out, noteIDs })
}
