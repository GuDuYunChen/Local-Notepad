// Additional verifier-owned acceptance only. Run AFTER the unchanged complete
// installation lifecycle. Never substitutes for its six exits or retained data.
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
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { selectDesktopMainWindow, assertDesktopWindowImage } from './desktop-window-target.mjs'
import { createExportDirectorySession } from './local-export-directory-session.mjs'
import { verifyUiScreensDesktop } from './check-ui-screens-desktop.mjs'
import { UI_INSTALLED_REGISTRATION_QUERY, validateUiInstalledRegistration, verifyUiScreensFiles } from './ui-screens-evidence.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const VERSION = '4.249.0'
const API_BASE = 'http://127.0.0.1:27121'
const REPORT = 'ui-screens-installed.json'
const PRODUCT_SOURCE_FILE = 'scripts/ui-screens-product-sources.json'
export const UI_SCREENS_PRODUCT_SOURCES = Object.freeze([
  'scripts/native-ui-select.mjs', 'scripts/check-ui-control-render.cjs',
  'scripts/desktop-save-fixture.mjs', 'scripts/desktop-window-session.mjs',
  'scripts/desktop-window-target.mjs', 'scripts/desktop-window-worker.ps1',
  'scripts/local-export-directory-session.mjs', 'scripts/local-export-directory-worker.ps1',
  'scripts/installer-lifecycle-core.mjs',
])
export const UI_SCREENS_VERIFIER_SOURCES = Object.freeze([
  'scripts/run-ui-screens-installed.mjs', 'scripts/check-ui-screens-desktop.mjs',
  'scripts/ui-screens-evidence.mjs', 'scripts/ui-screens-evidence.node.mjs', PRODUCT_SOURCE_FILE,
])
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const blob = bytes => createHash('sha1').update('blob ' + Buffer.byteLength(bytes) + '\0').update(bytes).digest('hex')
const readJSON = filename => JSON.parse(readFileSync(filename, 'utf8'))
const canonical = filename => readFileSync(filename, 'utf8').replace(/\r\n/g, '\n')
const samePath = (a, b) => path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase()
const fingerprint = filename => ({ filename: path.basename(filename), bytes: lstatSync(filename).size, sha256: sha(readFileSync(filename)) })
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim()

export function validateUiScreensOriginalInstallation({ pin, original, accepted, sourceProof, currentApplication }) {
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

function sourceIdentity(pin, sourceProof) {
  assert.equal(git('rev-parse', '--verify', 'HEAD'), process.env.GITHUB_SHA)
  const supplement = readJSON(path.join(ROOT, PRODUCT_SOURCE_FILE))
  assert.equal(supplement.schemaVersion, 1); assert.equal(supplement.productCommit, pin.product)
  assert.deepEqual(Object.keys(supplement.sourceFiles).sort(), [...UI_SCREENS_PRODUCT_SOURCES].sort())
  const originalCore = 'scripts/installer-lifecycle-core.mjs'
  for (const file of UI_SCREENS_PRODUCT_SOURCES) {
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
  const verifier = Object.fromEntries(UI_SCREENS_VERIFIER_SOURCES.map(file => {
    const expected = git('rev-parse', process.env.GITHUB_SHA + ':' + file)
    assert.equal(blob(canonical(path.join(ROOT, file))), expected, 'Verifier-owned source changed after checkout: ' + file)
    return [file, expected]
  }))
  return { productCommit: pin.product, product: supplement.sourceFiles, verifierCommit: process.env.GITHUB_SHA,
    verifier, generatedLifecycleCore: sourceProof.preparedCore }
}

function snapshot(directory) {
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
  walk(directory); assert.ok(entries.some(entry => entry.path === 'data.db'), 'Original retained synthetic database is missing')
  return { files: entries.length, bytes: totalBytes, sha256: sha(JSON.stringify(entries)) }
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
    const timer = setTimeout(() => { socket.close(); reject(Error('UI screenshots debugger connect deadline')) }, 10000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('UI screenshots debugger connect failed')) }, { once: true })
  })
  const fail = error => { fatal ??= error; for (const task of pending.values()) { clearTimeout(task.timer); task.reject(fatal) }; pending.clear() }
  socket.addEventListener('close', () => fail(Error('UI screenshots debugger closed')))
  socket.addEventListener('error', () => fail(Error('UI screenshots debugger failed')))
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
        const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('UI screenshots debugger command deadline: ' + method)) }, 15000)
        pending.set(id, { resolve, reject, timer })
        try { socket.send(JSON.stringify({ id, method, params })) } catch (error) { pending.delete(id); clearTimeout(timer); reject(error) }
      })
    } }
}

