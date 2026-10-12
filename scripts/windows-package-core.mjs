import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import path from 'node:path'

export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }
const entry = file => lstatSync(file, { throwIfNoEntry: false })
const regular = file => {
  const info = lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink()) fail(`Not a regular file: ${file}`)
  return info
}
export function versionAtLeast(actual, required) {
  const parse = value => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) fail('Invalid runtime version')
    return value.split('.').map(Number)
  }
  const a = parse(actual), b = parse(required)
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i] }
  return true
}

// Follow the PE resource directory; do not accept an arbitrary version string
// or a VS_FIXEDFILEINFO signature copied elsewhere in a file.
export function installerVersion(bytes) {
  const bound = (offset, length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > bytes.length) fail('Truncated PE resource')
    return offset
  }
  const u16 = offset => bytes.readUInt16LE(bound(offset, 2))
  const u32 = offset => bytes.readUInt32LE(bound(offset, 4))
  if (!Buffer.isBuffer(bytes) || bytes.length < 256 || u16(0) !== 0x5a4d) fail('Installer is not a PE executable')
  const pe = u32(0x3c)
  if (u32(pe) !== 0x4550) fail('Invalid PE signature')
  const count = u16(pe + 6), opt = pe + 24, optionalSize = u16(pe + 20), magic = u16(opt)
  if (![0x10b, 0x20b].includes(magic) || count < 1 || count > 96) fail('Invalid PE header')
  const directories = opt + (magic === 0x10b ? 96 : 112)
  if (directories + 24 > opt + optionalSize) fail('Missing PE resources')
  const sections = opt + optionalSize
  bound(sections, count * 40)
  const fileOffset = (rva, size) => {
    for (let i = 0; i < count; i++) {
      const entry = sections + i * 40, start = u32(entry + 12), rawSize = u32(entry + 16), raw = u32(entry + 20)
      if (rva >= start && rva - start + size <= rawSize) return bound(raw + rva - start, size)
    }
    fail('PE resource outside a file-backed section')
  }
  const resourceSize = u32(directories + 20), base = fileOffset(u32(directories + 16), resourceSize)
  const rb = (offset, size) => {
    if (offset < 0 || offset + size > resourceSize) fail('Invalid resource offset')
    return bound(base + offset, size)
  }
  const entries = offset => {
    const at = rb(offset, 16), n = u16(at + 12) + u16(at + 14)
    if (n < 1 || n > 1024) fail('Invalid resource count')
    rb(offset + 16, n * 8)
    return Array.from({ length: n }, (_, i) => ({ id: u32(at + 16 + i * 8), next: u32(at + 20 + i * 8) }))
  }
  const version = entries(0).find(item => item.id === 16)
  if (!version || !(version.next & 0x80000000)) fail('Missing RT_VERSION')
  const names = entries(version.next & 0x7fffffff)
  const versions = []
  for (const name of names) {
    if (!(name.next & 0x80000000)) fail('Invalid version name resource')
    for (const lang of entries(name.next & 0x7fffffff)) {
      if (lang.next & 0x80000000) fail('Invalid language resource')
      const data = rb(lang.next, 16), size = u32(data + 4), at = fileOffset(u32(data), size)
      if (size < 92 || u16(at) > size || u16(at + 2) !== 52 || u16(at + 4) !== 0) fail('Invalid version value')
      const key = Buffer.from('VS_VERSION_INFO\0', 'utf16le')
      if (!bytes.subarray(at + 6, at + 6 + key.length).equals(key)) fail('Invalid version key')
      const fixed = at + ((6 + key.length + 3) & ~3)
      if (fixed + 52 > at + u16(at) || u32(fixed) !== 0xfeef04bd) fail('Invalid fixed version')
      const decode = offset => [u32(offset) >>> 16, u32(offset) & 65535, u32(offset + 4) >>> 16, u32(offset + 4) & 65535].join('.')
      versions.push({ fileVersion: decode(fixed + 8), productVersion: decode(fixed + 16) })
    }
  }
  if (!versions.length || versions.some(item => JSON.stringify(item) !== JSON.stringify(versions[0]))) fail('Ambiguous PE versions')
  return versions[0]
}

export function packageIdentity(root) {
  const manifestPath = path.join(root, 'package.json'), lockPath = path.join(root, 'package-lock.json')
  regular(manifestPath); regular(lockPath)
  const manifestBytes = readFileSync(manifestPath), lockBytes = readFileSync(lockPath)
  const manifest = JSON.parse(manifestBytes), lock = JSON.parse(lockBytes), version = manifest.version
  if (!/^\d+\.\d+\.\d+$/.test(version) || version.split('.').some(n => Number(n) > 65535)) fail('Invalid application version')
  if (manifest.name !== 'notepad-desktop' || lock.name !== manifest.name || lock.version !== version ||
      lock.packages?.['']?.version !== version || lock.packages?.['']?.name !== manifest.name || lock.lockfileVersion !== 3) fail('Manifest and lock versions do not match')
  if (manifest.build?.directories?.output !== 'release' || manifest.build?.nsis?.artifactName !== 'Notepad-${version}-Setup.exe') fail('Unexpected installer output configuration')
  return { version, manifestSHA256: digest(manifestBytes), lockSHA256: digest(lockBytes) }
}

