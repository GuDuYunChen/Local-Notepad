import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { REPOSITORY, BRANCH, REQUIRED_CHECKS, summarizeWorkflowRuns, verifyIssueCatalog } from './stage-review.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)), HEAD = 'a'.repeat(40), OLD = 'b'.repeat(40)
const fixture = () => ({ total_count: 10, workflow_runs: REQUIRED_CHECKS.map((c, i) => ({ ...c,
  id: i + 1, run_number: 12, run_attempt: 1, head_sha: HEAD, head_branch: BRANCH,
  repository: { full_name: REPOSITORY }, status: 'completed', conclusion: 'success',
  pull_requests: c.event === 'pull_request' ? [{ number: 2,
    head: { ref: BRANCH, sha: HEAD, repo: { id: 1105107817 } },
    base: { ref: 'master', repo: { id: 1105107817 } } }] : [],
})) })
const catalog = () => JSON.parse(fs.readFileSync(path.join(root, 'docs/quality/known-issues.json'), 'utf8'))

test('ten exact current-HEAD workflow gates mean CI complete, never artifact acceptance', () => {
  const input = fixture(), before = JSON.stringify(input), r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, true); assert.equal(r.acceptance, 'artifact-verification-required')
  assert.equal(r.checks.length, 10); assert.equal(r.automaticRetries, 0); assert.equal(r.repositoryWrites, 0)
  assert.equal(JSON.stringify(input), before); assert.ok(Object.isFrozen(r) && Object.isFrozen(r.checks))
})
test('eight PR greens do not replace either full push gate', () => {
  const input = fixture(); input.workflow_runs = input.workflow_runs.filter(r => r.event === 'pull_request')
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, false); assert.equal(r.acceptance, 'not-ready')
  assert.deepEqual(r.checks.filter(c => c.state === 'missing').map(c => c.event), ['push', 'push'])
})
test('past-HEAD success cannot satisfy any current-head check', () => {
  const input = fixture(); input.workflow_runs.forEach(r => r.head_sha = OLD)
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, false); assert.equal(r.ignoredOtherHeads, 10)
})
test('same SHA tested on a different branch is not the original development gate', () => {
  const input = fixture(); input.workflow_runs[0].head_branch = 'master'
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, false); assert.equal(r.ignoredOtherBranches, 1)
})
test('display names cannot impersonate workflow identity', () => {
  const input = fixture(); input.workflow_runs[0].name = 'Sync Diagnostic CI'; input.workflow_runs[0].path = 'unrelated.yml'
  assert.equal(summarizeWorkflowRuns(input, HEAD).checks[0].state, 'missing')
})
for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required', 'startup_failure']) {
  test('refuses ' + conclusion + ' as successful acceptance', () => {
    const input = fixture(); input.workflow_runs[0].conclusion = conclusion
    const r = summarizeWorkflowRuns(input, HEAD)
    assert.equal(r.ciComplete, false); assert.equal(r.checks[0].state, 'blocked')
  })
}
for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
  test('reports ' + status + ' once, without scheduling or retry', () => {
    const input = fixture(); Object.assign(input.workflow_runs[0], { status, conclusion: null })
    const r = summarizeWorkflowRuns(input, HEAD)
    assert.equal(r.ciComplete, false); assert.equal(r.checks[0].state, 'pending'); assert.equal(r.automaticRetries, 0)
  })
}
test('latest failed run overrides an earlier successful run of the same path/event', () => {
  const input = fixture(); input.workflow_runs.push({ ...input.workflow_runs[0], id: 20, run_number: 13, conclusion: 'failure' })
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, false); assert.equal(r.checks[0].runID, 20)
})
test('a new run success preserves the earlier failure identity rather than erasing it', () => {
  const input = fixture(); input.workflow_runs[0].conclusion = 'failure'
  input.workflow_runs.push({ ...input.workflow_runs[0], id: 20, run_number: 13, conclusion: 'success', run_attempt: 2 })
  input.total_count = input.workflow_runs.length
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, true); assert.deepEqual(r.checks[0].earlierFailedRuns, [1]); assert.equal(r.checks[0].attempt, 2)
})
for (const [name, change] of [
  ['duplicate snapshots of one run', x => x.workflow_runs.push({ ...x.workflow_runs[0], run_attempt: 2 })],
  ['foreign repository', x => x.workflow_runs[0].repository.full_name = 'somebody/other'],
  ['missing repository', x => delete x.workflow_runs[0].repository],
  ['missing event', x => delete x.workflow_runs[0].event],
  ['missing path', x => delete x.workflow_runs[0].path],
  ['missing branch', x => delete x.workflow_runs[0].head_branch],
  ['unknown status', x => x.workflow_runs[0].status = 'magic-green'],
  ['in-progress success', x => x.workflow_runs[0].status = 'in_progress'],
  ['completed with no result', x => x.workflow_runs[0].conclusion = null],
  ['missing attempt', x => delete x.workflow_runs[0].run_attempt],
  ['unsafe ID', x => x.workflow_runs[0].id = Number.MAX_SAFE_INTEGER + 1],
]) test('rejects ' + name + ' rather than guessing a green status', () => {
  const input = fixture(); change(input); assert.throws(() => summarizeWorkflowRuns(input, HEAD))
})
test('empty/partial snapshots are not successful; wrappers and bad heads are rejected', () => {
  assert.equal(summarizeWorkflowRuns({ workflow_runs: [] }, HEAD).ciComplete, false)
  assert.throws(() => summarizeWorkflowRuns({ result: fixture() }, HEAD))
  assert.throws(() => summarizeWorkflowRuns(fixture(), 'a9a56ba'))
  const x = fixture(); x.workflow_runs = Array(201).fill(x.workflow_runs[0]); assert.throws(() => summarizeWorkflowRuns(x, HEAD))
})
test('catalog has actual source/regression links and does not claim those tests were executed', () => {
  const input = catalog(), before = JSON.stringify(input), r = verifyIssueCatalog(input, root)
  assert.equal(r.issues, 42); assert.ok(r.regressionFiles > 20); assert.ok(r.classifications.unresolved >= 5)
  assert.equal(r.testsExecuted, false); assert.equal(JSON.stringify(input), before)
})
for (const [name, change] of [
  ['duplicate incident ID', x => x.issues[1].id = x.issues[0].id],
  ['missing root cause rule', x => x.issues[0].prevention = ''],
  ['invalid status', x => x.issues[0].status = 'never-happens-again'],
  ['missing evidence document', x => x.issues[0].sources = ['docs/nonexistent.md']],
  ['missing regression', x => x.issues[0].tests = ['scripts/nonexistent.node.mjs']],
  ['fix without regression link', x => x.issues[0].tests = []],
  ['path traversal', x => x.issues[0].sources = ['docs/../package.json']],
  ['absolute path', x => x.issues[0].sources = ['/tmp/evidence.md']],
  ['foreign baseline', x => x.baseline = 'unknown'],
]) test('catalog refuses ' + name, () => { const x = catalog(); change(x); assert.throws(() => verifyIssueCatalog(x, root)) })
test('catalog refuses a directory as an evidence file', () => {
  const x = catalog(); x.issues[0].sources = ['docs/quality']
  assert.throws(() => verifyIssueCatalog(x, root))
})
test('CLI gives bounded failure output and never modifies supplied snapshots', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-stage-cli-')), script = path.join(root, 'scripts/stage-review.mjs')
  try {
    const file = path.join(tmp, 'snapshot.json')
    for (const [raw, exit] of [[JSON.stringify(fixture()), 0], ['{"workflow_runs":[]}', 2], ['{"PRIVATE_TOKEN":', 1], [' '.repeat(2*1024*1024+1), 1]]) {
      fs.writeFileSync(file, raw)
      const run = spawnSync(process.execPath, [script, 'ci', file, HEAD], { encoding: 'utf8', timeout: 10000 })
      assert.equal(run.status, exit); assert.equal(fs.readFileSync(file, 'utf8'), raw)
      assert.ok(run.stdout.length + run.stderr.length < 8000); assert.ok(!run.stderr.includes('PRIVATE_TOKEN'))
    }
    assert.deepEqual(fs.readdirSync(tmp), ['snapshot.json'])
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})

