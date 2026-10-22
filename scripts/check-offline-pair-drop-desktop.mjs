import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Native Chromium drag delivery with actual isolated files. Do not replace
// FileReader, React callbacks, validation, browser clocks or backend responses.
export async function verifyOfflinePairDropDesktop({ evaluate, click, cdp, until, api, out, noteIDs, filename, second }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const listBefore = await api('/api/files'), urlBefore = await evaluate('location.href')
  await click('[data-offline-pair] > summary')
  const state = side => evaluate(`document.querySelector('[data-offline-side="${side}"] [data-offline-state]').getAttribute('data-offline-state')`)
  const status = side => evaluate(`document.querySelector('[data-offline-drop="${side}"] [data-offline-drop-status]').getAttribute('data-offline-drop-status')`)
  const rows = () => evaluate("[...document.querySelectorAll('[data-offline-result] tbody tr')].map(r=>({key:r.getAttribute('data-offline-metric'),a:+r.cells[1].textContent,b:+r.cells[2].textContent,delta:r.cells[3].textContent}))")
  const drag = async (side, files, items = []) => {
    const point = await evaluate(`(()=>{const n=document.querySelector('[data-offline-drop="${side}"] [data-offline-drop-label]');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await cdp.send('Page.bringToFront')
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', {
      type, ...point, data: { files, items, dragOperationsMask: 1 },
    })
  }
  await drag('a', [filename]); await drag('b', [second])
  await until(async () => (await state('a')) === 'ready' && (await state('b')) === 'ready', 'Dropped reports did not become ready')
  assert.equal((await rows()).length, 0)
  await click('[data-offline-compare]'); const initial = await rows()
  assert.equal(initial.length, 12); assert.equal(initial[0].delta, '+1')
  await drag('a', [filename, second])
  await until(async () => (await status('a')) === 'drop-one-file', 'Multiple-drop refusal missing')
  assert.deepEqual(await rows(), initial); assert.equal(await state('b'), 'ready')
  await drag('a', [], [{ mimeType: 'text/plain', data: 'not a report' }])
  await until(async () => (await status('a')) === 'drop-file-required', 'Non-file hover refusal missing')
  assert.deepEqual(await rows(), initial)
  const invalid = path.join(out, 'offline-drop-invalid.json'); writeFileSync(invalid, '{')
  await drag('a', [invalid]); await until(async () => (await state('a')) === 'failed', 'Invalid dropped report not refused')
  assert.equal((await rows()).length, 0); assert.equal(await state('b'), 'ready')
  assert.equal(await evaluate("document.querySelector('[data-offline-export]')===null"), true)
  await drag('a', [filename]); await until(async () => (await state('a')) === 'ready', 'Explicit replacement failed')
  assert.equal((await rows()).length, 0); await click('[data-offline-compare]'); assert.deepEqual(await rows(), initial)
  await click('[data-offline-swap]'); assert.equal((await rows()).length, 0); await click('[data-offline-compare]')
  const reversed = await rows()
  assert.deepEqual(reversed, initial.map(r => ({ key: r.key, a: r.b, b: r.a, delta: +r.delta === 0 ? '0' : +r.delta > 0 ? String(-r.delta) : `+${-r.delta}` })))
  await evaluate("document.querySelector('[data-offline-drop=a]').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  writeFileSync(path.join(out, 'offline-pair-drop.png'), png)
  await click('[data-offline-pair] > summary')
  await until(async () => (await state('a')) === 'idle' && (await state('b')) === 'idle', 'Close did not clear dropped reports')
  assert.equal(await evaluate('location.href'), urlBefore)
  assert.deepEqual(await api('/api/files'), listBefore)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  writeFileSync(path.join(out, 'offline-pair-drop-checks.json'), JSON.stringify({ complete: true, commit: process.env.GITHUB_SHA,
    realPackagedApp: true, realFileReader: true, nativeChromiumDrag: true, syntheticData: true, initial, reversed,
    checks: ['two-real-side-drops', 'explicit-comparison-and-twelve-values', 'multi-drop-preserves-both', 'text-hover-refusal-preserves-comparison',
      'bad-replacement-clears-only-own-side-and-exports', 'explicit-retry-and-swap-direction', 'close-clears-dropped-files', 'no-navigation-or-note-import'],
    screenshot: { filename: 'offline-pair-drop.png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') },
  }, null, 2))
}
