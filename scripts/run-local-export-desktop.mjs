import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, cpSync, realpathSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { assertDesktopWindowImage, selectDesktopMainWindow } from './desktop-window-target.mjs'
import { createExportDirectorySession } from './local-export-directory-session.mjs'
import { verifyLocalExportDesktop, localExportDirectoryInventory } from './check-local-export-desktop.mjs'
import { LOCAL_EXPORT_VERSION, LOCAL_EXPORT_REPORT, LOCAL_EXPORT_CHECKS, LOCAL_EXPORT_SOURCES,
  exportSHA256 as hash, exportBlob as blob, verifyLocalExportDesktopReport } from './local-export-desktop-evidence.mjs'

const apiBase = 'http://127.0.0.1:27121'
async function freePort(port = 0) {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const actual = server.address().port; await new Promise(resolve => server.close(resolve)); return actual
}
async function until(check, label, budget = 15000) {
  const end = performance.now() + budget
  while (performance.now() < end) {
    const result = await check(); if (result) return result
    await sleep(100)
  }
  throw Error(label)
}
async function connect(url, onEvent) {
  const address = new URL(url); assert.equal(address.protocol, 'ws:'); assert.equal(address.hostname, '127.0.0.1')
  const ws = new WebSocket(url), pending = new Map(); let sequence = 0
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Export debugger connection deadline exceeded')), 10000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('Export debugger connection failed')) }, { once: true })
  })
  const disconnected = () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('Export debugger disconnected')) }; pending.clear() }
  ws.addEventListener('close', disconnected); ws.addEventListener('error', disconnected)
  ws.addEventListener('message', event => {
    const value = JSON.parse(String(event.data)); if (value.method) onEvent(value)
    const task = pending.get(value.id); if (!task) return
    pending.delete(value.id); clearTimeout(task.timer)
    if (value.error) task.reject(Error(JSON.stringify(value.error))); else task.resolve(value.result)
  })
  return { close: () => ws.close(), send(method, params = {}) { return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('Export debugger command deadline: ' + method)) }, 12000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  }) } }
}

