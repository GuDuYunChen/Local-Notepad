// Isolated source authoring only: publish two full, validated Git blobs.
// Never updates refs, commits, workflows, releases, packages or deployments.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const repository = 'GuDuYunChen/Local-Notepad'
const base = '0509350ad43557771713e07f5dcd7f75dcd162e2'
const ref = 'refs/heads/ci/source-objects-2f86'
const out = path.resolve('test-results/source-objects-2f86')
fs.mkdirSync(out, { recursive: true })
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex')
const blob = bytes => digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1')
const report = { complete: false, sourceAuthoringOnly: true, projectTestsExecuted: false,
  repository, base, authoringCommit: process.env.GITHUB_SHA || '', files: [] }
const save = () => fs.writeFileSync(path.join(out, 'source-objects.json'), JSON.stringify(report, null, 2) + '\n')
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 })
  assert.equal(result.status, 0, 'Source authoring command failed: ' + command + ' ' + args.join(' '))
  return result.stdout.trim()
}
const expectedBase = {
  'package.json': 'c54c1d6fc97586d3321b6c9fca776c0cb80034b1',
  'package-lock.json': '48fd55d9829c9f1a8b69d27b1d07f3257ba54fd0',
  'src/components/UIRedesign.test.jsx': 'c8ab52833f9de9ba3bdedb1e6fa8bc075737a09a',
}
save()
try {
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.GITHUB_REPOSITORY, repository)
  assert.equal(process.env.GITHUB_REF, ref)
  assert.match(process.env.GITHUB_SHA || '', /^[0-9a-f]{40}$/)
  assert.equal(run('git', ['rev-parse', 'HEAD']), process.env.GITHUB_SHA)
  assert.equal(run('git', ['rev-parse', 'HEAD^']), base)
  for (const [filename, expected] of Object.entries(expectedBase)) {
    assert.equal(run('git', ['rev-parse', `${base}:${filename}`]), expected)
    assert.equal(blob(fs.readFileSync(filename)), expected, 'Wrong full base file: ' + filename)
  }
  const filename = 'src/components/UIRedesign.test.jsx'
  const before = fs.readFileSync('scripts/ci-source-objects-2f86-before.txt', 'utf8')
  const after = fs.readFileSync('scripts/ci-source-objects-2f86-after.txt', 'utf8')
  assert.equal(digest(before), '1649ce9fb420b1901f90da7960f6299372bfd2c1c46d7ba59e080543cb7b5551')
  assert.equal(digest(after), '27f4479e68daa38663229ed6d86baba34154859721ca81a79687df888c3f8801')
  const original = fs.readFileSync(filename, 'utf8')
  assert.equal(original.split(before).length, 2, 'UI patch must match exactly once')
  const revised = original.replace(before, after)
  assert.equal(revised.replace(after, before), original, 'Unrelated UI tests changed')
  assert.equal((revised.match(/\bit\(/g) || []).length, (original.match(/\bit\(/g) || []).length)
  fs.writeFileSync(filename, revised)
  const originalLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
  run('npm', ['run', 'version:minor'])
  const lockBytes = fs.readFileSync('package-lock.json')
  assert.equal(blob(lockBytes), 'df80502240ff73700df26976b053c25d2839bd44')
  assert.equal(blob(fs.readFileSync('package.json')), '0d467513a70bba89e4703001b55b68ff754e8f9e')
  const updatedLock = JSON.parse(lockBytes)
  assert.equal(updatedLock.version, '4.219.0')
  assert.equal(updatedLock.packages[''].version, '4.219.0')
  assert.equal(Object.keys(updatedLock.packages).length - 1, 679)
  originalLock.version = '4.219.0'; originalLock.packages[''].version = '4.219.0'
  assert.deepEqual(updatedLock, originalLock, 'Dependency graph changed')
  run(process.execPath, ['scripts/check-app-version.mjs', '--previous-version=4.218.0'])
  run(process.execPath, ['scripts/verify-dependency-lock.mjs'])
  assert.deepEqual(run('git', ['diff', '--name-only']).split('\n').sort(),
    ['package-lock.json', 'package.json', filename].sort())
  assert.ok(process.env.SOURCE_OBJECT_TOKEN, 'Missing scoped job token')
  for (const file of ['package-lock.json', filename]) {
    const bytes = fs.readFileSync(file), expected = blob(bytes)
    assert.ok(bytes.length > 0 && bytes.length < 512 * 1024)
    const response = await fetch(`https://api.github.com/repos/${repository}/git/blobs`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: 'Bearer ' + process.env.SOURCE_OBJECT_TOKEN,
        Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ encoding: 'base64', content: bytes.toString('base64') }),
    })
    assert.equal(response.status, 201, 'Git blob upload did not succeed')
    const result = await response.json()
    assert.equal(result.sha, expected, 'Uploaded Git blob differs from validated bytes')
    const artifact = file === filename ? 'UIRedesign.test.jsx' : file
    fs.writeFileSync(path.join(out, artifact), bytes)
    report.files.push({ path: file, artifact, bytes: bytes.length, sha: expected, sha256: digest(bytes) })
    save()
  }
  report.complete = true
  console.log('Validated two complete source blobs; no branch update, build, release or deployment was performed.')
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Source authoring failed'
  process.exitCode = 1
} finally { save() }
