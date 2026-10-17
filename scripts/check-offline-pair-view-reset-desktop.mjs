import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { verifyOfflinePairDownloadInvariance } from './offline-pair-download-evidence.mjs'

// Exercise the existing packaged application, native keyboard and real downloads.
// No replacement of readers, comparison functions, click handlers or note APIs.
export async function verifyOfflinePairViewResetDesktop({ evaluate, click, cdp, until, api, out, noteIDs }) {
  const hash = raw => createHash('sha256').update(raw).digest('hex')
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const snapshot = () => evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>({key:r.dataset.offlineMetric,label:r.cells[0].textContent,a:Number(r.cells[1].textContent),b:Number(r.cells[2].textContent),delta:Number(r.cells[3].textContent),unit:r.cells[4].textContent}))")
  const sides = () => evaluate("[...document.querySelectorAll('[data-offline-side]')].map(el=>el.textContent)")
  const overview = () => evaluate("document.querySelector('[data-offline-summary]').textContent")
  const original = await snapshot(), originalSides = await sides(), originalOverview = await overview()
  assert.equal(original.length,12)
  const select = async (selector,index,value) => {
    await evaluate(`document.querySelector('${selector}').focus()`)
    for (const key of ['Home',...Array(index).fill('ArrowDown'),'Enter']) for (const type of ['keyDown','keyUp'])
      await cdp.send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:{Home:36,ArrowDown:40,Enter:13}[key]})
    await until(()=>evaluate(`document.querySelector('${selector}').value==='${value}'`),'View recovery selector did not update')
  }
  await click('[data-offline-differences]');await select('[data-offline-scope]',1,'counts')
  await select('[data-offline-order]',1,'largest');await select('[data-offline-direction]',2,'decrease')
  const filtered = await snapshot()
  assert.deepEqual(filtered,original.filter(r=>r.unit==='项'&&r.delta<0).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)))
  assert.match(await evaluate("document.querySelector('[data-offline-view-description]').textContent"),/仅数量（项） · 仅减少 · 幅度从大到小/)
  assert.equal(await overview(),originalOverview)
  const downloads = async suffix => {
    const directory=path.join(out,'offline-view-reset-'+suffix);mkdirSync(directory,{recursive:true});assert.equal(readdirSync(directory).length,0)
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory})
    const files=[]
    for(const format of ['json','csv','html']) {
      const startedAt=Date.now()
      await click(`[data-offline-export-format="${format}"]`)
      const filename=await until(()=>{const ns=readdirSync(directory).filter(n=>n.startsWith('Local-Notepad-offline-pair-')&&n.endsWith('.'+format));return ns.length===1?ns[0]:null},'View recovery download missing: '+format)
      const raw=readFileSync(path.join(directory,filename));assert.ok(raw.length>0&&raw.length<=16384)
      files.push({filename:path.join('offline-view-reset-'+suffix,filename),format,bytes:raw.length,sha256:hash(raw),startedAt,completedAt:Date.now()})
    }
    return files
  }
  const filteredFiles=await downloads('before')
  const feedback=await evaluate("document.querySelector('[data-offline-export-status]').textContent")
  await evaluate("document.querySelector('[data-offline-view-reset]').focus()")
  assert.equal(await evaluate("document.activeElement===document.querySelector('[data-offline-view-reset]')&&!document.activeElement.disabled"),true)
  // A full Enter keypress includes its character. Without text Chromium emits
  // keydown/up only, which does not activate even an isolated native button.
  for(const type of ['keyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,
    ...(type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})})
  await until(()=>evaluate("document.querySelector('[data-offline-result] tbody').rows.length===12&&!document.querySelector('[data-offline-differences]').checked"),'Keyboard view recovery did not complete')
  assert.equal(await evaluate("document.activeElement===document.querySelector('[data-offline-result]')"),true)
  assert.deepEqual(await snapshot(),original);assert.deepEqual(await sides(),originalSides);assert.equal(await overview(),originalOverview)
  assert.equal(await evaluate("document.querySelector('[data-offline-export-status]').textContent"),feedback)
  assert.equal(await evaluate("document.querySelector('[data-offline-view-reset]').disabled"),true)
  const restoredFiles=await downloads('after')
  const withBytes=files=>files.map(file=>({...file,raw:readFileSync(path.join(out,file.filename))}))
  const downloadInvariance=verifyOfflinePairDownloadInvariance(withBytes(filteredFiles),withBytes(restoredFiles),original)
  const exported=JSON.parse(readFileSync(path.join(out,restoredFiles[0].filename),'utf8'))
  assert.deepEqual(exported.metrics,original)
  await click('[data-offline-differences]');assert.equal(await evaluate("document.querySelector('[data-offline-scope]').value"),'all')
  assert.equal(await evaluate("document.querySelector('[data-offline-direction]').value"),'all')
  await select('[data-offline-scope]',1,'counts');assert.equal(await evaluate("document.querySelector('[data-offline-order]').value"),'original')
  // The inherited restored fixture has no positive quantity deltas.
  assert.equal(original.filter(r=>r.unit==='项'&&r.delta>0).length,0)
  await select('[data-offline-direction]',1,'increase');assert.equal((await snapshot()).length,0)
  assert.match(await evaluate("document.querySelector('[data-offline-no-differences]').textContent"),/恢复完整视图/)
  await click('[data-offline-view-reset]');assert.deepEqual(await snapshot(),original)
  await evaluate("document.querySelector('[data-offline-view-description]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');writeFileSync(path.join(out,'offline-view-reset.png'),png)
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before)
  writeFileSync(path.join(out,'offline-view-reset-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,
    realPackagedApp:true,realDownload:true,syntheticData:true,metrics:original,filtered,downloadInvariance,files:[...filteredFiles,...restoredFiles],
    checks:['effective-view-description','one-keyboard-action-clears-combined-filters','focus-returns-to-result-region','files-and-confirmation-preserved',
      'summary-and-export-feedback-unchanged','three-downloads-identical-except-validated-export-generation-time','no-old-sort-revival-and-empty-view-recovery','notes-unchanged'],
    screenshot:{filename:'offline-view-reset.png',bytes:png.length,sha256:hash(png)}},null,2))
}
