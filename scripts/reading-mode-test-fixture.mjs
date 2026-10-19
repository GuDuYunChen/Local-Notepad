import { READING_CHECKS, READING_ATTEMPTS } from './reading-mode-desktop-evidence.mjs'

// Synthetic contract-test objects only. This module is never imported by a
// native driver and is not installation or desktop execution evidence.
export function readingEvidenceFixture() {
  return { complete: true, commit: 'b'.repeat(40), productCommit: 'a'.repeat(40), version: '4.233.1',
    platform: 'win32', processID: 104, noteID: 'synthetic-contract-note',
    realPackagedApp: true, realBackend: true, realPreload: true, syntheticData: true,
    bridgeOverridden: false, timerAccelerated: false, dirtyWhileReading: true,
    onlyIntendedCaptionSaved: true, onlyIntendedTodoSaved: true, rendererReloaded: true,
    checks: [...READING_CHECKS], attempts: { ...READING_ATTEMPTS },
    draftSourceSHA256: '1'.repeat(64), databaseDuringDraftSHA256: '1'.repeat(64),
    captionSavedSHA256: '2'.repeat(64), beforeReadSHA256: '2'.repeat(64), afterReadSHA256: '2'.repeat(64),
    savedSHA256: '3'.repeat(64), reloadedSHA256: '3'.repeat(64),
    screenshots: ['reading-mode-decorators.png', 'reading-mode-decorators-reloaded.png'].map(filename => ({ filename, bytes: 100, sha256: '4'.repeat(64) })),
  }
}
