// Run the new real-component regressions against the exact pre-fix parent and
// activity components in an isolated copy. Do not reset/patch the working tree.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const baseline = 'a85a41b3f3e16d1ddf90b35e1c8cd5d4f3adead6'
const sources = new Map([
  ['src/components/SyncCenterPanel.jsx', 'e95a92d42b9d39b53e252a56d0cd2746cba2c6ed'],
  ['src/components/SyncActivityPanel.jsx', '4847ed8bc8f775b44bacf7a9f37d304693bc35e2'],
])
const markers = ['REGRESSION_PLAN_TIMEOUT:', 'REGRESSION_PLAN_SETTLED:']
const originals = new Map([...sources.keys()].map(path => [path, readFileSync(join(root, path))]))
const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
const requireSuccess = (result, operation) => {
  if (result.error || result.signal || result.status !== 0) throw new Error(`${operation}: ${result.error?.message || result.stderr || result.status}`)
  return result.stdout
}
const blobHash = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex')
const temp = mkdtempSync(join(tmpdir(), 'notepad-plan-baseline-'))
try {
  if (git(['cat-file', '-e', `${baseline}^{commit}`]).status !== 0) {
    requireSuccess(git(['fetch', '--no-tags', '--depth=1', 'origin', baseline]), 'fetch baseline')
  }
  // Fonts and binary assets are not needed by the settings components.
  cpSync(join(root, 'src'), join(temp, 'src'), { recursive: true,
    filter: path => !path.startsWith(join(root, 'src', 'assets', 'fonts')) })
  cpSync(join(root, 'scripts', 'fixtures'), join(temp, 'scripts', 'fixtures'), { recursive: true })
  for (const file of ['package.json', 'vitest.config.js', 'vitest.setup.js']) cpSync(join(root, file), join(temp, file))
  symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'), 'junction')
  for (const [path, sha] of sources) {
    const value = requireSuccess(git(['show', `${baseline}:${path}`]), `read ${path}`)
    if (blobHash(value) !== sha) throw new Error(`Unexpected baseline blob: ${path}`)
    writeFileSync(join(temp, path), value)
  }
  const report = join(temp, 'results.json')
  const run = spawnSync(process.execPath, [join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run', '--root=.', 'src/components/SyncPlanLifecycle.test.jsx',
    '-t', 'REGRESSION_PLAN_(TIMEOUT|SETTLED):', '--reporter=json', `--outputFile=${report}`], {
    cwd: temp, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024,
  })
  if (run.error || run.signal || run.status !== 1 || !existsSync(report)) {
    throw new Error(`Expected assertion failures, not setup/timeout/no-test failure: ${run.error?.message || run.signal || run.status}\n${run.stdout}\n${run.stderr}`)
  }
  const result = JSON.parse(readFileSync(report, 'utf8'))
  const assertions = (result.testResults || []).flatMap(test => test.assertionResults || [])
  const failures = assertions.filter(test => test.status === 'failed')
  if (result.numFailedTests !== 2 || failures.length !== 2 || result.numRuntimeErrorTestSuites > 0) {
    throw new Error(`Expected exactly two intended failures: ${JSON.stringify(result)}`)
  }
  for (const marker of markers) {
    const test = failures.find(test => test.fullName.includes(marker))
    if (!test || !test.failureMessages?.some(message => message.includes(marker))) {
      throw new Error(`Missing regression assertion ${marker}: ${JSON.stringify(failures)}`)
    }
    console.log(`EXPECTED REGRESSION DETECTED at ${baseline}: ${test.fullName}`)
  }
  console.log('Exact baseline components compiled and failed both intended assertions. Current-source gates must pass separately.')
} finally {
  rmSync(temp, { recursive: true, force: true })
  for (const [path, bytes] of originals) {
    if (!readFileSync(join(root, path)).equals(bytes)) throw new Error(`Working source changed: ${path}`)
  }
}