// Dependencies are injected only by isolated tests. The CLI supplies real
// subprocesses, real files and the real PE verifier, without a skip-install flag.
export async function packageWindows({ root, run, log = () => {}, signal, platform = process.platform, nodeVersion = process.versions.node }) {
  if (platform !== 'win32') fail('Windows packaging requires Windows')
  if (!versionAtLeast(nodeVersion, '22.12.0')) fail('Node.js 22.12.0 or newer is required; CI uses Node.js 24')
  const identity = packageIdentity(root)
  const results = path.join(root, 'test-results', 'local-package')
  mkdirSync(results, { recursive: true })
  const lockPath = path.join(results, 'running.lock')
  let lock
  try { lock = openSync(lockPath, 'wx') } catch (error) {
    if (error.code === 'EEXIST') fail(`Another packaging run or interrupted run owns ${lockPath}. Check its PID before removing this lock.`)
    throw error
  }
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID()
  const directory = path.join(results, id)
  let stage = 'prepare', complete = false, quarantine = null, retainLock = false
  const receipt = { format: 'local-notepad-local-package', schemaVersion: 1, complete: false, ...identity,
    commit: process.env.GITHUB_SHA || null, startedAt: new Date().toISOString(), stages: [] }
  try {
    mkdirSync(directory)
    writeFileSync(lock, JSON.stringify({ pid: process.pid, directory, startedAt: receipt.startedAt }))
    log(`[package] Log directory: ${directory}\n`)
    const unchanged = () => {
      if (JSON.stringify(packageIdentity(root)) !== JSON.stringify(identity)) fail('Build changed package.json or package-lock.json; refusing delivery')
    }
    const step = async (name, command, args, timeout = 900000) => {
      signal?.throwIfAborted(); stage = name; log(`[package] ${name}\n`)
      const result = await run(command, args, { cwd: root, timeout, signal, logFile: path.join(directory, 'commands.log') })
      if (result.code !== 0 || result.signal || result.error) fail(`${name} failed (${result.code ?? result.signal ?? 'spawn error'}); see commands.log`)
      signal?.throwIfAborted(); receipt.stages.push({ name, exitCode: 0 })
      return result.stdout || ''
    }
    await step('version-check', process.execPath, ['scripts/check-app-version.mjs'], 30000)
    await step('npm-check', 'npm', ['--version'], 30000)
    const go = await step('go-check', 'go', ['-C', 'server', 'env', 'GOVERSION'], 180000)
    const required = readFileSync(path.join(root, 'server', 'go.mod'), 'utf8').match(/^toolchain go(\d+\.\d+\.\d+)$/m)?.[1]
    const actual = go.trim().match(/^go(\d+\.\d+\.\d+)$/)?.[1]
    if (!required || !actual || !versionAtLeast(actual, required)) fail(`Go ${required || 'toolchain from server/go.mod'} or newer is required`)
    await step('install-locked-dependencies', 'npm', ['ci', '--no-audit', '--no-fund'])
    unchanged()
    stage = 'isolate-previous-installer'
    const release = path.join(root, 'release'), filename = `Notepad-${identity.version}-Setup.exe`, target = path.join(release, filename)
    if (entry(release) && (!entry(release).isDirectory() || entry(release).isSymbolicLink())) fail('release must be a real directory')
    if (entry(target)) { regular(target); quarantine = path.join(directory, 'previous-' + filename); renameSync(target, quarantine) }
    if (entry(target + '.sha256')) { regular(target + '.sha256'); renameSync(target + '.sha256', path.join(directory, 'previous-' + filename + '.sha256')) }
    // A previous package is preserved, never substituted after a build failure.
    await step('build', 'npm', ['run', 'build'])
    unchanged(); signal?.throwIfAborted(); stage = 'verify-new-installer'
    const info = regular(target)
    if (info.size < 256 || info.size > 512 * 1024 * 1024) fail('Installer size is invalid')
    const bytes = readFileSync(target), versions = installerVersion(bytes), expected = identity.version + '.0'
    if (versions.fileVersion !== expected || versions.productVersion !== expected) fail(`Installer internal version does not match ${expected}`)
    receipt.installer = { filename, bytes: bytes.length, sha256: digest(bytes), ...versions }
    receipt.installationTested = false
    receipt.previousInstaller = quarantine ? path.relative(root, quarantine) : null
    // Never follow a checksum link created while the build was in progress.
    writeFileSync(target + '.sha256', `${receipt.installer.sha256}  ${filename}\n`, { flag: 'wx' })
    receipt.complete = complete = true; stage = 'complete'
    return { ...receipt, directory, target }
  } catch (error) {
    receipt.error = { stage, message: String(error.message || error) }
    if (error.cleanupUnconfirmed === true) {
      retainLock = true
      receipt.recoveryRequired = true
      receipt.error.cleanupUnconfirmed = true
      receipt.error.reason = error.reason || 'cleanup-unconfirmed'
      receipt.error.childPid = error.childPid ?? null
      const recovery = { pid: process.pid, childPid: error.childPid ?? null, directory,
        startedAt: receipt.startedAt, state: 'cleanup-unconfirmed', reason: receipt.error.reason }
      ftruncateSync(lock, 0)
      writeSync(lock, JSON.stringify(recovery), 0, 'utf8')
      error.message += `; packaging lock retained at ${lockPath}. Confirm no build processes remain before removing it.`
    }
    throw error
  } finally {
    receipt.complete = complete; receipt.finishedAt = new Date().toISOString()
    try { if (existsSync(directory)) writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n') }
    finally { closeSync(lock); if (!retainLock) rmSync(lockPath) }
  }
}
