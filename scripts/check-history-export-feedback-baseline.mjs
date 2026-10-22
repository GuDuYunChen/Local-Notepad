import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Only the product export component is replaced. Every old test stays enabled;
// a compiler/import/runtime/timeout failure is never counted as reproduction.
const baseline = '35ec5cb2b0297fba10019c2edf7a62f6a0445087'
const file = 'src/components/SyncHistoryExport.jsx'
const directory = 'test-results/history-export-feedback'
const original = readFileSync(file)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const expectedFailures = [
  ...['text query', 'object kind', 'outcome'].map(name =>
    'does not resurrect an old download message after returning to the same ' + name),
  'does not resurrect old failure feedback after changing and restoring a filter',
  'keeps download feedback cleared when candidate entry ends with the original query',
  'failed refresh retry cannot replay an earlier export acknowledgement of the retained snapshot',
  'stopping a second read cannot replay the previous stopped-snapshot export acknowledgement',
].sort()
mkdirSync(directory, { recursive: true })
let proof
try {
  const old = spawnSync('git', ['cat-file', 'blob', '22945cce7b7bfde62e7b7fa74c6156408b66f156'], { maxBuffer: 1024 * 1024 })
  assert.equal(old.error, undefined); assert.equal(old.status, 0, 'Exact previous source required')
  const identity = createHash('sha1').update(Buffer.concat([
    Buffer.from('blob ' + old.stdout.length + '\0'), old.stdout,
  ])).digest('hex')
  // This is the exact previous file, not a reconstructed faulty implementation.
  assert.equal(identity, '22945cce7b7bfde62e7b7fa74c6156408b66f156')
  writeFileSync(file, old.stdout)
  const result = spawnSync(process.execPath, [
    'node_modules/vitest/vitest.mjs', 'run', '--root=.',
    'src/components/SyncHistoryExport.test.jsx', 'src/components/SyncHistoryExportFeedback.test.jsx', '--pool=forks', '--maxWorkers=1', '--minWorkers=1',
    '--reporter=json', '--outputFile=' + directory + '/baseline.json',
  ], { encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 })
  writeFileSync(directory + '/baseline.log', (result.stdout || '') + (result.stderr || ''))
  assert.equal(result.error, undefined); assert.equal(result.status, 1)
  const report = JSON.parse(readFileSync(directory + '/baseline.json', 'utf8'))
  assert.equal(report.numTotalTests, 20); assert.equal(report.numPassedTests, 13)
  assert.equal(report.numFailedTests, 7); assert.equal(report.numPendingTests, 0)
  const failed = report.testResults.flatMap(suite => suite.assertionResults).filter(test => test.status === 'failed')
  assert.deepEqual(failed.map(test => test.title).sort(), expectedFailures)
  for (const test of failed) {
    const failures = test.failureMessages.join('\n')
    assert.match(failures, /expected '(?:已请求下载|未能发起下载).* to be ''/)
    assert.doesNotMatch(failures, /timed out|Transform failed|Cannot find module/)
  }
  proof = { baseline, file, blob: identity, oldComponentSHA256: digest(old.stdout),
    fixedComponentSHA256: digest(original), tests: 20, expectedFailures, passing: 13 }
} finally {
  writeFileSync(file, original)
  assert.ok(readFileSync(file).equals(original), 'Current source must be restored even after failure')
}
writeFileSync(directory + '/proof.json', JSON.stringify({ ...proof, sourceRestored: true, complete: true }, null, 2))
console.log('Exact prior export component reproduced 7 stale-feedback assertions; 13 controls passed. Current source restored.')
