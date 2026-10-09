import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Select the actual file produced by the previous packaged-app export check.
// DOM.setFileInputFiles simulates choosing this owned fixture; FileReader,
// renderer validation and the visible table are all production implementations.
export async function verifyLocalOverviewFileDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, expected }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  await click('[data-local-report-file] summary')
  assert.equal(await evaluate("document.querySelector('[data-local-file-result]')===null"), true)
  const choose = async file => {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-local-report-file] input[type=file]' })
    assert.ok(nodeId, 'Missing real file picker')
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: [file] })
  }
  await choose(filename)
  await until(() => evaluate("document.querySelector('[data-local-file-state]')?.getAttribute('data-local-file-state')==='ready'"), 'Offline file was not accepted')
  const view = await evaluate(`(()=>{const n=document.querySelector('[data-local-report-file]');return {text:n.innerText, time:n.querySelector('time').textContent, rows:[...n.querySelectorAll('tbody tr')].map(r=>[...r.cells].map(c=>c.textContent))}})()`)
  assert.deepEqual(view.rows.map(r => Number(r[1])), expected.kinds.map(r => r.records))
  assert.deepEqual(view.rows.map(r => r[2]), expected.kinds.map(r => r.recordBytes + ' B'))
  assert.equal(view.time, expected.generatedAtUTC)
  assert.match(view.text, /不是当前工作区/); assert.match(view.text, /来源和真实性未经验证/)
  await evaluate("document.querySelector('[data-local-file-result]').scrollIntoView({block:'center'}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  writeFileSync(path.join(out, 'local-file.png'), png)
  await click('[data-local-report-file] button')
  assert.equal(await evaluate("document.querySelector('[data-local-file-result]')===null"), true)
  const bad = path.join(out, 'invalid-offline-report.json'); writeFileSync(bad, '{')
  await choose(bad)
  await until(() => evaluate("document.querySelector('[data-local-file-state]')?.getAttribute('data-local-file-state')==='failed'"), 'Malformed file was not refused')
  assert.equal(await evaluate("document.querySelector('[data-local-file-result]')===null"), true)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  writeFileSync(path.join(out, 'local-file-checks.json'), JSON.stringify({ complete: true, commit: process.env.GITHUB_SHA,
    realPackagedApp: true, realFileReader: true, syntheticData: true,
    checks: ['actual-exported-file-selected', 'all-four-counts-and-bytes-match', 'declared-time-matches', 'untrusted-file-scope-visible', 'clear-removes-result', 'malformed-file-refused', 'notes-unchanged'],
    screenshot: { filename: 'local-file.png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') }, view }, null, 2))
  await click('[data-local-report-file] button')
}