for (const total_count of [11, 9, undefined, '10']) {
  test('refuses complete CI when API page coverage is unknown or incomplete: ' + total_count, () => {
    const input = fixture(); input.total_count = total_count
    const r = summarizeWorkflowRuns(input, HEAD)
    assert.equal(r.checks.every(c => c.state === 'success'), true)
    assert.equal(r.coverageComplete, false); assert.equal(r.ciComplete, false)
    assert.equal(r.acceptance, 'not-ready'); assert.equal(r.automaticRetries, 0)
  })
}

// The run's branch/SHA alone cannot identify which PR/base was tested.
for (const [name, change] of [
  ['another PR', r => r.pull_requests[0].number = 3],
  ['another target branch', r => r.pull_requests[0].base.ref = 'main'],
  ['another PR head', r => r.pull_requests[0].head.sha = OLD],
  ['another source branch', r => r.pull_requests[0].head.ref = 'other'],
  ['fork source', r => r.pull_requests[0].head.repo.id = 123],
  ['foreign target', r => r.pull_requests[0].base.repo.id = 123],
  ['missing association', r => delete r.pull_requests],
  ['empty association', r => r.pull_requests = []],
  ['malformed association', r => r.pull_requests = {number: 2}],
  ['null association', r => r.pull_requests = [null]],
  ['missing source identity', r => delete r.pull_requests[0].head.repo],
  ['ambiguous repeated PR', r => r.pull_requests.push(structuredClone(r.pull_requests[0]))],
]) test('cannot accept PR2 from ' + name, () => {
  const input = fixture(); change(input.workflow_runs[0])
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, false); assert.equal(r.acceptance, 'not-ready')
  assert.equal(r.checks[0].state, 'unverified'); assert.equal(r.checks[0].scopeVerified, false)
  assert.equal(r.automaticRetries, 0)
})
test('new unverified PR run cannot be discarded to expose an older green run', () => {
  const input = fixture(), newer = structuredClone(input.workflow_runs[0])
  Object.assign(newer, { id: 100, run_number: 13, pull_requests: [] })
  input.workflow_runs.push(newer); input.total_count++
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, false); assert.equal(r.checks[0].runID, 100)
  assert.equal(r.checks[0].state, 'unverified')
})
test('one exact PR2 binding among other associations is sufficient, but not acceptance', () => {
  const input = fixture()
  input.workflow_runs[0].pull_requests.unshift({ number: 3 })
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, true); assert.equal(r.acceptance, 'artifact-verification-required')
  assert.equal(r.pullRequest, 2); assert.equal(r.baseBranch, 'master')
})
test('push gates do not require PR bindings', () => {
  const input = fixture()
  input.workflow_runs.filter(r => r.event === 'push').forEach(r => delete r.pull_requests)
  const r = summarizeWorkflowRuns(input, HEAD)
  assert.equal(r.ciComplete, true); assert.equal(r.checks.every(c => c.scopeVerified), true)
})
