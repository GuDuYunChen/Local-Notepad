import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Extend the existing isolated packaged-app export check. All actions use the
// actual rendered comparison and real clicks; never substitute its data model.
export async function verifyOfflinePairSummaryDesktop({ evaluate, click, cdp, until, api, out, noteIDs, metrics }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const distribution = rows => [rows.filter(row => row.delta > 0).length, rows.filter(row => row.delta < 0).length, rows.filter(row => row.delta === 0).length]
  const expected = distribution(metrics)
  assert.equal(metrics.length, 12)
  const snapshot = () => evaluate("[...document.querySelectorAll('[data-offline-summary-count]')].map(n=>Number(n.textContent))")
  assert.deepEqual(await snapshot(), expected)
  for (const [group, unit] of [['counts', '项'], ['bytes', 'B']]) {
    const values = distribution(metrics.filter(row => row.unit === unit))
    const text = await evaluate(`document.querySelector('[data-offline-summary-group="${group}"]').textContent`)
    assert.ok(text.includes(`增加 ${values[0]}，减少 ${values[1]}，未变 ${values[2]}`))
  }
  assert.equal(await evaluate("document.querySelector('[data-offline-differences]').checked"), false)
  await click('[data-offline-differences]')
  await until(() => evaluate(`document.querySelectorAll('[data-offline-result] tbody tr').length===${expected[0] + expected[1]}`), 'Difference rows did not update')
  assert.deepEqual(await snapshot(), expected)
  await click('[data-offline-differences]')
  assert.equal(await evaluate("document.querySelectorAll('[data-offline-result] tbody tr').length"), 12)
  await click('[data-offline-swap]')
  assert.equal(await evaluate("!!document.querySelector('[data-offline-summary]')"), false)
  await click('[data-offline-compare]')
  assert.deepEqual(await snapshot(), [expected[1], expected[0], expected[2]])
  await click('[data-offline-swap]'); await click('[data-offline-compare]')
  assert.deepEqual(await snapshot(), expected)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  const text = await evaluate("document.querySelector('[data-offline-summary]').textContent")
  assert.match(text, /不随筛选变化/); assert.match(text, /不代表变化的笔记数/)
  await evaluate("document.querySelector('[data-offline-summary]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  writeFileSync(path.join(out, 'offline-summary.png'), png)
  writeFileSync(path.join(out, 'offline-summary-checks.json'), JSON.stringify({ complete: true, commit: process.env.GITHUB_SHA,
    realPackagedApp: true, syntheticData: true, expected, metrics, text,
    checks: ['twelve-metric-distribution', 'separate-count-and-byte-groups', 'filter-keeps-complete-summary',
      'restore-all-table-rows', 'swap-revokes-old-summary', 'reconfirm-reverses-distribution', 'notes-unchanged'],
    screenshot: { filename: 'offline-summary.png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') } }, null, 2))
}
