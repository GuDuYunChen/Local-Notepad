import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAppVersion } from './check-app-version.mjs'
import { digest, installerVersion } from './windows-package-core.mjs'

const PREVIOUS_VERSION = '4.248.1'
const BUILD_STAGES = Object.freeze(['version-check', 'npm-check', 'go-check', 'install-locked-dependencies', 'build'])
const objectId = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const parse = (bytes, maximum, label) => {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum, label + ' size is invalid')
  return JSON.parse(bytes.toString('utf8'))
}

// Pure validation of real inputs. Synthetic callers exercise refusals only;
// this function never installs, starts an app, or claims lifecycle acceptance.
export function validateCurrentUpgradeInput({ manifestBytes, lockBytes, installerBytes, receipts, source }) {
  assert.ok(source && objectId(source.commit) && objectId(source.expectedCommit), 'Current source commit is missing')
  assert.equal(source.commit, source.expectedCommit, 'Checkout does not match the workflow commit')
  assert.ok(objectId(source.tree) && objectId(source.expectedTree), 'Current source tree is missing')
  assert.equal(source.tree, source.expectedTree, 'Checkout tree does not match the workflow commit tree')
  assert.equal(source.clean, true, 'Tracked source changed after checkout or packaging')
  const manifest = parse(manifestBytes, 1024 * 1024, 'Manifest')
  const lock = parse(lockBytes, 4 * 1024 * 1024, 'Lock')
  const { version, installer: filename } = checkAppVersion(manifest, lock, PREVIOUS_VERSION)
  assert.equal(manifest.name, 'notepad-desktop')
  assert.ok(Array.isArray(receipts) && receipts.length > 0 && receipts.length <= 64, 'Packaging receipts are missing or excessive')
  const parsed = receipts.map(entry => {
    assert.match(entry.file || '', /^test-results\/local-package\/[^/\\]+\/receipt\.json$/, 'Unexpected packaging receipt path')
    assert.equal(path.posix.normalize(entry.file), entry.file, 'Packaging receipt path is ambiguous')
    return { ...entry, receipt: parse(entry.bytes, 1024 * 1024, 'Packaging receipt') }
  })
  const matches = parsed.filter(({ receipt }) => receipt.complete === true && receipt.commit === source.commit && receipt.version === version)
  assert.equal(matches.length, 1, 'Exactly one successful current-commit/current-version packaging receipt is required')
  const { file, bytes: receiptBytes, receipt } = matches[0]
  assert.equal(receipt.format, 'local-notepad-local-package')
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.error, undefined, 'Successful packaging receipt contains an error')
  assert.notEqual(receipt.recoveryRequired, true, 'Packaging cleanup is unconfirmed')
  assert.equal(receipt.installationTested, false, 'A packaging receipt is not installation acceptance')
  assert.deepEqual(receipt.stages, BUILD_STAGES.map(name => ({ name, exitCode: 0 })), 'Original packaging stages are incomplete or changed')
  const startedAt = Date.parse(receipt.startedAt), finishedAt = Date.parse(receipt.finishedAt)
  assert.ok(Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt, 'Packaging completion timestamps are invalid')
  assert.equal(receipt.manifestSHA256, digest(manifestBytes), 'Packaging manifest bytes changed')
  assert.equal(receipt.lockSHA256, digest(lockBytes), 'Packaging lock bytes changed')
  assert.ok(Buffer.isBuffer(installerBytes) && installerBytes.length >= 256 && installerBytes.length <= 512 * 1024 * 1024, 'Candidate installer size is invalid')
  assert.equal(receipt.installer?.filename, filename, 'Packaging receipt points to another installer')
  assert.equal(receipt.installer.bytes, installerBytes.length, 'Candidate installer byte length differs from the packaging receipt')
  assert.equal(receipt.installer.sha256, digest(installerBytes), 'Candidate installer SHA-256 differs from the packaging receipt')
  const expectedVersions = { fileVersion: version + '.0', productVersion: version + '.0' }
  assert.deepEqual(installerVersion(installerBytes), expectedVersions, 'Actual candidate PE version differs from the manifest')
  for (const [key, expected] of Object.entries(expectedVersions)) assert.equal(receipt.installer[key], expected, 'Packaging receipt PE version differs from the manifest')
  return {
    schemaVersion: 1, inputVerified: true, scope: 'current-candidate-upgrade-input-only',
    installationTested: false, fullLifecycleTested: false, previousVersion: PREVIOUS_VERSION,
    current: { version, filename, bytes: installerBytes.length, sha256: digest(installerBytes), ...expectedVersions },
    source: { commit: source.commit, tree: source.tree, manifestSHA256: digest(manifestBytes), lockSHA256: digest(lockBytes), cleanTrackedCheckout: true },
    packagingReceipt: { file, bytes: receiptBytes.length, sha256: digest(receiptBytes), startedAt: receipt.startedAt, finishedAt: receipt.finishedAt },
  }
}

