import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { READING_CHECKS, READING_ATTEMPTS, validateReadingModeDesktopReport, verifyReadingModeDesktopReport } from './reading-mode-desktop-evidence.mjs'
import { readingEvidenceFixture } from './reading-mode-test-fixture.mjs'

const validate = report => validateReadingModeDesktopReport(report, 'b'.repeat(40), 'a'.repeat(40))
test('reading report contract binds draft, native guards, exact changes and real reload', () => assert.equal(validate(readingEvidenceFixture()), true))
for (const [name, mutate] of [
  ['prior version report', r => r.version = '4.233.0'], ['previous import version', r => r.version = '4.232.0'],
  ['wrong verifier', r => r.commit = 'c'.repeat(40)], ['wrong product', r => r.productCommit = 'c'.repeat(40)],
  ['not Windows', r => r.platform = 'linux'], ['no native process', r => r.processID = 0],
  ...['complete', 'realPackagedApp', 'realBackend', 'realPreload', 'syntheticData', 'dirtyWhileReading',
    'onlyIntendedCaptionSaved', 'onlyIntendedTodoSaved', 'rendererReloaded'].map(key => ['missing ' + key, r => r[key] = false]),
  ['bridge replacement', r => r.bridgeOverridden = true], ['accelerated timer', r => r.timerAccelerated = true],
  ['native failure', r => r.error = 'native input failed'],
  ...READING_CHECKS.map(check => ['missing gate ' + check, r => r.checks = r.checks.filter(value => value !== check)]),
  ...Object.keys(READING_ATTEMPTS).map(key => ['missing independent guard ' + key, r => delete r.attempts[key]]),
  ['draft written during reading', r => r.databaseDuringDraftSHA256 = '5'.repeat(64)],
  ['caption not saved', r => r.captionSavedSHA256 = r.draftSourceSHA256],
  ['reading changed body', r => r.afterReadSHA256 = '5'.repeat(64)],
  ['edit Todo not saved', r => r.savedSHA256 = r.afterReadSHA256],
  ['reload lost body', r => r.reloadedSHA256 = '5'.repeat(64)],
  ['missing image', r => r.screenshots.pop()], ['image path traversal', r => r.screenshots[0].filename = '../reading-mode-decorators.png'],
  ['image digest missing', r => r.screenshots[0].sha256 = 'bad'],
]) test('refuses reading evidence ' + name, () => { const r = readingEvidenceFixture(); mutate(r); assert.throws(() => validate(r)) })

test('on-disk reading evidence refuses missing, changed and non-PNG images', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'reading100-contract-'))
  try {
    const report = readingEvidenceFixture()
    const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('synthetic contract bytes')])
    const publish = () => writeFileSync(path.join(directory, 'reading-mode-desktop.json'), JSON.stringify(report))
    for (const image of report.screenshots) {
      image.bytes = bytes.length; image.sha256 = createHash('sha256').update(bytes).digest('hex')
      writeFileSync(path.join(directory, image.filename), bytes)
    }
    publish(); assert.equal(verifyReadingModeDesktopReport(directory, report.commit, report.productCommit).complete, true)
    writeFileSync(path.join(directory, report.screenshots[0].filename), Buffer.alloc(bytes.length))
    assert.throws(() => verifyReadingModeDesktopReport(directory, report.commit, report.productCommit))
    report.screenshots[0].sha256 = createHash('sha256').update(Buffer.alloc(bytes.length)).digest('hex'); publish()
    assert.throws(() => verifyReadingModeDesktopReport(directory, report.commit, report.productCommit))
    rmSync(path.join(directory, report.screenshots[1].filename))
    assert.throws(() => verifyReadingModeDesktopReport(directory, report.commit, report.productCommit))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
