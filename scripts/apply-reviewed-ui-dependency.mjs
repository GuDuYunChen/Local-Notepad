import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { verifyDependencyLock } from './verify-dependency-lock.mjs'

// Replay the accepted dependency introduction, without resolving a new graph.
// The historical preparation checkout must keep its own version and scripts.
const snapshot = '93fa4f9aaa0b806838833e02156e7bb2e2a7f36b'
const parent = '030b176d4989c1adb9eb2907fae1091e441b7695'
const baseline = '1c8ec5689847a580ce307b9157fbbc8c1ac43a8f'
const files = ['package.json', 'package-lock.json']
const directory = process.cwd()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = (args, cwd = directory, input) => {
  const result = spawnSync('git', args, { cwd, input, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.status, 0, `git ${args[0]} failed`)
  return result.stdout
}
const text = args => git(args).toString('utf8').trim()
const readFiles = cwd => files.map(name => fs.readFileSync(path.join(cwd, name)))
const readCommit = commit => files.map(name => git(['show', `${commit}:${name}`]))
const parse = raw => raw.map(value => JSON.parse(value.toString('utf8')))
const fingerprints = raw => Object.fromEntries(files.map((name, index) => [name, {
  bytes: raw[index].length, sha256: sha256(raw[index]),
  blob: git(['hash-object', '--stdin'], directory, raw[index]).toString('utf8').trim(),
}]))
const assertClean = () => assert.equal(
  text(['status', '--porcelain=v1', '--untracked-files=no', '--', ...files]), '',
  'Dependency inputs have staged or unstaged changes',
)

function replay() {
  assert.equal(fs.realpathSync(directory), fs.realpathSync(text(['rev-parse', '--show-toplevel'])),
    'Run from the checkout root')
  git(['ls-files', '--error-unmatch', '--', ...files])
  for (const name of files) assert.ok(fs.lstatSync(path.join(directory, name)).isFile(),
    'Dependency inputs must be regular tracked files')
  assertClean()
  const source = text(['rev-parse', 'HEAD'])
  const workflowSource = process.env.GITHUB_SHA || ''
  assert.match(workflowSource, /^[a-f0-9]{40}$/, 'Missing exact workflow source')
  const tools = {}
  for (const name of ['apply-reviewed-ui-dependency.mjs', 'verify-dependency-lock.mjs']) {
    const raw = fs.readFileSync(fileURLToPath(new URL(name, import.meta.url)))
    assert.ok(raw.equals(git(['show', `${workflowSource}:scripts/${name}`])),
      'Dependency replay tool differs from the workflow source')
    tools[name] = { bytes: raw.length, sha256: sha256(raw) }
  }
  assert.equal(text(['rev-parse', `${snapshot}^`]), parent, 'Unexpected dependency snapshot parent')
  assert.deepEqual(text(['diff', '--name-only', parent, snapshot]).split('\n').sort(), [...files].sort(),
    'Reviewed change must contain only the dependency manifest and lock')
  const before = readFiles(directory)
  const [manifest, lock] = parse(before)
  verifyDependencyLock(manifest, lock)
  const old = readCommit(parent), historical = readCommit(baseline), reviewed = readCommit(snapshot)
  const [oldManifest, oldLock] = parse(old), [reviewedManifest, reviewedLock] = parse(reviewed)
  verifyDependencyLock(oldManifest, oldLock)
  verifyDependencyLock(reviewedManifest, reviewedLock)
  assert.ok(historical[1].equals(old[1]), 'Historical baseline lock differs from the reviewed parent')
  assert.ok(isDeepStrictEqual(reviewedManifest, {
    ...oldManifest, dependencies: { ...oldManifest.dependencies, antd: '6.6.8' },
  }), 'Reviewed manifest delta must only introduce the exact Ant Design dependency')
  const patch = git(['diff', '--binary', '--full-index', parent, snapshot, '--', ...files])
  let candidate = before, mode = 'already-integrated'
  if (manifest.dependencies?.antd === '6.6.8') {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      assert.ok(isDeepStrictEqual(manifest[field] || {}, reviewedManifest[field] || {}),
        `Current ${field} differ from the reviewed dependency snapshot`)
    }
    const normalized = structuredClone(lock)
    normalized.version = reviewedLock.version
    normalized.packages[''].version = reviewedLock.packages[''].version
    assert.ok(isDeepStrictEqual(normalized, reviewedLock), 'Current dependency graph differs from the reviewed snapshot')
  } else {
    assert.ok(before[0].equals(historical[0]) || before[0].equals(old[0]),
      'Manifest is not an unchanged supported dependency baseline')
    assert.ok(before[1].equals(old[1]), 'Lock is not the unchanged reviewed dependency baseline')
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-reviewed-dependency-'))
    try {
      files.forEach((name, index) => fs.writeFileSync(path.join(temporary, name), before[index]))
      git(['apply', '--check', '-'], temporary, patch)
      git(['apply', '-'], temporary, patch)
      candidate = readFiles(temporary)
      const [nextManifest, nextLock] = parse(candidate)
      assert.ok(candidate[1].equals(reviewed[1]), 'Replayed lock differs from the exact reviewed bytes')
      assert.ok(isDeepStrictEqual(nextManifest, {
        ...manifest, dependencies: { ...manifest.dependencies, antd: '6.6.8' },
      }), 'Dependency replay changed unrelated manifest fields')
      verifyDependencyLock(nextManifest, nextLock)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
    mode = 'applied'
  }
  assert.equal(text(['rev-parse', 'HEAD']), source, 'Checkout changed during dependency replay')
  assertClean()
  assert.ok(readFiles(directory).every((raw, index) => raw.equals(before[index])),
    'Dependency inputs changed during review')
  const indexBefore = git(['ls-files', '--stage', '--', ...files])
  let applying = false
  try {
    if (mode === 'applied') {
      git(['apply', '--check', '-'], directory, patch)
      applying = true
      git(['apply', '-'], directory, patch)
    }
    const after = readFiles(directory)
    assert.ok(after.every((raw, index) => raw.equals(candidate[index])), 'Applied dependency bytes differ from preflight')
    assert.ok(git(['ls-files', '--stage', '--', ...files]).equals(indexBefore), 'Dependency replay changed the index')
    const summary = verifyDependencyLock(...parse(after))
    fs.writeFileSync(1, JSON.stringify({
      mode, source, workflowSource, snapshot, parent, baseline,
      patchSha256: sha256(patch), before: fingerprints(before), after: fingerprints(after), tools,
      ...summary, validation: 'reviewed-git-delta-and-lock-only',
    }) + '\n')
  } catch (error) {
    if (applying) files.forEach((name, index) => fs.writeFileSync(path.join(directory, name), before[index]))
    throw error
  }
}

try { replay() }
catch (error) {
  // Do not print manifest/lock contents or an assertion's potentially large diff.
  console.error('Reviewed UI dependency replay failed: ' + String(error.message).split('\n')[0].slice(0, 240))
  process.exitCode = 1
}
