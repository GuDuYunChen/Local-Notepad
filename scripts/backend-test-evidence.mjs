import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const TEST_ARGS = Object.freeze(['test', '-json', '-count=1', './...'])
const LIST_ARGS = ['list', '-f', '{{.ImportPath}}\t{{.Name}}\t{{len .TestGoFiles}}\t{{len .XTestGoFiles}}', './...']
const DISCOVER_ARGS = ['test', '-list', '^Test', './internal/syncs3']
const FOCUS = 'notepad-server/internal/syncs3'
const MAX = 64 * 1024 * 1024
const hash = b => createHash('sha256').update(b).digest('hex')
const read = (p, max = MAX) => {
  const s = fs.lstatSync(p)
  assert.ok(s.isFile() && !s.isSymbolicLink() && s.size <= max, 'invalid evidence file')
  return fs.readFileSync(p)
}
const text = (p, max) => read(p, max).toString('utf8')
const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 })
  assert.ok(!r.error && r.status === 0, 'git identity unavailable')
  return r.stdout.trim()
}

// Trusted expected tree comes from the separately read GitHub commit, not the
// report being checked. Verify the checkout bytes against tracked Git blobs.
export function sourceIdentity(root, tree) {
  assert.match(tree, /^[a-f0-9]{40}$/)
  const entries = git(root, ['ls-tree', '-r', '-z', tree, '--', 'server']).split('\0').filter(Boolean)
  const files = []
  for (const line of entries) {
    const split = line.indexOf('\t'), [mode, type, blob] = line.slice(0, split).split(' '), name = line.slice(split + 1)
    if (!(name.endsWith('.go') || name === 'server/go.mod' || name === 'server/go.sum')) continue
    assert.ok(/^100(644|755)$/.test(mode) && type === 'blob' && name.startsWith('server/') && !name.split('/').includes('..'), 'invalid source entry')
    const bytes = read(path.join(root, name))
    const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    assert.equal(oid, blob, 'source bytes differ from Git tree')
    files.push({ path: name, gitBlob: blob, sha256: hash(bytes), bytes: bytes.length })
  }
  assert.ok(files.length && files.some(f => f.path === 'server/go.mod'), 'missing module')
  const mod = text(path.join(root, 'server/go.mod'), 1024 * 1024)
  const moduleName = /^module\s+(\S+)\s*$/m.exec(mod)?.[1]
  const toolchain = /^toolchain\s+(go\d+\.\d+\.\d+)\s*$/m.exec(mod)?.[1]
  assert.equal(moduleName, 'notepad-server'); assert.ok(toolchain, 'explicit toolchain required')
  return { tree, moduleName, toolchain, files }
}

export function parsePackages(raw, source) {
  assert.ok(typeof raw === 'string' && raw.length > 0 && raw.length <= 1024 * 1024, 'missing package list')
  const seen = new Set()
  const result = raw.trimEnd().split(/\r?\n/).map(line => {
    const parts = line.split('\t'); assert.equal(parts.length, 4, 'invalid package line')
    const [name, packageName, a, b] = parts
    assert.ok(name === source.moduleName || name.startsWith(source.moduleName + '/'), 'foreign package module')
    assert.match(packageName, /^[A-Za-z_]\w*$/)
    assert.match(a, /^\d+$/); assert.match(b, /^\d+$/)
    assert.ok(!seen.has(name), 'duplicate package'); seen.add(name)
    const dir = 'server' + name.slice(source.moduleName.length)
    assert.ok(source.files.some(f => path.posix.dirname(f.path) === dir && f.path.endsWith('.go')), 'package absent from exact source tree')
    const allTests = source.files.filter(f => path.posix.dirname(f.path) === dir && f.path.endsWith('_test.go')).length
    assert.ok(Number(a) + Number(b) <= allTests, 'test file count disagrees with source')
    return { name, packageName, testFiles: Number(a) + Number(b) }
  })
  const dirs = [...new Set(source.files.filter(f => f.path.endsWith('.go') && !f.path.endsWith('_test.go')).map(f => path.posix.dirname(f.path)))].sort()
  assert.deepEqual(result.map(p => 'server' + p.name.slice(source.moduleName.length)).sort(), dirs, 'package list does not cover the source directories')
  return result
}

