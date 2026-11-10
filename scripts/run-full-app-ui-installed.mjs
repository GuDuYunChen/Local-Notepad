// Additive actual-app page matrix on its own hosted Windows runner. The original
// 17-module lifecycle and 12 three-page scenes must have passed in the same CI run.
// This group has its own machine/default-data baseline and never reuses old PIDs.
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { assertHostedWindows, requireOwnedPath, nsisArgs, verifyInstaller, validateLifecycleReport } from './installer-lifecycle-core.mjs'
import { createDesktopWindowSession, desktopWindowWorkerArguments } from './desktop-window-session.mjs'
import { selectDesktopMainWindow, assertDesktopWindowImage } from './desktop-window-target.mjs'
import { verifyFullAppUiDesktop } from './check-full-app-ui-desktop.mjs'
import { verifyLocalSyncLabDesktop } from './check-local-sync-lab-desktop.mjs'
import { prepareLocalSyncLabNotes, seedLocalSyncLab, snapshotLocalSyncLab } from './full-app-ui-local-sync-seed.mjs'
import { UI_INSTALLED_REGISTRATION_QUERY, validateUiInstalledRegistration, verifyUiScreensFiles } from './ui-screens-evidence.mjs'
import { FULL_APP_GROUPS, FULL_APP_MATRIX, FULL_APP_PRODUCT_SOURCE_FILES, FULL_APP_RUNTIME_SOURCE_FILES, FULL_APP_VERIFIER_SOURCE_FILES, fullAppProductPageSources, validateFullAppUiLedger, validateFullAppLedgerSourceIdentity, verifyFullAppUiFiles, validateFullAppInstalledReport, validateFullAppPrerequisites, validateNativeWindowResize, validateFullAppFixtureFile, validateLocalSyncLabBackendProcess, validateLocalSyncLabBackendExit } from './full-app-ui-evidence.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const VERSION = '4.249.0'
const API_BASE = 'http://127.0.0.1:27121'
const REPORT = 'full-app-ui-installed.json'
const LEDGER_FILE = 'scripts/full-app-ui-routes.json'
const PRODUCT_SOURCE_FILE = 'scripts/ui-screens-product-sources.json'
export const FULL_APP_UI_PRODUCT_SOURCES = FULL_APP_PRODUCT_SOURCE_FILES
export const FULL_APP_UI_VERIFIER_SOURCES = FULL_APP_VERIFIER_SOURCE_FILES
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const blob = bytes => createHash('sha1').update('blob ' + Buffer.byteLength(bytes) + '\0').update(bytes).digest('hex')
const readJSON = filename => JSON.parse(readFileSync(filename, 'utf8'))
const canonical = filename => readFileSync(filename, 'utf8').replace(/\r\n/g, '\n')
const samePath = (a, b) => path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase()
const fingerprint = filename => ({ filename: path.basename(filename), bytes: lstatSync(filename).size, sha256: sha(readFileSync(filename)) })
const sourceFingerprint = filename => {
  const bytes = Buffer.from(canonical(filename), 'utf8')
  return { filename: path.basename(filename), bytes: bytes.length, sha256: sha(bytes), canonicalization: 'git-LF' }
}
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim()

export function validateFullAppOriginalInstallation({ pin, original, accepted, sourceProof, currentApplication }) {
  assert.equal(pin.current.version, VERSION)
  validateLifecycleReport(original)
  assert.equal(original.productCommit, pin.product); assert.equal(original.verifierCommit, process.env.GITHUB_SHA)
  assert.deepEqual(original.installers, { current: pin.current, previous: pin.previous })
  assert.equal(original.appExits.length, 6); assert.equal(original.dataComparisons.length, 6)
  for (const name of ['installed-app-reading-mode-workflow', 'installed-app-shortcut-management-workflow',
    'installed-app-local-export-workflow', 'installed-app-block-reference-workflow', 'final-uninstall-preserves-data']) {
    assert.equal(original.checks.filter(value => value === name).length, 1, 'Original installation gate missing: ' + name)
  }
  assert.equal(accepted.complete, true); assert.equal(accepted.productCommit, pin.product)
  assert.equal(accepted.verifierCommit, process.env.GITHUB_SHA)
  assert.deepEqual(accepted.installer, pin.current); assert.deepEqual(accepted.installationChecks, original.checks)
  assert.equal(accepted.screenshotsVerified, true)
  assert.equal(sourceProof.productCommit, pin.product); assert.equal(sourceProof.verifierCommit, process.env.GITHUB_SHA)
  assert.equal(sourceProof.productionModified, false)
  for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) {
    assert.match(currentApplication[key] || '', /^[a-f0-9]{64}$/)
    assert.equal(original.shortcutManagementRun.application[key], currentApplication[key])
    assert.equal(original.localExportRun.application[key], currentApplication[key])
    const snapshots = original.snapshots.filter(item => item.phase === 'installed-' + VERSION)
    assert.ok(snapshots.length > 0); for (const snapshot of snapshots) assert.equal(snapshot[key], currentApplication[key])
  }
  return true
}

