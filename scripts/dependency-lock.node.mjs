import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyDependencyLock, inspectDependencyLock } from './verify-dependency-lock.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const locked = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const fixture = () => ({ manifest: structuredClone(manifest), lock: structuredClone(locked) })

test('current committed manifest and full platform lock agree without changing inputs', () => {
  const { manifest: p, lock: l } = fixture()
  const before = JSON.stringify([p, l]), result = verifyDependencyLock(p, l)
  assert.ok(result.packages > 0)
  assert.ok(Object.isFrozen(result))
  assert.equal(JSON.stringify([p, l]), before)
})
for (const [name, change] of [
  ['missing lock', f => f.lock = null],
  ['wrong lock schema', f => f.lock.lockfileVersion = 1],
  ['wrong package name', f => f.lock.name = 'another-app'],
  ['wrong package version', f => f.lock.version = '0.0.0'],
  ['wrong root version', f => f.lock.packages[''].version = '0.0.0'],
  ['missing root', f => delete f.lock.packages['']],
  ['changed direct requirement', f => f.manifest.dependencies.react = '0.0.0'],
  ['missing direct package', f => delete f.lock.packages['node_modules/react']],
  ['missing integrity', f => delete f.lock.packages['node_modules/react'].integrity],
  ['truncated integrity', f => f.lock.packages['node_modules/react'].integrity = 'sha512-YQ=='],
  ['nonfixed version', f => f.lock.packages['node_modules/react'].version = '^18.3.1'],
  ['foreign registry', f => f.lock.packages['node_modules/react'].resolved = 'https://example.invalid/react.tgz'],
  ['plaintext HTTP', f => f.lock.packages['node_modules/react'].resolved = 'http://registry.npmjs.org/react.tgz'],
  ['URL credentials', f => f.lock.packages['node_modules/react'].resolved = 'https://user:pass@registry.npmjs.org/react.tgz'],
  ['local tarball', f => f.lock.packages['node_modules/react'].resolved = 'file:react.tgz'],
  ['linked package', f => f.lock.packages['node_modules/react'].link = true],
  ['missing Windows esbuild', f => delete f.lock.packages['node_modules/@esbuild/win32-x64']],
  ['missing Linux rollup', f => delete f.lock.packages['node_modules/@rollup/rollup-linux-x64-gnu']],
  ['mismatched native version', f => f.lock.packages['node_modules/@esbuild/win32-x64'].version = '0.0.1'],
]) test('refuses ' + name + ' instead of silently resolving replacements', () => {
  const f = fixture(); change(f)
  assert.throws(() => verifyDependencyLock(f.manifest, f.lock))
})
test('CLI failure is nonzero, bounded, and does not create a replacement lock', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-lock-refusal-'))
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify(manifest))
    const script = fileURLToPath(new URL('./verify-dependency-lock.mjs', import.meta.url))
    const run = spawnSync(process.execPath, [script], { cwd: tmp, encoding: 'utf8', timeout: 10000 })
    assert.equal(run.status, 1)
    assert.match(run.stderr, /Dependency lock verification failed/)
    assert.ok(run.stderr.length < 512)
    assert.equal(fs.existsSync(path.join(tmp, 'package-lock.json')), false)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})
test('receipt includes the exact bytes fingerprint without claiming package installation', () => {
  const receipt = inspectDependencyLock(root)
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/)
  assert.equal(receipt.validation, 'manifest-and-lock-structure-only')
})
test('every existing CI root install uses npm ci with a lock preflight and no fallback', () => {
  const dir = path.join(root, '.github/workflows')
  let checked = 0
  for (const file of fs.readdirSync(dir).filter(n => /\.ya?ml$/.test(n))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.doesNotMatch(source, /\bnpm\s+(?:install|i)\b/, file)
    const installs = [...source.matchAll(/\bnpm ci --no-audit --no-fund/g)].length
    if (!installs) continue
    assert.equal([...source.matchAll(/node scripts\/verify-dependency-lock\.mjs/g)].length >= installs, true, file)
    assert.doesNotMatch(source, /npm ci[^\n]*(?:\|\||continue-on-error)/, file)
    checked += installs
  }
  assert.ok(checked >= 10, 'The existing Linux/Windows install steps must all be covered')
})
test('normal development launches the locked local Electron, not an npx version lookup', () => {
  for (const name of ['dev', 'dev:all']) {
    assert.doesNotMatch(manifest.scripts[name], /npx.*electron@/)
    assert.match(manifest.scripts[name], /electron out\/electron\/main\.cjs/)
  }
})
