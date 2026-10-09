import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Extend the original packaged-app check, not a replacement renderer/clipboard
// implementation. Only CDP download destination and read-side user gesture are
// configured in this isolated test process. No actual user workspace is used.
export async function verifyLocalOverviewReportDesktop({ evaluate, click, cdp, until, api, out, noteIDs, rows }) {
  const before = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  await cdp.send('Page.bringToFront')
  await click('[data-local-report-copy]')
  await until(() => evaluate("document.querySelector('[data-local-report-status]')?.getAttribute('data-local-report-status')==='copied'"), 'Clipboard write was not confirmed')
  const clipboard = await cdp.send('Runtime.evaluate', { expression: 'navigator.clipboard.readText()',
    awaitPromise: true, returnByValue: true, userGesture: true })
  assert.equal(clipboard.exceptionDetails, undefined)
  const text = clipboard.result.value
  assert.equal(typeof text, 'string'); assert.match(text, /Local-Notepad 本地盘点报告/)
  assert.match(text, /不是读取完成时间/); assert.match(text, /不是笔记备份/)
  assert.ok(Buffer.byteLength(text) <= 4096)
  const destination = path.join(out, 'report-downloads'); mkdirSync(destination, { recursive: true })
  assert.equal(readdirSync(destination).length, 0, 'Do not reuse a previous report download')
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: destination })
  await click('[data-local-report-download]')
  const filename = await until(() => {
    const found = readdirSync(destination).filter(n => /^Local-Notepad-local-inventory-.*\.json$/.test(n))
    return found.length === 1 ? found[0] : null
  }, 'Actual report download did not complete')
  const bytes = readFileSync(path.join(destination, filename)); assert.ok(bytes.length <= 4096)
  const report = JSON.parse(bytes)
  assert.equal(report.format, 'local-notepad-local-inventory-report'); assert.equal(report.version, 1)
  assert.equal(report.scope, 'previously-read-local-observation'); assert.equal(report.readOnly, true)
  assert.equal(report.completeForPreview, false); assert.equal(report.generationTimeIsObservationTime, false)
  assert.deepEqual(report.kinds.map(r => r.kind), ['file','tag','file-tag','attachment'])
  assert.deepEqual(report.kinds.map(r => r.records), rows.map(row => Number(row[1])))
  assert.equal(report.records, report.kinds.reduce((n,r) => n+r.records, 0))
  assert.equal(report.recordBytes, report.kinds.reduce((n,r) => n+r.recordBytes, 0))
  assert.match(text, new RegExp(`记录合计：${report.records}(?:\\n|$)`))
  for (const privateValue of [...noteIDs, 'Desktop save A.md', 'Desktop save B.md', 'native-close-latest']) {
    assert.ok(!text.includes(privateValue)); assert.ok(!bytes.toString().includes(privateValue))
  }
  assert.match(await evaluate("document.querySelector('[data-local-report-status]').textContent"), /尚未确认落盘/)
  assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), before)
  await evaluate("document.querySelector('[data-local-report]').scrollIntoView({block:'center'}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
  const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  const hash = b => createHash('sha256').update(b).digest('hex')
  writeFileSync(path.join(out, 'local-report.png'), png)
  writeFileSync(path.join(out, 'local-report-clipboard.txt'), text)
  writeFileSync(path.join(out, 'local-report-export.json'), bytes)
  writeFileSync(path.join(out, 'local-report-checks.json'), JSON.stringify({ complete: true, commit: process.env.GITHUB_SHA,
    realPackagedApp: true, realClipboard: true, realDownload: true, syntheticData: true,
    checks: ['actual-system-clipboard', 'actual-downloaded-json', 'source-category-counts-match', 'no-private-note-data', 'generation-not-observation-time', 'no-false-saved-receipt', 'notes-unchanged'],
    export: { filename, bytes: bytes.length, sha256: hash(bytes) }, clipboard: { bytes: Buffer.byteLength(text), sha256: hash(Buffer.from(text)) },
    screenshot: { filename: 'local-report.png', bytes: png.length, sha256: hash(png) } }, null, 2))
}
