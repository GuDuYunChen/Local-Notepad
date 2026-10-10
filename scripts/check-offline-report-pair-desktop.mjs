import { verifyOfflinePairExportDesktop } from './check-offline-pair-export-desktop.mjs'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Uses only the existing isolated packaged app and actual file inputs/readers.
// Does not replace React, the parser, backend responses or native scan results.
export async function verifyOfflineReportPairDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, expected }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const listBefore = await api('/api/files'), urlBefore = await evaluate('location.href')
  await click('[data-offline-pair] > summary')
  const state = side => evaluate(`document.querySelector('[data-offline-side="${side}"] [data-offline-state]').getAttribute('data-offline-state')`)
  const hasResult = () => evaluate("!!document.querySelector('[data-offline-result]')")
  const select = async (side, file) => {
    const doc = await cdp.send('DOM.getDocument', { depth: 0 })
    const found = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `[data-offline-side="${side}"] input` })
    assert.ok(found.nodeId)
    await cdp.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [file] })
  }
  const b = JSON.parse(JSON.stringify(expected))
  b.records++; b.recordBytes++; b.kinds[0].records++; b.kinds[0].recordBytes++
  const second = path.join(out, 'offline-pair-b.json'), invalid = path.join(out, 'offline-pair-invalid.json')
  writeFileSync(second, JSON.stringify(b)); writeFileSync(invalid, '{')
  await select('a', filename); await select('b', second)
  await until(async () => (await state('a')) === 'ready' && (await state('b')) === 'ready', 'Two real offline reports did not become ready')
  assert.equal(await hasResult(), false)
  await click('[data-offline-compare]'); await until(hasResult, 'Explicit offline comparison missing')
  const snapshot = () => evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>({key:r.getAttribute('data-offline-metric'),a:Number(r.cells[1].textContent),b:Number(r.cells[2].textContent),delta:r.cells[3].textContent,unit:r.cells[4].textContent}))")
  const values = report => [report.records, report.recordBytes, report.attachmentBytes, report.baseItems,
    ...report.kinds.flatMap(kind => [kind.records, kind.recordBytes])]
  const keys = ['records','recordBytes','attachmentBytes','baseItems','file:records','file:bytes','tag:records','tag:bytes','file-tag:records','file-tag:bytes','attachment:records','attachment:bytes']
  const units = ['项','B','B','项','项','B','项','B','项','B','项','B']
  const expectedRows = (a, b) => values(a).map((n, i) => {
    const right = values(b)[i], delta = right - n
    return { key: keys[i], a: n, b: right, delta: delta > 0 ? `+${delta}` : String(delta), unit: units[i] }
  })
  const forward = await snapshot(); assert.deepEqual(forward, expectedRows(expected, b))
  await click('[data-offline-swap]'); assert.equal(await hasResult(), false)
  await click('[data-offline-compare]'); await until(hasResult, 'Swapped explicit comparison missing')
  const reverse = await snapshot(); assert.deepEqual(reverse, expectedRows(b, expected))
  await evaluate("document.querySelector('[data-offline-result]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  writeFileSync(path.join(out, 'offline-report-pair.png'), png)
  await verifyOfflinePairExportDesktop({ evaluate, click, cdp, until, api, out, noteIDs, reverse })
  await select('a', invalid); await until(async () => (await state('a')) === 'failed', 'Invalid replacement was not refused')
  assert.equal(await hasResult(), false); assert.equal(await state('b'), 'ready')
  assert.equal(await evaluate("document.querySelector('[data-offline-compare]').disabled"), true)
  await click('[data-offline-pair] > summary')
  await until(async () => (await state('a')) === 'idle' && (await state('b')) === 'idle', 'Closing did not clear the offline pair')
  assert.equal(await hasResult(), false); assert.equal(await evaluate('location.href'), urlBefore)
  assert.deepEqual(await api('/api/files'), listBefore)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  writeFileSync(path.join(out, 'offline-report-pair-checks.json'), JSON.stringify({ complete: true,
    commit: process.env.GITHUB_SHA, realPackagedApp: true, realFileReader: true, syntheticData: true, forward, reverse,
    checks: ['two-actual-file-inputs', 'explicit-comparison-required', 'all-twelve-values-and-B-minus-A',
      'swap-revokes-and-reverses', 'invalid-replacement-clears-result', 'other-side-preserved', 'close-clears-both', 'no-navigation-or-note-write'],
    screenshot: { filename: 'offline-report-pair.png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') },
  }, null, 2))
}
