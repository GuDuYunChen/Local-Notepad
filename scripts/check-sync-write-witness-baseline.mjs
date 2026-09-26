// Run the new witness tests against the exact previous production transaction.
// Temporary copy only: build failure or timeout cannot count as a regression.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const baseline = 'cab7d1c144963cd3842291ed3d50bd43bd4416b9'
const source = 'server/internal/syncengine/resolution_validation.go'
const expectedSha = 'af0c1d25d432db28d899c154c029d8fa46de40de'
const expected = new Map([
  ['TestResolutionWitnessSkippedWrites', 'REGRESSION_WRITE_WITNESS:'],
  ['TestResolutionWitnessMissingBase', 'REGRESSION_FIRST_BASE:'],
])
const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 })
const success = (r, operation) => {
  if (r.error || r.signal || r.status !== 0) throw new Error(`${operation}: ${r.error?.message || r.stderr || r.status}`)
  return r.stdout
}
const original = readFileSync(join(root, source))
const temp = mkdtempSync(join(tmpdir(), 'notepad-write-witness-'))
try {
  if (git(['cat-file', '-e', `${baseline}^{commit}`]).status !== 0) {
    success(git(['fetch', '--no-tags', '--depth=1', 'origin', baseline]), 'baseline fetch')
  }
  cpSync(join(root, 'server'), join(temp, 'server'), {
    recursive: true, filter: path => !['bin', 'node_modules', '.git'].includes(basename(path)),
  })
  const value = success(git(['show', `${baseline}:${source}`]), 'baseline source')
  const sha = createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex')
  if (sha !== expectedSha) throw new Error('Baseline source hash mismatch')
  writeFileSync(join(temp, source), value)
  const run = spawnSync('go', ['test', '-json', './internal/syncengine',
    '-run', '^TestResolutionWitness(SkippedWrites|MissingBase)$', '-count=1', '-timeout=60s'], {
    cwd: join(temp, 'server'), encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
  })
  if (run.error || run.signal || run.status !== 1) {
    throw new Error(`Expected assertion failures, not ${run.error?.message || run.signal || run.status}\n${run.stderr}`)
  }
  const events = run.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
  for (const [name, marker] of expected) {
    if (!events.some(e => e.Action === 'fail' && e.Test === name) ||
        !events.some(e => (e.Test === name || e.Test?.startsWith(name + '/')) && e.Output?.includes(marker))) {
      throw new Error(`Missing required regression assertion: ${name}\n${run.stdout}\n${run.stderr}`)
    }
    console.log(`EXPECTED REGRESSION DETECTED at ${baseline}: ${name}`)
    for (const e of events.filter(e => e.Output?.includes(marker))) console.log(e.Output.trim())
  }
  if (events.some(e => e.Action === 'fail' && e.Test && ![...expected.keys()].some(n => e.Test === n || e.Test.startsWith(n + '/')))) {
    throw new Error('Unrelated test failure is not accepted as evidence')
  }
  console.log('Previous transaction compiled and failed both real SQLite witness tests; fixed-source gates run separately.')
} finally {
  rmSync(temp, { recursive: true, force: true })
  if (!readFileSync(join(root, source)).equals(original)) throw new Error('Working source unexpectedly modified')
}
