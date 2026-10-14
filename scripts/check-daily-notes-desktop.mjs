import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Uses the production renderer/Go database. The sole fault injection drops a
// POST response after the real server has committed the creation.
export async function verifyDailyNotesDesktop({ evaluate, click, cdp, until, api, out, noteIDs }) {
  const report = { complete: false, commit: process.env.GITHUB_SHA, realPackagedApp: true, realBackend: true, syntheticData: true, checks: [], screenshots: [] }
  const save = () => writeFileSync(path.join(out, 'daily-notes.json'), JSON.stringify(report, null, 2) + '\n')
  const mark = name => { report.checks.push(name); save() }; save()
  const original = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  let detach = null, interception = false, interceptionError = null
  const pending = new Set(), faults = []
  const openWorkspace = async () => { await click('button[aria-label="每日笔记"]'); await until(() => evaluate("!!document.querySelector('.daily-notes-panel .calendar-day[aria-label]:enabled')"), 'Daily workspace failed to load') }
  const action = async label => {
    assert.equal(await evaluate(`(()=>{const n=[...document.querySelectorAll('.daily-notes-panel button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!n||n.disabled)return false;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!n.contains(hit))return false;n.setAttribute('data-daily-click','');return true})()`), true, 'Daily action not reachable: ' + label)
    try { await click('[data-daily-click]') } finally { await evaluate("document.querySelector('[data-daily-click]')?.removeAttribute('data-daily-click')") }
  }
  const choose = async date => {
    await evaluate(`(()=>{const n=document.querySelector('input[aria-label="跳转日期"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(date)});n.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await action('查看日期'); await until(() => evaluate(`!!document.querySelector('.calendar-day[aria-label^="${date}"]')`), 'Date jump failed')
    await click(`.calendar-day[aria-label^="${date}"]`)
  }
  const current = date => api('/api/files/daily/' + date + '?read_only=1')
  const screenshot = async name => { const b = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'); writeFileSync(path.join(out, name), b); report.screenshots.push({ filename: name, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }); save() }
  try {
    const date = '2097-02-20', faultDate = '2097-02-21'
    assert.equal((await current(date)).file, null); assert.equal((await current(faultDate)).file, null)
    await openWorkspace(); assert.equal((await current(date)).file, null); mark('entry-and-calendar-browsing-do-not-create')
    await choose(date); await until(() => evaluate("!!document.querySelector('.editor-input') && !document.querySelector('.daily-notes-panel')"), 'New daily did not open editor')
    const created = (await current(date)).file; assert.ok(created?.id); assert.equal(created.parent_id, ''); mark('one-root-date-created-and-opened')
    await click('.editor-input[contenteditable="true"]'); await cdp.send('Input.insertText', { text: 'daily-native-saved-body' })
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 's', windowsVirtualKeyCode: 83, modifiers: 2 })
    await until(async () => (await current(date)).file.content.includes('daily-native-saved-body'), 'Daily body not saved by original editor')
    await until(() => evaluate("!document.querySelector('.save-state')"), 'Daily save still pending'); mark('original-editor-save-persists-daily-body')
    await openWorkspace(); await choose(date); await until(() => evaluate("document.querySelector('.editor-input')?.innerText.includes('daily-native-saved-body')"), 'Existing daily body not reopened')
    assert.equal((await current(date)).file.id, created.id); mark('reopen-retains-id-and-saved-body')
    const parallel = await Promise.all(Array.from({ length: 6 }, () => api('/api/files/daily/' + date, { method: 'POST' })))
    assert.ok(parallel.every(r => r.file.id === created.id && r.created === false)); mark('parallel-open-does-not-duplicate-or-overwrite')
    const invalid = await fetch('http://127.0.0.1:27121/api/files/daily/2025-02-29', { method: 'POST', headers: { Origin: 'null' }, signal: AbortSignal.timeout(4000) })
    assert.notEqual((await invalid.json()).code, 0); mark('invalid-calendar-date-refused-by-production-server')
    await openWorkspace()
    const target = 'http://127.0.0.1:27121/api/files/daily/' + faultDate
    detach = cdp.onEvent(message => {
      if (message.method !== 'Fetch.requestPaused') return
      const { requestId, request, responseStatusCode } = message.params
      const drop = request.url === target && request.method === 'POST' && responseStatusCode === 200
      if (drop) faults.push({ url: request.url, method: request.method, responseStatusCode })
      const task = cdp.send(drop ? 'Fetch.failRequest' : 'Fetch.continueRequest', drop ? { requestId, errorReason: 'Failed' } : { requestId })
        .catch(error => { interceptionError ||= error }).finally(() => pending.delete(task)); pending.add(task)
    })
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: target, requestStage: 'Response' }] }); interception = true
    await choose(faultDate); await until(() => evaluate("document.querySelector('.daily-notes-panel')?.innerText.includes('创建结果未确认')"), 'Unconfirmed creation result not visible')
    const committed = (await current(faultDate)).file; assert.ok(committed?.id); assert.equal(faults.length, 1); mark('real-committed-create-with-lost-response-is-uncertain')
    await cdp.send('Fetch.disable'); interception = false; await Promise.all([...pending]); detach(); detach = null; if (interceptionError) throw interceptionError
    await action('核对并打开记录'); await until(() => evaluate("!!document.querySelector('.editor-input') && !document.querySelector('.daily-notes-panel')"), 'Read-only reconciliation did not open record')
    await until(() => evaluate("!document.querySelector('.save-state')"), 'Opening a pristine daily note incorrectly dirtied the editor')
    assert.equal((await current(faultDate)).file.id, committed.id); report.failureInjection = { exactPostResponseOnly: true, faults }; mark('read-only-reconciliation-finds-same-committed-note')
    await openWorkspace(); await screenshot('daily-notes-installed.png'); await click('.daily-notes-panel button[aria-label="返回笔记"]'); mark('workspace-can-close-and-reopen')
    assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), original); mark('original-fixture-notes-unchanged')
    report.complete = true; save()
  } catch (error) { report.error = String(error.stack || error); save(); throw error }
  finally { if (interception) await cdp.send('Fetch.disable'); await Promise.all([...pending]); detach?.() }
}