export async function runUiScreensInstalled({ pin, installerPath, originalInstallationReport,
  out = path.join(ROOT, 'test-results/installer-lifecycle/ui-screens-installed'), ownedRoot = process.env.RUNNER_TEMP } = {}) {
  assertHostedWindows(process.env, process.platform)
  pin ??= readJSON(path.join(ROOT, 'scripts/reading-mode-installer-pin.json'))
  installerPath ??= path.join(ROOT, '.installer-input/current/Notepad-' + VERSION + '-Setup.exe')
  originalInstallationReport ??= path.join(ROOT, 'test-results/installer-lifecycle/installation.json')
  const originalDirectory = path.dirname(originalInstallationReport)
  const acceptedFile = path.join(originalDirectory, 'reading-mode-installation-accepted.json')
  const sourceProofFile = path.join(originalDirectory, 'local-import-verifier-source.json')
  const originalBytes = readFileSync(originalInstallationReport), original = JSON.parse(originalBytes)
  const acceptedBytes = readFileSync(acceptedFile), accepted = JSON.parse(acceptedBytes)
  const sourceProof = readJSON(sourceProofFile), originalApplication = original.localExportRun?.application
  validateUiScreensOriginalInstallation({ pin, original, accepted, sourceProof, currentApplication: originalApplication })
  const sources = sourceIdentity(pin, sourceProof)
  assert.equal(path.basename(installerPath), 'Notepad-' + VERSION + '-Setup.exe')
  verifyInstaller(readFileSync(installerPath), pin.current)
  assert.equal(existsSync(out), false, 'Do not overwrite a previous screenshot acceptance attempt')
  const defaultData = path.join(homedir(), 'AppData/Roaming/Notepad'), defaultBefore = snapshot(defaultData)
  const scratch = realpathSync.native(mkdtempSync(path.join(realpathSync.native(ownedRoot), 'ui-screens-installed-')))
  const installDirectory = requireOwnedPath(scratch, path.join(scratch, 'UI screenshot application'))
  const data = requireOwnedPath(scratch, path.join(scratch, 'data')), profile = requireOwnedPath(scratch, path.join(scratch, 'profile'))
  const executablePath = path.join(installDirectory, '记事本.exe')
  assert.equal(samePath(data, defaultData), false)
  mkdirSync(data); mkdirSync(out, { recursive: true })
  const report = { schemaVersion: 1, module: '2F.116', scope: 'installed-ui-screens', version: VERSION,
    productCommit: pin.product, verifierCommit: process.env.GITHUB_SHA, platform: process.platform,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT, syntheticData: true, realBackend: true,
    bridgeOverridden: false, timerAccelerated: false, emulatedViewport: false, forceTerminated: false,
    complete: false, cleanupComplete: false, startedAt: new Date().toISOString(), sourceFiles: sources,
    installer: pin.current, originalInstallation: { report: fingerprint(originalInstallationReport),
      accepted: fingerprint(acceptedFile), sourceProof: fingerprint(sourceProofFile), allOriginalGatesPassed: true,
      checks: original.checks, application: originalApplication },
    dataIsolation: { ownedRoot: scratch, data, profile, defaultData, defaultBefore, defaultUnchanged: false },
    checks: [], screenshots: [], windowSizes: [], commands: [], runtimeErrors: [],
    windowHelper: { events: [] }, directoryHelper: { events: [] } }
  const reportPath = path.join(out, REPORT)
  let app, exited, cdp, windowSession, directorySession, trace = '', closeRequested = false, narrowApplied = false, uninstalled = false
  const liveCommands = new Set()
  const save = () => {
    if (windowSession) report.windowHelper.lifecycle = windowSession.diagnostics()
    if (directorySession) report.directoryHelper.lifecycle = directorySession.diagnostics()
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  const cleanEnvironment = { ...process.env }
  for (const key of Object.keys(cleanEnvironment)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete cleanEnvironment[key]
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NOTEPAD_DATA', 'PORT']) delete cleanEnvironment[key]
  const traceData = value => { trace = (trace + String(value)).slice(-180000) }
  const command = async (file, args, { label, verbatim = false, timeout = 90000 } = {}) => {
    const started = performance.now(), child = spawn(file, args, { cwd: scratch, env: cleanEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: verbatim })
    liveCommands.add(child)
    let output = '', errors = '', timer, timedOut = false, terminal, recorded = false
    child.stdout.on('data', bytes => { output = (output + bytes).slice(-100000) }); child.stderr.on('data', bytes => { errors = (errors + bytes).slice(-100000) })
    child.stdout.on('error', traceData); child.stderr.on('error', traceData)
    const done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => { terminal = { code, signal }; liveCommands.delete(child); resolve(terminal) })
    })
    done.catch(() => {})
    try {
      const result = await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(Error('Owned UI screenshot command deadline')) }, timeout) })])
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
  const registrations = async () => JSON.parse(await ps(UI_INSTALLED_REGISTRATION_QUERY))
  const links = async () => JSON.parse(await ps("$links=@();foreach($folder in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))){$p=Join-Path $folder '记事本.lnk';if(Test-Path -LiteralPath $p){$links+=@{path=$p}}};ConvertTo-Json -InputObject @($links) -Compress"))
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result?.value
  }
  const api = async (route, options = {}) => {
    assert.match(route, /^\/api\//)
    const response = await fetch(API_BASE + route, { ...options, headers: { Origin: 'null', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000) })
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.code, 0, JSON.stringify(body)); return body.data
  }
  const click = async request => {
    if (typeof request === 'string') request = { selector: request }
    const point = await until(() => evaluate(`(()=>{const request=${JSON.stringify(request)};const nodes=[...document.querySelectorAll(request.selector)].filter(n=>!n.disabled&&(request.text===undefined||n.textContent.trim()===request.text||n.getAttribute('aria-label')===request.text)&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);if(nodes.length!==1)return null;const n=nodes[0];n.scrollIntoView({block:'center',behavior:'instant'});const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return hit&&(hit===n||n.contains(hit))?{x,y}:null})()`), 'UI screenshot control unavailable: ' + request.selector)
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
  const resize = async size => {
    assert.ok(['wide', 'narrow'].includes(size))
    const window = await mainWindow()
    if (size === 'wide') assert.equal(narrowApplied, false, 'All wide scenes must precede the native minimum-window action')
    else if (!narrowApplied) {
      report.minimumWindow = await directorySession.minimumWindow({ pid: report.pid, mainHandle: window.handle, executable: executablePath })
      narrowApplied = true
    }
    const observed = await until(async () => {
      const value = await evaluate('({width:innerWidth,height:innerHeight,devicePixelRatio})')
      return size === 'wide' ? value.width >= 1000 && value.height >= 600 && value : value.width === 704 && value.height === 455 && value
    }, 'Actual native ' + size + ' viewport did not settle')
    const viewport = { width: observed.width, height: observed.height }
    const result = { requested: size === 'narrow' ? { width: 704, height: 455 } : viewport,
      viewport, nativeWindow: true, devicePixelRatio: observed.devicePixelRatio,
      outerRequested: size === 'narrow' ? { width: 720, height: 520 } : { width: 1100, height: 720 } }
    report.windowSizes.push({ size, pid: report.pid, handle: window.handle, executable: executablePath,
      method: size === 'wide' ? 'actual-product-default-window' : 'source-bound-native-minimum-window', ...result })
    save(); return result
  }
  const closeNormally = async () => {
    if (!app || app.exitCode !== null) return
    assert.equal(closeRequested, false, 'An uncertain native close must never be replayed')
    const window = await mainWindow(); closeRequested = true
    await windowSession.close(window)
    const closeRequest = structuredClone(windowSession.events().at(-1)); let timer
    try {
      const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('UI screenshot normal close deadline')), 15000) })])
      assert.deepEqual(result, { code: 0, signal: null })
      report.exit = { pid: report.pid, ...result, nativeClose: true, window, closeRequest }
      app = null; cdp.close(); cdp = null
      await until(async () => { try { await freePort(27121); return true } catch { return false } }, 'UI screenshot backend remained alive', 5000)
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
    assert.deepEqual(await registrations(), [], 'Original lifecycle must finish uninstall before the additional check')
    assert.deepEqual(await links(), [], 'Original installed shortcuts remain')
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
    directorySession = createExportDirectorySession({ ownedRoot: scratch, onEvent: event => { report.directoryHelper.events.push(event); save() } })
    await Promise.all([windowSession.ready, directorySession.ready])
    const port = await freePort()
    app = spawn(executablePath, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
      { cwd: installDirectory, env: { ...cleanEnvironment, NOTEPAD_DATA: data, PORT: '27121' }, stdio: ['ignore', 'pipe', 'pipe'] })
    exited = new Promise((resolve, reject) => { app.once('error', reject); app.once('exit', (code, signal) => resolve({ code, signal })) }); exited.catch(() => {})
    for (const stream of [app.stdout, app.stderr]) { stream.on('data', traceData); stream.on('error', traceData) }
    report.pid = app.pid; assert.ok(Number.isSafeInteger(report.pid) && report.pid > 0)
    const oldPIDs = [...original.appExits.map(item => item.pid), ...original.shortcutManagementRun.processIDs,
      original.localExportRun.processID, original.blockReferenceRun.processID]
    assert.equal(oldPIDs.includes(report.pid), false, 'Additional process must not impersonate an original lifecycle exit')
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
    await verifyUiScreensDesktop({ evaluate, click, cdp, until, api, capture, resize, report, save,
      processID: report.pid, applicationIdentity: report.app })
    await verifyUiScreensFiles(report.uiScreens, out)
    assert.deepEqual(report.runtimeErrors, [])
    await closeNormally()
    await uninstall()
  } catch (error) {
    failure = error; report.error = String(error?.stack || error); report.complete = false; save()
    if (cdp) await capture('ui-screens-failed.png').catch(() => {})
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
    for (const [name, session] of [['directoryHelper', directorySession], ['windowHelper', windowSession]]) if (session) {
      try { report[name].stoppedCleanly = await session.dispose(); if (!report[name].stoppedCleanly) report.cleanupError ??= name + ' did not close cleanly' }
      catch (error) { report.cleanupError ??= String(error.message) }
    }
    if (!uninstalled && liveCommands.size === 0 && existsSync(path.join(installDirectory, 'Uninstall 记事本.exe')) && (!app || app.exitCode !== null)) {
      try { await uninstall() } catch (error) { report.cleanupError ??= 'Owned uninstall failed: ' + String(error.message) }
    }
    try {
      const after = snapshot(defaultData); report.dataIsolation.defaultAfter = after
      assert.deepEqual(after, defaultBefore, 'Original retained default data changed during additional UI acceptance')
      assert.deepEqual(readFileSync(originalInstallationReport), originalBytes); assert.deepEqual(readFileSync(acceptedFile), acceptedBytes)
      verifyInstaller(readFileSync(installerPath), pin.current)
      report.dataIsolation.defaultUnchanged = true; report.originalInstallation.reportsUnchanged = true
    } catch (error) { report.cleanupError ??= String(error.message) }
    report.cleanupComplete = uninstalled && liveCommands.size === 0 && !report.forceTerminated && !report.cleanupError && report.dataIsolation.defaultUnchanged
      && report.windowHelper.stoppedCleanly === true && report.directoryHelper.stoppedCleanly === true && report.backendStopped === true
    if (report.cleanupComplete && !failure) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    report.finishedAt = new Date().toISOString(); writeFileSync(path.join(out, 'ui-screens-runtime.log'), trace); save()
  }
  if (failure) throw failure
  assert.equal(report.cleanupComplete, true, report.cleanupError || 'Additional installed UI cleanup is incomplete')
  assert.equal(report.forceTerminated, false); assert.deepEqual(report.runtimeErrors, [])
  assert.equal(report.commands.length, 2); assert.deepEqual(report.commands.map(item => item.label), ['additional-ui-install', 'additional-ui-uninstall'])
  assert.ok(report.commands.every(item => item.code === 0 && item.signal === null && item.timedOut === false))
  await verifyUiScreensFiles(report.uiScreens, out)
  report.complete = true; save()
  writeFileSync(path.join(out, 'ui-screens-installed-accepted.json'), JSON.stringify({ complete: true,
    productCommit: pin.product, verifierCommit: process.env.GITHUB_SHA, currentInstaller: pin.current,
    sameOriginallyAcceptedInstalledBytes: true, originalLifecyclePreserved: true,
    scenes: report.uiScreens.scenes.map(scene => scene.name), report: fingerprint(reportPath),
    originalInstallation: report.originalInstallation, sourceFiles: report.sourceFiles,
    normalNativeExit: true, cleanupComplete: true, defaultDataUnchanged: true }, null, 2) + '\n', { flag: 'wx' })
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Use the source-bound actual CI paths; arbitrary executable overrides are refused')
  try {
    const report = await runUiScreensInstalled()
    console.log(JSON.stringify({ complete: report.complete, scenes: report.uiScreens.scenes.length, cleanupComplete: report.cleanupComplete }))
  } catch (error) { console.error(error); process.exitCode = 1 }
}