function sourceIdentity(pin, sourceProof, ledger) {
  assert.equal(git('rev-parse', '--verify', 'HEAD'), process.env.GITHUB_SHA)
  const productTree = git('rev-parse', pin.product + '^{tree}')
  assert.equal(ledger.productSource.commit, pin.product); assert.equal(ledger.productSource.tree, productTree)
  assert.equal(ledger.productSource.dirty, false)
  const applicationPaths = ['src', 'electron', 'server', 'package.json', 'package-lock.json', 'vite.config.js']
  const productPaths = Object.fromEntries(applicationPaths.map(file => {
    const expected = git('rev-parse', pin.product + ':' + file)
    assert.equal(git('rev-parse', process.env.GITHUB_SHA + ':' + file), expected, 'Verifier altered a product application path: ' + file)
    return [file, expected]
  }))
  assert.equal(git('status', '--porcelain', '--untracked-files=all', '--', ...applicationPaths), '', 'Product application paths must remain clean')
  const supplement = readJSON(path.join(ROOT, PRODUCT_SOURCE_FILE))
  assert.equal(supplement.schemaVersion, 1); assert.equal(supplement.productCommit, pin.product)
  assert.deepEqual(Object.keys(supplement.sourceFiles).sort(), [...FULL_APP_UI_PRODUCT_SOURCES].sort())
  const originalCore = 'scripts/installer-lifecycle-core.mjs'
  for (const file of FULL_APP_UI_PRODUCT_SOURCES) {
    assert.match(supplement.sourceFiles[file] || '', /^[a-f0-9]{40}$/)
    if (file === originalCore) {
      assert.equal(supplement.sourceFiles[file], sourceProof.originalCore)
      assert.equal(blob(canonical(path.join(ROOT, file))), sourceProof.preparedCore,
        'Original generated lifecycle core no longer matches its retained source proof')
    } else assert.equal(blob(canonical(path.join(ROOT, file))), supplement.sourceFiles[file], 'Product helper changed: ' + file)
  }
  const reused = {
    'scripts/native-ui-select.mjs': 'nativeUiSelectBlob',
    'scripts/desktop-save-fixture.mjs': 'shortcutManagementCanonicalFixtureBlob',
    'scripts/desktop-window-session.mjs': 'readingWindowSessionBlob',
    'scripts/desktop-window-target.mjs': 'readingWindowTargetBlob',
    'scripts/desktop-window-worker.ps1': 'readingWindowWorkerBlob',
    'scripts/local-export-directory-session.mjs': 'localExportDirectorySessionBlob',
    'scripts/local-export-directory-worker.ps1': 'localExportDirectoryWorkerBlob',
  }
  for (const [file, key] of Object.entries(reused)) assert.equal(supplement.sourceFiles[file], pin[key])
  const verifier = Object.fromEntries(FULL_APP_UI_VERIFIER_SOURCES.map(file => {
    const expected = git('rev-parse', process.env.GITHUB_SHA + ':' + file)
    assert.equal(blob(canonical(path.join(ROOT, file))), expected, 'Verifier-owned source changed after checkout: ' + file)
    return [file, expected]
  }))
  const pageSources = fullAppProductPageSources(ledger)
  const actualPageDetails = {}
  const actualPages = Object.fromEntries(pageSources.map(file => {
    const expected = git('rev-parse', pin.product + ':' + file)
    const filename = path.join(ROOT, file), workspaceBytes = readFileSync(filename)
    // Match the exact Git object bytes, whether Git stores LF or original CRLF.
    // A Windows checkout may only use its existing newline canonicalization;
    // neither candidate is accepted unless its complete Git blob matches P.
    const bytes = blob(workspaceBytes) === expected ? workspaceBytes : Buffer.from(canonical(filename), 'utf8')
    assert.equal(blob(bytes), expected, 'Actual application page source differs from pinned product: ' + file)
    actualPageDetails[file] = { blob: expected, bytes: bytes.length, sha256: sha(bytes) }
    return [file, expected]
  }))
  const runtime = Object.fromEntries(FULL_APP_RUNTIME_SOURCE_FILES.map(file => {
    const expected = git('rev-parse', pin.product + ':' + file)
    assert.equal(blob(canonical(path.join(ROOT, file))), expected, 'Typed fixture parser or schema differs from pinned product: ' + file)
    return [file, expected]
  }))
  const identity = { productCommit: pin.product, productTree, productPaths,
    product: supplement.sourceFiles, actualPages, actualPageDetails, runtime, verifierCommit: process.env.GITHUB_SHA,
    verifier, generatedLifecycleCore: sourceProof.preparedCore }
  validateFullAppLedgerSourceIdentity(ledger, identity)
  return identity
}

function snapshot(directory) {
  if (!existsSync(directory)) return { exists: false, files: 0, bytes: 0, sha256: sha('[]') }
  const entries = []; let totalBytes = 0
  assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink())
  const walk = (folder, prefix = '') => {
    for (const name of readdirSync(folder).sort()) {
      const filename = path.join(folder, name), info = lstatSync(filename), relative = prefix + name
      assert.equal(info.isSymbolicLink(), false, 'Linked default data is refused')
      if (info.isDirectory()) walk(filename, relative + '/')
      else {
        assert.equal(info.isFile(), true); assert.ok(entries.length < 10000 && info.size <= 512 * 1024 * 1024)
        totalBytes += info.size; assert.ok(totalBytes <= 1024 * 1024 * 1024)
        entries.push({ path: relative, bytes: info.size, sha256: sha(readFileSync(filename)) })
      }
    }
  }
  walk(directory)
  return { exists: true, files: entries.length, bytes: totalBytes, sha256: sha(JSON.stringify(entries)) }
}

