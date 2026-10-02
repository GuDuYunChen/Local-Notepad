import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY = 'GuDuYunChen/Local-Notepad'
export const BRANCH = 'feature/knowledge-os-phase2'
export const PULL_REQUEST = 2
export const BASE_BRANCH = 'master'
const REPOSITORY_ID = 1105107817
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const MAX_BYTES = 2 * 1024 * 1024
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const positive = value => Number.isSafeInteger(value) && value > 0
const demand = (test, message) => { if (!test) throw new Error(message) }
const STATUS = new Set(['queued', 'in_progress', 'completed', 'requested', 'waiting', 'pending'])
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale', 'startup_failure'])
const CHECKS = [
  ['pull_request', 'sync-diagnostic-ci.yml'], ['pull_request', 'sync-conflict-history-ci.yml'],
  ['pull_request', 'ui-redesign-ci.yml'], ['pull_request', 'sync-overview-ci.yml'],
  ['pull_request', 'sync-clock-ci.yml'], ['pull_request', 'sync-help-navigation-ci.yml'],
  ['pull_request', 'editor-discard-ci.yml'], ['pull_request', 'save-recovery-ci.yml'],
  ['push', 'ui-redesign-ci.yml'], ['push', 'desktop-save-ci.yml'],
]
export const REQUIRED_CHECKS = Object.freeze(CHECKS.map(([event, name]) => Object.freeze({ event, path: '.github/workflows/' + name })))

// PR runs from the same source branch can target a different base or PR.
// Missing/ambiguous association is unknown, not permission to reuse old greens.
function belongsToReview(run, head) {
  if (run.event !== 'pull_request') return true
  if (!Array.isArray(run.pull_requests)) return false
  const bindings = run.pull_requests.filter(pr => pr?.number === PULL_REQUEST)
  if (bindings.length !== 1) return false
  const pr = bindings[0]
  return pr.head?.ref === BRANCH && pr.head?.sha === head &&
    pr.head?.repo?.id === REPOSITORY_ID && pr.base?.ref === BASE_BRANCH &&
    pr.base?.repo?.id === REPOSITORY_ID
}

/** Summarize a captured GitHub Actions runs API response; never fetch or retry.
 * Even all-green CI is NOT artifact acceptance, source review or merge approval.
 * Supply a freshly resolved branch HEAD separately, not a SHA from the snapshot.
 */
export function summarizeWorkflowRuns(snapshot, expectedHead) {
  demand(sha(expectedHead), 'Expected a separately resolved 40-character branch HEAD')
  demand(snapshot && Array.isArray(snapshot.workflow_runs) && snapshot.workflow_runs.length <= 200,
    'Expected a bounded GitHub workflow_runs API snapshot, not a wrapper or job report')
  const seen = new Set(), runs = []
  let otherHead = 0, otherBranch = 0
  for (const run of snapshot.workflow_runs) {
    demand(run && sha(run.head_sha) && positive(run.id) && positive(run.run_number) && positive(run.run_attempt), 'Invalid run identity')
    demand(!seen.has(run.id), 'Duplicate run ID: refresh one snapshot instead of combining attempts')
    seen.add(run.id)
    demand(run.repository?.full_name === REPOSITORY, 'Run belongs to another or unverified repository')
    demand(typeof run.path === 'string' && typeof run.event === 'string' && typeof run.head_branch === 'string', 'Missing workflow scope')
    demand(STATUS.has(run.status), 'Unrecognized workflow status')
    demand(run.conclusion === null || CONCLUSIONS.has(run.conclusion), 'Unrecognized workflow conclusion')
    demand(run.status === 'completed' ? run.conclusion !== null : run.conclusion === null, 'Contradictory workflow status/conclusion')
    if (run.head_sha !== expectedHead) { otherHead++; continue }
    if (run.head_branch !== BRANCH) { otherBranch++; continue }
    runs.push(run)
  }
  const checks = REQUIRED_CHECKS.map(required => {
    // Use workflow path and event, never a display name that can collide.
    const matching = runs.filter(r => r.path === required.path && r.event === required.event)
      .sort((a, b) => b.run_number - a.run_number || b.id - a.id)
    const latest = matching[0]
    const scopeVerified = !!latest && belongsToReview(latest, expectedHead)
    const state = !latest ? 'missing' : !scopeVerified ? 'unverified'
      : latest.status !== 'completed' ? 'pending'
        : latest.conclusion === 'success' ? 'success' : 'blocked'
    return Object.freeze({ ...required, state, scopeVerified, runID: latest?.id ?? null,
      attempt: latest?.run_attempt ?? null, conclusion: latest?.conclusion ?? null,
      earlierFailedRuns: Object.freeze(matching.slice(1).filter(r => r.status === 'completed' && r.conclusion !== 'success').map(r => r.id)) })
  })
  // Ten visible greens do not prove coverage of an incomplete API page.
  const coverageComplete = Number.isSafeInteger(snapshot.total_count) &&
    snapshot.total_count >= 0 && snapshot.total_count === snapshot.workflow_runs.length
  const ciComplete = coverageComplete && checks.every(c => c.state === 'success')
  return Object.freeze({ repository: REPOSITORY, branch: BRANCH, head: expectedHead,
    pullRequest: PULL_REQUEST, baseBranch: BASE_BRANCH,
    evidence: 'supplied-api-snapshot-only', coverageComplete, ciComplete,
    acceptance: ciComplete ? 'artifact-verification-required' : 'not-ready',
    checks: Object.freeze(checks), ignoredOtherHeads: otherHead, ignoredOtherBranches: otherBranch,
    automaticRetries: 0, repositoryWrites: 0 })
}

