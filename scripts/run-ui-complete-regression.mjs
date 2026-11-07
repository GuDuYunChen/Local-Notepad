import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

// Read-only regression runner: runs all original suites even when one fails.
// No migration, filtering, retries, snapshot updates, or source publication here.
const root = process.cwd()
const directory = path.join(root, 'test-results/ui-complete-regression')
fs.mkdirSync(directory, { recursive: true })
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const report = {
  schemaVersion: 1, sourceCommit: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'),
  packageLockSha256: createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'),
  productVersion: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  node: process.version, platform: process.platform, startedAt: new Date().toISOString(), checks: [],
  visualAcceptance: false, windowsAcceptance: false, complete: false,
}
const save = () => fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
const run = (label, command, args, env = {}) => {
  const logfile = path.join(directory, label + '.log')
  const fd = fs.openSync(logfile, 'w')
  const started = Date.now()
  let result
  try { result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], timeout: 900000 }) }
  finally { fs.closeSync(fd) }
  const entry = { label, command: [command, ...args], exitCode: result.status, signal: result.signal ?? null, durationMs: Date.now() - started, error: result.error?.message ?? null, log: path.relative(root, logfile) }
  report.checks.push(entry); save()
  console.log('CHECK', JSON.stringify(entry))
  if (result.status !== 0) {
    const lines = fs.readFileSync(logfile, 'utf8').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)
    console.log('FAILURE_TAIL', label, lines.slice(-10).map(line => line.slice(0,500)).join('\n'))
  }
}
save()
run('dependency-lock', 'node', ['scripts/verify-dependency-lock.mjs'])
run('acceptance-bindings', 'node', ['scripts/check-acceptance-versions.mjs'])
run('build-main', 'npm', ['run', 'build:main'])
run('build-renderer', 'npm', ['run', 'build:renderer'])
run('build-export-fixture', 'node', ['scripts/build-local-export-fixture.mjs'])
run('build-reading-fixture', 'node', ['scripts/build-reading-mode-fixture.mjs'])
run('block-reference-contracts', 'node', ['--test', 'scripts/block-references-evidence.node.mjs', 'scripts/block-references-installed-evidence.node.mjs'])
run('native-helper-contracts', 'node', ['--test', 'scripts/native-helper-lifecycle.node.mjs'])
run('full-vitest', 'npx', ['--no-install', 'vitest', 'run', '--root=.', '--reporter=json', '--outputFile=test-results/ui-complete-regression/full-vitest.json'])
run('original-ui', 'npm', ['run', 'test:ui'])
run('electron', 'npm', ['run', 'test:electron'])
run('editor', 'npm', ['run', 'test:editor'])
run('ui-audit', 'npm', ['run', 'test:ui-audit'])
run('go-tests', 'go', ['-C', 'server', 'test', '-count=1', '-json', './...'])
run('go-build', 'go', ['-C', 'server', 'build', '-o', path.join(directory, 'notepad-server'), './cmd/notepad-server'])
run('go-windows-build', 'go', ['-C', 'server', 'build', '-o', path.join(directory, 'notepad-server.exe'), './cmd/notepad-server'], { GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' })
run('source-unchanged', 'git', ['diff', '--exit-code'])
const full = path.join(directory, 'full-vitest.json')
if (fs.existsSync(full)) {
  try {
    const tests = JSON.parse(fs.readFileSync(full, 'utf8'))
    report.vitest = { files: tests.testResults?.length, tests: tests.numTotalTests, passed: tests.numPassedTests, failed: tests.numFailedTests, pending: tests.numPendingTests }
    console.log('FULL_COUNTS', JSON.stringify(report.vitest))
    report.failureGroups = []
    for (const suite of tests.testResults || []) {
      const failed = (suite.assertionResults || []).filter(test => test.status === 'failed')
      if (failed.length || suite.status === 'failed') {
        const group = { file: path.relative(root, suite.name), count: failed.length, message: (suite.message || '').slice(0, 1200), examples: failed.slice(0, 4).map(test => ({ name: test.fullName, error: test.failureMessages?.[0]?.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 1500) })) }
        report.failureGroups.push(group)
        console.log('FAIL_GROUP', JSON.stringify(group))
      }
    }
  } catch (error) { report.reportParseError = error.message }
} else { report.reportParseError = 'Full Vitest JSON report is missing' }
report.finishedAt = new Date().toISOString()
report.complete = report.checks.length === 17 && report.checks.every(check => check.exitCode === 0) && !report.reportParseError && report.vitest.tests > 0 && report.vitest.failed === 0 && report.vitest.pending === 0
save()
console.log('REGRESSION_RESULT', JSON.stringify({ sourceCommit: report.sourceCommit, complete: report.complete, checks: report.checks.map(({label,exitCode}) => ({label,exitCode})), counts: report.vitest }))
process.exitCode = report.complete ? 0 : 1
