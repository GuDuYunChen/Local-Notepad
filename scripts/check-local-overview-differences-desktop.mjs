import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Append to the original packaged-app acceptance. Real clicks and a native
// Space key operate the production UI; no values, clocks or handlers are mocked.
export async function verifyLocalOverviewDifferencesDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, reference, choose }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const rows = () => evaluate("[...document.querySelectorAll('[data-local-compare-result] tbody tr')].map(r=>[...r.cells].map(c=>c.textContent))")
  const ready = () => until(() => evaluate("!!document.querySelector('[data-local-compare-result]')"), 'Difference view comparison missing')
  await click('[data-local-compare-start]'); await ready()
  const identical = await rows(); assert.equal(identical.length, 12)
  await click('[data-local-compare-differences]')
  assert.equal((await rows()).length, 0)
  assert.match(await evaluate("document.querySelector('[data-local-compare-empty]').textContent"), /不代表笔记或附件内容相同/)
  // Focus remains on the real toggle after clicking. Space must restore it.
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 })
  await until(() => evaluate("document.querySelector('[data-local-compare-differences]')?.getAttribute('aria-pressed')==='false'"), 'Space did not restore all metrics')
  assert.deepEqual(await rows(), identical)
  await choose(reference)
  await until(() => evaluate("document.querySelector('[data-local-file-state]')?.dataset.localFileState==='ready'"), 'Difference reference missing')
  assert.equal(await evaluate("document.querySelector('[data-local-compare-differences]')===null"), true)
  await click('[data-local-compare-start]'); await ready()
  const all = await rows(); assert.equal(all.length, 12)
  await click('[data-local-compare-differences]')
  const filtered = await rows(); assert.equal(filtered.length, 4)
  assert.deepEqual(filtered, all.filter(row => !/^0 /.test(row[3])))
  assert.match(await evaluate("document.querySelector('[data-local-compare-metrics]').textContent"), /4 个数值不同/)
  assert.ok(filtered.every(row => /^-1 (项|B)$/.test(row[3])))
  await evaluate("document.querySelector('[data-local-compare-differences]').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', {format:'png'})).data, 'base64')
  writeFileSync(path.join(out, 'local-differences.png'), png)
  await click('[data-local-compare-differences]'); assert.deepEqual(await rows(), all)
  await click('[data-local-compare-clear]'); assert.equal(await evaluate("!!document.querySelector('[data-local-file-result]')"), true)
  await choose(filename)
  await until(() => evaluate("document.querySelector('[data-local-file-state]')?.dataset.localFileState==='ready'"), 'Original report not restored after filtering')
  assert.equal(await evaluate("document.querySelector('[data-local-compare-result]')===null"), true)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  writeFileSync(path.join(out, 'local-differences-checks.json'), JSON.stringify({ complete:true, commit:process.env.GITHUB_SHA,
    realPackagedApp:true, realKeyboard:true, syntheticData:true,
    checks:['explicit-comparison-before-filter','identical-values-empty-state','native-space-toggle','source-replacement-revokes-filter','exact-negative-difference-subset','all-values-restored','clear-preserves-file','notes-unchanged'],
    identical, all, filtered, screenshot:{filename:'local-differences.png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')} }, null, 2))
}
