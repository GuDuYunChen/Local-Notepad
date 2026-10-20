import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { READING_CHECKS, READING_ATTEMPTS, validateReadingModeDesktopReport, verifyReadingModeDesktopReport } from './reading-mode-desktop-evidence.mjs'
import { readingEvidenceFixture } from './reading-mode-test-fixture.mjs'
import { inspectReadingNativeWindows } from './check-reading-mode-desktop.mjs'
import { selectDesktopUnappliedDialog, UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE } from './desktop-window-target.mjs'

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
  ['native Error caption lacks application instruction', p => {
    p.quit.dialog.childText = [UNAPPLIED_QUIT_DIALOG_MESSAGE, 'OK']; p.quit.windowsDuringBlock[1].childText = [...p.quit.dialog.childText]
  }],
  ['native Error caption lacks complete content', p => {
    p.quit.dialog.childText = [UNAPPLIED_QUIT_DIALOG_TITLE, 'OK']; p.quit.windowsDuringBlock[1].childText = [...p.quit.dialog.childText]
  }],
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
  ['missing raw native observations', p => delete p.quit.nativeObservations],
  ['missing changed native snapshot', p => p.quit.nativeObservations.changes.splice(1, 1)],
  ['missing last native snapshot', p => delete p.quit.nativeObservations.last],
  ['native snapshot forged inspect ID', p => p.quit.nativeObservations.last.nativeRequest.id += 100],
  ['native snapshot wrong receipt time', p => p.quit.nativeObservations.changes[1].nativeRequest.elapsedMs++],
  ['native snapshot wrong request PID', p => p.quit.nativeObservations.changes[1].nativeRequest.pid++],
  ['native snapshot rows differ from matched dialog', p => p.quit.nativeObservations.changes[1].windows[1].childText = ['changed observation']],
  ['native snapshot has wrong lifecycle phase', p => p.quit.nativeObservations.changes[1].phase = 'after-dismiss'],
  ['native last snapshot differs from returned windows', p => p.quit.nativeObservations.last.windows = []],
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
  const report = readingEvidenceFixture(), quit = report.pendingDrafts.quit, events = quit.helperEvents
  events.splice(2, 0, { ...events[2] })
  events.splice(-1, 0, { ...events.at(-1) })
  for (const [index, event] of events.entries()) { event.id = index + 31; event.elapsedMs = index + 100 }
  const indices = [0, 3, 5]
  for (const [index, observation] of quit.nativeObservations.changes.entries()) observation.nativeRequest = { ...events[indices[index]] }
  quit.nativeObservations.last.nativeRequest = { ...events.at(-1) }
  assert.equal(validate(report), true)
})

test('unrelated Error caption does not masquerade as the verified dismissed dialog', () => {
  const report = readingEvidenceFixture(), quit = report.pendingDrafts.quit
  const other = structuredClone(quit.dialog)
  other.handle = 888; other.childText = ['unrelated instruction', 'unrelated content']
  other.accessibility.boundWindow.handle = 888; other.accessibility.revalidatedWindow.handle = 888
  other.accessibility.root.handle = 888; other.accessibility.elements = []
  const windows = [...quit.windowsAfterDismiss, other]
  quit.windowsAfterDismiss = structuredClone(windows)
  quit.nativeObservations.changes.at(-1).windows = structuredClone(windows)
  quit.nativeObservations.last.windows = structuredClone(windows)
  assert.equal(validate(report), true)
})

