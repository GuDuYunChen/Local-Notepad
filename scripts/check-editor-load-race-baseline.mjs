import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const baseline = process.env.EDITOR_LOAD_RACE_BASELINE || '73c7a680160a1ad1901efb03990b6a03e523577f'
const file = 'src/components/TextEditor.jsx'
const hash = 'af5237388511f5df269990d2036db9376de55976'
const original = readFileSync(file)
const output = 'test-results/save-recovery/load-race-baseline.json'
const names = [
  'a save acknowledgement during A-B-A loading never replaces the newest draft with the empty loading buffer',
  'a conflict response while the same document reloads preserves its draft rather than an empty placeholder',
  'unmount cancels already queued saves instead of starting another PUT after the editor is gone',
  'a stalled initial read times out, offers retry, and ignores its late result after recovery',
  'invalid document reads cannot mount an empty/wrong body or enable a save: {"id":"load-race-b","content":"wrong note"}',
  'invalid document reads cannot mount an empty/wrong body or enable a save: {"id":"load-race-a"}',
  'invalid document reads cannot mount an empty/wrong body or enable a save: {"id":"load-race-a","content":{}}',
  'queued saves starting during a reload keep the captured draft instead of recaching the loading placeholder',
  'a failed re-read after an intervening acknowledgement leaves the latest draft available for retry',
]
mkdirSync('test-results/save-recovery', { recursive: true })
try {
  const old = spawnSync('git', ['show', baseline + ':' + file])
  assert.equal(old.status, 0, 'Exact old source required')
  assert.equal(createHash('sha1').update(Buffer.from('blob ' + old.stdout.length + '\0')).update(old.stdout).digest('hex'), hash)
  writeFileSync(file, old.stdout)
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--root=.',
    'src/components/EditorLoadSaveRace.test.jsx', '--reporter=json', '--outputFile=' + output], { encoding: 'utf8', timeout: 60000 })
  writeFileSync(output + '.log', (run.stdout || '') + (run.stderr || ''))
  assert.equal(run.error, undefined); assert.equal(run.status, 1)
  const report = JSON.parse(readFileSync(output, 'utf8'))
  const failed = report.testResults.flatMap(f => f.assertionResults).filter(t => t.status === 'failed')
  assert.deepEqual(failed.map(t => t.title).sort(), [...names].sort())
  assert.equal(report.numPassedTests, 1) // The already-guarded null response remains a passing control.
  for (const t of failed) {
    const reason = t.failureMessages.join('\n')
    assert.doesNotMatch(reason, /timed out|Failed to resolve|SyntaxError|ReferenceError|TypeError/)
    assert.match(reason, /expected .* (to be|to contain|to have)/s)
  }
  console.log('Nine exact 4.189.4 load/save lifecycle assertions failed as expected; null-response control still passed.')
} finally { writeFileSync(file, original); assert.ok(readFileSync(file).equals(original)) }
