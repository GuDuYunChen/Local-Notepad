import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDesktopReadingLink } from './reading-mode-save-evidence.mjs'
import { readingEvidenceFixture } from './reading-mode-test-fixture.mjs'

// Relational oracle fixtures only; actual on-disk reading report, PNG and all
// original desktop-save checks have their own independent refusal suites.
function fixture() {
  const reading = readingEvidenceFixture(), commit = reading.productCommit
  reading.commit = commit; reading.processID = 200
  const file = { bytes: 1234, sha256: '5'.repeat(64) }
  const desktop = { commit, processIDs: [100, 200], originalNoteIDs: ['original-A', 'original-B'],
    readingMode: { filename: 'reading-mode-desktop.json', ...file, processID: 200, noteID: reading.noteID,
      restoredNoteID: 'original-A', originalNoteRestored: true, restoredEditorText: 'Original body reading-mode-unsaved-draft',
      originalNotes: ['original-A', 'original-B'].map(id => ({ id, beforeBodySHA256: '6'.repeat(64), afterBodySHA256: '6'.repeat(64) })),
      quitObserverReattached: true, quitObserverTimeOrigin: 1000,
    },
    closeDiagnostics: [100, 200].map(pid => ({ phase: 'before-close', pid, renderer: {
      quitObserverReady: true, quitObserverTimeOrigin: 1000, timeOrigin: 1000,
    } })),
  }
  return { desktop, reading, commit, file }
}
const validate = f => validateDesktopReadingLink(f.desktop, f.reading, f.commit, f.file)
test('desktop acceptance requires current independent reading evidence and restored original note and observer', () => assert.equal(validate(fixture()), true))
for (const [name, mutate] of [
  ['missing independent report link', f => delete f.desktop.readingMode],
  ['old reading version', f => f.reading.version = '4.233.0'],
  ['reading gate omitted', f => f.reading.checks.pop()],
  ['caption guard omitted', f => delete f.reading.attempts.caption],
  ['different reading commit', f => f.reading.commit = 'f'.repeat(40)],
  ['different desktop commit', f => f.desktop.commit = 'f'.repeat(40)],
  ['wrong native process', f => f.reading.processID = 100],
  ['wrong linked process', f => f.desktop.readingMode.processID = 100],
  ['unexpected report filename', f => f.desktop.readingMode.filename = 'checks.json'],
  ['changed report bytes', f => f.desktop.readingMode.bytes++],
  ['changed report digest', f => f.desktop.readingMode.sha256 = '7'.repeat(64)],
  ['wrong fixture note', f => f.desktop.readingMode.noteID = 'other'],
  ['lost original note identity', f => f.desktop.originalNoteIDs.pop()],
  ['duplicated original note identity', f => f.desktop.originalNoteIDs[1] = f.desktop.originalNoteIDs[0]],
  ['fixture is an original note', f => f.desktop.originalNoteIDs[0] = f.reading.noteID],
  ['wrong restored note', f => f.desktop.readingMode.restoredNoteID = 'original-B'],
  ['lost original body comparison', f => f.desktop.readingMode.originalNotes.pop()],
  ['changed original body', f => f.desktop.readingMode.originalNotes[1].afterBodySHA256 = '8'.repeat(64)],
  ['no editor restoration', f => f.desktop.readingMode.originalNoteRestored = false],
  ['old editor body', f => f.desktop.readingMode.restoredEditorText = 'reading fixture'],
  ['quit observer not reattached', f => f.desktop.readingMode.quitObserverReattached = false],
  ['observer origin missing', f => f.desktop.readingMode.quitObserverTimeOrigin = 0],
  ['final native close missing', f => f.desktop.closeDiagnostics.pop()],
  ['wrong close process', f => f.desktop.closeDiagnostics[1].pid = 100],
  ['observer absent at actual close', f => f.desktop.closeDiagnostics[1].renderer.quitObserverReady = false],
  ['stale observer at close', f => f.desktop.closeDiagnostics[1].renderer.quitObserverTimeOrigin = 999],
  ['different renderer at close', f => f.desktop.closeDiagnostics[1].renderer.timeOrigin = 999],
]) test('refuses reading/desktop linkage ' + name, () => { const f = fixture(); mutate(f); assert.throws(() => validate(f)) })
