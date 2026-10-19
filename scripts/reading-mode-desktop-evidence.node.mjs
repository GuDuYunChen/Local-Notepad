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
  ['previous reading version', r => r.version = '4.233.1'],
  ['wrong verifier', r => r.commit = 'c'.repeat(40)], ['wrong product', r => r.productCommit = 'c'.repeat(40)],
  ['not Windows', r => r.platform = 'linux'], ['no native process', r => r.processID = 0],
  ...['complete', 'realPackagedApp', 'realBackend', 'realPreload', 'syntheticData', 'dirtyWhileReading',
    'onlyIntendedCaptionSaved', 'onlyIntendedTodoSaved', 'rendererReloaded'].map(key => ['missing ' + key, r => r[key] = false]),
  ['bridge replacement', r => r.bridgeOverridden = true], ['accelerated timer', r => r.timerAccelerated = true],
  ['native failure', r => r.error = 'native input failed'],
  ...READING_CHECKS.map(check => ['missing gate ' + check, r => r.checks = r.checks.filter(value => value !== check)]),
  ...Object.keys(READING_ATTEMPTS).map(key => ['missing independent guard ' + key, r => delete r.attempts[key]]),
  ['missing native selection observation', r => delete r.captionSelection],
  ['wrong selected control', r => r.captionSelection.selector = '.code-textarea'],
  ['input did not own focus', r => r.captionSelection.focused = false],
  ['selection was collapsed at insertion point', r => { r.captionSelection.selectionStart = 3; r.captionSelection.selectionEnd = 3 }],
  ['selection omitted original prefix', r => r.captionSelection.selectionStart = 1],
  ['selection omitted original suffix', r => r.captionSelection.selectionEnd--],
  ['original caption already changed', r => r.captionSelection.value = '原始图reading100-native-caption片说明'],
  ['replacement input was read-only', r => r.captionSelection.readOnly = true],
  ['draft written during reading', r => r.databaseDuringDraftSHA256 = '5'.repeat(64)],
  ['caption not saved', r => r.captionSavedSHA256 = r.draftSourceSHA256],
  ['reading changed body', r => r.afterReadSHA256 = '5'.repeat(64)],
  ['edit Todo not saved', r => r.savedSHA256 = r.afterReadSHA256],
  ['reload lost body', r => r.reloadedSHA256 = '5'.repeat(64)],
  ['missing image', r => r.screenshots.pop()], ['image path traversal', r => r.screenshots[0].filename = '../reading-mode-decorators.png'],
  ['image digest missing', r => r.screenshots[0].sha256 = 'bad'],
]) test('refuses reading evidence ' + name, () => { const r = readingEvidenceFixture(); mutate(r); assert.throws(() => validate(r)) })