test('matching failure retains actual last and changed native windows before the selector runs', async () => {
  const { pendingDrafts: { quit: source }, processID } = readingEvidenceFixture()
  const mismatch = [{ ...source.dialog, accessibility: undefined, title: 'Observed other caption', childText: ['observed content only'] }]
  const changed = [{ ...mismatch[0], childText: ['observed changed content'] }]
  const returns = [mismatch, mismatch, changed], quit = {}, saved = []
  const events = [{ type: 'ready', pid: 800, elapsedMs: 1 }]
  const windowSession = {
    inspect: async pid => {
      events.push({ type: 'inspect', pid, id: 41 + events.length, elapsedMs: 200 + events.length, completed: true })
      return returns.shift()
    },
    events: () => structuredClone(events),
  }
  const inspect = () => inspectReadingNativeWindows({ windowSession, processID, quit,
    phase: 'awaiting-unapplied-dialog', firstNativeEvent: 1, save: () => saved.push(structuredClone(quit)) })
  for (let index = 0; index < 3; index++) {
    const windows = await inspect()
    assert.equal(saved.length, index + 1, 'Must checkpoint before attempting to select a dialog')
    assert.throws(() => selectDesktopUnappliedDialog(windows, processID, source.executablePath))
  }
  const last = saved.at(-1)
  assert.equal(last.nativeObservations.changes.length, 2)
  assert.deepEqual(last.nativeObservations.changes[0].windows, mismatch)
  assert.deepEqual(last.nativeObservations.last.windows, changed)
  assert.deepEqual(last.nativeObservations.last.nativeRequest, events.at(-1))
  assert.deepEqual(last.helperEvents, events.slice(1))
  changed[0].childText.push('mutated caller copy')
  assert.deepEqual(quit.nativeObservations.last.windows[0].childText, ['observed changed content'])
})

test('native receipt mismatch also keeps its raw observation without manufacturing a successful receipt', async () => {
  const quit = {}, saved = [], native = [{ pid: 104, handle: 444, title: 'raw title', childText: [] }]
  const receipt = { type: 'close', pid: 104, id: 44, elapsedMs: 200, completed: true }
  await assert.rejects(inspectReadingNativeWindows({
    windowSession: { inspect: async () => native, events: () => [receipt] }, processID: 104,
    quit, phase: 'awaiting-unapplied-dialog', firstNativeEvent: 0, save: () => saved.push(structuredClone(quit)),
  }))
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].nativeObservations.last.windows, native)
  assert.deepEqual(saved[0].nativeObservations.last.nativeRequest, receipt)
})

for (const status of ['timeout', 'unsupported', 'error']) test('reading retains native and accessible ' + status + ' evidence before refusing the observation', async () => {
  const source = readingEvidenceFixture(), dialog = structuredClone(source.pendingDrafts.quit.dialog)
  Object.assign(dialog.accessibility, { status, errorCode: 'UIA_' + status.toUpperCase(), elapsedMs: status === 'timeout' ? 2001 : 12 })
  const windows = [dialog], quit = {}, saved = [], receipt = { type: 'inspect', id: 150, pid: source.processID, completed: true, elapsedMs: 112779 }
  await assert.rejects(inspectReadingNativeWindows({
    windowSession: { inspect: async () => windows, events: () => [receipt] }, processID: source.processID,
    executablePath: dialog.image, quit, phase: 'awaiting-unapplied-dialog', firstNativeEvent: 0,
    save: () => saved.push(structuredClone(quit)),
  }), /Native accessibility read refused/)
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].nativeObservations.last.windows[0].childText, ['OK'])
  assert.equal(saved[0].nativeObservations.last.windows[0].accessibility.status, status)
  assert.deepEqual(saved[0].nativeObservations.last.nativeRequest, receipt)
})

for (const [name, change] of [
  ['missing fresh window', event => delete event.window],
  ['missing fresh windows', event => delete event.windows],
  ['fresh UIA deadline expired', event => event.window.accessibility.elapsedMs = 2001],
  ['fresh accessibility text came from another HWND', event => event.window.accessibility.root.handle++],
  ['fresh content missing', event => event.window.accessibility.elements[1].name = 'partial content'],
]) test('reading acceptance refuses ' + name, () => {
  const report = readingEvidenceFixture(), event = report.pendingDrafts.quit.helperEvents.find(value => value.type === 'dismiss-unapplied')
  change(event)
  if (event.window && event.windows) event.windows[1] = structuredClone(event.window)
  assert.throws(() => validate(report))
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
