import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

// Offline reconstruction is allowed only when both complete product blobs
// match the published 4.189.3 source. CI fetches the pinned commit explicitly.
const baseline = process.env.DRAFT_RECOVERY_BASELINE || '5cf6619336554b4e8af6320ba41e03344f4db0dd'
const expected = {
  'src/components/TextEditor.jsx': '09dcdf9bf744696859a3c93f2d6dbece64f9d79e',
  'src/services/editorDraftCache.js': '6ddc04eccaf3560dca36d143e5e7e2181509e4c6',
}
const names = [
  'reopening after the five-minute cache window keeps the unconfirmed body reachable and saveable',
  'a newer database timestamp cannot hide an unsaved draft on reopening',
  'same-second external edits are not silently overwritten by restoring a fresh draft',
  'remounting reconciles the original unconfirmed request token before sending newer text',
  'switching before the debounce preserves the previous draft even when autosave-on-switch is disabled',
  'a larger in-memory draft cannot be shadowed by the older persistent cache entry',
]
const original = Object.keys(expected).map(file => [file, readFileSync(file)])
const output = 'test-results/save-recovery/draft-recovery-baseline.json'
mkdirSync('test-results/save-recovery', { recursive: true })
try {
  for (const [file, hash] of Object.entries(expected)) {
    const old = spawnSync('git', ['show', baseline + ':' + file])
    assert.equal(old.status, 0, 'Exact old source required: ' + file)
    assert.equal(createHash('sha1').update(Buffer.from('blob ' + old.stdout.length + '\0')).update(old.stdout).digest('hex'), hash)
    writeFileSync(file, old.stdout)
  }
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--root=.',
    'src/components/EditorDraftRecovery.test.jsx', '-t', names.join('|'), '--reporter=json', '--outputFile=' + output],
  { encoding: 'utf8', timeout: 60000 })
  writeFileSync(output + '.log', (run.stdout || '') + (run.stderr || ''))
  assert.equal(run.error, undefined); assert.equal(run.status, 1)
  const report = JSON.parse(readFileSync(output, 'utf8'))
  const failed = report.testResults.flatMap(f => f.assertionResults).filter(t => t.status === 'failed')
  assert.deepEqual(failed.map(t => t.title).sort(), [...names].sort())
  for (const t of failed) {
    const reason = t.failureMessages.join('\n')
    assert.doesNotMatch(reason, /timed out|Failed to resolve|SyntaxError|ReferenceError|TypeError/)
    assert.match(reason, t.title.startsWith('remounting') ? /to have a length of 3 but got 2/ : /expected .* to be/s)
  }
  console.log('All six precise 4.189.3 recovery failures reproduced; no timeout/import errors accepted.')
} finally {
  for (const [file, bytes] of original) { writeFileSync(file, bytes); assert.ok(readFileSync(file).equals(bytes)) }
}