function regularWithin(root, relative, maximum) {
  const parts = relative.split('/')
  assert.ok(parts.every(part => part && part !== '.' && part !== '..'), 'Unexpected input path')
  let target = root
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part)
    const stat = lstatSync(target)
    assert.equal(stat.isSymbolicLink(), false, 'Linked upgrade inputs are refused')
    if (index < parts.length - 1) assert.equal(stat.isDirectory(), true, 'Upgrade input parent is not a directory')
    else assert.ok(stat.isFile() && stat.size > 0 && stat.size <= maximum, 'Upgrade input is not a bounded regular file')
  }
  return readFileSync(target)
}

export function inspectCurrentUpgradeInput(root, source) {
  const manifestBytes = regularWithin(root, 'package.json', 1024 * 1024)
  const lockBytes = regularWithin(root, 'package-lock.json', 4 * 1024 * 1024)
  const { installer } = checkAppVersion(JSON.parse(manifestBytes), JSON.parse(lockBytes), PREVIOUS_VERSION)
  const directory = path.join(root, 'test-results', 'local-package')
  for (const target of [path.join(root, 'test-results'), directory]) {
    const stat = lstatSync(target)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Packaging receipt directory is not an owned real directory')
  }
  assert.equal(lstatSync(path.join(directory, 'running.lock'), { throwIfNoEntry: false }), undefined, 'Packaging is still running or cleanup is unconfirmed')
  const entries = readdirSync(directory, { withFileTypes: true })
  assert.ok(entries.length <= 128, 'Packaging input directory is unexpectedly large')
  const receipts = []
  for (const entry of entries) {
    assert.equal(entry.isSymbolicLink(), false, 'Linked packaging receipts are refused')
    if (!entry.isDirectory()) continue
    const file = 'test-results/local-package/' + entry.name + '/receipt.json'
    receipts.push({ file, bytes: regularWithin(root, file, 1024 * 1024) })
  }
  return validateCurrentUpgradeInput({ manifestBytes, lockBytes,
    installerBytes: regularWithin(root, 'release/' + installer, 512 * 1024 * 1024), receipts, source })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, 'Unexpected upgrade verifier arguments')
    assert.equal(process.platform, 'win32', 'Current candidate installation inputs require actual Windows')
    assert.equal(process.env.GITHUB_ACTIONS, 'true')
    assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Only disposable GitHub-hosted Windows runners are allowed')
    assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
    const root = fileURLToPath(new URL('../', import.meta.url)), expectedCommit = process.env.GITHUB_SHA
    assert.ok(objectId(expectedCommit), 'Workflow commit is missing')
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim()
    const source = { expectedCommit, expectedTree: git('rev-parse', '--verify', expectedCommit + '^{tree}'),
      commit: git('rev-parse', '--verify', 'HEAD'), tree: git('rev-parse', '--verify', 'HEAD^{tree}'),
      clean: git('status', '--porcelain', '--untracked-files=no') === '' }
    console.log(JSON.stringify(inspectCurrentUpgradeInput(root, source)))
  } catch (error) {
    console.error('Current upgrade input verification failed: ' + String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 350))
    process.exitCode = 1
  }
}
