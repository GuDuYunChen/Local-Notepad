import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { verifyDesktopSaveReport } from './desktop-save-evidence.mjs'
import { validateReadingModeDesktopReport, verifyReadingModeDesktopReport } from './reading-mode-desktop-evidence.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

// The original desktop save/quit oracle stays intact. This additional contract
// binds independent reading evidence to its second actual native process and
// requires restoration of both original saved notes and quit observation after
// the reading check's real renderer reloads.
export function validateDesktopReadingLink(desktop, reading, commit, file) {
  validateReadingModeDesktopReport(reading, commit)
  const link = desktop.readingMode
  assert.ok(link, 'Independent reading evidence is missing from desktop acceptance')
  assert.equal(desktop.commit, commit)
  assert.equal(desktop.processIDs.length, 2)
  assert.equal(link.processID, desktop.processIDs[1]); assert.equal(reading.processID, link.processID)
  assert.equal(link.filename, 'reading-mode-desktop.json')
  assert.equal(link.bytes, file.bytes); assert.equal(link.sha256, file.sha256)
  assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0); assert.match(file.sha256, /^[a-f0-9]{64}$/)
  assert.equal(link.noteID, reading.noteID)
  assert.equal(desktop.originalNoteIDs.length, 2)
  assert.equal(new Set(desktop.originalNoteIDs).size, 2)
  for (const id of desktop.originalNoteIDs) { assert.match(id, /^[a-zA-Z0-9-]+$/); assert.notEqual(id, reading.noteID) }
  assert.equal(link.restoredNoteID, desktop.originalNoteIDs[0])
  assert.deepEqual(link.originalNotes.map(note => note.id), desktop.originalNoteIDs)
  for (const note of link.originalNotes) {
    assert.match(note.beforeBodySHA256, /^[a-f0-9]{64}$/)
    assert.equal(note.afterBodySHA256, note.beforeBodySHA256, 'Reading workflow changed an original saved note')
  }
  assert.equal(link.originalNoteRestored, true)
  assert.ok(link.restoredEditorText.includes('reading-mode-unsaved-draft'), 'Original saved editor was not restored after reading reload')
  assert.equal(link.quitObserverReattached, true)
  assert.ok(Number.isFinite(link.quitObserverTimeOrigin) && link.quitObserverTimeOrigin > 0)
  const snapshots = desktop.closeDiagnostics.filter(snapshot => snapshot.phase === 'before-close')
  assert.equal(snapshots.length, 2)
  const final = snapshots[1]
  assert.equal(final.pid, link.processID)
  assert.equal(final.renderer.quitObserverReady, true, 'Original quit observation was lost during renderer reload')
  assert.equal(final.renderer.quitObserverTimeOrigin, link.quitObserverTimeOrigin)
  assert.equal(final.renderer.timeOrigin, link.quitObserverTimeOrigin)
  return true
}

export function verifyDesktopSaveReadingReport(directory, commit) {
  const desktop = verifyDesktopSaveReport(directory, commit)
  const reading = verifyReadingModeDesktopReport(directory, commit)
  const bytes = readFileSync(path.join(directory, 'reading-mode-desktop.json'))
  validateDesktopReadingLink(desktop, reading, commit, { bytes: bytes.length, sha256: hash(bytes) })
  return { desktop, reading }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve('test-results/desktop-save')
  const result = verifyDesktopSaveReadingReport(directory, process.env.GITHUB_SHA)
  console.log(JSON.stringify({ complete: true, commit: process.env.GITHUB_SHA,
    originalDesktopChecks: result.desktop.checks.length, independentReadingChecks: result.reading.checks.length,
    readingProcessID: result.reading.processID, originalNotesRestored: true, quitObserverReattached: true }))
}
