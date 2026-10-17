import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

// The override supports an offline reconstruction only when BOTH blob hashes
// equal the exact published 4.189.2 files. CI fetches the pinned commit below.
const baseline = process.env.SAVE_DECISION_BASELINE || 'ca9259c21ae0518b6d4f44d21bd7d48a232fedd7'
const expected = {
  'src/components/TextEditor.jsx': 'd5359229fb7c379ae5a458fe706ce88c8522e441',
  'src/components/EditorSaveConflictDialog.jsx': '37bb9be0b4ac3f2ac917c6b3d3507f7c11f70aae',
}
const saved = Object.keys(expected).map(file => [file, readFileSync(file)])
const names = [
  'keeping a matching conflicted draft still compares the reviewed database body before approving exit',
  'matching conflicted content becomes saved only after an actual applied receipt',
  'unmounting during database adoption preserves the draft and ignores a late response',
  'a failed database adoption explains the failure inside the still-open dialog',
]
const output = 'test-results/save-recovery/conflict-decision-baseline.json'
mkdirSync('test-results/save-recovery', { recursive: true })
try {
  for (const [file, hash] of Object.entries(expected)) {
    const old = spawnSync('git', ['show', baseline + ':' + file])
    assert.equal(old.status, 0, 'Exact baseline source is required: ' + file)
    const actual = createHash('sha1').update(Buffer.from('blob ' + old.stdout.length + '\0')).update(old.stdout).digest('hex')
    assert.equal(actual, hash, 'Baseline must not contain a modified product file')
    writeFileSync(file, old.stdout)
  }
  const result = spawnSync(process.execPath, [
    'node_modules/vitest/vitest.mjs', 'run', '--root=.', 'src/components/EditorSaveConflict.test.jsx',
    '-t', names.join('|'), '--reporter=json', '--outputFile=' + output,
  ], { encoding: 'utf8', timeout: 60000 })
  writeFileSync(output + '.log', (result.stdout || '') + (result.stderr || ''))
  assert.equal(result.error, undefined); assert.equal(result.status, 1)
  const report = JSON.parse(readFileSync(output, 'utf8'))
  const failed = report.testResults.flatMap(file => file.assertionResults).filter(item => item.status === 'failed')
  assert.deepEqual(failed.map(item => item.title).sort(), [...names].sort())
  for (const item of failed) {
    const reason = item.failureMessages.join('\n')
    assert.doesNotMatch(reason, /timed out|Failed to resolve|SyntaxError|ReferenceError/)
    assert.match(reason, item.title.startsWith('keeping') || item.title.startsWith('matching')
      ? /to have a length of 2 but got 1/
      : item.title.startsWith('unmounting') ? /expected \+?0 to be 1/ : /expected null not to be null/)
  }
  console.log('Reproduced all four precise assertions on exact 4.189.2 blobs. Infrastructure errors are not accepted.')
} finally {
  for (const [file, bytes] of saved) { writeFileSync(file, bytes); assert.ok(readFileSync(file).equals(bytes)) }
}
