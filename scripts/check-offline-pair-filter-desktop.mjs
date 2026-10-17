import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Real packaged window, native checkbox keyboard input and actual downloads.
// The filtering view must never replace the full confirmed export model.
export async function verifyOfflinePairFilterDesktop({ evaluate, click, cdp, until, api, out, noteIDs, reverse }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const snapshot = () => evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>({key:r.getAttribute('data-offline-metric'),a:Number(r.cells[1].textContent),b:Number(r.cells[2].textContent),delta:r.cells[3].textContent,unit:r.cells[4].textContent}))")
  const checked = () => evaluate("document.querySelector('[data-offline-differences]').checked")
  assert.equal(await checked(), false); assert.deepEqual(await snapshot(), reverse)
  await click('[data-offline-differences]')
  assert.equal(await checked(), true)
  const filtered = await snapshot(), expected = reverse.filter(row => Number(row.delta) !== 0)
  assert.deepEqual(filtered, expected); assert.equal(filtered.length, 4)
  // Clicking focused the real checkbox. Space must restore and reapply it.
  for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  assert.equal(await checked(), false); assert.deepEqual(await snapshot(), reverse)
  for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  assert.equal(await checked(), true); assert.deepEqual(await snapshot(), expected)
  const directory = path.join(out, 'offline-filter-exports'); mkdirSync(directory, { recursive: true })
  assert.equal(readdirSync(directory).length, 0)
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory })
  const files = [], texts = {}, hash = bytes => createHash('sha256').update(bytes).digest('hex')
  for (const format of ['json', 'csv', 'html']) {
    await click(`[data-offline-export-format=${format}]`)
    const name = await until(() => {
      const names = readdirSync(directory).filter(name => name.endsWith('.' + format))
      return names.length === 1 ? names[0] : null
    }, 'Filtered-view complete export missing: ' + format)
    const bytes = readFileSync(path.join(directory, name)); texts[format] = bytes.toString('utf8')
    assert.ok(bytes.length > 0 && bytes.length <= 16384)
    files.push({ filename: name, format, bytes: bytes.length, sha256: hash(bytes) })
  }
  const report = JSON.parse(texts.json)
  assert.equal(report.metrics.length, 12); assert.equal(report.includesAllMetrics, true)
  assert.deepEqual(report.metrics.map(row => ({ key: row.key, a: row.a, b: row.b, delta: String(row.delta), unit: row.unit })), reverse)
  assert.equal(texts.csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n').length, 13)
  assert.equal([...texts.html.matchAll(/data-offline-metric=/g)].length, 12)
  assert.deepEqual(await snapshot(), expected)
  await evaluate("document.querySelector('[data-offline-filter]').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  writeFileSync(path.join(out, 'offline-pair-filter.png'), png)
  await click('[data-offline-swap]'); assert.equal(await evaluate("!!document.querySelector('[data-offline-filter]')"), false)
  await click('[data-offline-compare]'); assert.equal(await checked(), false); assert.equal((await snapshot()).length, 12)
  await click('[data-offline-swap]'); await click('[data-offline-compare]'); assert.deepEqual(await snapshot(), reverse)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  writeFileSync(path.join(out, 'offline-pair-filter-checks.json'), JSON.stringify({ complete: true, commit: process.env.GITHUB_SHA,
    realPackagedApp: true, nativeKeyboard: true, realDownloads: true, syntheticData: true, filtered, all: reverse, files,
    checks: ['default-full-values', 'exact-signed-difference-rows', 'space-key-toggle', 'restore-all-original-values',
      'three-downloads-still-complete', 'filter-keeps-confirmed-export', 'swap-invalidates-filter', 'notes-unchanged'],
    screenshot: { filename: 'offline-pair-filter.png', bytes: png.length, sha256: hash(png) } }, null, 2))
}
