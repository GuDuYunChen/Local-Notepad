import { verifyComparisonHTMLDesktop } from './check-local-comparison-html-desktop.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { comparisonCSVRows } from './s3-local-comparison-export-cases.mjs'

// Additional real packaged-app clicks and downloaded bytes. Only the download
// destination belongs to this test. No renderer, file reader or HTTP is mocked.
export async function verifyComparisonExportDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, reference, choose }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  assert.equal(await evaluate("document.querySelector('[data-local-compare-export]')===null"), true)
  await choose(reference)
  await until(() => evaluate("document.querySelector('[data-local-file-state]')?.dataset.localFileState==='ready'"), 'Export reference missing')
  await click('[data-local-compare-start]')
  await until(() => evaluate("!!document.querySelector('[data-local-compare-result]')"), 'Export comparison missing')
  const all = await evaluate("[...document.querySelectorAll('[data-local-compare-result] tbody tr')].map(r=>[...r.cells].map(c=>c.textContent))")
  assert.equal(all.length, 12)
  await click('[data-local-compare-differences]')
  assert.equal(await evaluate("document.querySelectorAll('[data-local-compare-result] tbody tr').length"), 4)
  const destination = path.join(out, 'comparison-downloads'); mkdirSync(destination, { recursive:true })
  assert.equal(readdirSync(destination).length, 0)
  await cdp.send('Browser.setDownloadBehavior', { behavior:'allow', downloadPath:destination })
  const files = {}
  for (const format of ['json','csv']) {
    await click(`[data-local-compare-export="${format}"]`)
    const name = await until(() => {
      const names = readdirSync(destination).filter(n => n.startsWith('Local-Notepad-comparison-') && n.endsWith('.' + format))
      return names.length === 1 ? names[0] : null
    }, 'Comparison download missing: ' + format)
    files[format] = { name, bytes:readFileSync(path.join(destination,name)) }
    assert.ok(files[format].bytes.length > 0 && files[format].bytes.length <= 16384)
  }
  const json = JSON.parse(files.json.bytes.toString('utf8')), csv = comparisonCSVRows(files.csv.bytes.toString('utf8'))
  assert.equal(json.format,'local-notepad-local-comparison-report'); assert.equal(json.version,1)
  assert.equal(json.direction,'local-minus-reference'); assert.equal(json.sameWorkspaceVerified,false)
  assert.equal(json.completeForPreview,false); assert.equal(json.generationTimeIsObservationTime,false)
  assert.equal(json.includesAllMetrics,true); assert.equal(json.metricCount,12); assert.equal(json.changedMetricCount,4)
  assert.equal(json.metrics.length,12); assert.equal(csv.length,13)
  for (const [i,row] of json.metrics.entries()) {
    assert.deepEqual([row.reference,row.local,row.delta], all[i].slice(1).map(value=>Number(value.split(' ')[0])))
    assert.deepEqual(csv[i+1].slice(0,6),[row.id,row.label,row.unit,row.reference,row.local,row.delta].map(String))
    assert.equal(csv[i+1][8],'false'); assert.match(csv[i+1][9],/不是笔记备份/)
  }
  assert.equal(json.metrics[0].delta,-1); assert.equal(json.metrics[2].delta,0)
  for(const value of [...noteIDs,'Desktop save A.md','Desktop save B.md','native-close-latest']) {
    for(const file of Object.values(files)) assert.ok(!file.bytes.toString('utf8').includes(value))
  }
  assert.match(await evaluate("document.querySelector('[data-local-compare-export-status]').textContent"),/尚未确认落盘/)
  await evaluate("document.querySelector('[data-local-compare-export-panel]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64')
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
  writeFileSync(path.join(out,'local-comparison-export.png'),png)
  await verifyComparisonHTMLDesktop({ evaluate, click, cdp, until, out, destination, metrics: json.metrics })
  await click('[data-local-compare-clear]'); assert.equal(await evaluate("document.querySelector('[data-local-compare-export]')===null"),true)
  await choose(filename)
  await until(() => evaluate("document.querySelector('[data-local-file-state]')?.dataset.localFileState==='ready'"), 'Export original report not restored')
  assert.equal(await evaluate("document.querySelector('[data-local-compare-export]')===null"),true)
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before)
  writeFileSync(path.join(out,'local-comparison-export-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,
    realPackagedApp:true,realDownloads:true,syntheticData:true,
    checks:['explicit-comparison-required','real-json-and-csv-download','all-twelve-metrics-despite-filter','exact-signed-values-match-display',
      'unverified-scope-preserved','no-private-note-data','clear-revokes-output','notes-unchanged'], all,
    files:Object.fromEntries(Object.entries(files).map(([kind,file])=>[kind,{filename:path.join('comparison-downloads',file.name),bytes:file.bytes.length,sha256:hash(file.bytes)}])),
    screenshot:{filename:'local-comparison-export.png',bytes:png.length,sha256:hash(png)}},null,2))
}
