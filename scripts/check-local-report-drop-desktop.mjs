import assert from 'node:assert/strict'
import { verifyOfflineReportPairDesktop } from './check-offline-report-pair-desktop.mjs'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// CDP dispatches native Chromium drag events with real isolated filesystem
// files. No FileReader, parser, React handler, response or clock is replaced.
export async function verifyLocalReportDropDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, expected }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const filesBefore = await api('/api/files'), pageBefore = await evaluate('location.href')
  const drag = async (files, items = []) => {
    const point = await evaluate(`(()=>{const n=document.querySelector('[data-local-report-drop]');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await cdp.send('Page.bringToFront')
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', {
      type, ...point, data: { files, items, dragOperationsMask: 1 },
    })
  }
  const state = () => evaluate("document.querySelector('[data-local-file-state]')?.getAttribute('data-local-file-state')")
  const status = () => evaluate("document.querySelector('[data-local-report-drop-status]')?.getAttribute('data-local-report-drop-status')")
  await drag([filename])
  await until(async () => await state() === 'ready', 'Actual dropped file was not accepted')
  const rows = await evaluate("[...document.querySelectorAll('[data-local-file-result] tbody tr')].map(r=>[...r.cells].map(c=>c.textContent))")
  assert.deepEqual(rows.map(r => Number(r[1])), expected.kinds.map(r => r.records))
  assert.deepEqual(rows.map(r => r[2]), expected.kinds.map(r => r.recordBytes + ' B'))
  assert.equal(await evaluate("document.querySelector('[data-local-report-drop]').getAttribute('data-file-drag')"), 'false')
  const bad = path.join(out, 'drop-invalid.json'); writeFileSync(bad, '{')
  await drag([filename, bad]); assert.equal(await status(), 'drop-one-file'); assert.equal(await state(), 'ready')
  await drag([], [{ mimeType: 'text/plain', data: 'PRIVATE_NOT_A_REPORT' }])
  assert.equal(await status(), 'drop-file-required'); assert.equal(await state(), 'ready')
  await drag([bad]); await until(async () => await state() === 'failed', 'Malformed dropped file was not refused')
  assert.equal(await evaluate("!!document.querySelector('[data-local-file-result]')"), false)
  await drag([filename]); await until(async () => await state() === 'ready', 'Explicit fresh drop failed')
  assert.equal(await evaluate('location.href'), pageBefore)
  assert.deepEqual(await api('/api/files'), filesBefore, 'Dropping a report imported an unwanted note')
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  await evaluate("document.querySelector('[data-local-report-drop]').scrollIntoView({block:'start'}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  writeFileSync(path.join(out, 'local-report-drop.png'), png)
  writeFileSync(path.join(out, 'local-report-drop-checks.json'), JSON.stringify({
    complete: true, commit: process.env.GITHUB_SHA, realPackagedApp: true, realFileReader: true,
    nativeChromiumDrag: true, syntheticData: true, rows,
    checks: ['actual-dropped-export-file', 'four-counts-and-exact-bytes', 'multi-file-preserves-current',
      'text-refusal-preserves-current', 'invalid-json-clears-old-result', 'explicit-retry', 'no-navigation-or-note-import'],
    screenshot: { filename: 'local-report-drop.png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') },
  }, null, 2))
  await click('[data-local-report-drop] button')
  await verifyOfflineReportPairDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, expected })
}
