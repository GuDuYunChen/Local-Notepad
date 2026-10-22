import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createInspectionFixture, FIXTURE_BUCKET, FIXTURE_REGION, FIXTURE_PREFIX, FIXTURE_KEY, FIXTURE_ID, FIXTURE_SECRET, FIXTURE_TOKEN } from './s3-inspection-fixture.mjs'

// Runs inside the existing Windows packaged-app acceptance process. All inputs
// enter the real Settings panel via CDP input; preload/main/Go are not replaced.
export async function verifyS3InspectionDesktop({ evaluate, click, cdp, until, api, out, noteIDs }) {
  assert.equal(process.platform, 'win32')
  const report = { complete: false, commit: process.env.GITHUB_SHA || '', platform: process.platform,
    realPackagedApp: true, realPreload: true, realBackend: true, syntheticObjectOrigin: true,
    cloudProviderTested: false, checks: [], screenshots: [], startedAt: new Date().toISOString() }
  const save = () => writeFileSync(path.join(out, 's3-inspection.json'), JSON.stringify(report, null, 2) + '\n')
  save()
  const fixture = await createInspectionFixture()
  let before, checksComplete = false
  const values = { endpoint: fixture.endpoint, bucket: FIXTURE_BUCKET, region: FIXTURE_REGION,
    prefix: FIXTURE_PREFIX, key: FIXTURE_KEY, accessKeyId: FIXTURE_ID, secretAccessKey: FIXTURE_SECRET, sessionToken: FIXTURE_TOKEN }
  const text = () => evaluate("document.querySelector('.s3-inspection').innerText")
  const state = () => evaluate("document.querySelector('.s3-inspection-result')?.dataset.state")
  const waitState = expected => until(async () => await state() === expected, 'Unexpected real inspection state: ' + expected, 12000)
  const button = async name => {
    assert.equal(await evaluate(`(()=>{const list=[...document.querySelectorAll('.s3-inspection button')].filter(n=>n.textContent===${JSON.stringify(name)});if(list.length!==1||list[0].disabled)return false;list[0].setAttribute('data-s3-native-click','');return true})()`), true, 'Missing enabled action ' + name)
    try { await click('[data-s3-native-click]') }
    finally { await evaluate("document.querySelector('[data-s3-native-click]')?.removeAttribute('data-s3-native-click')") }
  }
  const fill = async (name, value) => {
    await click('.s3-inspection input[name="' + name + '"]')
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', windowsVirtualKeyCode: 65, modifiers: 2 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', windowsVirtualKeyCode: 65, modifiers: 2 })
    await cdp.send('Input.insertText', { text: value })
    assert.equal(await evaluate(`document.querySelector('.s3-inspection input[name="${name}"]').value`), value)
  }
  const prepare = async () => {
    for (const [name, value] of Object.entries(values)) await fill(name, value)
    await click('.s3-inspection-consent input')
    assert.equal(await evaluate("document.querySelector('.s3-inspection-consent input').checked"), true)
  }
  const check = async (expectRequest = true) => {
    const beforeCount = fixture.counts().requests
    const label = await evaluate("document.querySelector('.s3-inspection-actions .primary').textContent")
    await button(label)
    if (expectRequest) await until(() => fixture.counts().requests === beforeCount + 1, 'Expected one real outbound object request')
  }
  const mark = name => { fixture.verify(); report.checks.push(name); save() }
  const noDisclosure = async () => {
    const content = await text()
    for (const value of [FIXTURE_SECRET, FIXTURE_TOKEN, 'synthetic-object', 'late-object']) assert.ok(!content.includes(value), 'Sensitive body in UI')
    assert.equal(await evaluate(`(()=>{const s=JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]);return ${JSON.stringify([FIXTURE_ID, FIXTURE_SECRET, FIXTURE_TOKEN])}.some(v=>s.includes(v))})()`), false, 'Credentials persisted in web storage')
  }
  const screenshot = async filename => {
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    writeFileSync(path.join(out, filename), bytes)
    report.screenshots.push({ filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); save()
  }
  try {
    before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
    assert.equal(await evaluate("typeof window.electronAPI.s3ProbeRead"), 'function')
    await until(() => evaluate("!!document.querySelector('.s3-inspection-opener')"), 'Actual Settings module missing')
    await button('打开云端只读检查'); await waitState('idle')
    assert.equal(fixture.counts().requests, 0)
    await check(false)
    assert.equal(await evaluate("!!document.querySelector('.s3-inspection [role=alert]')"), true)
    assert.equal(fixture.counts().requests, 0); mark('entry-and-invalid-form-never-read')
    await prepare(); await check(); await waitState('readable')
    assert.equal(fixture.counts().requests, 1)
    assert.match(await text(), /0 B/); await noDisclosure(); mark('real-settings-preload-main-go-signed-empty-object')
    fixture.setMode('good'); await check(); await waitState('readable')
    assert.match(await text(), /16 B/); await noDisclosure(); mark('complete-object-count-without-body-disclosure')
    await screenshot('s3-inspection-success.png')
    const failures = [['denied', /不能据此判断密码错误/], ['not-found', /404/], ['redirect', /重定向被拒绝/], ['server-error', /HTTP状态/], ['encoding', /正文或编码/]]
    for (const [mode, message] of failures) {
      fixture.setMode(mode); const count = fixture.counts().requests
      await check(); await waitState('failed'); assert.match(await text(), message)
      assert.equal(fixture.counts().requests, count + 1); await noDisclosure(); mark(mode + '-one-request-no-auto-retry')
    }
    fixture.setMode('good'); await fill('maxBytes', '4'); await check(); await waitState('failed')
    assert.match(await text(), /超过本次读取限额/); mark('oversize-object-refused-with-zero-accepted-data')
    await fill('maxBytes', '1048576'); await check(); await waitState('readable'); mark('manual-retry-after-correcting-limit')
    await fill('key', 'B'); await fill('key', FIXTURE_KEY)
    assert.equal(await evaluate("document.querySelector('.s3-inspection-metrics')===null"), true); mark('input-a-b-a-does-not-revive-completed-result')
    fixture.setMode('hold'); const start = fixture.counts().requests
    await check(); await waitState('pending')
    await until(() => fixture.counts().held === 1, 'Real outbound request did not reach the held fixture')
    await button('停止采用'); await check(false)
    assert.equal(fixture.counts().requests, start + 1); assert.match(await text(), /上一次原生调用尚未返回/)
    fixture.release(); await sleep(300); assert.equal(await state(), 'stopped')
    fixture.setMode('good'); await check(); await waitState('readable'); mark('stop-busy-late-result-rejection-and-manual-recovery')
    fixture.setMode('hold'); await check(); await waitState('pending')
    await until(() => fixture.counts().held === 1, 'Native timeout fixture was not reached')
    // No accelerated timers: the original Go/main deadline ends the operation.
    await waitState('failed'); assert.match(await text(), /超时/); fixture.release(); mark('actual-native-deadline-no-partial-success')
    fixture.setMode('empty'); await check(); await waitState('readable'); mark('manual-recovery-after-native-timeout')
    await button('清空全部输入')
    for (const name of Object.keys(values)) assert.equal(await evaluate(`document.querySelector('.s3-inspection input[name="${name}"]').value`), '')
    await prepare(); // The entry is already open, only refill controls.
    await button('关闭并清空')
    assert.equal(await evaluate("document.activeElement===document.querySelector('.s3-inspection-opener')"), true)
    await button('打开云端只读检查'); await waitState('idle')
    for (const name of Object.keys(values)) assert.equal(await evaluate(`document.querySelector('.s3-inspection input[name="${name}"]').value`), '')
    await noDisclosure(); mark('clear-close-reopen-empty-with-entry-focus')
    await screenshot('s3-inspection-cleared.png'); await button('关闭并清空')
    assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before, 'Inspection changed fixture notes')
    mark('original-note-data-unchanged')
    report.counts = fixture.counts(); checksComplete = true
  } catch (error) {
    report.failure = 'Native inspection acceptance failed; see assertion in job log'
    throw error
  } finally {
    try { await fixture.close(); report.cleanupComplete = true }
    finally { report.complete = checksComplete && report.cleanupComplete === true; report.finishedAt = new Date().toISOString(); save() }
  }
}
