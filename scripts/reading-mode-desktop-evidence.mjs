import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { assertFullNativeTextSelection, assertFullNativeFormulaSelection, assertNativeUrlReplacement,
  READING_CAPTION_SELECTOR, READING_FORMULA_SELECTOR, READING_EMBED_URL_SELECTOR, READING_EMBED_TITLE_SELECTOR } from './reading-mode-native-input.mjs'
import { assertDesktopWindowImage, selectDesktopMainWindow, selectDesktopUnappliedDialog,
  isDesktopUnappliedDialogWindow, UNAPPLIED_QUIT_DIALOG_CAPTION,
  UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE, assertDesktopAccessibleText } from './desktop-window-target.mjs'

export const READING_MODE_VERSION = '4.243.0'
export const READING_DRAFT_VALUES = Object.freeze({
  formulaOriginal: 'x^2', formulaPending: 'y^3', formulaApplied: 'x^2 + y^2', formulaQuit: 'z^4',
  embedOriginalURL: 'https://example.invalid/reading-mode-original',
  embedOriginalTitle: '已应用嵌入标题',
  embedPendingURL: 'https://www.youtube.com/embed/reading-mode-unapplied',
  embedPendingTitle: 'reading100-pending-embed',
  embedAppliedURL: 'https://example.invalid/reading-mode-applied',
  embedAppliedTitle: 'reading100-applied-embed',
  sourceBody: 'reading-mode-canonical-decorators',
  destinationBody: 'reading-mode-pending-navigation-target',
})
export const READING_CHECKS = Object.freeze([
  'current-version-real-packaged-preload',
  'canonical-decorators-created-through-real-service',
  'reading-retains-unsaved-caption-and-rejects-native-input',
  'returned-edit-mode-saves-only-intended-caption',
  'reading-blocks-independent-native-text-inputs',
  'reading-blocks-todo-formula-and-media-mutations',
  'reading-toggle-expansion-keeps-database-body',
  'editable-todo-still-saves',
  'reading-preference-survives-real-renderer-reload',
  'formula-pending-draft-reading-navigation-cancel-and-save-guard',
  'formula-cancel-and-completion-preserve-exact-body',
  'embed-pending-draft-reading-navigation-cancel-and-save-guard',
  'embed-cancel-and-completion-preserve-exact-body',
  'reading-unapplied-drafts-refuse-native-window-close',
  'returned-editing-discards-pending-drafts-and-navigation-resumes',
])
export const READING_ATTEMPTS = Object.freeze({
  root: true, caption: true, gridCaption: true, todo: true, callout: true,
  toggleTitle: true, toggleContent: true, code: true, formula: true,
  imageControls: true, gridControls: true, attachmentPreview: true,
})
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export const READING_SCREENSHOTS = Object.freeze([
  'reading-mode-decorators.png', 'reading-mode-decorators-reloaded.png',
  'reading-mode-formula-pending.png', 'reading-mode-embed-pending.png',
  'reading-mode-unapplied-after-close.png',
])

function sourceVisible(ui, reading) {
  assert.equal(ui.reading, reading)
  assert.equal(ui.sourceVisible, true); assert.equal(ui.destinationVisible, false)
}

export function assertReadingCommittedDraftView(ui, formula, embedTitle, pending) {
  sourceVisible(ui, true)
  assert.equal(ui.formulaExpression, formula); assert.equal(ui.formulaBlock, true)
  assert.equal(ui.formulaDraft, null); assert.equal(ui.formulaDraftBlock, null)
  assert.equal(ui.embedTitle, embedTitle); assert.equal(ui.iframeSrc, null)
  assert.equal(ui.embedDraftURL, null); assert.equal(ui.embedDraftTitle, null)
  for (const [key, label] of [['formula', '公式'], ['embed', '嵌入']]) {
    if (pending.includes(key)) {
      assert.ok(ui.pendingText.includes(label))
      assert.ok(ui.notices[key].includes('未应用') && ui.notices[key].includes(label))
    } else assert.equal(ui.notices[key], '')
  }
  if (!pending.length) assert.equal(ui.pendingText, '')
  return true
}

