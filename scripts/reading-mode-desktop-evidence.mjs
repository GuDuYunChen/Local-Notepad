import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const READING_MODE_VERSION = '4.233.1'
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
])
export const READING_ATTEMPTS = Object.freeze({
  root: true, caption: true, gridCaption: true, todo: true, callout: true,
  toggleTitle: true, toggleContent: true, code: true, formula: true,
  imageControls: true, gridControls: true, attachmentPreview: true,
})
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

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
  for (const key of ['draftSourceSHA256', 'databaseDuringDraftSHA256', 'captionSavedSHA256',
    'beforeReadSHA256', 'afterReadSHA256', 'savedSHA256', 'reloadedSHA256']) assert.match(report[key], /^[a-f0-9]{64}$/, key)
  assert.equal(report.draftSourceSHA256, report.databaseDuringDraftSHA256)
  assert.notEqual(report.draftSourceSHA256, report.captionSavedSHA256)
  assert.equal(report.captionSavedSHA256, report.beforeReadSHA256)
  assert.equal(report.beforeReadSHA256, report.afterReadSHA256)
  assert.notEqual(report.afterReadSHA256, report.savedSHA256)
  assert.equal(report.savedSHA256, report.reloadedSHA256)
  assert.equal(report.screenshots.length, 2)
  assert.deepEqual(report.screenshots.map(image => image.filename), ['reading-mode-decorators.png', 'reading-mode-decorators-reloaded.png'])
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
