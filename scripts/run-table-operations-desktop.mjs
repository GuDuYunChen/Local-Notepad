import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { selectDesktopMainWindow, assertDesktopWindowImage } from './desktop-window-target.mjs'
import { createExportDirectorySession } from './local-export-directory-session.mjs'
import { TABLE_OPERATIONS_BUDGET_MS, verifyTableOperationsDesktop } from './table-operations-desktop-driver.mjs'
import { TABLE_OPERATIONS_VERSION, TABLE_OPERATIONS_REPORT, TABLE_OPERATIONS_SOURCES,
  tableOperationsBlob, tableOperationsHash, verifyTableOperationsReport } from './table-operations-evidence.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const apiBase = 'http://127.0.0.1:27121'
const q = JSON.stringify

export async function tableOperationsUntil(check, label, budget = 15000) {
  const deadline = performance.now() + budget
  while (performance.now() < deadline) {
    const result = await check()
    if (result) return result
    await sleep(100)
  }
  throw new Error(label)
}
async function freePort(port = 0) {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const actual = server.address().port
  await new Promise(resolve => server.close(resolve))
  return actual
}
async function connect(url, observe) {
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'ws:'); assert.equal(parsed.hostname, '127.0.0.1')
  const socket = new WebSocket(url), pending = new Map(), listeners = new Set()
  let id = 0
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Table debugger connect deadline')), 10000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Table debugger connection failed')) }, { once: true })
  })
  const disconnected = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Table debugger disconnected')) }
    pending.clear()
  }
  socket.addEventListener('close', disconnected); socket.addEventListener('error', disconnected)
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.method) { observe(message); for (const listener of listeners) listener(message) }
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id); clearTimeout(item.timer)
    if (message.error) item.reject(new Error(q(message.error)))
    else item.resolve(message.result)
  })
  return {
    close: () => socket.close(),
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const sequence = ++id
        const timer = setTimeout(() => { pending.delete(sequence); reject(new Error('Table debugger command deadline: ' + method)) }, 12000)
        pending.set(sequence, { resolve, reject, timer }); socket.send(q({ id: sequence, method, params }))
      })
    },
  }
}

