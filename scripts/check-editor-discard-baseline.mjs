// Reproduce this user's failure on the exact previously accepted source, then
// restore this checkout byte-for-byte before running the fixed-code regressions.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const baseline = '40c1d2f0620f7424670532975fb10e76746940d9'
const files = ['src/App.jsx', 'src/components/TextEditor.jsx', 'src/services/editorQuit.mjs']
const saved = files.map(path => [path, readFileSync(path)])
try {
  for (const path of files) {
    const result = spawnSync('git', ['show', baseline + ':' + path])
    assert.equal(result.status, 0, 'Exact baseline source is required')
    writeFileSync(path, result.stdout)
  }
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--root=.', 'src/AppExitDiscard.test.jsx', '-t', 'discard then leave the editor and quit does not resurrect the abandoned draft'], { encoding: 'utf8', timeout: 60000 })
  console.log(run.stdout); console.error(run.stderr)
  assert.equal(run.error, undefined)
  assert.equal(run.status, 1, 'The reported regression must fail on the original code')
  assert.match(run.stdout + run.stderr, /AssertionError|expected .* to (?:be|equal)/)
  assert.match(run.stdout + run.stderr, /unresolved/, 'Must reproduce the actual quit refusal, not an unrelated failure')
  console.log('Confirmed: real old App/Editor leaves the discarded note unresolved; original failure reproduced.')
} finally {
  for (const [path, bytes] of saved) { writeFileSync(path, bytes); assert.ok(readFileSync(path).equals(bytes)) }
}