for (const [name, mutate] of [
  ['missing pending workflow', p => delete p.formula],
  ['reading formula renders unapplied expression', p => p.formula.reading.formulaExpression = 'y^3'],
  ['reading formula uses unapplied inline layout', p => p.formula.reading.formulaBlock = false],
  ['reading formula still shows editable textarea', p => p.formula.reading.formulaDraft = 'y^3'],
  ['reading formula lacks local pending notice', p => p.formula.reading.notices.formula = ''],
  ['reading formula lacks global pending registration', p => p.formula.reading.pendingText = ''],
  ['reading embed renders pending title', p => p.embed.reading.embedTitle = 'reading100-pending-embed'],
  ['reading embed loads pending URL', p => p.embed.reading.iframeSrc = p.embed.pendingURL.after.value],
  ['reading embed still shows editable URL', p => p.embed.reading.embedDraftURL = p.embed.pendingURL.after.value],
  ['reading embed lacks pending notice', p => p.embed.reading.notices.embed = ''],
  ['cancel navigation lost source note', p => p.formula.navigation.cancel.ui.sourceVisible = false],
  ['cancel navigation reached destination', p => p.embed.navigation.cancel.ui.destinationVisible = true],
  ['save dismissed unapplied dialog', p => p.formula.navigation.save.ui.dialogTitle = ''],
  ['save remained indefinitely busy', p => p.embed.navigation.save.ui.saveReady = false],
  ['save changed database before local apply', p => p.formula.navigation.save.bodySHA256 = '7'.repeat(64)],
  ['save lacks unapplied failure message', p => p.embed.navigation.save.failureText = ''],
  ['cancel did not dismiss navigation dialog', p => p.formula.navigation.cancel.ui.dialogTitle = '当前笔记未保存'],
  ['return from reading lost formula draft', p => p.formula.navigation.returned.ui.formulaDraft = 'x^2'],
  ['return from reading lost embed title', p => p.embed.navigation.returned.ui.embedDraftTitle = ''],
  ['formula Cancel retained unapplied textarea', p => p.formula.cancelled.ui.formulaDraft = 'y^3'],
  ['formula Cancel did not restore block layout', p => p.formula.cancelled.ui.formulaBlock = false],
  ['embed Cancel retained unapplied pending flag', p => p.embed.cancelled.ui.pendingText = '嵌入内容'],
  ['formula insertion lacked focus', p => p.formula.pendingSelection.focused = false],
  ['formula insertion had incomplete selection', p => p.formula.appliedSelection.selectionStart = 1],
  ['embed URL native deletion was partial', p => p.embed.pendingURL.cleared.value = 'https://prefix'],
  ['embed URL replacement value differs', p => p.embed.appliedURL.after.value = 'https://example.invalid/wrong'],
  ['embed title insertion had incomplete selection', p => p.embed.appliedTitleSelection.selectionEnd--],
  ['formula omitted actual manual-save shortcut', p => p.formula.saveKey = 'synthetic-save'],
  ['embed omitted actual manual-save shortcut', p => p.embed.saveKey = ''],
  ['formula application left local pending state', p => p.formula.saved.pendingText = '公式'],
  ['embed application left iframe from pending URL', p => p.embed.saved.iframeSrc = p.embed.pendingURL.after.value],
  ['quit skipped pending formula', p => p.quit.before.notices.formula = ''],
  ['quit lost pending embed', p => p.quit.after.notices.embed = ''],
  ['quit wrote an unapplied body', p => p.quit.afterBodySHA256 = '7'.repeat(64)],
  ['quit renderer restarted', p => p.quit.timeOriginAfter++],
  ['quit target belongs to another PID', p => p.quit.windowsBeforeClose[0].pid++],
  ['quit target lacks actual executable', p => delete p.quit.windowsBeforeClose[0].image],
  ['quit target has another image', p => p.quit.windowsBeforeClose[0].image = 'C:\\other\\Other.exe'],
  ['quit no longer has the main window during rejection', p => p.quit.windowsDuringBlock.shift()],
  ['native error has only a partial message', p => { p.quit.dialog.childText = ['未应用']; p.quit.windowsDuringBlock[1].childText = ['未应用'] }],
  ['native error has another title', p => { p.quit.dialog.title = 'Other error'; p.quit.windowsDuringBlock[1].title = 'Other error' }],
  ['native error belongs to another process', p => { p.quit.dialog.pid++; p.quit.windowsDuringBlock[1].pid++ }],
  ['ambiguous matching native error dialogs', p => p.quit.windowsDuringBlock.push({ ...p.quit.dialog, handle: 401 })],
  ['native dialog remains after claimed dismissal', p => p.quit.windowsAfterDismiss.push({ ...p.quit.dialog })],
  ['quit stopped process', p => p.quit.processStillAlive = false],
  ['quit stopped backend', p => p.quit.backendStillAlive = false],
  ['quit did not confirm narrow dismissal', p => p.quit.dismissed = false],
  ['native error evidence replaced by renderer screenshot', p => p.quit.dialogEvidence = 'renderer-screenshot'],
  ['missing native quit receipt', p => p.quit.helperEvents.splice(1, 1)],
  ['native close replayed', p => p.quit.helperEvents[2].type = 'close'],
  ['unexplained native operation', p => p.quit.helperEvents[2].type = 'other'],
  ['missing final native inspection', p => p.quit.helperEvents.pop()],
  ['replayed request ID', p => p.quit.helperEvents[3].id--],
  ['native receipt belongs to another PID', p => p.quit.helperEvents[1].pid++],
  ['unconfirmed native refusal close', p => p.quit.helperEvents[1].completed = false],
  ['recovery lost formula before explicit Cancel', p => p.recovery.returned.formulaDraft = 'x^2 + y^2'],
  ['recovery lost embed before explicit Cancel', p => p.recovery.returned.embedDraftURL = ''],
  ['recovery Cancel kept pending registration', p => p.recovery.cancelled.pendingText = '公式、嵌入内容'],
  ['recovery manual save changed committed body', p => p.recovery.bodySHA256 = '7'.repeat(64)],
  ['recovery navigation never resumed', p => p.recovery.destination.destinationVisible = false],
  ['recovery navigation still shows dialog', p => p.recovery.destination.dialogTitle = '当前笔记未保存'],
  ['destination note body changed', p => p.recovery.destinationBodySHA256 = '7'.repeat(64)],
  ['original note did not reopen', p => p.recovery.reopened.sourceVisible = false],
]) test('refuses pending-draft evidence ' + name, () => {
  const report = readingEvidenceFixture(); mutate(report.pendingDrafts); assert.throws(() => validate(report))
})

for (const stage of ['afterFormula', 'afterEmbed']) test(stage + ' exact body comparison refuses unrelated changes even with an honest recomputed digest', () => {
  const report = readingEvidenceFixture(), snapshot = report.pendingDrafts.bodies[stage]
  const document = JSON.parse(snapshot.content)
  document.root.children.find(node => node.type === 'image').caption = 'unrelated edit'
  snapshot.content = JSON.stringify(document); snapshot.sha256 = createHash('sha256').update(snapshot.content).digest('hex')
  if (stage === 'afterEmbed') report.pendingDrafts.bodies.final = { ...snapshot }
  assert.throws(() => validate(report), new RegExp(stage === 'afterFormula' ? 'Formula completion changed' : 'Embed completion changed'))
})
test('reading trace accepts preexisting installed-session IDs and additional observed dialog polls', () => {
  const report = readingEvidenceFixture(), events = report.pendingDrafts.quit.helperEvents
  events.splice(2, 0, { ...events[2] })
  events.splice(-1, 0, { ...events.at(-1) })
  for (const [index, event] of events.entries()) { event.id = index + 31; event.elapsedMs = index + 100 }
  assert.equal(validate(report), true)
})
test('the final read-back must be exactly the last applied body', () => {
  const report = readingEvidenceFixture()
  report.pendingDrafts.bodies.final = { ...report.pendingDrafts.bodies.afterFormula }
  assert.throws(() => validate(report))
})

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
