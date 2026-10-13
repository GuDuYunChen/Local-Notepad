// Ephemeral Windows runner only. No release, deployment, branch update or real
// user data. Exercise the actual artifact, not a freshly rebuilt substitute.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const productCommit = '191439e04ddbf6b4423194d2978ae72da926df3c'
const installerHash = 'b3fab086b8f34f2dd7025223e8322a80b2e0634bfbc88631b25ad2d0d727b43a'
const originalDriverBlob = '5ba0111b13a4a3577865364d35542554aa7fda58'
const root = process.cwd(), out = path.join(root, 'test-results', 'installer-smoke')
fs.mkdirSync(out, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fileHash = filename => hash(fs.readFileSync(filename))
const git = args => {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 })
  assert.equal(result.status, 0, 'Git source check failed')
  return result.stdout.trim()
}
const report = { complete: false, productCommit, verificationCommit: process.env.GITHUB_SHA || '',
  installerArtifactId: 11785294620, installerSourceRun: 38337004784,
  platform: process.platform, ephemeralRunner: true, syntheticData: true,
  installationExecuted: false, installedApplicationTested: false, uninstallationExecuted: false,
  upgradeTested: false, deploymentPerformed: false, steps: [], startedAt: new Date().toISOString() }
const save = () => fs.writeFileSync(path.join(out, 'installation.json'), JSON.stringify(report, null, 2) + '\n')
const run = (label, executable, args, timeout, options = {}) => {
  const logfile = label + '.log', fd = fs.openSync(path.join(out, logfile), 'w')
  let result
  try { result = spawnSync(executable, args, { cwd: root, env: process.env, stdio: ['ignore', fd, fd], timeout, ...options }) }
  finally { fs.closeSync(fd) }
  report.steps.push({ label, exitCode: result.status, signal: result.signal,
    executionError: result.error ? String(result.error.code || 'process-error') : null,
    log: logfile, logSHA256: fileHash(path.join(out, logfile)) }); save()
  assert.ok(!result.error, label + ' could not complete within its process budget')
  assert.equal(result.status, 0, label + ' returned a failure exit code')
  assert.equal(result.signal, null, label + ' did not exit normally')
}
let installedDir, adaptedDriver
save()
try {
  assert.equal(process.platform, 'win32')
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
  assert.equal(process.env.GITHUB_REF, 'refs/heads/ci/installer-check-4219')
  assert.equal(git(['rev-parse', 'HEAD']), report.verificationCommit)
  assert.equal(git(['rev-parse', 'HEAD^']), productCommit)
  assert.equal(git(['rev-parse', 'HEAD:scripts/check-desktop-save.mjs']), originalDriverBlob)
  assert.equal(git(['diff', '--name-only']), '')
  run('version-check', process.execPath, ['scripts/check-app-version.mjs', '--previous-version=4.218.0'], 30000)
  const installer = path.join(root, 'test-results', 'installer-input', 'Notepad-4.219.0-Setup.exe')
  assert.equal(fs.statSync(installer).size, 104197801)
  assert.equal(fileHash(installer), installerHash, 'Downloaded installer differs from the verified artifact')
  report.installer = { filename: path.basename(installer), bytes: fs.statSync(installer).size, sha256: installerHash }; save()
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(process.env.RUNNER_TEMP), 'notepad-4219-installed-'))
  installedDir = path.join(parent, '安装验证 4.219.0')
  assert.equal(fs.existsSync(installedDir), false)
  report.installPathHasSpacesAndChinese = true
  // NSIS /D and _?= consume the remaining command line and must not be quoted.
  run('install', installer, ['/S', '/D=' + installedDir], 120000, { windowsVerbatimArguments: true })
  const applications = fs.readdirSync(installedDir).filter(name => name.endsWith('.exe') && !/^uninstall/i.test(name))
  assert.equal(applications.length, 1, 'Installed application identity is ambiguous')
  const app = path.join(installedDir, applications[0]), asar = path.join(installedDir, 'resources', 'app.asar')
  const backend = path.join(installedDir, 'resources', 'bin', 'notepad-server.exe')
  const require = createRequire(import.meta.url)
  const manifest = JSON.parse(require('@electron/asar').extractFile(asar, 'package.json').toString('utf8'))
  assert.equal(manifest.version, '4.219.0')
  assert.equal(manifest.name, 'notepad-desktop')
  assert.ok(fs.statSync(backend).size > 0)
  report.installationExecuted = true
  report.installedFiles = { version: manifest.version, appSHA256: fileHash(app), asarSHA256: fileHash(asar), backendSHA256: fileHash(backend) }; save()

  // Preserve the original driver and every assertion. Only point its application
  // location at the actually installed directory. Its own isolated data/profile,
  // real native close, timeout budgets and failure-only cleanup are unchanged.
  const original = fs.readFileSync(path.join(root, 'scripts', 'check-desktop-save.mjs'), 'utf8')
  const marker = "const unpacked = path.join(root, 'release', 'win-unpacked')"
  const replacement = 'const unpacked = ' + JSON.stringify(installedDir)
  assert.equal(original.split(marker).length, 2)
  const adapted = original.replace(marker, replacement)
  assert.equal(adapted.replace(replacement, marker), original)
  adaptedDriver = path.join(root, 'scripts', 'ci-installed-desktop-4219.mjs')
  assert.equal(fs.existsSync(adaptedDriver), false)
  fs.writeFileSync(adaptedDriver, adapted)
  report.driver = { originalGitBlob: originalDriverBlob, originalWorkingSHA256: hash(original),
    adaptedSHA256: hash(adapted), onlyChange: 'packaged-application-directory', originalAssertionsRetained: true }; save()
  run('installed-desktop', process.execPath, [adaptedDriver], 600000)
  const desktop = JSON.parse(fs.readFileSync(path.join(root, 'test-results', 'desktop-save', 'checks.json'), 'utf8'))
  const trash = JSON.parse(fs.readFileSync(path.join(root, 'test-results', 'desktop-save', 'trash-workspace.json'), 'utf8'))
  assert.equal(desktop.complete, true); assert.equal(trash.complete, true)
  assert.equal(desktop.commit, report.verificationCommit); assert.equal(trash.commit, report.verificationCommit)
  assert.equal(desktop.appSHA256, report.installedFiles.appSHA256)
  assert.equal(desktop.asarSHA256, report.installedFiles.asarSHA256)
  assert.equal(desktop.backendSHA256, report.installedFiles.backendSHA256)
  assert.equal(trash.checks.length, 12)
  assert.equal(desktop.exits.length, 2)
  for (const exit of desktop.exits) { assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.nativeClose, true) }
  assert.equal(desktop.windowHelper.stoppedCleanly, true)
  report.installedApplicationTested = true
  report.trashCheckpoints = trash.checks
  report.nativeExits = desktop.exits
  report.nativeReportCommit = report.verificationCommit; save()

  const uninstallers = fs.readdirSync(installedDir).filter(name => /^uninstall.*\.exe$/i.test(name))
  assert.equal(uninstallers.length, 1, 'Installed uninstaller missing or ambiguous')
  run('uninstall', path.join(installedDir, uninstallers[0]), ['/S', '_?=' + installedDir], 120000, { windowsVerbatimArguments: true })
  for (const target of [app, asar, backend]) assert.equal(fs.existsSync(target), false, 'Uninstall retained application payload')
  report.uninstallationExecuted = true
  report.applicationPayloadRemoved = true
  report.uninstallerMayRemainAtOriginalLocation = fs.existsSync(path.join(installedDir, uninstallers[0]))
  fs.unlinkSync(adaptedDriver); adaptedDriver = null
  assert.equal(git(['diff', '--name-only']), '')
  report.complete = true
  console.log('Exact installer installed successfully; original full desktop suite passed against installed files; application payload uninstalled successfully.')
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Installed acceptance failed'
  process.exitCode = 1
} finally {
  if (adaptedDriver && fs.existsSync(adaptedDriver)) fs.unlinkSync(adaptedDriver)
  // Failure artifacts remain truthful; do not delete the install tree to fake a
  // successful uninstall. The isolated runner itself owns eventual cleanup.
  report.finishedAt = new Date().toISOString(); save()
}
