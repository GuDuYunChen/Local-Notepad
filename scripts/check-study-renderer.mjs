// Isolated native Electron check. No user profile, database or network is used.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(path.join(os.tmpdir(), 'notepad-study-native-'))
try {
  await build({ stdin: { contents: `export * from './src/services/collectionStudy.js'; export * from './src/services/collectionPackage.js'; export * from './src/services/collectionStudyHub.js'; export * from './src/services/collectionStudyBatch.js'; export * from './src/services/studyCompilation.js'; export { createSearchCollectionStore } from './src/services/searchCollections.js';`,
    resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', globalName: 'StudyNative', outfile: path.join(directory, 'study.js') })
  const page = path.join(directory, 'study.html')
  await writeFile(page, '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Isolated study storage check</title></head><body><script src="./study.js"></script></body></html>')
  const main = path.join(root, 'scripts/study-renderer-main.cjs')
  for (const phase of ['write', 'read']) {
    const output = execFileSync(require('electron'), [main, path.join(directory, 'profile'), page, phase],
      { encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
    assert.ok(output.includes('STUDY_NATIVE_OK:' + phase), output)
    console.log(output.trim())
  }
  console.log('Native Electron file-page reading storage passed: real Web Locks, WebCrypto, localStorage and fresh-process read of synthetic marks/bookmark/Unicode notes. Paired-package restore/reimport, batch status/undo and fresh-process persisted manual marks also passed. Not a full application UI test.')
} finally { await rm(directory, { recursive: true, force: true }) }
