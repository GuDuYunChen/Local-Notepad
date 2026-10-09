import { verifyLocalOverviewDifferencesDesktop } from './check-local-overview-differences-desktop.mjs'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Runs after the original real exported-file viewer check. New reference data
// is explicitly synthetic, derived from the actual export only in this test.
// Both the production FileReader and comparison UI remain unmodified.
export async function verifyLocalOverviewComparisonDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, expected, choose }) {
  const before=await Promise.all(noteIDs.map(id=>api('/api/files/'+id)))
  assert.equal(await evaluate("document.querySelector('[data-local-compare-result]')===null"),true)
  await click('[data-local-compare-start]')
  await until(()=>evaluate("!!document.querySelector('[data-local-compare-result]')"),'Comparison result missing')
  const readRows=()=>evaluate("[...document.querySelectorAll('[data-local-compare-result] tbody tr')].map(r=>[...r.cells].map(c=>c.textContent))")
  const same=await readRows();assert.equal(same.length,12)
  assert.ok(same.every(row=>/^0 (项|B)$/.test(row[3])))
  const other=JSON.parse(JSON.stringify(expected))
  other.records++;other.recordBytes++;other.kinds[0].records++;other.kinds[0].recordBytes++
  const reference=path.join(out,'comparison-reference.json');writeFileSync(reference,JSON.stringify(other))
  await choose(reference)
  await until(()=>evaluate("document.querySelector('[data-local-file-state]')?.dataset.localFileState==='ready'"),'Synthetic comparison reference failed')
  assert.equal(await evaluate("document.querySelector('[data-local-compare-result]')===null"),true)
  await click('[data-local-compare-start]')
  await until(()=>evaluate("!!document.querySelector('[data-local-compare-result]')"),'Second comparison result missing')
  const changed=await readRows();assert.equal(changed.length,12)
  assert.equal(changed[0][1],`${expected.records+1} 项`);assert.equal(changed[0][2],`${expected.records} 项`);assert.equal(changed[0][3],'-1 项')
  assert.equal(changed[1][3],'-1 B');assert.equal(changed[4][3],'-1 项');assert.equal(changed[5][3],'-1 B')
  assert.equal(changed[2][3],'0 B');assert.equal(changed[3][3],'0 项')
  const text=await evaluate("document.querySelector('[data-local-comparison]').innerText")
  assert.match(text,/未验证两者来自同一工作区/);assert.match(text,/不是盘点时间/)
  await evaluate("document.querySelector('[data-local-comparison]').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64')
  writeFileSync(path.join(out,'local-comparison.png'),png)
  await click('[data-local-compare-clear]');assert.equal(await evaluate("document.querySelector('[data-local-compare-result]')===null"),true)
  assert.equal(await evaluate("!!document.querySelector('[data-local-file-result]')"),true)
  await choose(filename)
  await until(()=>evaluate("document.querySelector('[data-local-file-state]')?.dataset.localFileState==='ready'"),'Original report was not restored')
  assert.equal(await evaluate("document.querySelector('[data-local-compare-result]')===null"),true)
  assert.deepEqual(await Promise.all(noteIDs.map(id=>api('/api/files/'+id))),before)
  writeFileSync(path.join(out,'local-comparison-checks.json'),JSON.stringify({complete:true,commit:process.env.GITHUB_SHA,
    realPackagedApp:true,realFileReader:true,syntheticData:true,
    checks:['explicit-comparison-required','same-export-zero-deltas','replacement-revokes-consent','signed-count-and-byte-deltas','unverified-provenance-visible','hide-preserves-file-view','original-reselection-no-stale-comparison','notes-unchanged'],
    same,changed,text,screenshot:{filename:'local-comparison.png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')}},null,2))
  await verifyLocalOverviewDifferencesDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, reference, choose })
}