async function until(check, label, budget = 15000) {
  const end = performance.now() + budget
  while (performance.now() < end) { const value = await check(); if (value) return value; await sleep(100) }
  throw Error(label)
}
async function freePort(port = 0) {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const actual = server.address().port; await new Promise(resolve => server.close(resolve)); return actual
}
async function connect(url) {
  const parsed = new URL(url); assert.equal(parsed.protocol, 'ws:'); assert.equal(parsed.hostname, '127.0.0.1')
  const socket = new WebSocket(url), pending = new Map(), listeners = new Set(); let sequence = 0, fatal
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('Full application UI debugger connect deadline')) }, 10000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('Full application UI debugger connect failed')) }, { once: true })
  })
  const fail = error => { fatal ??= error; for (const task of pending.values()) { clearTimeout(task.timer); task.reject(fatal) }; pending.clear() }
  socket.addEventListener('close', () => fail(Error('Full application UI debugger closed')))
  socket.addEventListener('error', () => fail(Error('Full application UI debugger failed')))
  socket.addEventListener('message', event => {
    try {
      const message = JSON.parse(String(event.data))
      if (message.method) for (const listener of listeners) listener(message)
      const task = pending.get(message.id)
      if (task) { pending.delete(message.id); clearTimeout(task.timer); if (message.error) task.reject(Error(JSON.stringify(message.error))); else task.resolve(message.result) }
    } catch (error) { fail(error) }
  })
  return { onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener) }, close: () => socket.close(),
    send(method, params = {}) {
      if (fatal) return Promise.reject(fatal)
      return new Promise((resolve, reject) => {
        const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('Full application UI debugger command deadline: ' + method)) }, 15000)
        pending.set(id, { resolve, reject, timer })
        try { socket.send(JSON.stringify({ id, method, params })) } catch (error) { pending.delete(id); clearTimeout(timer); reject(error) }
      })
    } }
}

