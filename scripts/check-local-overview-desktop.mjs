import assert from 'node:assert/strict'
import { verifyLocalOverviewReportDesktop } from './check-local-overview-report-desktop.mjs'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Invoked inside the original owned packaged-app desktop test. No replacement
// preload, HTTP response, renderer module, clock, database or cancellation.
export async function verifyLocalOverviewDesktop({ evaluate, click, cdp, until, api, out, noteIDs }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  assert.equal(await evaluate("typeof window.electronAPI.s3LocalOverviewRead"), 'function')
  const denied = await fetch('http://127.0.0.1:27121/api/sync/s3/local-overview', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Notepad-Read-Only': 's3-local-overview' },
    body: '{"readOnly":true}', signal: AbortSignal.timeout(3000),
  })
  assert.equal(denied.status, 403); assert.equal((await denied.json()).data, null)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
  await click('[aria-label="更多功能"]')
  assert.equal(await evaluate(`(()=>{const items=[...document.querySelectorAll('[role=menuitem]')].filter(n=>n.textContent.trim()==='设置');if(items.length!==1)return false;items[0].setAttribute('data-local-test-settings','');return true})()`), true)
  await click('[data-local-test-settings]')
  await until(() => evaluate("!!document.querySelector('[data-local-inventory]')"), 'Local inventory panel missing')
  assert.equal(await evaluate("document.querySelector('[data-local-inventory] table')===null"), true)
  await click('[data-local-inventory] button')
  await until(() => evaluate("!!document.querySelector('[data-local-inventory] table')"), 'Authorized real local inventory did not complete', 12000)
  const snapshot = await evaluate(`(()=>{const panel=document.querySelector('[data-local-inventory]');return {text:panel.innerText,rows:[...panel.querySelectorAll('tbody tr')].map(r=>[...r.cells].map(c=>c.textContent)),tokenKeys:Object.keys(window.electronAPI).filter(k=>/token/i.test(k))}})()`)
  assert.equal(snapshot.rows.length, 4); assert.equal(Number(snapshot.rows[0][1]), 2)
  assert.deepEqual(snapshot.tokenKeys, []); assert.match(snapshot.text, /本次盘点已完成/)
  const invalid = await evaluate("window.electronAPI.s3LocalOverviewRead({readOnly:true,path:'not-authorized'})")
  assert.equal(invalid.success, false); assert.equal(invalid.data, null)
  const after = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  assert.deepEqual(after, before, 'Inventory changed note data')
  await evaluate("document.querySelector('[data-local-inventory]').scrollIntoView({block:'start'}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  writeFileSync(path.join(out, 'local-overview.png'), png)
  writeFileSync(path.join(out, 'local-overview.json'), JSON.stringify({
    complete: true, commit: process.env.GITHUB_SHA, realPackagedApp: true, realPreload: true, realBackend: true,
    syntheticData: true, rows: snapshot.rows, text: snapshot.text,
    checks: ['unauthenticated-http-refused', 'no-implicit-panel-result', 'real-click-through-ipc-and-go', 'four-real-categories', 'invalid-path-refused', 'source-notes-unchanged', 'no-renderer-token'],
    screenshot: { filename: 'local-overview.png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') },
  }, null, 2))
  await verifyLocalOverviewReportDesktop({ evaluate, click, cdp, until, api, out, noteIDs, rows: snapshot.rows })
  await click('[aria-label="返回笔记"]')
}
