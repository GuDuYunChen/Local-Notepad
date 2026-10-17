import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const baseline = process.argv[2] || 'c701bb70cd07f9b4d0f5a17d6a7b5ea4c4c59432'
const file = 'src/components/SyncConflictHistoryPanel.jsx'
const expectedBlob = '8fb1adfbce5808d0f075f0c47ad95f6cead94521'
const read = spawnSync('git', ['show', baseline + ':' + file])
assert.equal(read.status, 0, 'The exact 4.190.0 baseline must be available')
assert.equal(createHash('sha1').update(Buffer.from('blob ' + read.stdout.length + '\0')).update(read.stdout).digest('hex'), expectedBlob)
const current = readFileSync(file)
mkdirSync('test-results/history-composition', { recursive: true })
const expectedFailures = [
  'keeps the committed query while Chinese candidate text is still composing',
  'does not truncate in-progress phonetic text at the 128-character boundary',
  'commits the final Chinese text before applying the length limit and the filter',
  'limits committed Unicode text without splitting a surrogate, not candidate text',
  'a fresh composition after clearing works without resurrecting the previous candidate',
  'append while composing still uses the last committed query and preserves the candidate buffer',
  'failed refresh during composition preserves both last committed selection and current input',
  'an isComposing input without compositionstart still protects the active candidate',
]
try {
  writeFileSync(file, read.stdout)
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--root=.',
    'src/components/SyncHistoryComposition.test.jsx', '--maxWorkers=1', '--minWorkers=1',
    '--reporter=json', '--outputFile=test-results/history-composition/baseline.json'],
  { encoding: 'utf8', timeout: 60000 })
  writeFileSync('test-results/history-composition/baseline.log', (run.stdout || '') + (run.stderr || ''))
  assert.equal(run.error, undefined); assert.equal(run.status, 1)
  const report = JSON.parse(readFileSync('test-results/history-composition/baseline.json', 'utf8'))
  const assertions = report.testResults.flatMap(suite => suite.assertionResults)
  const failed = assertions.filter(test => test.status === 'failed')
  assert.equal(assertions.length, 14); assert.equal(report.numPassedTests, 6)
  assert.deepEqual(failed.map(test => test.title).sort(), [...expectedFailures].sort())
  for (const test of failed) {
    assert.ok(test.failureMessages.length > 0)
    for (const message of test.failureMessages) {
      assert.match(message, /expected .* (?:to be|to deeply equal)/s)
      assert.doesNotMatch(message, /timed out|cannot find|failed to load|ReferenceError|TypeError/i)
    }
  }
  writeFileSync('test-results/history-composition/baseline-identity.json', JSON.stringify({ baseline, file, expectedBlob, failed: 8, passed: 6 }, null, 2))
  console.log('Exact 4.190.0 reproduced eight assertion failures and six passing controls; no timeout accepted.')
} finally {
  writeFileSync(file, current)
  assert.ok(readFileSync(file).equals(current))
}
