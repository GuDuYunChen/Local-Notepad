import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, lstatSync, copyFileSync, realpathSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { assertHostedWindows, nsisArgs, requireOwnedPath, verifyInstaller } from './installer-lifecycle-core.mjs'
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { selectDesktopMainWindow, assertDesktopWindowImage } from './desktop-window-target.mjs'
import { DRAFT_REPORT, DRAFT_SOURCES, draftHash, draftBlob, verifyDraftDurabilityReport } from './draft-durability-desktop-evidence.mjs'
import { verifyDraftDurabilityDesktop } from './draft-durability-desktop-driver.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const alive = child => Boolean(child && child.exitCode === null && child.signalCode === null)
export async function draftUntil(check, label, budget = 15000) {
  const deadline = performance.now() + budget
  while (performance.now() < deadline) { const value = await check(); if (value) return value; await sleep(100) }
  throw new Error(label)
}
async function freePort(port = 0) {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const actual = server.address().port
  await new Promise(resolve => server.close(resolve))
  return actual
}
async function deadline(promise, ms, message) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })]) }
  finally { clearTimeout(timer) }
}
async function connect(url, trace) {
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'ws:'); assert.equal(parsed.hostname, '127.0.0.1')
  const ws = new WebSocket(url), pending = new Map(), listeners = new Set(); let sequence = 0
  await deadline(new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true })
  }), 10000, 'Debugger connect deadline')
  ws.addEventListener('close', () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Debugger closed')) }
    pending.clear()
  })
  ws.addEventListener('message', event => {
    const value = JSON.parse(event.data)
    if (value.method) {
      if (value.method === 'Runtime.exceptionThrown') trace(JSON.stringify(value))
      for (const listener of listeners) listener(value)
    }
    const task = pending.get(value.id)
    if (task) { pending.delete(value.id); clearTimeout(task.timer); value.error ? task.reject(new Error(JSON.stringify(value.error))) : task.resolve(value.result) }
  })
  return { close: () => ws.close(), onEvent: listener => listeners.add(listener), send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Debugger deadline: ' + method)) }, 15000)
      pending.set(id, { resolve, reject, timer })
      try { ws.send(JSON.stringify({ id, method, params })) } catch (error) { clearTimeout(timer); pending.delete(id); reject(error) }
    })
  } }
}
// Snapshot only owned storage after every application process has stopped.
// Reparse points and links are refused, including at the root itself.
export function draftStorageSnapshot(directories) {
  const result = {}
  const visit = (directory, relative) => {
    assert.equal(lstatSync(directory).isSymbolicLink(), false, 'Storage link refused')
    for (const entry of readdirSync(directory).sort()) {
      const file = path.join(directory, entry), name = relative + '/' + entry, stat = lstatSync(file)
      assert.equal(stat.isSymbolicLink(), false, 'Storage link refused')
      if (stat.isDirectory()) visit(file, name)
      else { assert.equal(stat.isFile(), true); result[name] = { bytes: stat.size, sha256: draftHash(readFileSync(file)) } }
    }
  }
  for (const [name, directory] of Object.entries(directories).sort(([a], [b]) => a.localeCompare(b))) {
    assert.ok(existsSync(directory), 'Expected real storage missing: ' + name); visit(directory, name)
  }
  assert.ok(Object.keys(result).length > 0, 'An empty snapshot is not retention evidence')
  return result
}
export async function runDraftDurabilityDesktop({ development = false } = {}) {
  if (development) { assert.equal(process.platform, 'linux'); assert.notEqual(process.env.GITHUB_ACTIONS, 'true') }
  else assertHostedWindows(process.env, process.platform)
  const pin = JSON.parse(readFileSync(path.join(root, 'scripts/reading-mode-installer-pin.json'), 'utf8'))
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
  assert.equal(version, '4.237.0')
  if (!development) assert.equal(pin.current.version, version)
  const scratch = realpathSync.native(mkdtempSync(path.join(development ? tmpdir() : process.env.RUNNER_TEMP, 'draft104-')))
  const out = path.join(root, 'test-results/installer-lifecycle/draft-durability' + (development ? '-development' : ''))
  mkdirSync(out, { recursive: true })
  assert.equal(existsSync(path.join(out, DRAFT_REPORT)), false, 'Refusing to overwrite prior evidence')
  const roaming = path.join(homedir(), 'AppData', 'Roaming')
  const candidates = development ? [] : ['Notepad', 'notepad-desktop', '记事本'].map(name => path.join(roaming, name))
  for (const directory of candidates) assert.equal(existsSync(directory), false, 'Refusing preexisting user storage: ' + directory)
  const data = development ? path.join(scratch, 'data') : path.join(roaming, 'Notepad')
  const profile = path.join(scratch, 'browser-profile'), install = path.join(scratch, '中文 草稿安装')
  const installer = path.join(root, '.installer-input/current/Notepad-' + version + '-Setup.exe')
  const executable = development ? '/usr/bin/chromium' : path.join(install, '记事本.exe')
  const sourceFiles = Object.fromEntries(DRAFT_SOURCES.map(name => [name, draftBlob(readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n'))]))
  if (!development) assert.deepEqual(sourceFiles, pin.draftSourceFiles, 'Draft verifier source differs from the reviewed binary-bound pin')
  const report = {
    schemaVersion: 1, module: '2F.104', version, platform: process.platform,
    scope: development ? 'browser-development-only' : 'installed-default-profile',
    runnerEnvironment: development ? 'local-development' : process.env.RUNNER_ENVIRONMENT,
    productCommit: development ? '8cefe847a01cbcf71d661d348103e57dd3bfecee' : pin.product,
    verifierCommit: development ? '8cefe847a01cbcf71d661d348103e57dd3bfecee' : process.env.GITHUB_SHA,
    sourceFiles, syntheticData: true, realBackend: true, bridgeOverridden: false, timerAccelerated: false,
    nativeAcceptance: !development, defaultProfile: false, complete: false, cleanupComplete: false,
    forcedFailureCleanup: false, cases: [], crashes: [], launches: [], screenshots: [], retention: [], installationCommands: [],
    startedAt: new Date().toISOString(),
  }
  const save = () => writeFileSync(path.join(out, DRAFT_REPORT), JSON.stringify(report, null, 2) + '\n')
  let trace = '', app, backend, vite, cdp, windowSession, storageProfile, installationStarted = false
  const requests = []
  const traceData = value => { trace = (trace + String(value)).slice(-300000) }
  const env = { ...process.env }
  for (const name of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|ELECTRON_RUN_AS_NODE|^NOTEPAD_DATA$|^PORT$/.test(name)) delete env[name]
  if (development) Object.assign(env, { NOTEPAD_DATA: data, PORT: '27121' })
  const own = (command, args, options = {}) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], ...options })
    child.stdout?.on('data', traceData); child.stderr?.on('data', traceData)
    child.finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
    child.finished.catch(() => {})
    return child
  }
  const until = draftUntil
  const api = async (route, options = {}) => {
    const response = await fetch('http://127.0.0.1:27121' + route, { ...options, headers: { Origin: 'null', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000) })
    assert.equal(response.status, 200); const payload = await response.json(); assert.equal(payload.code, 0, JSON.stringify(payload)); return payload.data
  }
  const stopped = () => until(async () => {
    try { await fetch('http://127.0.0.1:27121/api/health', { signal: AbortSignal.timeout(500) }); return false } catch { return true }
  }, 'Owned backend remained alive after application exit', 10000)
  const evaluate = async expression => {
    const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(value.exceptionDetails, undefined, JSON.stringify(value.exceptionDetails)); return value.result?.value
  }
  const click = async request => {
    if (typeof request === 'string') request = { selector: request }
    const point = await until(() => evaluate(`(()=>{const r=${JSON.stringify(request)};const all=[...document.querySelectorAll(r.selector)].filter(n=>!n.disabled&&(r.text===undefined||n.textContent.trim()===r.text||n.getAttribute('aria-label')===r.text)&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);if(all.length!==1)return null;const n=all[0];n.scrollIntoView({block:'center'});const b=n.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);return hit&&n.contains(hit)?{x,y}:null})()`), 'Control missing, ambiguous or occluded: ' + JSON.stringify(request))
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
  }
  const capture = async filename => {
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    writeFileSync(path.join(out, filename), bytes, { flag: 'wx' })
    report.screenshots.push({ filename, bytes: bytes.length, sha256: draftHash(bytes) }); save()
  }
  const runCommand = async (command, args, label, collect = true) => {
    const child = own(command, args, { windowsVerbatimArguments: true }), started = performance.now()
    let receipt, timedOut = false
    try { receipt = await deadline(child.finished, 120000, 'Installer command deadline: ' + label) }
    catch (error) { timedOut = true; if (alive(child)) child.kill(); throw error }
    finally {
      if (collect) report.installationCommands.push({ operation: label, pid: child.pid, ...receipt, timedOut, elapsedMs: performance.now() - started })
      save()
    }
    assert.deepEqual(receipt, { code: 0, signal: null }, label)
    return receipt
  }
  const installCurrent = async label => {
    assert.equal(development, false); requireOwnedPath(scratch, install)
    verifyInstaller(readFileSync(installer), pin.current)
    installationStarted = true
    await runCommand(installer, nsisArgs(scratch, install), label)
    assert.ok(existsSync(executable), 'Installed application executable missing')
  }
  const uninstallCurrent = async label => {
    const names = readdirSync(install).filter(name => /^Uninstall.*\.exe$/i.test(name))
    assert.equal(names.length, 1, 'Uninstaller is missing or ambiguous')
    const source = path.join(install, names[0]), copy = path.join(scratch, label + '-uninstall.exe')
    requireOwnedPath(scratch, copy); copyFileSync(source, copy)
    assert.equal(draftHash(readFileSync(copy)), draftHash(readFileSync(source)))
    await runCommand(copy, nsisArgs(scratch, install, true), label)
    assert.equal(existsSync(executable), false, 'Uninstaller did not remove the application')
  }
  const windowIdentity = async () => {
    assert.ok(alive(app), 'Application exited before native identity verification')
    const target = selectDesktopMainWindow(await windowSession.inspect(app.pid, executable), app.pid, await evaluate('document.title'))
    assertDesktopWindowImage(target, executable); return target
  }
  const start = async () => {
    assert.equal(alive(app), false, 'Previous application still running')
    if (!development) await freePort(27121)
    const port = await freePort()
    const args = development ? ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--window-size=1280,900', '--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port, 'http://127.0.0.1:5000'] : ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port]
    app = own(executable, args, { cwd: development ? root : install, detached: development })
    const pid = app.pid; assert.ok(Number.isInteger(pid) && pid > 0)
    report.launches.push({ pid, startedAt: new Date().toISOString() }); save()
    const page = await until(async () => {
      assert.ok(alive(app), 'Application exited before its renderer became ready')
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) })).json()
        const matches = pages.filter(value => value.type === 'page' && (development ? value.url.startsWith('http://127.0.0.1:5000') : value.url.startsWith('file:')))
        return matches.length === 1 && matches[0]
      } catch { return false }
    }, 'Application renderer not ready', 30000)
    cdp = await connect(page.webSocketDebuggerUrl, traceData)
    cdp.onEvent(event => { if (event.method === 'Network.requestWillBeSent') requests.push({ method: event.params.request.method, url: event.params.request.url }) })
    for (const domain of ['Runtime', 'Page', 'Network']) await cdp.send(domain + '.enable')
    await until(() => evaluate("Boolean(document.querySelector('.workspace-sidebar'))"), 'Application shell not ready', 30000)
    assert.equal(path.resolve((await api('/api/diagnostics')).data_dir), path.resolve(data))
    if (!development) {
      const diagnostics = await evaluate('window.electronAPI.appDiagnostics()')
      assert.equal(diagnostics.version, version); assert.equal(diagnostics.packaged, true)
      report.app = { version: diagnostics.version, packaged: diagnostics.packaged }
      const identities = { executableSHA256: draftHash(readFileSync(executable)), asarSHA256: draftHash(readFileSync(path.join(install, 'resources/app.asar'))), backendSHA256: draftHash(readFileSync(path.join(install, 'resources/bin/notepad-server.exe'))) }
      for (const [key, value] of Object.entries(identities)) { if (report[key]) assert.equal(report[key], value); report[key] = value }
      if (!windowSession) { windowSession = createDesktopWindowSession(); await windowSession.ready }
      await windowIdentity()
    }
    save()
  }
  const crash = async () => {
    assert.ok(alive(app)); const pid = app.pid
    if (development) {
      // Kill only this verifier's detached browser process group, not the host.
      assert.ok(app.spawnargs.includes('--user-data-dir=' + profile)); process.kill(-pid, 'SIGKILL')
    } else {
      await windowIdentity()
      await runCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 'expected-owned-process-crash', false)
    }
    const receipt = await deadline(app.finished, 15000, 'Expected process crash did not exit')
    cdp?.close(); cdp = null; app = null
    if (!development) await stopped()
    report.crashes.push({ pid, ...receipt, expected: true, exited: true, identityVerified: true, method: development ? 'development-browser-process-group' : 'owned-taskkill-tree' }); save()
    return pid
  }
  const reinstallWithRetainedDraft = async () => {
    if (development) return // Browser preflight never claims to execute an installer.
    assert.equal(alive(app), false)
    const profiles = candidates.filter(directory => existsSync(path.join(directory, 'IndexedDB')))
    assert.equal(profiles.length, 1, 'Actual default Chromium profile is missing or ambiguous')
    storageProfile = profiles[0]; report.defaultProfile = true; report.profileBasename = path.basename(storageProfile)
    const directories = { backend: data, indexedDB: path.join(storageProfile, 'IndexedDB'), localStorage: path.join(storageProfile, 'Local Storage') }
    const before = draftStorageSnapshot(directories)
    for (const operation of ['same-version-install', 'uninstall', 'reinstall']) {
      if (operation === 'uninstall') await uninstallCurrent(operation)
      else await installCurrent(operation)
      const after = draftStorageSnapshot(directories)
      assert.deepEqual(after, before, 'Installation lifecycle changed unsaved persistent draft or database: ' + operation)
      report.retention.push({ operation, equal: true, files: Object.keys(after).length, digest: draftHash(JSON.stringify(after)) }); save()
    }
  }
  const closeNormally = async () => {
    const pid = app.pid
    if (development) await cdp.send('Browser.close').catch(() => {})
    else await windowSession.close(await windowIdentity())
    const receipt = await deadline(app.finished, 15000, 'Normal close deadline')
    assert.deepEqual(receipt, { code: 0, signal: null })
    report.exit = { pid, ...receipt, normal: true }; app = null; cdp?.close(); cdp = null
    if (!development) { await stopped(); report.backendStopped = true }
    save()
  }
  const stopDevelopmentChild = async child => {
    if (!alive(child)) return
    process.kill(-child.pid, 'SIGTERM')
    await deadline(child.finished, 10000, 'Development helper did not stop')
  }
  save()
  try {
    await freePort(27121)
    if (development) {
      backend = own(path.join(root, 'server/bin/notepad-draft-dev'), [], { detached: true })
      await until(async () => { try { await api('/api/health'); return true } catch { return false } }, 'Development backend not ready')
      await freePort(5000)
      vite = own(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { detached: true })
      await until(async () => { try { return (await fetch('http://127.0.0.1:5000', { signal: AbortSignal.timeout(800) })).ok } catch { return false } }, 'Development frontend not ready', 30000)
    } else await installCurrent('initial-install')
    await verifyDraftDurabilityDesktop({ api, evaluate, click, until, capture, report, save, cdp: () => cdp,
      start, pid: () => app.pid, crash, reinstallWithRetainedDraft, closeNormally,
      requestCount: () => requests.length, bodyWritesSince: (index, id) => requests.slice(index).filter(request => request.method === 'PUT' && new URL(request.url).pathname === '/api/files/' + encodeURIComponent(id)).length,
    })
    if (!development) await uninstallCurrent('final-uninstall')
    report.complete = true
  } catch (error) {
    report.error = { message: error.message, stack: error.stack }
    if (cdp) await capture('draft104-failure.png').catch(() => {})
    throw error
  } finally {
    cdp?.close()
    if (alive(app)) {
      report.forcedFailureCleanup = true
      try {
        if (development) process.kill(-app.pid, 'SIGKILL')
        else await runCommand('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], 'failed-owned-process-cleanup', false)
        await deadline(app.finished, 15000, 'Failed owned process did not stop')
      } catch (error) { report.cleanupError = error.message }
    }
    if (windowSession) await windowSession.dispose().then(clean => { if (!clean) report.cleanupError = 'Native window helper did not exit cleanly' }, error => { report.cleanupError = error.message })
    for (const child of [vite, backend]) {
      try { await stopDevelopmentChild(child) } catch (error) { report.cleanupError = error.message; if (alive(child)) { report.forcedFailureCleanup = true; try { process.kill(-child.pid, 'SIGKILL') } catch {} } }
    }
    if (development) { try { await stopped(); report.backendStopped = true } catch (error) { report.cleanupError = error.message } }
    if (!development && installationStarted && !report.complete && existsSync(executable)) {
      try { await uninstallCurrent('failure-uninstall') } catch (error) { report.cleanupError = error.message }
    }
    // All these exact default locations were absent before the first launch.
    // Never delete a symlink, a previously existing location or unrelated data.
    if (!development && !report.cleanupError) {
      for (const directory of candidates) if (existsSync(directory)) {
        assert.equal(lstatSync(directory).isSymbolicLink(), false)
        assert.equal(path.dirname(realpathSync.native(directory)).toLowerCase(), realpathSync.native(roaming).toLowerCase())
        rmSync(directory, { recursive: true })
      }
      report.storageDirectoriesRemoved = candidates.every(directory => !existsSync(directory))
    }
    writeFileSync(path.join(out, 'draft-runtime.log'), trace)
    report.cleanupComplete = !report.forcedFailureCleanup && !report.cleanupError && (development || report.storageDirectoriesRemoved === true)
    report.completedAt = new Date().toISOString(); save()
    if (report.cleanupComplete) rmSync(scratch, { recursive: true, force: true })
  }
  verifyDraftDurabilityReport(out, { product: report.productCommit, verifier: report.verifierCommit, sources: sourceFiles, native: !development })
  return report
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const development = process.argv.length === 3 && process.argv[2] === '--development'
  assert.ok(process.argv.length === 2 || development, 'No arbitrary paths or hosts accepted')
  runDraftDurabilityDesktop({ development }).then(report => console.log(JSON.stringify({ complete: report.complete, scope: report.scope, cases: report.cases.length, cleanupComplete: report.cleanupComplete }))).catch(error => { console.error(error); process.exitCode = 1 })
}