function boundedJSON(filename) {
  // Open once, and bound the actual bytes as well as the initial size.
  const fd = fs.openSync(filename, 'r')
  try {
    const stat = fs.fstatSync(fd)
    demand(stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES, 'Input must be a nonempty regular file <= 2 MiB')
    const buffer = Buffer.alloc(stat.size + 1)
    let count = 0
    while (count < buffer.length) {
      const n = fs.readSync(fd, buffer, count, buffer.length - count, null)
      if (!n) break
      count += n
    }
    demand(count === stat.size, 'Input changed size during reading')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count)))
  } finally { fs.closeSync(fd) }
}

export function verifyIssueCatalog(catalog, directory = ROOT) {
  demand(catalog?.schemaVersion === 1 && catalog.repository === REPOSITORY && sha(catalog.baseline), 'Invalid catalog identity')
  demand(Array.isArray(catalog.issues) && catalog.issues.length > 0 && catalog.issues.length <= 200, 'Invalid issue collection')
  const ids = new Set(), tests = new Set(), sources = new Set(), root = fs.realpathSync(directory)
  const counts = { 'historical-fixed': 0, mitigated: 0, unresolved: 0 }
  const inRepoFile = filename => {
    demand(typeof filename === 'string' && /^(docs|scripts|src|server|electron)\//.test(filename) &&
      !filename.includes('\\') && !filename.split('/').some(v => !v || v === '.' || v === '..'), 'Unsafe catalog path')
    const real = fs.realpathSync(path.join(root, filename)), relative = path.relative(root, real)
    demand(!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) && fs.statSync(real).isFile(), 'Missing or out-of-repository regression path')
  }
  const index = fs.readFileSync(path.join(root, 'docs/KNOWN_ISSUES.md'), 'utf8')
  for (const issue of catalog.issues) {
    demand(issue && /^[A-Z]+-\d{2}$/.test(issue.id) && !ids.has(issue.id), 'Duplicate or invalid issue ID')
    ids.add(issue.id)
    demand(['product', 'test', 'environment', 'handoff', 'limitation'].includes(issue.category) && Object.hasOwn(counts, issue.status), 'Invalid issue classification')
    counts[issue.status]++
    for (const field of ['stage', 'title', 'prevention']) demand(typeof issue[field] === 'string' && issue[field].trim() && issue[field].length <= 1200, 'Missing issue description')
    demand(Array.isArray(issue.sources) && issue.sources.length > 0 && issue.sources.length <= 10 && Array.isArray(issue.tests) && issue.tests.length <= 20, 'Missing evidence links')
    demand(issue.status !== 'historical-fixed' || issue.tests.length > 0, 'Historical fix needs a regression reference')
    demand(index.includes('| ' + issue.id + ' ·'), 'Human-readable index is missing an issue')
    for (const filename of issue.sources) { inRepoFile(filename); sources.add(filename) }
    for (const filename of issue.tests) { inRepoFile(filename); tests.add(filename) }
  }
  return Object.freeze({ issues: ids.size, classifications: Object.freeze(counts),
    sourceDocuments: sources.size, regressionFiles: tests.size, testsExecuted: false,
    statement: 'Catalog integrity only; historical status is not current test execution' })
}

export function main(argv = process.argv.slice(2)) {
  try {
    let result
    if (argv.length === 1 && argv[0] === 'catalog') {
      result = verifyIssueCatalog(boundedJSON(path.join(ROOT, 'docs/quality/known-issues.json')))
    } else if (argv.length === 3 && argv[0] === 'ci') {
      result = summarizeWorkflowRuns(boundedJSON(argv[1]), argv[2])
    } else {
      console.error('Usage: node scripts/stage-review.mjs catalog | ci <runs.json> <fresh-branch-head>')
      return 1
    }
    console.log(JSON.stringify(result))
    return result.ciComplete === false ? 2 : 0
  } catch {
    // Never dump source JSON, external error messages, tokens, paths or raw logs.
    console.error('Stage review input failed validation. Keep prior evidence; refresh the exact source snapshot. No action was taken.')
    return 1
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