// Both unpacked and NSIS-installed verification execute this original module.
// Existing save/reading/shortcut processes and installation comparisons remain
// separate prerequisites; this process never impersonates one of their exits.
export async function runLocalExportLifecycle({ executablePath, out, productCommit = process.env.GITHUB_SHA,
  version = LOCAL_EXPORT_VERSION, scope = 'packaged', ownedRoot = process.env.RUNNER_TEMP || tmpdir() } = {}) {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted'); assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/); assert.match(productCommit || '', /^[a-f0-9]{40}$/)
  assert.ok(['packaged', 'installed'].includes(scope)); assert.equal(version, LOCAL_EXPORT_VERSION)
  assert.ok(path.win32.isAbsolute(executablePath || ''))
  const scratch = realpathSync.native(mkdtempSync(path.join(ownedRoot, 'notepad-export-'))), profile = path.join(scratch, 'profile')
  const applicationDirectory = path.dirname(executablePath)
  const dataDirectory = scope === 'installed' ? path.join(homedir(), 'AppData', 'Roaming', 'Notepad') : path.join(scratch, 'data')
  if (scope === 'packaged') mkdirSync(dataDirectory)
  mkdirSync(out, { recursive: true }); const reportPath = path.join(out, LOCAL_EXPORT_REPORT)
  const report = { schemaVersion: 1, module: '2F.102', version, commit: process.env.GITHUB_SHA, productCommit, scope,
    platform: process.platform, runnerEnvironment: process.env.RUNNER_ENVIRONMENT, syntheticData: true,
    bridgeOverridden: false, timerAccelerated: false, forceTerminated: false, complete: false, cleanupComplete: false,
    startedAt: new Date().toISOString(), checks: [], screenshots: [], directoryActions: [],
    windowHelper: { events: [], stoppedCleanly: false }, directoryHelper: { events: [], stoppedCleanly: false },
    app: { executable: executablePath, executableSHA256: hash(readFileSync(executablePath)),
      asarSHA256: hash(readFileSync(path.join(applicationDirectory, 'resources', 'app.asar'))),
      backendSHA256: hash(readFileSync(path.join(applicationDirectory, 'resources', 'bin', 'notepad-server.exe'))) },
    sourceFiles: Object.fromEntries(LOCAL_EXPORT_SOURCES.map(name => [name,
      blob(readFileSync(new URL('./' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n'))])),
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' })
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2))
  const mark = name => { assert.equal(name, LOCAL_EXPORT_CHECKS[report.checks.length]); report.checks.push(name); save() }
  let child, exited, cdp, windowSession, directorySession, trace = ''
  const requests = [], pendingRequests = new Map(), environment = { ...process.env }
  for (const key of Object.keys(environment)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete environment[key]
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NOTEPAD_DATA', 'PORT']) delete environment[key]
  if (scope === 'packaged') { environment.NOTEPAD_DATA = dataDirectory; environment.PORT = '27121' }
  const traceData = value => { trace = (trace + String(value)).slice(-180000) }
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result?.value
  }
  const api = async (route, init = {}) => {
    const response = await fetch(apiBase + route, { ...init, headers: { Origin: 'null', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000) })
    assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.code, 0, JSON.stringify(value)); return value.data
  }
  const click = async requested => {
    if (typeof requested === 'string') requested = { selector: requested }
    const point = await until(() => evaluate(`(() => {
      const request=${JSON.stringify(requested)};
      const nodes=[...document.querySelectorAll(request.selector)].filter(node=>!node.disabled&&(request.text===undefined||node.textContent.trim()===request.text)&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0);
      if(nodes.length!==1)return null;const node=nodes[0];node.scrollIntoView({block:'center'});
      const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
      return hit&&(hit===node||node.contains(hit))?{x,y}:null;
    })()`), 'Export control missing, disabled, ambiguous or occluded: ' + requested.selector)
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
  }
  const capture = async filename => {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    writeFileSync(path.join(out, filename), bytes, { flag: 'wx' })
    report.screenshots.push({ filename, bytes: bytes.length, sha256: hash(bytes) }); save()
  }
  try {
    windowSession = createDesktopWindowSession({ onEvent: event => { report.windowHelper.events.push(event); save() } })
    directorySession = createExportDirectorySession({ ownedRoot: scratch, onEvent: event => { report.directoryHelper.events.push(event); save() } })
    await Promise.all([windowSession.ready, directorySession.ready])
    await freePort(27121); const port = await freePort()
    child = spawn(executablePath, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
      { cwd: applicationDirectory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    exited = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject) }); exited.catch(() => {})
    for (const stream of [child.stdout, child.stderr]) { stream.on('data', traceData); stream.on('error', traceData) }
    const pid = child.pid; assert.ok(Number.isSafeInteger(pid) && pid > 0)
    const page = await until(async () => {
      assert.equal(child.exitCode, null, 'Export application exited before ready')
      let response
      try { response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) }) } catch { return null }
      const pages = await response.json(), matches = pages.filter(item => item.type === 'page' && item.url.startsWith('file:') && item.url.includes('index.html'))
      return matches.length === 1 && matches[0]
    }, 'Export packaged renderer did not become available')
    cdp = await connect(page.webSocketDebuggerUrl, value => {
      if (value.method === 'Network.requestWillBeSent') {
        const { requestId, request } = value.params, address = new URL(request.url)
        if (address.origin === apiBase && /^(POST|PUT|PATCH|DELETE)$/.test(request.method)) {
          const entry = { requestID: requestId, processID: pid, path: address.pathname, method: request.method, status: null }
          requests.push(entry); pendingRequests.set(requestId, entry)
        }
      } else if (value.method === 'Network.responseReceived') {
        const entry = pendingRequests.get(value.params.requestId); if (entry) entry.status = value.params.response.status
      } else if (value.method === 'Runtime.exceptionThrown') traceData(JSON.stringify(value) + '\n')
    })
    for (const domain of ['Runtime', 'Page', 'Network']) await cdp.send(domain + '.enable')
    await until(() => evaluate("Boolean(document.querySelector('.workspace-sidebar'))"), 'Export App did not initialize')
    const diagnostics = await evaluate('window.electronAPI.appDiagnostics()')
    assert.equal(diagnostics.packaged, true); assert.equal(diagnostics.version, version)
    const backend = await api('/api/diagnostics'); assert.equal(path.resolve(backend.data_dir).toLowerCase(), path.resolve(dataDirectory).toLowerCase())
    report.launch = { pid, profile, executable: executablePath, diagnostics: { version: diagnostics.version, packaged: diagnostics.packaged } }; save()
    const target = selectDesktopMainWindow(await windowSession.inspect(pid, executablePath), pid, await evaluate('document.title'))
    assertDesktopWindowImage(target, executablePath)
    const binding = { pid, mainHandle: target.handle, executable: executablePath }
    report.minimumWindow = await directorySession.minimumWindow(binding); save()
    const product = await verifyLocalExportDesktop({ report, save, mark, api, evaluate, click, cdp, until, capture,
      directorySession, binding, ownedRoot: scratch, dataDirectory, requests: () => structuredClone(requests) })
    const closing = selectDesktopMainWindow(await windowSession.inspect(pid, executablePath), pid, await evaluate('document.title'))
    assertDesktopWindowImage(closing, executablePath); await windowSession.close(closing)
    const closeRequest = structuredClone(windowSession.events().at(-1)); let timer
    try {
      const end = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Export native close did not finish')), 15000) })])
      assert.equal(end.code, 0); assert.equal(end.signal, null)
      cdp.close(); cdp = null; child = null
      await until(async () => {
        try { await fetch(apiBase + '/api/health', { signal: AbortSignal.timeout(400) }); return false } catch { return true }
      }, 'Export backend remained alive after native close', 5000)
      report.exit = { pid, ...end, nativeClose: true, backendStopped: true, window: closing, closeRequest }
    } finally { clearTimeout(timer) }
    assert.deepEqual(localExportDirectoryInventory(product.exportDirectory), product.filesBeforeExit)
    report.exportFilesSurvivedExit = true; mark('native-close-keeps-exported-bytes')
    const evidenceDirectory = path.join(out, 'local-export-files')
    cpSync(product.exportDirectory, evidenceDirectory, { recursive: true, errorOnExist: true, force: false })
    report.exportRoot = product.exportDirectory
    report.files = localExportDirectoryInventory(evidenceDirectory).map(({ filename, bytes, sha256 }) => ({ filename: 'local-export-files/' + filename, bytes, sha256 }))
    report.windowHelper.stoppedCleanly = await windowSession.dispose()
    report.directoryHelper.stoppedCleanly = await directorySession.dispose()
    assert.equal(report.windowHelper.stoppedCleanly, true); assert.equal(report.directoryHelper.stoppedCleanly, true)
    assert.doesNotMatch(trace, /后端异常结束；同步恢复记录保留/)
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    report.cleanupComplete = true; mark('owned-resources-cleaned')
    report.complete = true; report.finishedAt = new Date().toISOString(); save()
    return await verifyLocalExportDesktopReport(out, process.env.GITHUB_SHA, productCommit, scope)
  } catch (error) {
    report.complete = false; report.error = String(error?.stack || error); save()
    if (cdp) { try { await capture('local-export-failed.png') } catch {} }
    throw error
  } finally {
    cdp?.close()
    if (child && child.exitCode === null && Number.isSafeInteger(child.pid)) {
      report.forceTerminated = true; report.complete = false; save()
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, stdio: 'ignore' })
      await Promise.race([exited.catch(() => {}), sleep(3000)])
    }
    await directorySession?.dispose(); await windowSession?.dispose()
    writeFileSync(path.join(out, 'local-export-desktop.log'), trace)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'test-results', 'desktop-save')
  const { verifyDesktopSaveReadingReport } = await import('./reading-mode-save-evidence.mjs')
  const { verifyShortcutManagementDesktopReport } = await import('./shortcut-management-desktop-evidence.mjs')
  const original = verifyDesktopSaveReadingReport(out, process.env.GITHUB_SHA)
  const shortcut = verifyShortcutManagementDesktopReport(out, process.env.GITHUB_SHA)
  const directory = path.join(root, 'release', 'win-unpacked')
  const filename = readdirSync(directory).find(name => name.endsWith('.exe') && !name.startsWith('Uninstall')); assert.ok(filename)
  const result = await runLocalExportLifecycle({ executablePath: path.join(directory, filename), out })
  for (const [key, oldKey] of [['executableSHA256', 'appSHA256'], ['asarSHA256', 'asarSHA256'], ['backendSHA256', 'backendSHA256']]) {
    assert.equal(result.app[key], original.desktop[oldKey]); assert.equal(result.app[key], shortcut.app[key])
  }
  assert.equal(original.desktop.processIDs.includes(result.launch.pid), false)
  assert.equal(shortcut.launches.some(item => item.pid === result.launch.pid), false)
  writeFileSync(path.join(out, 'local-export-desktop-accepted.json'), JSON.stringify({ complete: true, commit: process.env.GITHUB_SHA,
    originalSaveReadingShortcutAccepted: true, sameOriginalApplicationBytes: true, checks: result.checks, processID: result.launch.pid,
    originalDesktopSHA256: hash(readFileSync(path.join(out, 'checks.json'))),
    originalReadingSHA256: hash(readFileSync(path.join(out, 'reading-mode-desktop.json'))),
    originalShortcutSHA256: hash(readFileSync(path.join(out, 'shortcut-management-desktop.json'))),
    exportReportSHA256: hash(readFileSync(path.join(out, LOCAL_EXPORT_REPORT))), files: result.files.length,
  }, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ complete: true, originalSaveReadingShortcutAccepted: true, localExportChecks: result.checks.length }))
}
