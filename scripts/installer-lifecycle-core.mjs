import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const PRODUCT_COMMIT = '191439e04ddbf6b4423194d2978ae72da926df3c'
export const CI_BRANCH = 'ci/local-installation-2f86'
export const RELEASES = Object.freeze({
  previous: Object.freeze({ version: '4.218.0', bytes: 104182839,
    sha256: '0e585aad28c4569666d7ed29c927b6b3bd207571fd0e7b9400fb0fdc93c10909' }),
  current: Object.freeze({ version: '4.219.0', bytes: 104197801,
    sha256: 'b3fab086b8f34f2dd7025223e8322a80b2e0634bfbc88631b25ad2d0d727b43a' }),
})
export const REQUIRED_CHECKS = Object.freeze([
  'pinned-installers-verified', 'fresh-current-install', 'installed-app-trash-workflow',
  'fresh-uninstall-preserves-default-data', 'previous-version-installed-and-seeded',
  'upgrade-preserves-default-data-before-launch', 'upgraded-app-reads-and-saves',
  'same-version-reinstall-preserves-data', 'uninstall-removes-program-and-registration',
  'reinstall-recovers-retained-data', 'final-uninstall-preserves-data', 'owned-processes-exited',
])
export function assertHostedWindows(env, platform) {
  assert.equal(platform, 'win32', 'Actual Windows required; no simulated acceptance')
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Only disposable GitHub-hosted runners are allowed')
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Refusing self-hosted or user computers')
  assert.equal(env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
  assert.equal(env.GITHUB_REF, 'refs/heads/' + CI_BRANCH)
  assert.match(env.GITHUB_SHA || '', /^[0-9a-f]{40}$/)
  assert.ok(path.win32.isAbsolute(env.RUNNER_TEMP || ''), 'Runner temporary directory missing')
}
export function requireOwnedPath(root, candidate) {
  assert.equal(typeof root, 'string'); assert.equal(typeof candidate, 'string')
  for (const value of [root, candidate]) {
    assert.ok(path.win32.isAbsolute(value) && /^[a-z]:\\/i.test(value), 'Local drive path required')
    assert.doesNotMatch(value, /[\x00-\x1f"<>|?*]/, 'Invalid Windows path characters')
    assert.ok(!value.slice(2).includes(':'), 'Alternate data streams refused')
    assert.ok(!value.split(/[\\/]/).some(p => p === '.' || p === '..' || /[. ]$/.test(p)), 'Ambiguous path refused')
  }
  const relative = path.win32.relative(root, candidate)
  assert.ok(relative && !relative.startsWith('..') && !path.win32.isAbsolute(relative), 'Path outside owned directory')
  return candidate
}
export function nsisArgs(root, directory, uninstall = false) {
  requireOwnedPath(root, directory)
  // NSIS requires /D= and _?= LAST, with no quotes even with spaces.
  // Caller uses windowsVerbatimArguments:true; this is NOT a shell command.
  return ['/S', '/currentuser', (uninstall ? '_?=' : '/D=') + directory]
}
export function verifyInstaller(bytes, expected) {
  assert.equal(bytes.length, expected.bytes, 'Installer byte length mismatch')
  const digest = createHash('sha256').update(bytes).digest('hex')
  assert.equal(digest, expected.sha256, 'Installer SHA-256 mismatch')
  assert.equal(bytes.subarray(0, 2).toString(), 'MZ', 'Not a PE executable')
  return { ...expected, sha256: digest }
}
export function validateLifecycleReport(report) {
  assert.equal(report.productCommit, PRODUCT_COMMIT)
  assert.match(report.verifierCommit || '', /^[0-9a-f]{40}$/)
  assert.equal(report.complete, true)
  assert.equal(report.platform, 'win32')
  assert.equal(report.runnerEnvironment, 'github-hosted')
  assert.equal(report.syntheticData, true)
  assert.equal(report.usedDefaultDataPath, true)
  assert.equal(report.forceTerminated, false)
  assert.equal(report.cleanupComplete, true)
  assert.deepEqual(report.checks, REQUIRED_CHECKS)
  assert.deepEqual(report.installers, RELEASES)
  assert.equal(report.commands.length, 8)
  for (const c of report.commands) {
    assert.equal(c.code, 0); assert.equal(c.signal, null); assert.equal(c.timedOut, false)
    assert.ok(c.pid > 0); assert.ok(Number.isFinite(c.elapsedMs) && c.elapsedMs >= 0)
  }
  assert.ok(report.appExits.length >= 5)
  for (const exit of report.appExits) {
    assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.nativeClose, true)
  }
  assert.ok(report.dataComparisons.length >= 5)
  for (const check of report.dataComparisons) {
    assert.equal(check.equal, true); assert.ok(check.files > 0); assert.match(check.digest, /^[a-f0-9]{64}$/)
  }
  return true
}
