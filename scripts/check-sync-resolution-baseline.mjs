// Prove the new fault tests detect the exact pre-fix production implementation.
// All execution happens in a temporary server copy. Never reset the working tree.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const baseline = '7e35b0adc298d1ae233bcad28ef2514c13957625'
const sources = new Map([
  ['server/internal/syncengine/engine.go', '393edc61414d956290ef15014f743d3798c41100'],
  ['server/internal/syncengine/resolution_validation.go', '528b60335b72730567d315e889566ea4fdf5727e'],
])
const expected = new Map([
  ['TestResolutionAtomicHistoryFailure', 'REGRESSION_HISTORY:'],
  ['TestResolutionAtomicReceiptFailure', 'REGRESSION_RECEIPT:'],
])
const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 })
const requireSuccess = (result, operation) => {
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${operation} failed: ${result.error?.message || result.stderr || result.status}`)
  }
  return result.stdout
}
const hash = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex')

const originals = new Map([...sources.keys()].map(path => [path, readFileSync(join(root, path))]))
const temp = mkdtempSync(join(tmpdir(), 'notepad-resolution-baseline-'))
try {
  const available = git(['cat-file', '-e', `${baseline}^{commit}`])
  if (available.status !== 0) {
    requireSuccess(git(['fetch', '--no-tags', '--depth=1', 'origin', baseline]), 'fetch reviewed baseline')
  }
  cpSync(join(root, 'server'), join(temp, 'server'), {
    recursive: true,
    filter: path => !['bin', 'node_modules', '.git'].includes(basename(path)),
  })
  for (const [path, sha] of sources) {
    const value = requireSuccess(git(['show', `${baseline}:${path}`]), `read ${path}`)
    if (hash(value) !== sha) throw new Error(`Unexpected baseline blob: ${path}`)
    writeFileSync(join(temp, path), value)
  }
  const run = spawnSync('go', ['test', '-json', './internal/syncengine',
    '-run', '^TestResolutionAtomic(HistoryFailure|ReceiptFailure)$', '-count=1', '-timeout=60s'], {
    cwd: join(temp, 'server'), encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
  })
  if (run.error || run.signal || run.status !== 1) {
    throw new Error(`Expected two baseline regression failures, got ${run.error?.message || run.signal || run.status}\n${run.stderr}`)
  }
  const events = run.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
  for (const [name, marker] of expected) {
    const failed = events.some(event => event.Action === 'fail' && event.Test === name)
    const reason = events.some(event => event.Test?.startsWith(name + '/') && event.Output?.includes(marker))
    if (!failed || !reason) {
      throw new Error(`Baseline did not fail for the required assertion: ${name}\n${run.stdout}\n${run.stderr}`)
    }
    console.log(`EXPECTED REGRESSION DETECTED at ${baseline}: ${name}`)
    for (const event of events.filter(event => event.Test?.startsWith(name + '/') && event.Output?.includes(marker))) {
      console.log(event.Output.trim())
    }
  }
  const unrelated = events.filter(event => event.Action === 'fail' && event.Test &&
    ![...expected.keys()].some(name => event.Test === name || event.Test.startsWith(name + '/')))
  if (unrelated.length) throw new Error('Unrelated failure is not an accepted regression witness')
  console.log('Baseline compiled and both real SQLite fault tests detected their original defects. Fixed-source gates must pass separately.')
} finally {
  rmSync(temp, { recursive: true, force: true })
  for (const [path, bytes] of originals) {
    if (!readFileSync(join(root, path)).equals(bytes)) throw new Error(`Working source changed during baseline check: ${path}`)
  }
}
