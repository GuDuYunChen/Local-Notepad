import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

/** Validate the committed lock without installing, fetching, or executing packages.
 * npm ci remains responsible for dependency-graph and downloaded-byte validation.
 */
export function verifyDependencyLock(manifest, lock) {
  assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Missing package manifest')
  assert.ok(lock && typeof lock === 'object' && !Array.isArray(lock), 'Missing dependency lock')
  assert.equal(lock.lockfileVersion, 3, 'Expected package-lock v3')
  assert.equal(lock.name, manifest.name, 'Lock package name differs from manifest')
  assert.equal(lock.version, manifest.version, 'Lock package version differs from manifest')
  const packages = lock.packages
  assert.ok(packages && typeof packages === 'object' && !Array.isArray(packages), 'Missing locked packages')
  const root = packages['']
  assert.ok(root && typeof root === 'object', 'Missing lock root')
  assert.equal(root.name, manifest.name, 'Lock root name differs')
  assert.equal(root.version, manifest.version, 'Lock root version differs')
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.deepEqual(root[field] || {}, manifest[field] || {}, `Lock ${field} differs from manifest`)
    for (const name of Object.keys(manifest[field] || {})) {
      assert.ok(Object.hasOwn(packages, 'node_modules/' + name), 'Missing locked direct dependency')
    }
  }
  let count = 0
  for (const [location, entry] of Object.entries(packages)) {
    if (location === '') continue
    assert.ok(location.startsWith('node_modules/') && !location.includes('\\') &&
      !location.split('/').includes('..'), 'Invalid package location')
    assert.ok(entry && typeof entry === 'object' && !entry.link, 'Linked packages are not supported in this lock')
    assert.match(entry.version || '', /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/, 'Package version is not fixed')
    const url = new URL(entry.resolved)
    assert.ok(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' &&
      !url.username && !url.password && !url.search && !url.hash &&
      (!url.port || url.port === '443') && url.pathname.endsWith('.tgz'), 'Unapproved package tarball source')
    const integrity = /^(sha512|sha1)-([A-Za-z0-9+/]+={0,2})$/.exec(entry.integrity || '')
    assert.ok(integrity, 'Missing or invalid package integrity')
    const digest = Buffer.from(integrity[2], 'base64')
    assert.equal(digest.length, integrity[1] === 'sha512' ? 64 : 20, 'Invalid package integrity length')
    assert.equal(digest.toString('base64'), integrity[2], 'Noncanonical package integrity')
    count++
  }
  assert.ok(count > 0, 'Dependency lock is empty')
  // Do not derive a Windows lock from Linux's hidden node_modules lock.
  for (const [parent, binaries] of [
    ['esbuild', ['@esbuild/linux-x64', '@esbuild/win32-x64']],
    ['rollup', ['@rollup/rollup-linux-x64-gnu', '@rollup/rollup-win32-x64-msvc']],
  ]) {
    const version = packages['node_modules/' + parent]?.version
    assert.ok(version, 'Missing native build-tool version')
    for (const name of binaries) {
      const binary = packages['node_modules/' + name]
      assert.ok(binary?.optional === true, 'Missing cross-platform optional build binary')
      assert.equal(binary.version, version, 'Native build binary version differs')
    }
  }
  return Object.freeze({ name: manifest.name, version: manifest.version, lockfileVersion: 3,
    packages: count, electronToChromium: packages['node_modules/electron-to-chromium']?.version || null })
}

export function inspectDependencyLock(directory = process.cwd()) {
  const raw = fs.readFileSync(path.join(directory, 'package-lock.json'))
  assert.ok(raw.length > 0 && raw.length <= 4 * 1024 * 1024, 'Invalid lock file size')
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const summary = verifyDependencyLock(manifest, JSON.parse(raw.toString('utf8')))
  return Object.freeze({ ...summary, sha256: createHash('sha256').update(raw).digest('hex'),
    node: process.version, platform: process.platform, validation: 'manifest-and-lock-structure-only' })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(inspectDependencyLock())) }
  catch {
    // Keep logs bounded; do not dump the entire manifest or lock in an assertion diff.
    console.error('Dependency lock verification failed. Review package.json and package-lock.json together; do not delete the lock or bypass npm ci.')
    process.exitCode = 1
  }
}
