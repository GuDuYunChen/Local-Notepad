import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGACY_DEFECT, verifyInstaller } from './installer-lifecycle-core.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const FIXTURE = '.github/fixtures/legacy-installer-4.219.0'
const PART_BYTES = 6 * 1024 * 1024
const PART_NAMES = Array.from({ length: Math.ceil(LEGACY_DEFECT.bytes / PART_BYTES) }, (_, i) => `part-${String(i).padStart(2, '0')}.bin`)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function validateLegacyManifest(manifest) {
  assert.deepEqual(Object.keys(manifest).sort(), ['format', 'installer', 'partBytes', 'parts'], 'Unexpected legacy manifest fields')
  assert.equal(manifest.format, 'local-notepad-legacy-installer-parts-v1')
  assert.deepEqual(manifest.installer, LEGACY_DEFECT, 'Legacy manifest cannot replace the original installer pin')
  assert.equal(manifest.partBytes, PART_BYTES)
  assert.ok(Array.isArray(manifest.parts), 'Legacy parts must be an array')
  assert.deepEqual(manifest.parts.map(part => part.name), PART_NAMES, 'Legacy part names and order must be exact')
  for (const [i, part] of manifest.parts.entries()) {
    assert.deepEqual(Object.keys(part).sort(), ['bytes', 'name', 'sha256'], 'Unexpected legacy part fields')
    assert.equal(part.bytes, Math.min(PART_BYTES, LEGACY_DEFECT.bytes - i * PART_BYTES), `Legacy part length declaration mismatch: ${PART_NAMES[i]}`)
    assert.match(part.sha256, /^[a-f0-9]{64}$/, 'Legacy part SHA-256 is required')
  }
  return manifest
}

export function readLegacyFixture(directory) {
  assert.ok(lstatSync(directory).isDirectory(), 'Legacy fixture must be a real directory')
  const names = readdirSync(directory)
  assert.deepEqual(names.sort(), [...PART_NAMES, 'manifest.json', 'README.md', '.gitattributes'].sort(), 'Legacy fixture has missing or unexpected entries')
  for (const name of names) assert.ok(lstatSync(path.join(directory, name)).isFile(), `Legacy fixture entry must be a regular file: ${name}`)
  const manifest = validateLegacyManifest(JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')))
  const parts = manifest.parts.map(part => {
    const filename = path.join(directory, part.name)
    assert.equal(lstatSync(filename).size, part.bytes, `Legacy part byte length mismatch: ${part.name}`)
    return { name: part.name, data: readFileSync(filename) }
  })
  return { manifest, parts }
}

export function assembleLegacyInstaller(manifest, parts, receipt = {}) {
  validateLegacyManifest(manifest)
  assert.deepEqual(parts.map(part => part.name), PART_NAMES, 'Legacy input parts must have exact names and order')
  receipt.parts = []
  for (const [i, part] of parts.entries()) {
    assert.ok(Buffer.isBuffer(part.data), `Legacy part must contain actual bytes: ${part.name}`)
    const observed = { name: part.name, bytes: part.data.length, sha256: sha256(part.data) }
    receipt.parts.push(observed)
    assert.equal(observed.bytes, manifest.parts[i].bytes, `Legacy part byte length mismatch: ${part.name}`)
    assert.equal(observed.sha256, manifest.parts[i].sha256, `Legacy part SHA-256 mismatch: ${part.name}`)
  }
  const bytes = Buffer.concat(parts.map(part => part.data))
  receipt.installer = { bytes: bytes.length, sha256: sha256(bytes) }
  receipt.installer = verifyInstaller(bytes, LEGACY_DEFECT)
  return bytes
}

export function writeLegacyInstaller(bytes, destination) {
  // Recheck the original whole-file identity even when called independently.
  const identity = verifyInstaller(bytes, LEGACY_DEFECT)
  mkdirSync(path.dirname(destination), { recursive: true })
  let fd
  let created = false
  try {
    fd = openSync(destination, 'wx')
    created = true
    writeFileSync(fd, bytes)
    closeSync(fd)
    fd = undefined
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd) } catch { /* Preserve the original write failure. */ }
    }
    if (created) unlinkSync(destination)
    throw error
  }
  return identity
}

function main() {
  const receipt = { complete: false, fixture: FIXTURE, expectedInstaller: LEGACY_DEFECT, phase: 'fixed-inputs' }
  try {
    assert.equal(process.argv.length, 2, 'Legacy fixture preparation accepts no arguments')
    assert.equal(path.relative(ROOT, process.cwd()), '', 'Legacy fixture preparation must run from its own repository root')
    for (const directory of ['.github', '.github/fixtures', FIXTURE]) {
      assert.ok(lstatSync(path.join(ROOT, directory)).isDirectory(), 'Legacy fixture directories must not be links')
    }
    const { manifest, parts } = readLegacyFixture(path.join(ROOT, FIXTURE))
    receipt.phase = 'verify-parts-and-original-installer'
    const bytes = assembleLegacyInstaller(manifest, parts, receipt)
    receipt.phase = 'exclusive-output'
    for (const directory of ['.installer-input', '.installer-input/legacy']) {
      const target = path.join(ROOT, directory)
      try { mkdirSync(target) } catch (error) { if (error.code !== 'EEXIST') throw error }
      assert.ok(lstatSync(target).isDirectory(), 'Legacy output directories must not be links')
    }
    writeLegacyInstaller(bytes, path.join(ROOT, '.installer-input', 'legacy', `Notepad-${LEGACY_DEFECT.version}-Setup.exe`))
    receipt.phase = 'original-installer-restored'
    receipt.complete = true
    console.log(JSON.stringify(receipt))
  } catch (error) {
    console.error(JSON.stringify({ ...receipt, error: error.message, code: error.code ?? null }))
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
