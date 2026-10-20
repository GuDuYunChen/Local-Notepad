import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { assertDesktopWindowImage, selectDesktopMainWindow } from './desktop-window-target.mjs'
import { observeShortcutManagementKeys, verifyShortcutManagementBeforeRestart,
  verifyShortcutManagementAfterRestart } from './check-shortcut-management-desktop.mjs'
import { SHORTCUT_MANAGEMENT_VERSION, SHORTCUT_MANAGEMENT_REPORT, SHORTCUT_MANAGEMENT_CHECKS,
  SHORTCUT_MANAGEMENT_SOURCES, verifyShortcutManagementDesktopReport } from './shortcut-management-desktop-evidence.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const blob = source => createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex')
const apiBase = 'http://127.0.0.1:27121'

async function freePort(port = 0) {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const actual = server.address().port
  await new Promise(resolve => server.close(resolve)); return actual
}

async function until(check, label, budget = 15000) {
  const end = performance.now() + budget
  let last
  while (performance.now() < end) {
    try { const result = await check(); if (result) return result } catch (error) { last = error }
    await sleep(100)
  }
  throw Error(label + (last ? ': ' + last.message : ''))
}

async function connect(url, onEvent) {
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'ws:'); assert.equal(parsed.hostname, '127.0.0.1')
  const ws = new WebSocket(url), pending = new Map()
  let sequence = 0
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Shortcut debugger connection deadline exceeded')), 10000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('Shortcut debugger connection failed')) }, { once: true })
  })
  const disconnected = () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('Shortcut debugger disconnected')) }
    pending.clear()
  }
  ws.addEventListener('close', disconnected); ws.addEventListener('error', disconnected)
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.method) onEvent(message)
    const task = pending.get(message.id)
    if (!task) return
    pending.delete(message.id); clearTimeout(task.timer)
    if (message.error) task.reject(Error(JSON.stringify(message.error))); else task.resolve(message.result)
  })
  return { close: () => ws.close(), send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Shortcut debugger command deadline: ' + method)) }, 12000)
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
    })
  } }
}

