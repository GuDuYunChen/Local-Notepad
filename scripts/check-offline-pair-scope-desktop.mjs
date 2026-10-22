import { verifyOfflinePairOrderDesktop } from './check-offline-pair-order-desktop.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Extend the original isolated packaged-app test. Native keyboard selection,
// real production comparison and actual downloads; no replaced renderer or I/O.
export async function verifyOfflinePairScopeDesktop({ evaluate, click, cdp, until, api, out, noteIDs, metrics }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const overview = () => evaluate("document.querySelector('[data-offline-summary]').textContent")
  const originalOverview = await overview()
  const snapshot = () => evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>({key:r.dataset.offlineMetric,a:Number(r.cells[1].textContent),b:Number(r.cells[2].textContent),delta:Number(r.cells[3].textContent),unit:r.cells[4].textContent}))")
  const project = row => ({ key: row.key, a: row.a, b: row.b, delta: row.delta, unit: row.unit })
  const select = async (selector, index, value) => {
    await evaluate(`document.querySelector('${selector}').focus()`)
    for (const key of ['Home', ...Array(index).fill('ArrowDown'), 'Enter']) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: { Home: 36, ArrowDown: 40, Enter: 13 }[key] })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: { Home: 36, ArrowDown: 40, Enter: 13 }[key] })
    }
    await until(() => evaluate(`document.querySelector('${selector}').value==='${value}'`), 'Native selector did not update: ' + selector)
  }
  assert.equal(await evaluate("document.querySelector('[data-offline-differences]').checked"), false)
  await click('[data-offline-differences]')
  await select('[data-offline-scope]', 1, 'counts')
  const quantity = metrics.filter(row => row.delta !== 0 && row.unit === '项').map(project)
  assert.deepEqual(await snapshot(), quantity); assert.equal(quantity.length, 2)
  await select('[data-offline-scope]', 2, 'bytes')
  assert.deepEqual(await snapshot(), metrics.filter(row => row.delta !== 0 && row.unit === 'B').map(project))
  await select('[data-offline-direction]', 1, 'increase')
  assert.deepEqual(await snapshot(), metrics.filter(row => row.delta > 0 && row.unit === 'B').map(project))
  assert.match(await evaluate("document.querySelector('[data-offline-no-differences]').textContent"), /不代表两份报告相同/)
  await select('[data-offline-direction]', 2, 'decrease')
  await select('[data-offline-scope]', 1, 'counts')
  assert.deepEqual(await snapshot(), quantity); assert.equal(await overview(), originalOverview)
  const directory = path.join(out, 'offline-scope-exports'); mkdirSync(directory, { recursive: true })
  assert.equal(readdirSync(directory).length, 0)
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory })
  const files = [], contents = {}, hash = bytes => createHash('sha256').update(bytes).digest('hex')
  for (const format of ['json', 'csv', 'html']) {
    await click(`[data-offline-export-format="${format}"]`)
    const filename = await until(() => {
      const found = readdirSync(directory).filter(n => n.startsWith('Local-Notepad-offline-pair-') && n.endsWith('.' + format))
      return found.length === 1 ? found[0] : null
    }, 'Scoped actual download did not finish: ' + format)
    const bytes = readFileSync(path.join(directory, filename)); assert.ok(bytes.length > 0 && bytes.length <= 16384)
    contents[format] = bytes.toString('utf8'); files.push({ filename, format, bytes: bytes.length, sha256: hash(bytes) })
  }
  const json = JSON.parse(contents.json); assert.equal(json.includesAllMetrics, true); assert.equal(json.metricCount, 12)
  assert.deepEqual(json.metrics.map(project), metrics.map(project))
  const csv = contents.csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n')
  assert.equal(csv.length, 13)
  const html = [...contents.html.matchAll(/<tr data-offline-metric="([^"]+)"><th scope="row">([^<]+)<\/th><td>(\d+)<\/td><td>(\d+)<\/td><td>([+-]?\d+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
  assert.deepEqual(html.map(m => ({key:m[1],a:+m[3],b:+m[4],delta:+m[5],unit:m[6]})), metrics.map(project))
  for (const text of Object.values(contents)) for (const value of [...noteIDs, 'Desktop save A.md', 'Desktop save B.md', 'native-close-latest']) assert.ok(!text.includes(value))
  await evaluate("document.querySelector('[data-offline-filter]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  writeFileSync(path.join(out, 'offline-scope.png'), png)
  await click('[data-offline-differences]'); assert.equal((await snapshot()).length, 12)
  await click('[data-offline-differences]'); assert.equal(await evaluate("document.querySelector('[data-offline-scope]').value"), 'all')
  await select('[data-offline-scope]', 2, 'bytes'); await click('[data-offline-swap]')
  assert.equal(await evaluate("!!document.querySelector('[data-offline-scope]')"), false)
  await click('[data-offline-compare]'); assert.equal((await snapshot()).length, 12)
  await click('[data-offline-swap]'); await click('[data-offline-compare]')
  assert.deepEqual(await snapshot(), metrics.map(project)); assert.equal(await overview(), originalOverview)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  writeFileSync(path.join(out, 'offline-scope-checks.json'), JSON.stringify({ complete: true, commit: process.env.GITHUB_SHA,
    realPackagedApp: true, realDownload: true, syntheticData: true, metrics, files, quantity,
    checks: ['native-quantity-and-capacity-selection', 'type-and-direction-intersection', 'empty-scope-not-equal-reports',
      'overview-keeps-twelve-metrics', 'three-actual-complete-downloads', 'disable-restores-all-and-resets-scope',
      'swap-revokes-and-reconfirm-restores', 'notes-unchanged'],
    screenshot: { filename: 'offline-scope.png', bytes: png.length, sha256: hash(png) } }, null, 2))
  await verifyOfflinePairOrderDesktop({ evaluate, click, cdp, until, api, out, noteIDs, metrics })
}
