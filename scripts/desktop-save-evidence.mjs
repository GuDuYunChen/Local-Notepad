import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Expectations are independent of the driver's implementation or UI model.
export function verifyDesktopSaveReport(directory, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  const report = JSON.parse(readFileSync(path.join(directory, 'checks.json'), 'utf8'))
  assert.equal(report.commit, commit); assert.equal(report.platform, 'win32')
  assert.equal(report.complete, true); assert.equal(report.error, undefined)
  for (const field of ['realPackagedApp', 'realLexical', 'realPreloadAndQuit', 'realBackend', 'syntheticData']) assert.equal(report[field], true)
  assert.equal(report.timerAccelerated, false)
  assert.equal(report.dirtyBeforeClose, true); assert.equal(report.noForcedBackendWarning, true)
  assert.equal(report.processIDs.length, 2); assert.ok(report.processIDs.every(pid => Number.isInteger(pid) && pid > 0))
  assert.deepEqual(report.exits, report.processIDs.map(pid => ({ pid, code: 0, signal: null, nativeClose: true })))
  assert.deepEqual(report.checks, [
    'production preload connected for process ' + report.processIDs[0],
    'native Ctrl+S saved actual heading and body without reference confirmation',
    'real library switch and reopen retain saved Lexical content',
    'real unaccelerated 30-second autosave persisted a changed heading',
    'real failed browser PUT retains draft, actual retry saves it',
    'WM_CLOSE with dirty Lexical body completed real quit gate and backend shutdown',
    'production preload connected for process ' + report.processIDs[1],
    'fresh-profile packaged restart reads latest body from real database and closes cleanly',
  ])
  for (const field of ['appSHA256', 'asarSHA256', 'backendSHA256', 'finalBodySHA256']) assert.match(report[field], /^[a-f0-9]{64}$/)
  const expected = [
    ['manual-saved', 'manual-native-4189'],
    ['automatic-saved', 'automatic-native-4189'],
    ['failure-retains-draft', 'recovered-after-block'],
    ['retry-saved', 'recovered-after-block'],
    ['restarted-fresh-profile', 'native-close-latest'],
  ]
  assert.equal(report.screenshots.length, expected.length)
  for (const [index, [name, marker]] of expected.entries()) {
    const item = report.screenshots[index]
    assert.equal(item.filename, name + '.png')
    assert.ok(item.text.includes(marker))
    const bytes = readFileSync(path.join(directory, item.filename))
    assert.equal(bytes.length, item.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.ok(bytes.readUInt32BE(16) >= 700 && bytes.readUInt32BE(20) >= 480)
  }
  return report
}