function resumedDraft(ui, kind, values) {
  sourceVisible(ui, false)
  if (kind === 'formula') {
    assert.equal(ui.formulaDraft, values.formula); assert.equal(ui.formulaDraftBlock, false)
    assert.ok(ui.pendingText.includes('公式'))
  } else {
    assert.equal(ui.embedDraftURL, values.url); assert.equal(ui.embedDraftTitle, values.title)
    assert.ok(ui.pendingText.includes('嵌入内容'))
  }
}

function cleanView(ui, formula, embedTitle) {
  sourceVisible(ui, false)
  assert.equal(ui.formulaExpression, formula); assert.equal(ui.formulaBlock, true)
  assert.equal(ui.formulaDraft, null); assert.equal(ui.formulaDraftBlock, null)
  assert.equal(ui.embedDraftURL, null); assert.equal(ui.embedDraftTitle, null)
  assert.equal(ui.embedTitle, embedTitle); assert.equal(ui.iframeSrc, null)
  assert.equal(ui.pendingText, ''); assert.deepEqual(ui.notices, { formula: '', embed: '' })
}

function bodySnapshot(snapshot) {
  assert.equal(typeof snapshot.content, 'string'); assert.match(snapshot.sha256, /^[a-f0-9]{64}$/)
  assert.equal(hash(snapshot.content), snapshot.sha256)
  const value = JSON.parse(snapshot.content)
  assert.equal(value.root.type, 'root'); assert.ok(Array.isArray(value.root.children))
  return value
}

const oneNode = (body, type) => {
  const nodes = body.root.children.filter(node => node.type === type)
  assert.equal(nodes.length, 1, 'Expected one canonical ' + type)
  return nodes[0]
}

function navigationGuard(navigation, kind, expectedHash, formula, embedTitle, values) {
  for (const choice of ['cancel', 'save']) {
    const step = navigation[choice]
    assert.equal(step.dialogTitle, '当前笔记未保存'); assert.ok(step.dialogMessage.includes('未应用'))
    assert.equal(step.buttonEnabled, true); assert.equal(step.buttonLabel, choice === 'cancel' ? '取消' : '保存')
    assert.equal(step.dialogRemained, choice === 'save'); assert.equal(step.bodySHA256, expectedHash)
    assert.equal(step.ui.dialogTitle, choice === 'save' ? '当前笔记未保存' : '')
    if (choice === 'save') assert.equal(step.ui.saveReady, true)
    assertReadingCommittedDraftView(step.ui, formula, embedTitle, [kind])
  }
  assert.ok(navigation.save.failureText.includes(kind === 'formula' ? '公式' : '嵌入内容'))
  assert.ok(navigation.save.failureText.includes('未应用'))
  assert.equal(navigation.returned.bodySHA256, expectedHash)
  resumedDraft(navigation.returned.ui, kind, values)
}

export function validateReadingNativeQuitEvents(events, processID) {
  assert.ok(Array.isArray(events) && events.length >= 5)
  assert.equal(events[0].type, 'inspect'); assert.equal(events[1].type, 'close')
  const dismiss = events.findIndex(event => event.type === 'dismiss-unapplied')
  assert.ok(dismiss >= 3 && dismiss < events.length - 1)
  assert.equal(events.filter(event => event.type === 'dismiss-unapplied').length, 1)
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (index !== 1 && index !== dismiss) assert.equal(event.type, 'inspect')
    assert.equal(event.completed, true); assert.equal(event.pid, processID)
    assert.ok(Number.isSafeInteger(event.id) && event.id > 0)
    assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0)
    if (index) {
      assert.equal(event.id, events[index - 1].id + 1)
      assert.ok(event.elapsedMs >= events[index - 1].elapsedMs)
    }
  }
  return true
}

