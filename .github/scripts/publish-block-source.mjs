import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { brotliDecompressSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const repo = 'GuDuYunChen/Local-Notepad'
const base = 'ac7914962242fcab16a14125ce3ea353e331b6ef'
const baseTree = '2caa3ab98c8118f68d0ebb4d0f2e51b4e6abfb4e'
const targetTree = '0540ef32ea0ebedfa0460cf0da44effcb8ea7df2'
const dry = process.argv.length === 3 && process.argv[2] === '--dry-run'
assert.ok(process.argv.length === 2 || dry, 'Unsupported publisher arguments')
if (!dry) {
  assert.equal(process.env.GITHUB_REPOSITORY, repo)
  assert.equal(process.env.GITHUB_REF, 'refs/heads/ci/local-dev-kit-ac791496')
  assert.ok(process.env.GITHUB_TOKEN)
}
const candidate = path.resolve('candidate'), helper = path.resolve('publisher')
const git = (...args) => execFileSync('git', ['-C', candidate, ...args], { maxBuffer: 8 * 1024 * 1024 })
assert.equal(git('rev-parse', 'HEAD').toString().trim(), base)
assert.equal(git('rev-parse', 'HEAD^{tree}').toString().trim(), baseTree)
assert.equal(git('status', '--porcelain').toString(), '')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const parts = Array.from({ length: 5 }, (_, n) => readFileSync(path.join(helper, '.github/fixtures/blocks103-patch', 'part-' + n + '.br')))
const compressed = Buffer.concat(parts)
assert.equal(compressed.length, 46419)
assert.equal(sha(compressed), '31180fe15eb8621dac6803eabadba92d8982ceff177285c7d54665123741d434')
const patch = brotliDecompressSync(compressed, { maxOutputLength: 200000 })
assert.equal(patch.length, 194161)
assert.equal(sha(patch), '5fab7d4f8249ddcf877c15382af4fc1d11d18c1ed6ad3a593fb10bb1b9f8b595')
execFileSync('git', ['-C', candidate, 'apply', '--index', '--whitespace=error', '-'], { input: patch })
assert.equal(git('write-tree').toString().trim(), targetTree, 'Applied patch differs from the locally tested tree')
git('diff', '--cached', '--check')
const names = git('diff', '--cached', '--name-only', '-z').toString().split('\0').filter(Boolean)
assert.equal(names.length, 51)
const before = JSON.parse(git('show', base + ':package-lock.json'))
const after = JSON.parse(readFileSync(path.join(candidate, 'package-lock.json'), 'utf8'))
assert.equal(after.version, '4.236.0'); assert.equal(after.packages[''].version, '4.236.0')
after.version = before.version; after.packages[''].version = before.packages[''].version
assert.deepEqual(after, before, 'Dependency graph changed')
const entries = names.map(name => {
  assert.ok(/^(?:src|scripts|server|docs|electron|\.github)\//.test(name) || ['AGENTS.md', 'package.json', 'package-lock.json'].includes(name))
  assert.ok(!name.split('/').some(x => x === '..' || !x))
  const entry = git('ls-files', '--stage', '-z', '--', name).toString()
  const match = entry.match(/^(100644|100755) ([a-f0-9]{40}) 0\t([^\0]+)\0$/)
  assert.ok(match, 'Only tracked regular text files can be published: ' + name)
  assert.equal(match[3], name)
  const bytes = readFileSync(path.join(candidate, name))
  assert.equal(bytes.toString('utf8').includes('\uFFFD'), false)
  assert.equal(bytes.includes(0), false)
  const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex')
  assert.equal(blob, match[2])
  return { path: name, mode: match[1], type: 'blob', sha: blob, bytes }
})
async function post(kind, payload) {
  assert.ok(['blobs', 'trees'].includes(kind), 'Publisher cannot update a ref or create a commit')
  const response = await fetch('https://api.github.com/repos/' + repo + '/git/' + kind, {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000), redirect: 'error',
  })
  assert.equal(response.status, 201, 'Immutable object creation refused: ' + kind + ' HTTP ' + response.status)
  return response.json()
}
if (!dry) {
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < entries.length) {
      const entry = entries[next++]
      const result = await post('blobs', { content: entry.bytes.toString('base64'), encoding: 'base64' })
      assert.equal(result.sha, entry.sha, 'Remote blob differs: ' + entry.path)
    }
  }))
  const result = await post('trees', { base_tree: baseTree, tree: entries.map(({ bytes, ...item }) => item) })
  assert.equal(result.sha, targetTree, 'Remote tree differs from the locally tested tree')
}
const receipt = { schemaVersion: 1, sourceBase: base, sourceBaseTree: baseTree, testedTree: targetTree,
  patchSha256: sha(patch), files: entries.map(({ bytes, ...entry }) => ({ ...entry, size: bytes.length })),
  immutableObjectsPublished: !dry, productRefsUpdated: false, testsExecutedHere: false,
  workflowCommit: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null }
mkdirSync('source-object-receipt', { recursive: true })
writeFileSync('source-object-receipt/immutable-source-objects.json', JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ testedTree: targetTree, files: entries.length, immutableObjectsPublished: !dry, productRefsUpdated: false }))
