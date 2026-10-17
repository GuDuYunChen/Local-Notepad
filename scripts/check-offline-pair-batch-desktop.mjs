import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Actual packaged controls and FileReader; only isolated fixture files supplied.
export async function verifyOfflinePairBatchDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, second }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id))), list = await api('/api/files')
  const url = await evaluate('location.href')
  await click('[data-offline-pair] > summary'); await click('[data-offline-batch-toggle]')
  const choose = async files => {
    const document = await cdp.send('DOM.getDocument', { depth: 0 })
    const node = await cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '[data-offline-batch-input]' })
    assert.ok(node.nodeId); await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files })
  }
  const ready = () => evaluate("['a','b'].every(s=>document.querySelector('[data-offline-side='+s+'] [data-offline-state]').getAttribute('data-offline-state')==='ready') && document.querySelector('[data-offline-batch-reading]').getAttribute('data-offline-batch-reading')==='false'")
  const hasResult = () => evaluate("!!document.querySelector('[data-offline-result]')")
  const rows = () => evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>[Number(r.cells[1].textContent),Number(r.cells[2].textContent),Number(r.cells[3].textContent)])")
  const values = r => [r.records,r.recordBytes,r.attachmentBytes,r.baseItems,...r.kinds.flatMap(k=>[k.records,k.recordBytes])]
  const a = values(JSON.parse(readFileSync(filename, 'utf8'))), b = values(JSON.parse(readFileSync(second, 'utf8')))
  const expected = a.map((n,i)=>[n,b[i],b[i]-n])
  await choose([filename,second]);await until(ready,'Batch reports did not become ready')
  assert.equal(await hasResult(),false)
  await click('[data-offline-compare]');await until(hasResult,'Batch comparison was not confirmed')
  const forward = await rows();assert.deepEqual(forward,expected)
  await choose([filename]);assert.deepEqual(await rows(),expected)
  assert.match(await evaluate("document.querySelector('[data-offline-batch]').innerText"),/恰好选择两份/)
  const bad = path.join(out,'offline-batch-invalid.json');writeFileSync(bad,'{')
  await choose([filename,bad]);await until(()=>evaluate("document.querySelector('[data-offline-batch]').innerText.includes('未采用任何新报告')"),'Invalid batch was not rejected')
  assert.equal(await hasResult(),false);assert.equal(await ready(),true)
  await click('[data-offline-compare]');assert.deepEqual(await rows(),expected)
  await choose([second,filename]);await until(()=>evaluate("document.querySelector('[data-offline-batch]').innerText.includes('两份报告已一起替换')"),'Reverse batch did not complete')
  assert.equal(await hasResult(),false);await click('[data-offline-compare]')
  const reverse = await rows();assert.deepEqual(reverse,b.map((n,i)=>[n,a[i],a[i]-n]))
  assert.equal(await evaluate("document.querySelectorAll('[data-offline-export] button').length"),3)
  await evaluate("document.querySelector('[data-offline-batch]').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64')
  writeFileSync(path.join(out,'offline-pair-batch.png'),png)
  await click('[data-offline-pair] > summary')
  await until(()=>evaluate("!document.querySelector('[data-offline-batch-input]') && ['a','b'].every(s=>document.querySelector('[data-offline-side='+s+'] [data-offline-state]').getAttribute('data-offline-state')==='idle')"),'Close did not clear batch state')
  assert.equal(await evaluate('location.href'),url);assert.deepEqual(await api('/api/files'),list)
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before)
  writeFileSync(path.join(out,'offline-pair-batch-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,
    realPackagedApp:true,realFileReader:true,syntheticData:true,forward,reverse,
    checks:['actual-two-file-selection','explicit-confirmation-required','twelve-exact-values-in-picker-order','wrong-count-preserves-comparison','invalid-batch-retains-old-pair-without-partial-adoption','reversed-batch-revokes-and-reverses','close-clears-all-batch-state','no-navigation-or-note-write'],
    screenshot:{filename:'offline-pair-batch.png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')}},null,2))
}