function validateNativeObservations(quit, processID) {
  const { changes, last } = quit.nativeObservations || {}
  assert.ok(Array.isArray(changes) && changes.length >= 3, 'Native changed-window observations are missing')
  const events = quit.helperEvents, dismiss = events.findIndex(event => event.type === 'dismiss-unapplied')
  for (const observation of [...changes, last]) {
    assert.ok(observation && Array.isArray(observation.windows))
    const receipt = observation.nativeRequest
    const index = events.findIndex(event => event.id === receipt?.id)
    assert.ok(index >= 0, 'Native observation lacks its actual inspect receipt')
    assert.deepEqual(receipt, events[index])
    assert.equal(receipt.type, 'inspect'); assert.equal(receipt.pid, processID)
    assert.ok(observation.windows.every(window => window.pid === processID))
    for (const window of observation.windows) if (window.accessibility != null) assertDesktopAccessibleText(window)
    assert.equal(observation.phase, index === 0 ? 'before-close' : index < dismiss ? 'awaiting-unapplied-dialog' : 'after-dismiss')
  }
  for (let index = 1; index < changes.length; index++) {
    assert.ok(changes[index].nativeRequest.id > changes[index - 1].nativeRequest.id)
    assert.ok(changes[index].phase !== changes[index - 1].phase ||
      JSON.stringify(changes[index].windows) !== JSON.stringify(changes[index - 1].windows), 'Unchanged poll was recorded as a window change')
  }
  assert.deepEqual(changes[0].nativeRequest, events[0])
  assert.deepEqual(changes[0].windows, quit.windowsBeforeClose)
  const blocked = changes.filter(observation => observation.phase === 'awaiting-unapplied-dialog').at(-1)
  assert.ok(blocked, 'Matched native dialog observation is missing')
  assert.deepEqual(blocked.nativeRequest, events[dismiss - 1])
  assert.deepEqual(blocked.windows, quit.windowsDuringBlock)
  assert.deepEqual(last.nativeRequest, events.at(-1))
  assert.deepEqual(last.windows, quit.windowsAfterDismiss)
  assert.equal(changes.at(-1).phase, last.phase)
  assert.deepEqual(changes.at(-1).windows, last.windows)
  assert.ok(changes.at(-1).nativeRequest.id <= last.nativeRequest.id)
}

