import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGACY_DEFECT } from './installer-lifecycle-core.mjs'
import { assembleLegacyInstaller, readLegacyFixture, validateLegacyManifest, writeLegacyInstaller } from './prepare-legacy-installer.mjs'

const fixture = fileURLToPath(new URL('../.github/fixtures/legacy-installer-4.219.0/', import.meta.url))
const { manifest, parts } = readLegacyFixture(fixture)
const scratch = mkdtempSync(path.join(os.tmpdir(), 'notepad-legacy-parts-'))
const cliRoot = path.join(scratch, 'repository')
const cli = path.join(cliRoot, 'scripts', 'prepare-legacy-installer.mjs')
const destination = path.join(cliRoot, '.installer-input', 'legacy', `Notepad-${LEGACY_DEFECT.version}-Setup.exe`)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const alteredManifest = () => structuredClone(manifest)
let verifiedBytes
after(() => rmSync(scratch, { recursive: true, force: true }))

test('legacy fixture CLI restores the exact original real installer without executing it', () => {
  mkdirSync(path.dirname(cli), { recursive: true })
  for (const name of ['prepare-legacy-installer.mjs', 'installer-lifecycle-core.mjs']) {
    copyFileSync(fileURLToPath(new URL(name, import.meta.url)), path.join(cliRoot, 'scripts', name))
  }
  cpSync(fixture, path.join(cliRoot, '.github', 'fixtures', 'legacy-installer-4.219.0'), { recursive: true, errorOnExist: true, force: false })
  const result = spawnSync(process.execPath, [cli], { cwd: cliRoot, encoding: 'utf8', timeout: 30000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.signal, null)
  assert.equal(result.stderr, '')
  const receipt = JSON.parse(result.stdout)
  assert.equal(receipt.complete, true)
  assert.equal(receipt.phase, 'original-installer-restored')
  assert.deepEqual(receipt.parts, manifest.parts)
  assert.deepEqual(receipt.installer, LEGACY_DEFECT)
  const actual = readFileSync(destination)
  verifiedBytes = actual
  assert.equal(actual.length, 104197801)
  assert.equal(hash(actual), 'b3fab086b8f34f2dd7025223e8322a80b2e0634bfbc88631b25ad2d0d727b43a')
  assert.equal(createHash('sha1').update(Buffer.from(`blob ${actual.length}\0`)).update(actual).digest('hex'), '5f77866ad72ba3698a5b8ffa3c2a53307739b86f')
  assert.equal(actual.subarray(0, 2).toString(), 'MZ')
})

test('legacy fixture CLI refuses user path arguments before accessing an output', () => {
  const result = spawnSync(process.execPath, [cli, '--destination=elsewhere.exe'], { cwd: cliRoot, encoding: 'utf8', timeout: 30000 })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.equal(result.signal, null)
  assert.equal(result.stdout, '')
  const receipt = JSON.parse(result.stderr)
  assert.equal(receipt.complete, false)
  assert.equal(receipt.phase, 'fixed-inputs')
  assert.match(receipt.error, /accepts no arguments/)
  assert.equal(existsSync(path.join(cliRoot, 'elsewhere.exe')), false)
})

test('legacy fixture CLI refuses a working directory outside its own repository', () => {
  const result = spawnSync(process.execPath, [cli], { cwd: scratch, encoding: 'utf8', timeout: 30000 })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.equal(result.signal, null)
  assert.equal(result.stdout, '')
  const receipt = JSON.parse(result.stderr)
  assert.equal(receipt.complete, false)
  assert.equal(receipt.phase, 'fixed-inputs')
  assert.match(receipt.error, /own repository root/)
  assert.equal(existsSync(path.join(scratch, '.installer-input')), false)
})

function refusesBeforeOutput(label, changedManifest, changedParts, expectedError) {
  const refusedDestination = path.join(scratch, `${label}.exe`)
  assert.throws(() => {
    const bytes = assembleLegacyInstaller(changedManifest, changedParts)
    writeLegacyInstaller(bytes, refusedDestination)
  }, expectedError)
  assert.equal(existsSync(refusedDestination), false, 'Refused input must not create an installer')
}

test('legacy fixture refuses a missing part before creating any output', () => {
  refusesBeforeOutput('missing', manifest, parts.slice(0, -1), /exact names and order/)
})

test('legacy fixture refuses an extra part before creating any output', () => {
  refusesBeforeOutput('extra', manifest, [...parts, { name: 'part-17.bin', data: parts[0].data }], /exact names and order/)
})

test('legacy fixture refuses a changed manifest order', () => {
  const changed = alteredManifest()
  ;[changed.parts[1], changed.parts[2]] = [changed.parts[2], changed.parts[1]]
  refusesBeforeOutput('manifest-order', changed, parts, /names and order must be exact/)
})

test('legacy fixture refuses swapped equal-sized parts even with matching per-part digests', () => {
  const changed = alteredManifest()
  const swapped = parts.map(part => ({ ...part }))
  assert.notEqual(hash(parts[1].data), hash(parts[2].data))
  ;[swapped[1].data, swapped[2].data] = [swapped[2].data, swapped[1].data]
  changed.parts[1].sha256 = hash(swapped[1].data)
  changed.parts[2].sha256 = hash(swapped[2].data)
  refusesBeforeOutput('swapped', changed, swapped, /Installer SHA-256 mismatch/)
})

test('legacy fixture refuses truncated actual part bytes', () => {
  const truncated = parts.map(part => ({ ...part }))
  truncated[16].data = truncated[16].data.subarray(0, -1)
  refusesBeforeOutput('truncated', manifest, truncated, /part byte length mismatch/)
})

test('legacy fixture refuses corrupted actual part bytes', () => {
  const corrupted = parts.map(part => ({ ...part }))
  corrupted[8].data = Buffer.from(corrupted[8].data)
  corrupted[8].data[100] ^= 1
  refusesBeforeOutput('corrupted', manifest, corrupted, /part SHA-256 mismatch/)
})

test('legacy fixture cannot authorize corruption by changing a part digest', () => {
  const changed = alteredManifest()
  const corrupted = parts.map(part => ({ ...part }))
  corrupted[8].data = Buffer.from(corrupted[8].data)
  corrupted[8].data[100] ^= 1
  changed.parts[8].sha256 = hash(corrupted[8].data)
  refusesBeforeOutput('rehashed-corruption', changed, corrupted, /Installer SHA-256 mismatch/)
})

test('legacy fixture refuses manifest path traversal and noncanonical names', () => {
  for (const name of ['../part-00.bin', '/part-00.bin', 'C:\\part-00.bin', 'part-00.bin/child']) {
    const changed = alteredManifest()
    changed.parts[0].name = name
    assert.throws(() => validateLegacyManifest(changed), /names and order must be exact/)
  }
})

test('legacy fixture cannot replace the original whole-file identity in its manifest', () => {
  const changed = alteredManifest()
  changed.installer.sha256 = '0'.repeat(64)
  refusesBeforeOutput('changed-pin', changed, parts, /cannot replace the original installer pin/)
})

test('legacy fixture refuses an existing output without replacing its bytes', () => {
  const existing = path.join(scratch, 'existing.exe')
  const sentinel = Buffer.from('pre-existing output stays untouched')
  writeFileSync(existing, sentinel, { flag: 'wx' })
  assert.throws(() => writeLegacyInstaller(verifiedBytes, existing), { code: 'EEXIST' })
  assert.deepEqual(readFileSync(existing), sentinel)
})

test('legacy fixture validates the whole installer before opening an output', () => {
  const existing = path.join(scratch, 'existing-invalid.exe')
  const sentinel = Buffer.from('invalid input also leaves pre-existing output untouched')
  writeFileSync(existing, sentinel, { flag: 'wx' })
  assert.throws(() => writeLegacyInstaller(parts[0].data, existing), /Installer byte length mismatch/)
  assert.deepEqual(readFileSync(existing), sentinel)
})