export async function runTableOperationsDesktop({ executablePath, out = path.join(root, 'test-results/table-operations'),
  scope = 'packaged', productCommit = process.env.GITHUB_SHA, sourcePins, ownedRoot = process.env.RUNNER_TEMP || tmpdir() } = {}) {
  assert.equal(process.platform, 'win32', 'Table native acceptance requires real Windows')
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Only disposable hosted Windows accepts native test data')
  assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/); assert.match(productCommit || '', /^[a-f0-9]{40}$/)
  assert.ok(['packaged', 'installed'].includes(scope))
  assert.ok(path.win32.isAbsolute(executablePath || '')); assert.ok(path.win32.isAbsolute(ownedRoot || ''))
  assert.equal(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, TABLE_OPERATIONS_VERSION)
  const expectedSources = scope === 'packaged' ? Object.fromEntries(TABLE_OPERATIONS_SOURCES.map(name => [name,
    tableOperationsBlob(execFileSync('git', ['show', productCommit + ':' + name], { cwd: root, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }).replace(/\r\n/g, '\n')),
  ])) : sourcePins
  assert.deepEqual(Object.keys(expectedSources || {}).sort(), [...TABLE_OPERATIONS_SOURCES].sort(), 'Independent current product source pins are required')
  for (const pin of Object.values(expectedSources)) assert.match(pin || '', /^[a-f0-9]{40}$/)
  const sourceFiles = Object.fromEntries(TABLE_OPERATIONS_SOURCES.map(name => [name, tableOperationsBlob(readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n'))]))
  assert.deepEqual(sourceFiles, expectedSources, 'Local Table verification sources differ from the packaged product commit or independently pinned installer sources')
  const scratch = mkdtempSync(path.join(ownedRoot, 'notepad-tables-'))
  const profile = path.join(scratch, 'profile'), directory = path.dirname(executablePath)
  const data = scope === 'installed' ? path.join(homedir(), 'AppData/Roaming/Notepad') : path.join(scratch, 'data')
  if (scope === 'packaged') mkdirSync(data)
  mkdirSync(out, { recursive: true })
  const report = {
    schemaVersion: 1, module: 'notepad-table', version: TABLE_OPERATIONS_VERSION, platform: process.platform,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT, productCommit, verifierCommit: process.env.GITHUB_SHA, scope,
    syntheticData: true, bridgeOverridden: false, timerAccelerated: false, forceTerminated: false,
    realBackend: false, realPreload: false, complete: false, cleanupComplete: false,
    businessBudgetMs: TABLE_OPERATIONS_BUDGET_MS, checks: [], nativeInputs: [], requests: [], screenshots: [],
    executable: executablePath, executableSHA256: tableOperationsHash(readFileSync(executablePath)),
    asarSHA256: tableOperationsHash(readFileSync(path.join(directory, 'resources/app.asar'))),
    backendSHA256: tableOperationsHash(readFileSync(path.join(directory, 'resources/bin/notepad-server.exe'))),
    sourceFiles,
    profile, data, startedAt: new Date().toISOString(), windowHelper: { events: [] }, resizeHelper: { events: [] },
  }
  const reportFile = path.join(out, TABLE_OPERATIONS_REPORT)
  writeFileSync(reportFile, q(report), { flag: 'wx' })
  const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  const environment = { ...process.env }
  for (const name of Object.keys(environment)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name)) delete environment[name]
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NOTEPAD_DATA', 'PORT']) delete environment[name]
  if (scope === 'packaged') { environment.NOTEPAD_DATA = data; environment.PORT = '27121' }
  let child, exited, cdp, windowSession, resizeSession, trace = '', businessDeadline = Infinity
  const traceData = bytes => { trace = (trace + String(bytes)).slice(-200000) }
  const until = (check, label, budget = 15000) => tableOperationsUntil(check, label, Math.max(1, Math.min(budget, businessDeadline - performance.now())))
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, q(result.exceptionDetails))
    return result.result?.value
  }
  const api = async (route, options = {}) => {
    const response = await fetch(apiBase + route, { ...options, headers: { Origin: 'null', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000) })
    assert.equal(response.status, 200)
    const result = await response.json(); assert.equal(result.code, 0, q(result)); return result.data
  }
  const click = async target => {
    const request = typeof target === 'string' ? { selector: target } : target
    const point = await until(() => evaluate(`(() => {
      const request=${q(request)}
      const nodes=[...document.querySelectorAll(request.selector)].filter(node=>!node.disabled&&
        (request.text===undefined||node.textContent.trim()===request.text||node.getAttribute('aria-label')===request.text)&&
        node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0)
      if(nodes.length!==1)return null
      const node=nodes[0];node.scrollIntoView({block:'nearest',inline:'nearest'})
      const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+Math.min(r.height/2,18),hit=document.elementFromPoint(x,y)
      return hit&&node.contains(hit)?{x,y}:null
    })()`), 'Native Table control missing, ambiguous, disabled, or covered: ' + q(request))
    for (const type of ['mousePressed', 'mouseReleased']) {
      const params = { type, ...point, button: 'left', clickCount: 1 }
      report.nativeInputs.push({ sequence: report.nativeInputs.length + 1, method: 'Input.dispatchMouseEvent', ...params }); save()
      await cdp.send('Input.dispatchMouseEvent', params)
    }
  }
  const capture = async filename => {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    writeFileSync(path.join(out, filename), bytes, { flag: 'wx' })
    report.screenshots.push({ filename, bytes: bytes.length, sha256: tableOperationsHash(bytes) }); save()
  }
  const binding = async () => {
    const window = selectDesktopMainWindow(await windowSession.inspect(child.pid, executablePath), child.pid, await evaluate('document.title'))
    assertDesktopWindowImage(window, executablePath)
    return window
  }
  try {
    await freePort(27121) // Never attach to or seed an existing backend.
    const port = await freePort()
    child = spawn(executablePath, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
      { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    exited = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject) })
    void exited.catch(() => {})
    for (const stream of [child.stdout, child.stderr]) { stream.on('data', traceData); stream.on('error', traceData) }
    report.pid = child.pid; assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0); save()
    const page = await until(async () => {
      assert.equal(child.exitCode, null, 'Table app exited before startup')
      let pages
      try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) })).json() }
      catch { return false }
      const matches = pages.filter(item => item.type === 'page' && item.url.startsWith('file:') && item.url.includes('index.html'))
      return matches.length === 1 && matches[0]
    }, 'Actual packaged Table renderer did not start')
    const pending = new Map()
    cdp = await connect(page.webSocketDebuggerUrl, event => {
      if (event.method === 'Runtime.exceptionThrown') traceData(q(event) + '\n')
      if (event.method === 'Network.requestWillBeSent') {
        const { requestId, request } = event.params, url = new URL(request.url)
        if (url.origin === apiBase && /^(POST|PUT|PATCH|DELETE)$/.test(request.method)) {
          const item = { requestID: requestId, path: url.pathname, method: request.method, postData: request.postData || '', status: null }
          report.requests.push(item); pending.set(requestId, item); save()
        }
      } else if (event.method === 'Network.responseReceived') {
        const item = pending.get(event.params.requestId)
        if (item) { item.status = event.params.response.status; save() }
      } else if (event.method === 'Network.loadingFailed') {
        const item = pending.get(event.params.requestId)
        if (item) { item.failure = { errorText: event.params.errorText, blockedReason: event.params.blockedReason || null }; save() }
      }
    })
    for (const domain of ['Runtime', 'Page', 'Network']) await cdp.send(domain + '.enable')
    await until(() => evaluate("!!document.querySelector('.workspace-sidebar')"), 'Full Table application shell did not initialize')
    const diagnostics = await evaluate('window.electronAPI.appDiagnostics()')
    assert.equal(diagnostics.packaged, true); assert.equal(diagnostics.version, TABLE_OPERATIONS_VERSION)
    report.app = { version: diagnostics.version, packaged: diagnostics.packaged }; report.realPreload = true
    const backend = await api('/api/diagnostics')
    assert.equal(path.resolve(backend.data_dir).toLowerCase(), path.resolve(data).toLowerCase()); report.realBackend = true
    windowSession = createDesktopWindowSession({ onEvent: event => { report.windowHelper.events.push(event); save() } })
    await windowSession.ready; await binding()
    resizeSession = createExportDirectorySession({ ownedRoot: scratch, onEvent: event => { report.resizeHelper.events.push(event); save() } })
    await resizeSession.ready
    const resizeSmall = async () => {
      const target = await binding()
      report.minimumWindow = await resizeSession.minimumWindow({ pid: child.pid, mainHandle: target.handle, executable: executablePath }); save()
    }
    businessDeadline = performance.now() + TABLE_OPERATIONS_BUDGET_MS
    await verifyTableOperationsDesktop({ api, evaluate, click, cdp, until, capture, report, save, resizeSmall })
    businessDeadline = Infinity
    const window = await binding()
    await windowSession.close(window)
    let timer
    const exit = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Table app native close deadline')), 15000) })]).finally(() => clearTimeout(timer))
    assert.deepEqual(exit, { code: 0, signal: null })
    report.exit = { pid: child.pid, ...exit, normalClose: true }; child = null; cdp.close(); cdp = null
    await until(async () => {
      try { await fetch(apiBase + '/api/health', { signal: AbortSignal.timeout(400) }); return false } catch { return true }
    }, 'Owned Table backend remained alive', 5000)
    report.backendStopped = true
    assert.equal(await resizeSession.dispose(), true); resizeSession = null
    assert.equal(await windowSession.dispose(), true); windowSession = null
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    report.cleanupComplete = true; report.complete = true; report.finishedAt = new Date().toISOString(); save()
    return verifyTableOperationsReport(out, { commit: productCommit, verifier: process.env.GITHUB_SHA, scope, sources: expectedSources })
  } catch (error) {
    report.complete = false; report.error = String(error.stack || error); save()
    if (cdp) await capture('table-native-failure.png').catch(() => {})
    throw error
  } finally {
    cdp?.close()
    if (child && child.exitCode === null && Number.isSafeInteger(child.pid)) {
      report.complete = false; report.forceTerminated = true; save()
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, stdio: 'ignore' })
      await Promise.race([exited.catch(() => {}), sleep(3000)])
    }
    for (const session of [resizeSession, windowSession]) if (session) {
      try { if (!await session.dispose()) report.cleanupError = 'Owned Table helper did not stop cleanly' }
      catch (error) { report.cleanupError = String(error.message || error) }
    }
    writeFileSync(path.join(out, 'table-native-runtime.log'), trace)
    if (report.cleanupError) { report.complete = false; report.cleanupComplete = false }
    save()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'No arbitrary native application paths accepted by CLI')
  const unpacked = path.join(root, 'release/win-unpacked')
  const candidates = readdirSync(unpacked).filter(name => name.endsWith('.exe') && !name.startsWith('Uninstall'))
  assert.equal(candidates.length, 1)
  runTableOperationsDesktop({ executablePath: path.join(unpacked, candidates[0]) }).then(report => {
    console.log(q({ complete: report.complete, nativeChecks: report.checks.length, nativeInputs: report.nativeInputs.length, cleanupComplete: report.cleanupComplete }))
  }).catch(error => { console.error(error); process.exitCode = 1 })
}
