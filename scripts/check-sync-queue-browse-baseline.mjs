import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Prove the new React assertions expose the actual old component, not a mock
// implementation or a syntax/import failure. The fixed suite runs separately.
const root = fileURLToPath(new URL('../', import.meta.url))
const sha = 'f7e26742a30582e722a6846408997fe65ba5fb04'
const expectedBlob = 'c80b606959a60333ec0859b51242464245678237'
const response = await fetch(`https://raw.githubusercontent.com/GuDuYunChen/Local-Notepad/${sha}/src/components/SyncConflictQueue.jsx`, { signal: AbortSignal.timeout(30000) })
assert.ok(response.ok, `Cannot retrieve baseline: HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), expectedBlob, 'Baseline Git blob mismatch')
const id = randomUUID()
const componentName = `SyncQueueBrowseBaseline-${id}`
const component = path.join(root, 'src/components', componentName + '.jsx')
const testFile = path.join(root, 'src/components', componentName + '.test.jsx')
const report = path.join(root, 'src/components', componentName + '.json')
const currentTest = fs.readFileSync(path.join(root, 'src/components/SyncConflictBrowseGuard.test.jsx'), 'utf8')
const needle = "import Queue from './SyncConflictQueue'"
assert.equal(currentTest.split(needle).length, 2, 'Expected exactly one real component import')
const created = []
try {
  fs.writeFileSync(component, bytes, { flag: 'wx' }); created.push(component)
  fs.writeFileSync(testFile, currentTest.replace(needle, `import Queue from './${componentName}'`), { flag: 'wx' }); created.push(testFile)
  // The UUID prevents collision with other independent validation processes.
  created.push(report)
  const run = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--root=.',
    testFile, '-t', 'REGRESSION_BROWSE:', '--reporter=json', `--outputFile=${report}`],
  { cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 })
  assert.ifError(run.error); assert.equal(run.signal, null, 'Baseline timed out or was signaled')
  assert.notEqual(run.status, 0, 'The old component unexpectedly passed all intended regressions')
  const result = JSON.parse(fs.readFileSync(report, 'utf8'))
  const assertions = result.testResults.flatMap(item => item.assertionResults || [])
  for (const name of ['next', 'last', 'previous', 'first']) {
    const matches = assertions.filter(item => item.fullName.includes(`REGRESSION_BROWSE: ${name} first`))
    assert.equal(matches.length, 1, `Missing or duplicate actual React assertion: ${name}`)
    assert.equal(matches[0].status, 'failed', `Baseline did not expose ${name}`)
    assert.ok(matches[0].failureMessages.some(message => message.includes('REGRESSION_BROWSE: a revoked old card reached the resolver')),
      `Baseline ${name} failed for a different reason`)
    console.log(`EXPECTED REGRESSION DETECTED at ${sha}: native DOM ${name} event then old confirmation inside a React test batch`)
  }
  console.log('Exact old Queue + real Review compiled and the four pagination assertions exposed premature resolver calls. This is React DOM testing, not native Windows end-to-end evidence.')
} finally {
  for (const file of created.reverse()) fs.rmSync(file, { force: true })
}
