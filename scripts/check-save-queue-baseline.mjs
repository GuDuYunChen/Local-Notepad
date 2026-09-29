import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const baseline = process.env.SAVE_QUEUE_BASELINE || '3c66a5e36189c5876fb8c1e21fd66c7d1d09f19a'
const files = {
  'src/App.jsx': '7f036225cdca1d4ae91fce520c0aaf58f20bbc1e',
  'src/components/TextEditor.jsx': 'b9af2361ca025ec5c0490f9cb91c3718957707b9',
}
const original = Object.entries(files).map(([file]) => [file, readFileSync(file)])
const output = 'test-results/save-recovery/queue-order-baseline.json'
const failedNames = [
  'saving A then B then A while the first request waits finishes with the last requested A',
  'a final save cannot report success before a previously queued different body has finished',
  'an automatic save matching the active body still runs after a different queued manual save',
  'repeated nonadjacent snapshots keep their requested order across four queued saves',
  'a queued write re-establishes the exit guard before unmount even when the visible text was just acknowledged',
  'Ctrl+S does not announce completion while a different saved snapshot is still queued',
]
const filter = 'saving A then|a final save|an automatic save|adjacent identical|closing the editor|repeated nonadjacent|newer text without|a rejected predecessor|a queued write|Ctrl\\+S does not announce'
mkdirSync('test-results/save-recovery', { recursive: true })
try {
  for (const [file, hash] of Object.entries(files)) {
    const old = spawnSync('git', ['show', baseline + ':' + file])
    assert.equal(old.status, 0, 'Exact old source is required: ' + file)
    assert.equal(createHash('sha1').update(Buffer.from('blob ' + old.stdout.length + '\0')).update(old.stdout).digest('hex'), hash)
    writeFileSync(file, old.stdout)
  }
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--root=.',
    'src/components/EditorSaveQueueOrder.test.jsx', 'src/AppSaveRecovery.test.jsx', '-t', filter,
    '--reporter=json', '--outputFile=' + output], { encoding: 'utf8', timeout: 60000 })
  writeFileSync(output + '.log', (run.stdout || '') + (run.stderr || ''))
  assert.equal(run.error, undefined); assert.equal(run.status, 1)
  const report = JSON.parse(readFileSync(output, 'utf8'))
  const failed = report.testResults.flatMap(f => f.assertionResults).filter(t => t.status === 'failed')
  assert.deepEqual(failed.map(t => t.title).sort(), [...failedNames].sort())
  // Count actual assertion statuses; some reporters include filtered tests
  // in their summary passed count. Four unchanged behaviors must really run.
  assert.equal(report.testResults.flatMap(f => f.assertionResults).filter(t => t.status === 'passed').length, 4)
  for (const t of failed) {
    const message = t.failureMessages.join('\n')
    assert.doesNotMatch(message, /timed out|Failed to resolve|SyntaxError|ReferenceError|TypeError/)
    assert.match(message, /expected .* (to be|to equal|to deeply equal)/s)
  }
  console.log('Six exact 4.189.5 queue-order/early-success/exit-guard assertions fail; four existing behaviors remain passing controls.')
} finally {
  for (const [file, bytes] of original) { writeFileSync(file, bytes); assert.ok(readFileSync(file).equals(bytes)) }
}