export function parseTestEvents(raw, packages, requiredTests) {
  assert.ok(typeof raw === 'string' && raw.length > 0 && Buffer.byteLength(raw) <= MAX && raw.endsWith('\n'), 'truncated or missing test stream')
  assert.ok(Array.isArray(requiredTests) && requiredTests.length > 0 && requiredTests.every(t => /^Test\w+$/.test(t)), 'missing S3 tests')
  assert.equal(new Set(requiredTests).size, requiredTests.length, 'duplicate required test')
  const states = new Map(packages.map(p => [p.name, { ...p, started: false, terminal: '', tests: new Map() }]))
  assert.ok(states.has(FOCUS), 'S3 package not discovered')
  for (const line of raw.trimEnd().split('\n')) {
    assert.ok(Buffer.byteLength(line) <= 1024 * 1024, 'oversized test event')
    let e
    try { e = JSON.parse(line) } catch { throw new Error('malformed test event') }
    assert.ok(e && typeof e === 'object' && !Array.isArray(e), 'invalid test event')
    assert.ok(typeof e.Time === 'string' && Number.isFinite(Date.parse(e.Time)), 'event timestamp missing')
    const p = states.get(e.Package); assert.ok(p, 'unexpected package in test stream')
    assert.ok(['start','run','pause','cont','pass','fail','output','skip','bench'].includes(e.Action), 'unknown test action')
    assert.notEqual(e.Action, 'fail', 'backend tests failed')
    assert.ok(!e.FailedBuild, 'backend build failed')
    if (e.Action === 'start') {
      assert.ok(!e.Test && !p.started && !p.terminal, 'duplicate package start'); p.started = true; continue
    }
    assert.ok(p.started && !p.terminal, 'event outside active package')
    if (e.Action === 'output') {
      assert.equal(typeof e.Output, 'string')
      assert.ok(!/^ok\s+\S+\s+\(cached\)/m.test(e.Output), 'cached test output rejected')
      continue
    }
    if (e.Test) {
      assert.equal(typeof e.Test, 'string')
      const state = p.tests.get(e.Test)
      if (e.Action === 'run') { assert.ok(!state, 'duplicate test run'); p.tests.set(e.Test, 'running') }
      else if (e.Action === 'pause') { assert.equal(state, 'running'); p.tests.set(e.Test, 'paused') }
      else if (e.Action === 'cont') { assert.equal(state, 'paused'); p.tests.set(e.Test, 'running') }
      else {
        assert.ok(['pass','skip'].includes(e.Action) && state === 'running', 'test terminal without active run')
        if (p.name === FOCUS) assert.notEqual(e.Action, 'skip', 'S3 test skipped')
        p.tests.set(e.Test, e.Action)
      }
    } else {
      assert.ok(['pass','skip'].includes(e.Action), 'invalid package terminal')
      if (e.Action === 'skip') assert.equal(p.testFiles, 0, 'package with test files skipped')
      assert.ok([...p.tests.values()].every(v => v === 'pass' || v === 'skip'), 'unfinished tests')
      p.terminal = e.Action
    }
  }
  for (const p of states.values()) assert.ok(p.started && p.terminal, 'missing package execution')
  const s3 = states.get(FOCUS)
  const top = [...s3.tests.keys()].filter(t => !t.includes('/')).sort()
  assert.deepEqual(top, [...requiredTests].sort(), 'S3 discovery and execution differ')
  assert.ok(requiredTests.every(t => s3.tests.get(t) === 'pass'), 'missing passed S3 test')
  const summary = [...states.values()].map(p => ({ package: p.name, status: p.terminal,
    passed: [...p.tests.values()].filter(v => v === 'pass').length,
    skipped: [...p.tests.values()].filter(v => v === 'skip').length }))
  return { packages: summary, s3TopLevel: top.length, testPassEvents: summary.reduce((n,p) => n + p.passed, 0),
    testSkipEvents: summary.reduce((n,p) => n + p.skipped, 0) }
}