function validatePendingDrafts(report) {
  const pending = report.pendingDrafts, text = READING_DRAFT_VALUES
  assert.ok(pending && typeof pending === 'object', 'Complete native pending-draft workflow is missing')
  assert.match(pending.destinationNoteID, /^[a-zA-Z0-9-]+$/)
  assert.notEqual(pending.destinationNoteID, report.noteID)
  assert.match(pending.destinationBodySHA256, /^[a-f0-9]{64}$/)
  const before = bodySnapshot(pending.bodies.before)
  const afterFormula = bodySnapshot(pending.bodies.afterFormula)
  const afterEmbed = bodySnapshot(pending.bodies.afterEmbed)
  bodySnapshot(pending.bodies.final)
  assert.equal(pending.bodies.before.sha256, report.reloadedSHA256)
  assert.equal(pending.bodies.final.content, pending.bodies.afterEmbed.content)
  assert.equal(oneNode(before, 'formula').expression, text.formulaOriginal)
  assert.equal(oneNode(before, 'formula').displayMode, true)
  assert.equal(oneNode(before, 'embed').url, text.embedOriginalURL)
  assert.equal(oneNode(before, 'embed').title, text.embedOriginalTitle)
  const expectedFormula = structuredClone(before)
  oneNode(expectedFormula, 'formula').expression = text.formulaApplied
  assert.deepEqual(afterFormula, expectedFormula, 'Formula completion changed other document fields')
  const expectedEmbed = structuredClone(afterFormula)
  Object.assign(oneNode(expectedEmbed, 'embed'), { url: text.embedAppliedURL, title: text.embedAppliedTitle })
  assert.deepEqual(afterEmbed, expectedEmbed, 'Embed completion changed other document fields')
  assert.notEqual(pending.bodies.before.sha256, pending.bodies.afterFormula.sha256)
  assert.notEqual(pending.bodies.afterFormula.sha256, pending.bodies.afterEmbed.sha256)

  const formula = pending.formula
  assertFullNativeFormulaSelection(formula.pendingSelection, READING_FORMULA_SELECTOR, text.formulaOriginal)
  assertReadingCommittedDraftView(formula.reading, text.formulaOriginal, text.embedOriginalTitle, ['formula'])
  assert.equal(formula.readingBodySHA256, pending.bodies.before.sha256)
  navigationGuard(formula.navigation, 'formula', pending.bodies.before.sha256, text.formulaOriginal, text.embedOriginalTitle, { formula: text.formulaPending })
  cleanView(formula.cancelled.ui, text.formulaOriginal, text.embedOriginalTitle)
  assert.equal(formula.cancelled.bodySHA256, pending.bodies.before.sha256)
  assertFullNativeFormulaSelection(formula.appliedSelection, READING_FORMULA_SELECTOR, text.formulaOriginal)
  assert.equal(formula.saveKey, 'Control+S')
  cleanView(formula.saved, text.formulaApplied, text.embedOriginalTitle)

  const embed = pending.embed
  assertNativeUrlReplacement(embed.pendingURL, READING_EMBED_URL_SELECTOR, text.embedOriginalURL, text.embedPendingURL)
  assertFullNativeTextSelection(embed.pendingTitleSelection, READING_EMBED_TITLE_SELECTOR, text.embedOriginalTitle)
  assertReadingCommittedDraftView(embed.reading, text.formulaApplied, text.embedOriginalTitle, ['embed'])
  assert.equal(embed.readingBodySHA256, pending.bodies.afterFormula.sha256)
  navigationGuard(embed.navigation, 'embed', pending.bodies.afterFormula.sha256, text.formulaApplied, text.embedOriginalTitle, { url: text.embedPendingURL, title: text.embedPendingTitle })
  cleanView(embed.cancelled.ui, text.formulaApplied, text.embedOriginalTitle)
  assert.equal(embed.cancelled.bodySHA256, pending.bodies.afterFormula.sha256)
  assertNativeUrlReplacement(embed.appliedURL, READING_EMBED_URL_SELECTOR, text.embedOriginalURL, text.embedAppliedURL)
  assertFullNativeTextSelection(embed.appliedTitleSelection, READING_EMBED_TITLE_SELECTOR, text.embedOriginalTitle)
  assert.equal(embed.saveKey, 'Control+S')
  cleanView(embed.saved, text.formulaApplied, text.embedAppliedTitle)

  const quit = pending.quit
  assertFullNativeFormulaSelection(quit.formulaSelection, READING_FORMULA_SELECTOR, text.formulaApplied)
  assertNativeUrlReplacement(quit.embedURL, READING_EMBED_URL_SELECTOR, text.embedAppliedURL, text.embedPendingURL)
  assertFullNativeTextSelection(quit.embedTitleSelection, READING_EMBED_TITLE_SELECTOR, text.embedAppliedTitle)
  assertReadingCommittedDraftView(quit.before, text.formulaApplied, text.embedAppliedTitle, ['formula', 'embed'])
  assertReadingCommittedDraftView(quit.after, text.formulaApplied, text.embedAppliedTitle, ['formula', 'embed'])
  assert.equal(quit.beforeBodySHA256, pending.bodies.afterEmbed.sha256)
  assert.equal(quit.afterBodySHA256, pending.bodies.afterEmbed.sha256)
  assert.ok(Number.isFinite(quit.timeOriginBefore) && quit.timeOriginBefore > 0)
  assert.equal(quit.timeOriginAfter, quit.timeOriginBefore)
  const main = selectDesktopMainWindow(quit.windowsBeforeClose, report.processID, quit.windowTitle)
  assertDesktopWindowImage(main, quit.executablePath)
  assert.deepEqual(quit.target, main)
  assertDesktopWindowImage(selectDesktopMainWindow(quit.windowsDuringBlock, report.processID, quit.windowTitle), quit.executablePath)
  assert.deepEqual(quit.dialog, selectDesktopUnappliedDialog(quit.windowsDuringBlock, report.processID, quit.executablePath))
  assert.equal(quit.dialog.title, UNAPPLIED_QUIT_DIALOG_CAPTION)
  const dialogText = [...quit.dialog.childText,
    ...(quit.dialog.accessibility == null ? [] : assertDesktopAccessibleText(quit.dialog))]
  assert.ok(dialogText.some(value => value.includes(UNAPPLIED_QUIT_DIALOG_TITLE)))
  assert.ok(dialogText.some(value => value.includes(UNAPPLIED_QUIT_DIALOG_MESSAGE)))
  assertDesktopWindowImage(selectDesktopMainWindow(quit.windowsAfterDismiss, report.processID, quit.windowTitle), quit.executablePath)
  assert.equal(quit.windowsAfterDismiss.some(window => window.pid === report.processID && window.visible &&
    (window.handle === quit.dialog.handle || isDesktopUnappliedDialogWindow(window, report.processID))), false)
  for (const key of ['processStillAlive', 'backendStillAlive', 'dismissed']) assert.equal(quit[key], true)
  assert.equal(quit.dialogEvidence, 'native-window-title-and-child-text')
  validateReadingNativeQuitEvents(quit.helperEvents, report.processID)
  const fresh = quit.helperEvents.find(event => event.type === 'dismiss-unapplied')
  assert.deepEqual(fresh.window, selectDesktopUnappliedDialog(fresh.windows, report.processID, quit.executablePath))
  assert.equal(fresh.window.handle, quit.dialog.handle, 'Fresh dismissal addressed another dialog')
  validateNativeObservations(quit, report.processID)

  const recovery = pending.recovery
  resumedDraft(recovery.returned, 'formula', { formula: text.formulaQuit })
  resumedDraft(recovery.returned, 'embed', { url: text.embedPendingURL, title: text.embedPendingTitle })
  cleanView(recovery.cancelled, text.formulaApplied, text.embedAppliedTitle)
  assert.equal(recovery.saveKey, 'Control+S'); assert.equal(recovery.bodySHA256, pending.bodies.afterEmbed.sha256)
  assert.equal(recovery.destination.reading, false); assert.equal(recovery.destination.sourceVisible, false)
  assert.equal(recovery.destination.destinationVisible, true); assert.equal(recovery.destination.dialogTitle, '')
  assert.equal(recovery.destinationBodySHA256, pending.destinationBodySHA256)
  cleanView(recovery.reopened, text.formulaApplied, text.embedAppliedTitle)
  assert.equal(recovery.reopened.dialogTitle, '')
}