// Both packaged and installed verification use this exact runner. Its two
// native processes share one isolated profile; the earlier desktop/installer
// fresh-profile database gates are not changed or counted as shortcut restarts.
export async function runShortcutManagementLifecycle({ executablePath, out,
  productCommit = process.env.GITHUB_SHA, version = SHORTCUT_MANAGEMENT_VERSION,
  scope = 'packaged', ownedRoot = process.env.RUNNER_TEMP || tmpdir() } = {}) {
  assert.equal(process.platform, 'win32')
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/)
  assert.match(productCommit || '', /^[a-f0-9]{40}$/)
  assert.ok(['packaged', 'installed'].includes(scope))
  assert.equal(version, SHORTCUT_MANAGEMENT_VERSION)
  assert.ok(path.win32.isAbsolute(executablePath || ''))
  const scratch = mkdtempSync(path.join(ownedRoot, 'notepad-shortcuts-'))
  const profile = path.join(scratch, 'profile')
  const applicationDirectory = path.dirname(executablePath)
  const dataDirectory = scope === 'installed'
    ? path.join(homedir(), 'AppData', 'Roaming', 'Notepad') : path.join(scratch, 'data')
  if (scope === 'packaged') mkdirSync(dataDirectory)
  mkdirSync(out, { recursive: true })
  const reportFile = path.join(out, SHORTCUT_MANAGEMENT_REPORT)
  const report = { schemaVersion: 1, module: '2F.101', version, commit: process.env.GITHUB_SHA,
    productCommit, scope, platform: process.platform, runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
    syntheticData: true, bridgeOverridden: false, timerAccelerated: false, forceTerminated: false,
    complete: false, cleanupComplete: false, sameProfile: true, profile, startedAt: new Date().toISOString(),
    app: { executable: executablePath, executableSHA256: hash(readFileSync(executablePath)),
      asarSHA256: hash(readFileSync(path.join(applicationDirectory, 'resources', 'app.asar'))),
      backendSHA256: hash(readFileSync(path.join(applicationDirectory, 'resources', 'bin', 'notepad-server.exe'))) },
    sourceFiles: Object.fromEntries(SHORTCUT_MANAGEMENT_SOURCES.map(name => [name,
      blob(readFileSync(new URL('./' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n'))])),
    checks: [], actions: [], screenshots: [], launches: [], exits: [],
    windowHelper: { events: [], stoppedCleanly: false } }
  writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' })
  const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2))
  const mark = name => { assert.equal(name, SHORTCUT_MANAGEMENT_CHECKS[report.checks.length]); report.checks.push(name); save() }
  let child, exited, cdp, windowSession, trace = ''
  const mutations = [], pendingRequests = new Map()
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete environment[key]
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NOTEPAD_DATA', 'PORT']) delete environment[key]
  if (scope === 'packaged') { environment.NOTEPAD_DATA = dataDirectory; environment.PORT = '27121' }
  const traceData = value => { trace = (trace + String(value)).slice(-180000) }
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }
  const api = async (route, init = {}) => {
    const response = await fetch(apiBase + route, { ...init, headers: { Origin: 'null', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000) })
    assert.equal(response.status, 200)
    const result = await response.json(); assert.equal(result.code, 0, JSON.stringify(result)); return result.data
  }
  const click = async target => {
    const requested = typeof target === 'string' ? { selector: target } : target
    const point = await until(() => evaluate(`(() => {
      const request=${JSON.stringify(requested)};
      const nodes=Array.from(document.querySelectorAll(request.selector)).filter(n=>
        !n.disabled && (request.text===undefined || n.textContent.trim()===request.text) &&
        n.getBoundingClientRect().width>0 && n.getBoundingClientRect().height>0);
      if(nodes.length!==1)return null;
      const node=nodes[0];node.scrollIntoView({block:'center'});
      const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
      return hit&&(hit===node||node.contains(hit))?{x,y}:null;
    })()`), 'Shortcut native target missing, disabled, ambiguous or occluded: ' + requested.selector)
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
  }
  const capture = async filename => {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    writeFileSync(path.join(out, filename), bytes, { flag: 'wx' })
    report.screenshots.push({ filename, bytes: bytes.length, sha256: hash(bytes) }); save()
  }
  const launch = async () => {
    await freePort(27121) // Never attach to an existing application/backend.
    const port = await freePort()
    child = spawn(executablePath, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
      { cwd: applicationDirectory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    exited = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject) })
    void exited.catch(() => {})
    for (const stream of [child.stdout, child.stderr]) { stream.on('data', traceData); stream.on('error', traceData) }
    const pid = child.pid
    assert.ok(Number.isSafeInteger(pid) && pid > 0)
    const page = await until(async () => {
      assert.equal(child.exitCode, null, 'Shortcut application exited before ready')
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json()
      const matches = pages.filter(item => item.type === 'page' && item.url.startsWith('file:') && item.url.includes('index.html'))
      return matches.length === 1 && matches[0]
    }, 'Shortcut packaged renderer did not become available')
    pendingRequests.clear()
    cdp = await connect(page.webSocketDebuggerUrl, message => {
      if (message.method === 'Network.requestWillBeSent') {
        const { requestId, request } = message.params
        const address = new URL(request.url)
        if (address.origin === apiBase && /^(POST|PUT|PATCH|DELETE)$/.test(request.method)) {
          const record = { requestID: requestId, processID: pid, path: address.pathname,
            method: request.method, postData: request.postData || '', status: null }
          mutations.push(record); pendingRequests.set(requestId, record)
        }
      } else if (message.method === 'Network.responseReceived') {
        const record = pendingRequests.get(message.params.requestId)
        if (record) record.status = message.params.response.status
      } else if (message.method === 'Runtime.exceptionThrown') traceData(JSON.stringify(message) + '\n')
    })
    for (const domain of ['Runtime', 'Page', 'Network']) await cdp.send(domain + '.enable')
    await until(() => evaluate("Boolean(document.querySelector('.workspace-sidebar'))"), 'Shortcut App did not initialize')
    const diagnostics = await evaluate('window.electronAPI.appDiagnostics()')
    assert.equal(diagnostics.packaged, true); assert.equal(diagnostics.version, version)
    const backend = await api('/api/diagnostics')
    assert.equal(path.resolve(backend.data_dir).toLowerCase(), path.resolve(dataDirectory).toLowerCase())
    assert.equal(await observeShortcutManagementKeys(evaluate), true)
    report.launches.push({ pid, profile, executable: executablePath,
      diagnostics: { version: diagnostics.version, packaged: diagnostics.packaged },
      timeOrigin: await evaluate('performance.timeOrigin') }); save()
    return { report, mark, save, api, evaluate, click, cdp, until, capture, processID: pid,
      requests: () => structuredClone(mutations) }
  }
  const close = async () => {
    const pid = child.pid, title = await evaluate('document.title')
    const windows = await windowSession.inspect(pid, executablePath)
    const target = selectDesktopMainWindow(windows, pid, title)
    assertDesktopWindowImage(target, executablePath)
    await windowSession.close(target)
    const closeRequest = structuredClone(windowSession.events().at(-1))
    let timer
    try {
      const end = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Shortcut native close did not finish')), 15000) })])
      assert.equal(end.code, 0); assert.equal(end.signal, null)
      cdp.close(); cdp = null; child = null
      await until(async () => {
        try { await fetch(apiBase + '/api/health', { signal: AbortSignal.timeout(400) }); return false } catch { return true }
      }, 'Shortcut backend remained alive after native close', 5000)
      report.exits.push({ pid, ...end, nativeClose: true, backendStopped: true, window: target, closeRequest }); save()
    } finally { clearTimeout(timer) }
  }
  try {
    windowSession = createDesktopWindowSession({ onEvent: event => { report.windowHelper.events.push(event); save() } })
    await windowSession.ready
    await verifyShortcutManagementBeforeRestart(await launch())
    await close(); mark('first-native-close')
    const next = await launch()
    assert.notEqual(report.launches[0].pid, report.launches[1].pid)
    assert.equal(report.launches[0].profile, report.launches[1].profile)
    mark('same-profile-new-native-process')
    await verifyShortcutManagementAfterRestart(next)
    await close(); mark('second-native-close')
    report.windowHelper.stoppedCleanly = await windowSession.dispose()
    assert.equal(report.windowHelper.stoppedCleanly, true)
    assert.doesNotMatch(trace, /后端异常结束；同步恢复记录保留/)
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    report.cleanupComplete = true; mark('owned-resources-cleaned')
    report.complete = true; report.finishedAt = new Date().toISOString(); save()
    return verifyShortcutManagementDesktopReport(out, process.env.GITHUB_SHA, productCommit, scope)
  } catch (error) {
    report.complete = false; report.error = String(error?.stack || error); save()
    if (cdp) { try { await capture('shortcut-management-failed.png') } catch {} }
    throw error
  } finally {
    cdp?.close()
    if (child && child.exitCode === null && Number.isSafeInteger(child.pid)) {
      report.forceTerminated = true; report.complete = false; save()
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, stdio: 'ignore' })
      await Promise.race([exited.catch(() => {}), sleep(3000)])
    }
    await windowSession?.dispose()
    writeFileSync(path.join(out, 'shortcut-management-desktop.log'), trace)
    if (report.complete) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const out = path.join(root, 'test-results', 'desktop-save')
  const { verifyDesktopSaveReadingReport } = await import('./reading-mode-save-evidence.mjs')
  const original = verifyDesktopSaveReadingReport(out, process.env.GITHUB_SHA)
  const directory = path.join(root, 'release', 'win-unpacked')
  const filename = readdirSync(directory).find(name => name.endsWith('.exe') && !name.startsWith('Uninstall'))
  assert.ok(filename, 'Current packaged application missing')
  const shortcuts = await runShortcutManagementLifecycle({ executablePath: path.join(directory, filename), out })
  assert.equal(shortcuts.app.asarSHA256, original.desktop.asarSHA256)
  assert.equal(shortcuts.app.executableSHA256, original.desktop.appSHA256)
  assert.equal(shortcuts.app.backendSHA256, original.desktop.backendSHA256)
  assert.equal(shortcuts.launches.some(item => original.desktop.processIDs.includes(item.pid)), false)
  writeFileSync(path.join(out, 'shortcut-management-desktop-accepted.json'), JSON.stringify({
    complete: true, commit: process.env.GITHUB_SHA, originalDesktopProcesses: original.desktop.processIDs,
    shortcutProcesses: shortcuts.launches.map(item => item.pid), sameOriginalApplicationBytes: true,
    originalSaveAndReadingAccepted: true, checks: shortcuts.checks,
    originalReadingSHA256: hash(readFileSync(path.join(out, 'reading-mode-desktop.json'))),
    originalDesktopSHA256: hash(readFileSync(path.join(out, 'checks.json'))),
    shortcutReportSHA256: hash(readFileSync(path.join(out, SHORTCUT_MANAGEMENT_REPORT))),
  }, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ complete: true, originalSaveAndReadingAccepted: true,
    shortcutManagementChecks: shortcuts.checks.length, shortcutNativeProcesses: shortcuts.launches.length }))
}