const descriptor = p => { const b = read(p); return { bytes: b.length, sha256: hash(b) } }
const discover = raw => {
  const lines = raw.trimEnd().split(/\r?\n/)
  const names = lines.filter(s => /^Test\w+$/.test(s))
  assert.ok(lines.every(s => /^Test\w+$/.test(s) || /^ok\s+notepad-server\/internal\/syncs3\s+/.test(s)), 'invalid S3 test listing')
  return names
}

export function verifyBackendReport(dir, root, expected) {
  assert.match(expected.commit, /^[a-f0-9]{40}$/); assert.match(expected.tree, /^[a-f0-9]{40}$/)
  const r = JSON.parse(text(path.join(dir, 'report.json'), 8 * 1024 * 1024))
  assert.equal(r.schemaVersion, 1); assert.equal(r.complete, true)
  assert.equal(r.commit, expected.commit); assert.equal(r.tree, expected.tree)
  assert.equal(r.repository, 'GuDuYunChen/Local-Notepad')
  assert.equal(r.branch, 'feature/knowledge-os-phase2')
  assert.ok((expected.localFixture ? ['local-fixture'] : ['push','pull_request']).includes(r.event), 'fixture is not CI evidence')
  const source = sourceIdentity(root, expected.tree)
  assert.deepEqual(r.sourceBefore, source); assert.deepEqual(r.sourceAfter, source)
  assert.equal(r.go.version, source.toolchain); assert.equal(r.go.os, 'linux'); assert.equal(r.go.arch, 'amd64')
  assert.deepEqual(r.testArgs, TEST_ARGS)
  assert.deepEqual(r.environment, { GOTOOLCHAIN: 'local', GOWORK: 'off', GOFLAGS: '' })
  assert.deepEqual(r.commands.map(c => [c.name, c.exitCode, c.signal, c.error]), [
    ['environment', 0, null, null], ['packages', 0, null, null], ['discovery', 0, null, null], ['tests', 0, null, null]])
  assert.deepEqual(r.commands.map(c => c.args), [
    ['env','-json','GOVERSION','GOOS','GOARCH','GOMOD'], LIST_ARGS, DISCOVER_ARGS, [...TEST_ARGS]])
  assert.ok(r.commands.every(c => c.workingDirectory === 'server'), 'wrong command working directory')
  const names = ['go-env.json','packages.tsv','s3-list.txt','tests.jsonl']
  assert.deepEqual(Object.keys(r.files).sort(), [...names, ...names.map(n => n + '.stderr')].sort())
  for (const [name, d] of Object.entries(r.files)) assert.deepEqual(descriptor(path.join(dir, name)), d, 'raw artifact checksum mismatch')
  const go = JSON.parse(text(path.join(dir, names[0]), 65536))
  assert.equal(go.GOVERSION, source.toolchain); assert.equal(go.GOOS, 'linux'); assert.equal(go.GOARCH, 'amd64')
  assert.ok(typeof go.GOMOD === 'string' && go.GOMOD.replaceAll('\\','/').endsWith('/server/go.mod'))
  const pkgs = parsePackages(text(path.join(dir, names[1]), 1024 * 1024), source)
  const result = parseTestEvents(text(path.join(dir, names[3])), pkgs, discover(text(path.join(dir, names[2]), 1024 * 1024)))
  assert.deepEqual(r.result, result)
  return { commit: r.commit, tree: r.tree, ...result, scope: 'backend-tests-only', artifactVerification: true }
}