export function validateReadingModeDesktopReport(report, commit, productCommit = commit) {
  assert.match(commit || '', /^[a-f0-9]{40}$/)
  assert.match(productCommit || '', /^[a-f0-9]{40}$/)
  assert.equal(report.commit, commit); assert.equal(report.productCommit, productCommit)
  assert.equal(report.version, READING_MODE_VERSION); assert.equal(report.platform, 'win32')
  for (const key of ['complete', 'realPackagedApp', 'realBackend', 'realPreload', 'syntheticData',
    'dirtyWhileReading', 'onlyIntendedCaptionSaved', 'onlyIntendedTodoSaved', 'rendererReloaded']) assert.equal(report[key], true, key)
  assert.equal(report.bridgeOverridden, false); assert.equal(report.timerAccelerated, false)
  assert.equal(report.error, undefined)
  assert.ok(Number.isSafeInteger(report.processID) && report.processID > 0)
  assert.match(report.noteID, /^[a-zA-Z0-9-]+$/)
  assert.deepEqual(report.checks, READING_CHECKS)
  assert.deepEqual(report.attempts, READING_ATTEMPTS)
  assertFullNativeTextSelection(report.captionSelection, READING_CAPTION_SELECTOR, '原始图片说明')
  for (const key of ['draftSourceSHA256', 'databaseDuringDraftSHA256', 'captionSavedSHA256',
    'beforeReadSHA256', 'afterReadSHA256', 'savedSHA256', 'reloadedSHA256']) assert.match(report[key], /^[a-f0-9]{64}$/, key)
  assert.equal(report.draftSourceSHA256, report.databaseDuringDraftSHA256)
  assert.notEqual(report.draftSourceSHA256, report.captionSavedSHA256)
  assert.equal(report.captionSavedSHA256, report.beforeReadSHA256)
  assert.equal(report.beforeReadSHA256, report.afterReadSHA256)
  assert.notEqual(report.afterReadSHA256, report.savedSHA256)
  assert.equal(report.savedSHA256, report.reloadedSHA256)
  validatePendingDrafts(report)
  assert.equal(report.screenshots.length, READING_SCREENSHOTS.length)
  assert.deepEqual(report.screenshots.map(image => image.filename), READING_SCREENSHOTS)
  for (const image of report.screenshots) {
    assert.ok(Number.isSafeInteger(image.bytes) && image.bytes > 8)
    assert.match(image.sha256, /^[a-f0-9]{64}$/)
  }
  return true
}

export function verifyReadingModeDesktopReport(directory, commit, productCommit = commit) {
  const report = JSON.parse(readFileSync(path.join(directory, 'reading-mode-desktop.json'), 'utf8'))
  validateReadingModeDesktopReport(report, commit, productCommit)
  for (const image of report.screenshots) {
    assert.equal(path.basename(image.filename), image.filename)
    const bytes = readFileSync(path.join(directory, image.filename))
    assert.equal(bytes.length, image.bytes); assert.equal(hash(bytes), image.sha256)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  }
  return report
}