export async function runFullAppUiInstalled({ group, pin, installerPath, originalInstallationReport,
  out, ownedRoot = process.env.RUNNER_TEMP } = {}) {
  assert.ok(FULL_APP_GROUPS.includes(group), 'An exact declared application group is required')
  out ??= path.join(ROOT, 'test-results/full-app-ui', group)
  const ledger = readJSON(path.join(ROOT, LEDGER_FILE)); validateFullAppUiLedger(ledger)
  assertHostedWindows(process.env, process.platform)
  assert.match(process.env.GITHUB_RUN_ID || '', /^[1-9][0-9]*$/)
  assert.match(process.env.GITHUB_RUN_ATTEMPT || '', /^[1-9][0-9]*$/)
  assert.equal(process.env.GITHUB_JOB, 'full-application-ui')
  pin ??= readJSON(path.join(ROOT, 'scripts/reading-mode-installer-pin.json'))
  installerPath ??= path.join(ROOT, '.installer-input/current/Notepad-' + VERSION + '-Setup.exe')
  originalInstallationReport ??= path.join(ROOT, '.accepted-installation/installation.json')
  const originalDirectory = path.dirname(originalInstallationReport)
  const acceptedFile = path.join(originalDirectory, 'reading-mode-installation-accepted.json')
  const sourceProofFile = path.join(originalDirectory, 'local-import-verifier-source.json')
  const originalBytes = readFileSync(originalInstallationReport), original = JSON.parse(originalBytes)
  const acceptedBytes = readFileSync(acceptedFile), accepted = JSON.parse(acceptedBytes)
  const sourceProof = readJSON(sourceProofFile), originalApplication = original.localExportRun?.application
  validateFullAppOriginalInstallation({ pin, original, accepted, sourceProof, currentApplication: originalApplication })
  const threeDirectory = path.join(originalDirectory, 'ui-screens-installed')
  const threeReportFile = path.join(threeDirectory, 'ui-screens-installed.json')
  const threeAcceptedFile = path.join(threeDirectory, 'ui-screens-installed-accepted.json')
  const threeReport = readJSON(threeReportFile), threeAccepted = readJSON(threeAcceptedFile)
  const preparationFile = path.join(originalDirectory, 'preparation-context.json'), preparation = readJSON(preparationFile)
  validateFullAppPrerequisites({ pin, original, accepted, sourceProof, threeReport, threeAccepted, preparation,
    verifierCommit: process.env.GITHUB_SHA, runID: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    threeReportFingerprint: fingerprint(threeReportFile) })
  verifyUiScreensFiles(threeReport.uiScreens, threeDirectory)
  const sources = sourceIdentity(pin, sourceProof, ledger)
  for (const [file, expected] of Object.entries(threeReport.sourceFiles.verifier)) assert.equal(sources.verifier[file], expected)
  assert.deepEqual(threeReport.sourceFiles.product, sources.product)
  const retainedFiles = [originalInstallationReport, acceptedFile, sourceProofFile, preparationFile, threeReportFile, threeAcceptedFile]
  const retainedBytes = retainedFiles.map(file => readFileSync(file))
  assert.equal(path.basename(installerPath), 'Notepad-' + VERSION + '-Setup.exe')
  verifyInstaller(readFileSync(installerPath), pin.current)
  assert.equal(existsSync(out), false, 'Do not overwrite a previous screenshot acceptance attempt')
  const defaultData = path.join(homedir(), 'AppData/Roaming/Notepad'), defaultBefore = snapshot(defaultData)
  const scratch = realpathSync.native(mkdtempSync(path.join(realpathSync.native(ownedRoot), 'full-app-ui-' + group + '-')))
  const installDirectory = requireOwnedPath(scratch, path.join(scratch, 'Full application UI application'))
  const data = requireOwnedPath(scratch, path.join(scratch, 'data')), profile = requireOwnedPath(scratch, path.join(scratch, 'profile'))
  const fixtures = requireOwnedPath(scratch, path.join(scratch, 'fixture-inputs'))
  const executablePath = path.join(installDirectory, '记事本.exe')
  assert.equal(samePath(data, defaultData), false)
  mkdirSync(data); mkdirSync(fixtures); mkdirSync(out, { recursive: true })
  const report = { schemaVersion: 1, module: '2F.116', scope: 'installed-actual-app-page-matrix-group', group, version: VERSION,
    productCommit: pin.product, productTree: sources.productTree, verifierCommit: process.env.GITHUB_SHA, platform: process.platform,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT, syntheticData: true, realBackend: true,
    bridgeOverridden: false, timerAccelerated: false, emulatedViewport: false, forceTerminated: false,
    complete: false, cleanupComplete: false, startedAt: new Date().toISOString(), sourceFiles: sources,
    runner: { runID: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      job: process.env.GITHUB_JOB, group, machine: process.env.COMPUTERNAME || null },
    originalThreePages: { report: fingerprint(threeReportFile), accepted: fingerprint(threeAcceptedFile),
      sameProductAndInstalledBytes: true, complete: true, scenes: threeReport.uiScreens.scenes.length },
    ledger: sourceFingerprint(path.join(ROOT, LEDGER_FILE)), workspaceLedger: fingerprint(path.join(ROOT, LEDGER_FILE)),
    installer: pin.current, originalInstallation: { report: fingerprint(originalInstallationReport),
      accepted: fingerprint(acceptedFile), sourceProof: fingerprint(sourceProofFile), allOriginalGatesPassed: true,
      checks: original.checks, application: originalApplication },
    dataIsolation: { ownedRoot: scratch, data, profile, defaultData, defaultBefore, defaultUnchanged: false,
      baselineScope: 'this-matrix-job-only', baselineOwner: [process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT, process.env.GITHUB_JOB, group].join(':') },
    checks: [], screenshots: [], windowSizes: [], commands: [], runtimeErrors: [], fixtureInputs: [], fixtureInputsVerified: false,
    windowHelper: { events: [] }, resizeCommands: [] }
  const reportPath = path.join(out, REPORT)
  let app, exited, cdp, windowSession, trace = '', closeRequested = false, uninstalled = false, activeLabBackend
  const liveCommands = new Set()
  const save = () => {
    if (windowSession) report.windowHelper.lifecycle = windowSession.diagnostics()
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  const cleanEnvironment = { ...process.env }
  for (const key of Object.keys(cleanEnvironment)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete cleanEnvironment[key]
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NOTEPAD_DATA', 'PORT']) delete cleanEnvironment[key]
  const traceData = value => { trace = (trace + String(value)).slice(-180000) }
  const command = async (file, args, { label, verbatim = false, timeout = 90000, input } = {}) => {
    const started = performance.now(), child = spawn(file, args, { cwd: scratch, env: cleanEnvironment,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: verbatim })
    liveCommands.add(child)
    let output = '', errors = '', timer, timedOut = false, terminal, recorded = false
    child.stdout.on('data', bytes => { output = (output + bytes).slice(-100000) }); child.stderr.on('data', bytes => { errors = (errors + bytes).slice(-100000) })
    child.stdout.on('error', traceData); child.stderr.on('error', traceData)
    const done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => { terminal = { code, signal }; liveCommands.delete(child); resolve(terminal) })
    })
    done.catch(() => {})
    if (input !== undefined) { child.stdin.on('error', traceData); child.stdin.end(input) }
    try {
      const result = await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(Error('Owned Full application UI command deadline')) }, timeout) })])
      if (label) { report.commands.push({ label, pid: child.pid, ...result, timedOut, elapsedMs: Math.round(performance.now() - started) }); recorded = true; save() }
      assert.equal(result.signal, null); assert.equal(result.code, 0, errors || label || 'Native command failed')
      return output.trim()
    } finally {
      clearTimeout(timer)
      if (timedOut && child.exitCode === null && Number.isSafeInteger(child.pid)) {
        report.forceTerminated = true; report.complete = false; save()
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, stdio: 'ignore' })
        await Promise.race([done.catch(() => {}), sleep(3000)])
      }
      if (label && !recorded) report.commands.push({ label, pid: child.pid ?? null,
        ...(terminal || { code: null, signal: null }), timedOut, terminalConfirmed: Boolean(terminal), elapsedMs: Math.round(performance.now() - started) })
      if (timedOut && liveCommands.has(child)) report.cleanupError ??= 'Owned native command did not confirm termination'
      save()
    }
  }
  const ps = async source => command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from("$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();" + source, 'utf16le').toString('base64')], { timeout: 20000 })
  const labBackendProcesses = async ({ parentPid, pid, timeout }) => {
    assert.equal(group, 'local-sync-lab')
    assert.ok(Number.isInteger(timeout) && timeout > 0 && timeout <= 5000)
    assert.equal((parentPid === undefined) !== (pid === undefined), true, 'An exact parent or process PID is required')
    const queryPID = parentPid ?? pid
    assert.ok(Number.isSafeInteger(queryPID) && queryPID > 0)
    const filter = parentPid === undefined ? `ProcessId = ${pid}` : `ParentProcessId = ${parentPid} AND Name = 'notepad-server.exe'`
    const source = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();` +
      `$items=@(Get-CimInstance Win32_Process -Filter "${filter}" -ErrorAction Stop | ForEach-Object {` +
      `@{pid=[long]$_.ProcessId;parentPid=[long]$_.ParentProcessId;executable=[string]$_.ExecutablePath;` +
      `createdAt=$_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ');source='Win32_Process'}});` +
      `ConvertTo-Json -InputObject @($items) -Compress`
    const processes = JSON.parse(await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64')], { timeout }))
    assert.ok(Array.isArray(processes)); return processes
  }
  const identifyLabBackend = async () => {
    const processes = await labBackendProcesses({ parentPid: report.pid, timeout: 5000 })
    assert.equal(processes.length, 1, 'The actual installed App must own exactly one backend process')
    return validateLocalSyncLabBackendProcess(processes[0], report.pid, path.join(installDirectory, 'resources/bin/notepad-server.exe'))
  }
  const registrations = async () => JSON.parse(await ps(UI_INSTALLED_REGISTRATION_QUERY))
  const links = async () => JSON.parse(await ps("$links=@();foreach($folder in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))){$p=Join-Path $folder '记事本.lnk';if(Test-Path -LiteralPath $p){$links+=@{path=$p}}};ConvertTo-Json -InputObject @($links) -Compress"))
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result?.value
  }
  const api = async (route, options = {}) => {
    assert.match(route, /^\/api\//)
    const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData
    const response = await fetch(API_BASE + route, { ...options, headers: { Origin: 'null', ...(multipart ? {} : { 'Content-Type': 'application/json' }) }, redirect: 'error', signal: AbortSignal.timeout(4000) })
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.code, 0, JSON.stringify(body)); return body.data
  }
  const readAsset = async url => {
    assert.match(url, /^\/uploads\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/)
    assert.ok(!url.includes('..'), 'Asset traversal is refused')
    const response = await fetch(API_BASE + url, { headers: { Origin: 'null' }, redirect: 'error', signal: AbortSignal.timeout(4000) })
    assert.equal(response.status, 200)
    const bytes = Buffer.from(await response.arrayBuffer()); assert.ok(bytes.length > 0 && bytes.length <= 1024 * 1024)
    return bytes
  }
  const writeFixtureFile = ({ name, bytes }) => {
    validateFullAppFixtureFile({ name, bytes })
    const filename = requireOwnedPath(scratch, path.join(fixtures, name)), contents = Buffer.from(bytes)
    writeFileSync(filename, contents, { flag: 'wx' })
    const record = { path: filename, name, bytes: contents.length, sha256: sha(contents) }
    report.fixtureInputs.push(record); save(); return { ...record }
  }
  const verifyFixtureFiles = () => {
    for (const file of report.fixtureInputs) {
      const bytes = readFileSync(file.path)
      assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256, 'Owned synthetic input changed after creation')
    }
    report.fixtureInputsVerified = true
  }
  const click = async request => {
    if (typeof request === 'string') request = { selector: request }
    const point = await until(() => evaluate(`(()=>{const request=${JSON.stringify(request)};const nodes=[...document.querySelectorAll(request.selector)].filter(n=>!n.disabled&&(request.text===undefined||n.textContent.trim()===request.text||n.getAttribute('aria-label')===request.text)&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);if(nodes.length!==1)return null;const n=nodes[0];n.scrollIntoView({block:'center',behavior:'instant'});const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return hit&&(hit===n||n.contains(hit))?{x,y}:null})()`), 'Full application UI control unavailable: ' + request.selector)
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
  }
  const capture = async (filename, observeBeforeCapture) => {
    assert.match(filename, /^[a-z0-9][a-z0-9_-]*\.png$/)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    if (observeBeforeCapture) await observeBeforeCapture()
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    assert.ok(bytes.length > 1000); writeFileSync(path.join(out, filename), bytes, { flag: 'wx' })
    const record = { filename, bytes: bytes.length, sha256: sha(bytes) }; report.screenshots.push(record); save(); return record
  }
  const mainWindow = async () => {
    const window = selectDesktopMainWindow(await windowSession.inspect(report.pid, executablePath), report.pid, await evaluate('document.title'))
    assertDesktopWindowImage(window, executablePath); return window
  }
  const resize = async (requested, { phase = 'matrix' } = {}) => {
    assert.ok(['setup', 'matrix'].includes(phase))
    if (phase === 'setup') { assert.equal(report.windowSizes.length, 0); assert.deepEqual(requested, { width: 1280, height: 800 }) }
    else {
      assert.equal(report.windowSizes[0]?.phase, 'setup', 'The native setup window must be established before the page matrix')
      assert.ok(report.windowSizes.length <= FULL_APP_MATRIX.length)
      assert.deepEqual(requested, FULL_APP_MATRIX[report.windowSizes.length - 1].viewport, 'Native viewport order differs from the fixed page matrix')
    }
    assert.ok(FULL_APP_MATRIX.some(item => item.viewport.width === requested?.width && item.viewport.height === requested?.height), 'Undeclared native client size')
    const window = await mainWindow(), before = await evaluate('({width:innerWidth,height:innerHeight,devicePixelRatio})')
    const request = { protocol: 1, operation: 'resize-owned-client', pid: report.pid, handle: window.handle,
      executable: executablePath, width: requested.width, height: requested.height, devicePixelRatio: before.devicePixelRatio,
      beforeViewport: { width: before.width, height: before.height } }
    const started = performance.now()
    const worker = JSON.parse(await command('powershell.exe', desktopWindowWorkerArguments(readFileSync(path.join(ROOT, 'scripts/full-app-ui-window-worker.ps1'))),
      { timeout: 20000, input: JSON.stringify(request) + '\n' }))
    const observed = await until(async () => {
      const value = await evaluate('({width:innerWidth,height:innerHeight,devicePixelRatio})')
      return value.width === requested.width && value.height === requested.height && value
    }, 'Actual native client did not reach exact ' + requested.width + 'x' + requested.height)
    assert.equal(observed.devicePixelRatio, before.devicePixelRatio, 'Native resize moved to a different DPI context')
    validateNativeWindowResize(worker, request)
    const result = { requested: { ...requested }, viewport: { width: observed.width, height: observed.height },
      nativeWindow: true, devicePixelRatio: observed.devicePixelRatio, native: worker }
    report.resizeCommands.push({ phase, operation: request.operation, elapsedMs: Math.round(performance.now() - started), complete: true })
    report.windowSizes.push({ ...result, phase, pid: report.pid, handle: window.handle, method: 'owned-hwnd-exact-client-size' })
    save(); return result
  }
  const closeNormally = async () => {
    if (!app || app.exitCode !== null) return
    assert.equal(closeRequested, false, 'An uncertain native close must never be replayed')
    const closingBackend = group === 'local-sync-lab'
      ? validateLocalSyncLabBackendProcess(activeLabBackend, report.pid, path.join(installDirectory, 'resources/bin/notepad-server.exe')) : null
    const window = await mainWindow(); closeRequested = true
    await windowSession.close(window)
    const closeRequest = structuredClone(windowSession.events().at(-1)); let timer
    try {
      const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Full application UI normal close deadline')), 15000) })])
      assert.deepEqual(result, { code: 0, signal: null })
      report.exit = { pid: report.pid, ...result, nativeClose: true, window, closeRequest }
      app = null; cdp.close(); cdp = null
      if (closingBackend) {
        const deadline = performance.now() + 5000
        await until(async () => {
          const remaining = Math.floor(deadline - performance.now())
          assert.ok(remaining > 0, 'The original backend-close deadline has elapsed')
          const processes = await labBackendProcesses({ pid: closingBackend.pid, timeout: remaining })
          if (processes.length) {
            assert.deepEqual(processes, [closingBackend], 'The recorded backend PID was replaced; no foreign process may be acted on')
            return false
          }
          try { await freePort(27121) } catch { return false }
          assert.ok(performance.now() <= deadline, 'The original backend-close deadline has elapsed')
          report.exit.backendExit = { pid: closingBackend.pid, source: 'Win32_Process', processes, portClosed: true, complete: true }
          validateLocalSyncLabBackendExit(report.exit.backendExit, closingBackend)
          return true
        }, 'Local lab backend PID or port remained alive', 5000)
      } else {
        await until(async () => { try { await freePort(27121); return true } catch { return false } }, 'Full application UI backend remained alive', 5000)
      }
      report.backendStopped = true; save()
    } finally { clearTimeout(timer) }
  }
  const uninstall = async () => {
    if (uninstalled) return
    assert.ok(!app || app.exitCode !== null, 'Close owned application before uninstall')
    const source = path.join(installDirectory, 'Uninstall 记事本.exe')
    assert.ok(existsSync(source), 'Owned current uninstaller is missing')
    const copy = requireOwnedPath(scratch, path.join(scratch, 'owned-ui-uninstaller.exe'))
    assert.equal(existsSync(copy), false); copyFileSync(source, copy); assert.equal(sha(readFileSync(copy)), sha(readFileSync(source)))
    await command(copy, nsisArgs(scratch, installDirectory, true), { label: 'additional-ui-uninstall', verbatim: true })
    for (const file of [executablePath, path.join(installDirectory, 'resources/app.asar'), path.join(installDirectory, 'resources/bin/notepad-server.exe')]) assert.equal(existsSync(file), false)
    assert.deepEqual(await registrations(), []); assert.deepEqual(await links(), []); uninstalled = true
    report.uninstalled = true; save()
  }
  let failure
  try {
    assert.deepEqual(await registrations(), [], 'This new matrix runner must begin without an existing application registration')
    assert.deepEqual(await links(), [], 'This new matrix runner has an existing application shortcut')
    await freePort(27121)
    await command(installerPath, nsisArgs(scratch, installDirectory), { label: 'additional-ui-install', verbatim: true })
    const appIdentity = { executable: executablePath, executableSHA256: sha(readFileSync(executablePath)),
      asarSHA256: sha(readFileSync(path.join(installDirectory, 'resources/app.asar'))),
      backendSHA256: sha(readFileSync(path.join(installDirectory, 'resources/bin/notepad-server.exe'))) }
    for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) assert.equal(appIdentity[key], originalApplication[key], 'Additional installed application differs: ' + key)
    const registered = await registrations(); report.registrationRead = registered; report.app = appIdentity; save()
    report.registration = validateUiInstalledRegistration(registered, installDirectory, VERSION); save()
    assert.deepEqual(snapshot(defaultData), defaultBefore)
    windowSession = createDesktopWindowSession({ onEvent: event => { report.windowHelper.events.push(event); save() } })
    await windowSession.ready
    const port = await freePort()
    app = spawn(executablePath, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
      { cwd: installDirectory, env: { ...cleanEnvironment, NOTEPAD_DATA: data, PORT: '27121' }, stdio: ['ignore', 'pipe', 'pipe'] })
    exited = new Promise((resolve, reject) => { app.once('error', reject); app.once('exit', (code, signal) => resolve({ code, signal })) }); exited.catch(() => {})
    for (const stream of [app.stdout, app.stderr]) { stream.on('data', traceData); stream.on('error', traceData) }
    report.pid = app.pid; assert.ok(Number.isSafeInteger(report.pid) && report.pid > 0)
    // PIDs and default-data paths belong to this runner; no cross-machine PID comparison.
    const page = await until(async () => {
      assert.equal(app.exitCode, null, 'Additional installed application exited before readiness')
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) })
        const matches = (await response.json()).filter(item => item.type === 'page' && item.url.startsWith('file:') && item.url.includes('index.html'))
        return matches.length === 1 && matches[0]
      } catch { return false }
    }, 'Additional installed renderer did not become available')
    cdp = await connect(page.webSocketDebuggerUrl)
    cdp.onEvent(event => { if (event.method === 'Runtime.exceptionThrown') { report.runtimeErrors.push(event.params.exceptionDetails?.text || 'Runtime exception'); save() } })
    for (const domain of ['Runtime', 'Page', 'Network']) await cdp.send(domain + '.enable')
    await until(() => evaluate("Boolean(document.querySelector('.workspace-sidebar'))"), 'Actual installed application shell did not initialize')
    const diagnostics = await evaluate('window.electronAPI.appDiagnostics()')
    assert.equal(diagnostics.version, VERSION); assert.equal(diagnostics.packaged, true)
    report.app = { ...appIdentity, version: diagnostics.version, packaged: diagnostics.packaged }
    const backend = await api('/api/diagnostics'); assert.ok(samePath(backend.data_dir, data), 'Additional process must use its isolated synthetic data')
    report.backendDataVerified = true; save()
    if (group === 'local-sync-lab') {
      // Only this separate job prepares typed local conflict/history inputs.
      // Both app lifetimes use this newly installed, hash-verified executable.
      activeLabBackend = await identifyLabBackend()
      const files = await prepareLocalSyncLabNotes({ api })
      assert.equal(files.length, 21)
      report.localSyncLabLifecycle = { schemaVersion: 1, complete: false,
        bootstrap: { pid: report.pid, app: structuredClone(report.app), dataDir: data, profile, backendDataVerified: report.backendDataVerified,
          backendProcess: structuredClone(activeLabBackend), noteCount: files.length } }
      await closeNormally()
      assert.equal(app, null); assert.equal(cdp, null); assert.equal(report.backendStopped, true)
      assert.deepEqual({ code: report.exit.code, signal: report.exit.signal, nativeClose: report.exit.nativeClose }, { code: 0, signal: null, nativeClose: true })
      await freePort(27121)
      const bootstrapClosed = { appExit: structuredClone(report.exit), backendStopped: true, portClosed: true,
        backendProcess: structuredClone(activeLabBackend), backendProcessExited: true }
      report.localSyncLabLifecycle.bootstrap.closed = bootstrapClosed; save()
      report.localSyncLabSeed = seedLocalSyncLab({ dataDir: data, ownedRoot: scratch, bootstrapClosed, files })
      assert.deepEqual(snapshotLocalSyncLab({ dataDir: data, ownedRoot: scratch }), report.localSyncLabSeed.after)
      report.localSyncLabLifecycle.seededWhileStopped = true
      assert.deepEqual(snapshot(defaultData), defaultBefore)
      for (const [key, filename] of [['executableSHA256', executablePath], ['asarSHA256', path.join(installDirectory, 'resources/app.asar')], ['backendSHA256', path.join(installDirectory, 'resources/bin/notepad-server.exe')]]) {
        assert.equal(sha(readFileSync(filename)), appIdentity[key], 'Local lab cannot replace the accepted installed binary')
      }
      // The previous close is proven complete. This flag belongs to the new
      // process lifetime; an uncertain prior close is never replayed.
      closeRequested = false; report.backendStopped = false; delete report.exit
      const labPort = await freePort()
      app = spawn(executablePath, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${labPort}`],
        { cwd: installDirectory, env: { ...cleanEnvironment, NOTEPAD_DATA: data, PORT: '27121' }, stdio: ['ignore', 'pipe', 'pipe'] })
      exited = new Promise((resolve, reject) => { app.once('error', reject); app.once('exit', (code, signal) => resolve({ code, signal })) }); exited.catch(() => {})
      for (const stream of [app.stdout, app.stderr]) { stream.on('data', traceData); stream.on('error', traceData) }
      report.pid = app.pid; assert.ok(Number.isSafeInteger(report.pid) && report.pid > 0)
      const labPage = await until(async () => {
        assert.equal(app.exitCode, null, 'Seeded installed application exited before readiness')
        try {
          const response = await fetch(`http://127.0.0.1:${labPort}/json/list`, { signal: AbortSignal.timeout(800) })
          const matches = (await response.json()).filter(item => item.type === 'page' && item.url.startsWith('file:') && item.url.includes('index.html'))
          return matches.length === 1 && matches[0]
        } catch { return false }
      }, 'Seeded installed renderer did not become available')
      cdp = await connect(labPage.webSocketDebuggerUrl)
      cdp.onEvent(event => { if (event.method === 'Runtime.exceptionThrown') { report.runtimeErrors.push(event.params.exceptionDetails?.text || 'Runtime exception'); save() } })
      for (const domain of ['Runtime', 'Page', 'Network']) await cdp.send(domain + '.enable')
      await until(() => evaluate("Boolean(document.querySelector('.workspace-sidebar'))"), 'Seeded installed application shell did not initialize')
      const labDiagnostics = await evaluate('window.electronAPI.appDiagnostics()')
      assert.equal(labDiagnostics.version, VERSION); assert.equal(labDiagnostics.packaged, true)
      const labBackend = await api('/api/diagnostics'); assert.ok(samePath(labBackend.data_dir, data), 'Seeded process left its isolated synthetic data')
      activeLabBackend = await identifyLabBackend()
      report.localSyncLabLifecycle.restarted = { pid: report.pid, app: structuredClone(report.app), dataDir: data, profile, backendDataVerified: true,
        backendProcess: structuredClone(activeLabBackend) }
      save()
    }
    const verifyDesktop = group === 'local-sync-lab' ? verifyLocalSyncLabDesktop : verifyFullAppUiDesktop
    await verifyDesktop({ evaluate, click, cdp, until, api, readAsset, writeFixtureFile, capture, resize, report, save, group,
      processID: report.pid, applicationIdentity: report.app })
    await verifyFullAppUiFiles(report.fullAppUi, out, ledger)
    assert.deepEqual(report.runtimeErrors, [])
    await closeNormally()
    if (group === 'local-sync-lab') {
      assert.equal(report.backendStopped, true)
      const logicalAfter = snapshotLocalSyncLab({ dataDir: data, ownedRoot: scratch })
      report.localSyncLabLifecycle.after = logicalAfter
      assert.deepEqual(logicalAfter, report.localSyncLabSeed.after, 'Actual local lab page observations changed protected logical database, uploads or remote absence')
      report.localSyncLabLifecycle.logicalUnchanged = true
      report.localSyncLabLifecycle.finalExit = structuredClone(report.exit)
      report.localSyncLabLifecycle.complete = true; save()
    }
    await uninstall()
  } catch (error) {
    failure = error; report.error = String(error?.stack || error); report.complete = false; save()
    if (cdp) await capture('full-app-ui-failed.png').catch(() => {})
  } finally {
    if (app && app.exitCode === null && !closeRequested && cdp && windowSession) {
      try { await closeNormally() } catch (error) { report.cleanupError = 'Normal cleanup close failed: ' + String(error.message) }
    }
    if (app && app.exitCode === null && Number.isSafeInteger(app.pid)) {
      report.forceTerminated = true; report.complete = false
      spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { timeout: 10000, stdio: 'ignore' })
      await Promise.race([exited.catch(() => {}), sleep(3000)])
    }
    cdp?.close()
    for (const [name, session] of [['windowHelper', windowSession]]) if (session) {
      try { report[name].stoppedCleanly = await session.dispose(); if (!report[name].stoppedCleanly) report.cleanupError ??= name + ' did not close cleanly' }
      catch (error) { report.cleanupError ??= String(error.message) }
    }
    if (!uninstalled && liveCommands.size === 0 && existsSync(path.join(installDirectory, 'Uninstall 记事本.exe')) && (!app || app.exitCode !== null)) {
      try { await uninstall() } catch (error) { report.cleanupError ??= 'Owned uninstall failed: ' + String(error.message) }
    }
    try {
      const after = snapshot(defaultData); report.dataIsolation.defaultAfter = after
      assert.deepEqual(after, defaultBefore, 'This matrix runner own default data changed during isolated application acceptance')
      assert.deepEqual(readFileSync(originalInstallationReport), originalBytes); assert.deepEqual(readFileSync(acceptedFile), acceptedBytes)
      retainedFiles.forEach((file, index) => assert.deepEqual(readFileSync(file), retainedBytes[index]))
      verifyUiScreensFiles(threeReport.uiScreens, threeDirectory)
      verifyInstaller(readFileSync(installerPath), pin.current)
      verifyFixtureFiles()
      report.originalThreePages.reportsUnchanged = true
      report.dataIsolation.defaultUnchanged = true; report.originalInstallation.reportsUnchanged = true
    } catch (error) { report.cleanupError ??= String(error.message) }
    report.cleanupComplete = uninstalled && liveCommands.size === 0 && !report.forceTerminated && !report.cleanupError && report.dataIsolation.defaultUnchanged
      && report.windowHelper.stoppedCleanly === true && report.backendStopped === true
    if (report.cleanupComplete && !failure) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    report.finishedAt = new Date().toISOString(); writeFileSync(path.join(out, 'full-app-ui-runtime.log'), trace); save()
  }
  if (failure) throw failure
  assert.equal(report.cleanupComplete, true, report.cleanupError || 'Additional installed UI cleanup is incomplete')
  assert.equal(report.forceTerminated, false); assert.deepEqual(report.runtimeErrors, [])
  assert.equal(report.commands.length, 2); assert.deepEqual(report.commands.map(item => item.label), ['additional-ui-install', 'additional-ui-uninstall'])
  assert.ok(report.commands.every(item => item.code === 0 && item.signal === null && item.timedOut === false))
  await verifyFullAppUiFiles(report.fullAppUi, out, ledger)
  report.complete = true; save()
  validateFullAppInstalledReport(report, ledger)
  writeFileSync(path.join(out, 'full-app-ui-installed-accepted.json'), JSON.stringify({ complete: true,
    productCommit: pin.product, productTree: sources.productTree, verifierCommit: process.env.GITHUB_SHA, currentInstaller: pin.current,
    sameOriginallyAcceptedInstalledBytes: true, originalLifecyclePreserved: true,
    scope: report.scope, group, scenes: report.fullAppUi.scenes.map(scene => [scene.routeId, scene.stateId, scene.theme, scene.viewport]), report: fingerprint(reportPath),
    originalThreePages: report.originalThreePages, ledger: report.ledger, runner: report.runner,
    originalInstallation: report.originalInstallation, sourceFiles: report.sourceFiles,
    normalNativeExit: true, cleanupComplete: true, defaultDataUnchanged: true }, null, 2) + '\n', { flag: 'wx' })
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Only the declared group may be supplied; executable and pin overrides are refused')
  assert.ok(FULL_APP_GROUPS.includes(process.argv[2]))
  try {
    const report = await runFullAppUiInstalled({ group: process.argv[2] })
    console.log(JSON.stringify({ complete: report.complete, group: report.group, scenes: report.fullAppUi.scenes.length, cleanupComplete: report.cleanupComplete }))
  } catch (error) { console.error(error); process.exitCode = 1 }
}