export function collectBackendEvidence(root = ROOT, output = path.join(root, 'test-results/backend-tests'), options = {}) {
  fs.mkdirSync(output, { recursive: true })
  assert.equal(fs.readdirSync(output).length, 0, 'use a fresh evidence directory; do not overwrite earlier evidence')
  const report = { schemaVersion: 1, complete: false, commands: [], files: {} }
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  save()
  const command = (name, args, filename, budget = 120000) => {
    const out = fs.openSync(path.join(output, filename), 'wx'), err = fs.openSync(path.join(output, filename + '.stderr'), 'wx')
    let r
    try { r = spawnSync('go', args, { cwd: path.join(root, 'server'), env: { ...process.env, GOTOOLCHAIN: 'local', GOWORK: 'off', GOFLAGS: '' },
      stdio: ['ignore', out, err], timeout: budget, killSignal: 'SIGKILL' }) }
    finally { fs.closeSync(out); fs.closeSync(err) }
    report.commands.push({ name, args: [...args], workingDirectory: 'server', exitCode: r.status, signal: r.signal, error: r.error ? 'execution-error' : null })
    for (const n of [filename, filename + '.stderr']) report.files[n] = descriptor(path.join(output, n))
    save(); assert.ok(!r.error && r.status === 0 && r.signal === null, `${name} did not complete successfully; raw logs preserved`)
  }
  try {
    report.commit = git(root, ['rev-parse', 'HEAD'])
    report.tree = git(root, ['rev-parse', 'HEAD^{tree}'])
    assert.match(report.commit, /^[a-f0-9]{40}$/)
    if (!options.localFixture && process.env.GITHUB_SHA) assert.equal(report.commit, process.env.GITHUB_SHA)
    assert.equal(git(root, ['diff', '--name-only', 'HEAD', '--', 'server']), '', 'dirty backend checkout')
    assert.equal(git(root, ['ls-files', '--others', '--exclude-standard', '--', 'server']), '', 'untracked backend input')
    Object.assign(report, { repository: options.localFixture ? 'GuDuYunChen/Local-Notepad' : process.env.GITHUB_REPOSITORY,
      branch: options.localFixture ? 'feature/knowledge-os-phase2' : (process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME),
      event: options.localFixture ? 'local-fixture' : process.env.GITHUB_EVENT_NAME, testArgs: [...TEST_ARGS],
      environment: { GOTOOLCHAIN: 'local', GOWORK: 'off', GOFLAGS: '' }, sourceBefore: sourceIdentity(root, report.tree) })
    assert.equal(report.repository, 'GuDuYunChen/Local-Notepad'); assert.equal(report.branch, 'feature/knowledge-os-phase2')
    command('environment', ['env', '-json', 'GOVERSION','GOOS','GOARCH','GOMOD'], 'go-env.json', 15000)
    const go = JSON.parse(text(path.join(output,'go-env.json'), 65536))
    assert.equal(go.GOVERSION, report.sourceBefore.toolchain, 'toolchain mismatch; no automatic download')
    report.go = { version: go.GOVERSION, os: go.GOOS, arch: go.GOARCH }
    command('packages', LIST_ARGS, 'packages.tsv')
    command('discovery', DISCOVER_ARGS, 's3-list.txt')
    command('tests', TEST_ARGS, 'tests.jsonl', 480000)
    report.sourceAfter = sourceIdentity(root, report.tree)
    assert.equal(git(root, ['diff', '--name-only', 'HEAD', '--', 'server']), '', 'backend input changed during tests')
    assert.equal(git(root, ['ls-files', '--others', '--exclude-standard', '--', 'server']), '', 'untracked backend input after tests')
    report.result = parseTestEvents(text(path.join(output,'tests.jsonl')), parsePackages(text(path.join(output,'packages.tsv')), report.sourceBefore), discover(text(path.join(output,'s3-list.txt'))))
    report.complete = true; save()
    return verifyBackendReport(output, root, { commit: report.commit, tree: report.tree, localFixture: !!options.localFixture })
  } catch (error) {
    report.complete = false; report.failure = 'backend evidence incomplete; inspect preserved raw files'; save(); throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'verify') {
      assert.equal(process.argv.length, 6, 'usage: verify <directory> <checkout-commit> <tree>')
      console.log(JSON.stringify(verifyBackendReport(path.resolve(process.argv[3]), ROOT, {commit: process.argv[4], tree: process.argv[5]})))
    } else { assert.equal(process.argv.length, 2); console.log(JSON.stringify(collectBackendEvidence())) }
  } catch (error) { console.error(`Backend evidence check failed: ${error.message}`); process.exitCode = 1 }
}
