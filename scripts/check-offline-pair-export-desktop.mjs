import { verifyOfflinePairFilterDesktop } from './check-offline-pair-filter-desktop.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Actual downloads from the same isolated packaged window. Never replace the
// comparison, FileReader, Blob, click handler or backend responses.
export async function verifyOfflinePairExportDesktop({ evaluate, click, cdp, until, api, out, noteIDs, reverse }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const directory = path.join(out, 'offline-pair-exports'); mkdirSync(directory, { recursive: true })
  assert.equal(readdirSync(directory).length, 0)
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory })
  const hashes = [], contents = {}
  for (const format of ['json', 'csv', 'html']) {
    await click(`[data-offline-export-format="${format}"]`)
    const name = await until(() => {
      const matches = readdirSync(directory).filter(n => n.startsWith('Local-Notepad-offline-pair-') && n.endsWith('.' + format))
      return matches.length === 1 ? matches[0] : null
    }, 'Offline pair download not completed: ' + format)
    const bytes = readFileSync(path.join(directory, name))
    assert.ok(bytes.length > 0 && bytes.length <= 16384)
    contents[format] = bytes.toString('utf8')
    hashes.push({ filename: name, format, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  const json = JSON.parse(contents.json)
  assert.equal(json.format, 'local-notepad-offline-pair-comparison'); assert.equal(json.direction, 'B-minus-A')
  assert.equal(json.scope, 'previously-confirmed-file-pair'); assert.equal(json.metricCount, 12); assert.equal(json.includesAllMetrics, true)
  for (const key of ['sameWorkspaceVerified', 'contentEqualityVerified', 'completeForPreview', 'generationTimeIsObservationTime']) assert.equal(json[key], false)
  assert.equal(json.reportA.source, 'untrusted-file'); assert.equal(json.reportB.source, 'untrusted-file')
  const values = json.metrics.map(r => ({ key: r.key, a: r.a, b: r.b, delta: r.delta > 0 ? `+${r.delta}` : String(r.delta), unit: r.unit }))
  assert.deepEqual(values, reverse)
  // Every CSV text cell is controlled and quoted; accept escaped quotes rather
  // than splitting blindly on commas inside the notice.
  const csv = contents.csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n').map(line => {
    const cells = []; let value = '', quoted = false
    for (let i=0;i<line.length;i++) {
      const c=line[i]
      if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++}else quoted=!quoted}
      else if(c===','&&!quoted){cells.push(value);value=''}else value+=c
    }
    assert.equal(quoted,false);cells.push(value);return cells
  })
  assert.equal(csv.length,13);assert.ok(csv.every(r=>r.length===11))
  assert.deepEqual(csv.slice(1).map(r=>({key:r[0],a:+r[3],b:+r[4],delta:+r[5],unit:r[2]})),json.metrics.map(r=>({key:r.key,a:r.a,b:r.b,delta:r.delta,unit:r.unit})))
  const html=[...contents.html.matchAll(/<tr data-offline-metric="([^"]+)"><th scope="row">([^<]+)<\/th><td>(\d+)<\/td><td>(\d+)<\/td><td>([+-]?\d+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
  assert.deepEqual(html.map(m=>({key:m[1],label:m[2],a:+m[3],b:+m[4],delta:+m[5],unit:m[6]})),json.metrics)
  assert.doesNotMatch(contents.html, /<script\b|\s(?:src|href)=/i)
  for (const text of Object.values(contents)) {
    for (const value of [...noteIDs,'Desktop save A.md','Desktop save B.md','native-close-latest']) assert.ok(!text.includes(value))
    assert.ok(!text.includes('本次本地盘点'))
  }
  assert.match(await evaluate("document.querySelector('[data-offline-export-status]').textContent"), /尚未确认落盘/)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  await evaluate("document.querySelector('[data-offline-export]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64')
  writeFileSync(path.join(out,'offline-pair-export.png'),png)
  writeFileSync(path.join(out,'offline-pair-export-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,
    realPackagedApp:true,realDownload:true,syntheticData:true,files:hashes,metrics:json.metrics,
    checks:['three-actual-download-formats','all-twelve-screen-values-match','B-minus-A-and-zero-rows','both-sources-are-untrusted-files','no-note-data-or-false-local-provenance','no-active-html','truthful-download-feedback','notes-unchanged'],
    screenshot:{filename:'offline-pair-export.png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')}},null,2))
  await verifyOfflinePairFilterDesktop({ evaluate, click, cdp, until, api, out, noteIDs, reverse })
}
