// Windows packaged-app acceptance: actual main/preload/App/Lexical/backend.
// No renderer modules, request responses, timers or quit receipts are replaced.
// CDP is enabled only on this isolated test process and bound to loopback.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { createSaveTestServer } from './save-recovery-server.mjs'
import { verifyDesktopSaveReport } from './desktop-save-evidence.mjs'

assert.equal(process.platform, 'win32', 'This check requires the actual Windows package')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const unpacked = path.join(root, 'release', 'win-unpacked')
const executable = readdirSync(unpacked).find(name => name.endsWith('.exe') && !name.startsWith('Uninstall'))
assert.ok(executable, 'Packaged application is missing')
const exe = path.join(unpacked, executable)
const backend = path.join(unpacked, 'resources', 'bin', 'notepad-server.exe')
const scratch = mkdtempSync(path.join(tmpdir(), 'notepad-desktop-save-'))
const out = path.join(root, 'test-results', 'desktop-save')
mkdirSync(out, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { startedAt: new Date().toISOString(), exits: [], commit: process.env.GITHUB_SHA || '', platform: process.platform, complete: false,
  realPackagedApp: true, realLexical: true, realPreloadAndQuit: true, realBackend: true,
  syntheticData: true, timerAccelerated: false, processIDs: [], checks: [], screenshots: [],
  appSHA256: hash(readFileSync(exe)),
  asarSHA256: hash(readFileSync(path.join(unpacked, 'resources', 'app.asar'))),
  backendSHA256: hash(readFileSync(backend)) }
const saveReport = () => writeFileSync(path.join(out, 'checks.json'), JSON.stringify(report, null, 2))
saveReport()
let server, child, exited, cdp, trace = ''
const apiBase = 'http://127.0.0.1:27121'
const note = (heading, text) => JSON.stringify({ root: { type: 'root', version: 1, direction: null,
  format: '', indent: 0, children: [
    { type: 'heading', version: 1, tag: 'h1', format: '', indent: 0, direction: null,
      children: [{ type: 'text', version: 1, text: heading, format: 0, mode: 'normal', style: '', detail: 0 }] },
    { type: 'paragraph', version: 1, format: '', indent: 0, direction: null,
      children: [{ type: 'text', version: 1, text, format: 0, mode: 'normal', style: '', detail: 0 }] },
  ] } })
const textOf = node => typeof node?.text === 'string' ? node.text : (node?.children || []).map(textOf).join('\n')
async function until(check, label, budget = 15000) {
  const end = Date.now() + budget
  let last
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value } catch (error) { last = error }
    await sleep(100)
  }
  throw new Error(label + (last ? ': ' + last.message : ''))
}
async function availablePort(port = 0) {
  const listener = createServer()
  await new Promise((yes, no) => { listener.once('error', no); listener.listen(port, '127.0.0.1', yes) })
  const actual = listener.address().port
  await new Promise(yes => listener.close(yes))
  return actual
}
async function connect(url) {
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'ws:')
  assert.equal(parsed.hostname, '127.0.0.1')
  const ws = new WebSocket(url), pending = new Map()
  let next = 0
  await new Promise((yes, no) => { ws.addEventListener('open', yes, { once: true }); ws.addEventListener('error', no, { once: true }) })
  const failAll = () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Desktop debugger disconnected')) }
    pending.clear()
  }
  ws.addEventListener('close', failAll); ws.addEventListener('error', failAll)
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.method === 'Runtime.exceptionThrown') trace += JSON.stringify(message) + '\n'
    const task = pending.get(message.id)
    if (!task) return
    pending.delete(message.id); clearTimeout(task.timer)
    if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result)
  })
  return {
    close: () => ws.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP command timeout: ' + method)) }, 12000)
        pending.set(id, { resolve, reject, timer })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}
async function evaluate(expression) {
  const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails))
  return value.result?.value
}
async function api(route, init = {}) {
  const response = await fetch(apiBase + route, { ...init,
    headers: { Origin: 'null', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(3000) })
  assert.equal(response.status, 200)
  const value = await response.json()
  assert.equal(value.code, 0, JSON.stringify(value))
  return value.data
}
async function launch() {
  await availablePort(27121) // Never attach to or write into an existing backend.
  const port = await availablePort()
  const environment = { ...process.env, NOTEPAD_DATA: server.data, PORT: '27121' }
  delete environment.ELECTRON_RUN_AS_NODE
  child = spawn(exe, [`--user-data-dir=${path.join(scratch, 'profile')}`,
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
    { cwd: unpacked, env: environment,
      stdio: ['ignore', 'pipe', 'pipe'] })
  report.processIDs.push(child.pid)
  exited = new Promise((yes, no) => { child.once('exit', (code, signal) => yes({ code, signal })); child.once('error', no) })
  void exited.catch(() => {})
  child.stdout.on('data', b => { trace = (trace + b).slice(-150000) })
  child.stderr.on('data', b => { trace = (trace + b).slice(-150000) })
  const page = await until(async () => {
    if (child.exitCode !== null) throw new Error('Desktop exited before ready')
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json()
    return pages.find(item => item.type === 'page' && item.url.startsWith('file:') && item.url.includes('index.html'))
  }, 'Packaged renderer not available')
  cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable')
  await until(async () => !!(await api('/api/health')), 'Packaged backend not available')
  assert.equal(await evaluate("typeof window.electronAPI?.reportQuitResult"), 'function')
  report.checks.push('production preload connected for process ' + child.pid)
  saveReport()
}
async function click(selector) {
  const point = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;
    n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  assert.ok(point, 'Missing visible control: ' + selector)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
}
async function key(key, keyCode, modifiers = 0) {
  const params = { key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}
async function open(id, expected) {
  await until(() => evaluate(`!!document.querySelector('[data-file-id="${id}"]')`), 'Note missing from actual library')
  await click(`[data-file-id="${id}"]`)
  await until(() => evaluate(`document.querySelector('.editor-input[contenteditable="true"]')?.innerText.includes(${JSON.stringify(expected)})`), 'Actual Lexical editor did not load expected content')
}
async function changeHeading(value) {
  await click('.editor-input[contenteditable="true"]')
  await key('Home', 36, 2); await key('End', 35, 8)
  await cdp.send('Input.insertText', { text: value })
  await until(() => evaluate(`document.querySelector('.editor-input h1')?.innerText===${JSON.stringify(value)}`), 'Native heading input did not reach Lexical')
}
async function append(value) {
  await click('.editor-input[contenteditable="true"]'); await key('End', 35, 2)
  await cdp.send('Input.insertText', { text: value })
  await until(() => evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(value)})`), 'Native body input did not reach Lexical')
}
async function assertSaved(id, heading, marker, budget = 15000) {
  const content = await until(async () => {
    const file = await api('/api/files/' + id), body = JSON.parse(file.content).root
    return body.children?.find(n => n.type === 'heading')?.children?.map(textOf).join('') === heading &&
      textOf(body).includes(marker) ? file.content : null
  }, 'Latest Lexical body was not durably saved: ' + marker, budget)
  await until(() => evaluate("!document.querySelector('.save-state')"), 'Save status did not settle')
  assert.equal(await evaluate("document.querySelectorAll('[role=dialog]').length"), 0)
  return content
}
async function screenshot(name) {
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')
  await sleep(200)
  const data = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const bytes = Buffer.from(data.data, 'base64'), filename = name + '.png'
  writeFileSync(path.join(out, filename), bytes)
  report.screenshots.push({ filename, bytes: bytes.length, sha256: hash(bytes),
    text: await evaluate("document.querySelector('.editor-input')?.innerText || document.body.innerText") })
  saveReport()
}
async function closeWindow() {
  assert.ok(Number.isInteger(child.pid))
  // WM_CLOSE addresses only the main window of this spawned test process.
  // No app.quit(), forged ready receipt, taskkill or renderer mock on success.
  const command = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class CloseTestWindow{[DllImport("user32.dll",SetLastError=true)]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);}';$p=Get-Process -Id ${child.pid};$p.Refresh();if($p.MainWindowHandle -eq 0){throw 'Test window missing'};if(-not [CloseTestWindow]::PostMessage($p.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'WM_CLOSE failed'}`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  const ownedPID = child.pid
  const timeout = new AbortController()
  let end
  try { end = await Promise.race([exited, sleep(15000, null, { signal: timeout.signal }).then(() => { throw new Error('Native window close was blocked') })]) }
  finally { timeout.abort() }
  assert.equal(end.code, 0); assert.equal(end.signal, null)
  report.exits.push({ pid: ownedPID, code: end.code, signal: end.signal, nativeClose: true })
  cdp.close(); cdp = null; child = null
  await until(async () => {
    try { await fetch(apiBase + '/api/health', { signal: AbortSignal.timeout(400) }); return false } catch { return true }
  }, 'Packaged backend remained alive after normal close', 5000)
}
try {
  await availablePort(27121)
  server = await createSaveTestServer(backend)
  const a = await server.call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'Desktop save A.md', content: note('原始标题', 'original body') }) })
  const b = await server.call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'Desktop save B.md', content: note('第二篇', 'other note') }) })
  await server.stop()
  await launch(); await open(a.id, '原始标题')
  await changeHeading('手动保存标题'); await append(' manual-native-4189')
  await key('s', 83, 2)
  await assertSaved(a.id, '手动保存标题', 'manual-native-4189')
  report.checks.push('native Ctrl+S saved actual heading and body without reference confirmation')
  await screenshot('manual-saved')
  await open(b.id, 'other note'); await open(a.id, 'manual-native-4189')
  report.checks.push('real library switch and reopen retain saved Lexical content')
  await changeHeading('自动保存标题'); await append(' automatic-native-4189')
  await assertSaved(a.id, '自动保存标题', 'automatic-native-4189', 42000)
  report.checks.push('real unaccelerated 30-second autosave persisted a changed heading')
  await screenshot('automatic-saved')
  // Fail only this application's browser transport. The real API and DB remain
  // running; no replacement response or synthetic success acknowledgement.
  await cdp.send('Network.setBlockedURLs', { urls: [apiBase + '/api/files/' + a.id] })
  await append(' recovered-after-block')
  await key('s', 83, 2)
  await until(() => evaluate("document.querySelector('.save-state.error')?.textContent.includes('保存未确认')"), 'Save failure was not visible')
  assert.ok(!textOf(JSON.parse((await api('/api/files/' + a.id)).content).root).includes('recovered-after-block'))
  await screenshot('failure-retains-draft')
  await cdp.send('Network.setBlockedURLs', { urls: [] })
  await click('.status-retry-btn')
  await assertSaved(a.id, '自动保存标题', 'recovered-after-block')
  report.checks.push('real failed browser PUT retains draft, actual retry saves it')
  await screenshot('retry-saved')
  // Leave a new, not explicitly saved edit. Closing must use the real main
  // process / IPC freeze-and-save gate before terminating its own backend.
  await append(' native-close-latest')
  await closeWindow()
  report.checks.push('WM_CLOSE with dirty Lexical body completed real quit gate and backend shutdown')
  await server.start()
  const persisted = (await server.call('/api/files/' + a.id)).content
  assert.ok(textOf(JSON.parse(persisted).root).includes('native-close-latest'))
  await server.stop()
  // Use a fresh Chromium profile so a stale draft cache cannot fake persistence.
  rmSync(path.join(scratch, 'profile'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  await launch(); await open(a.id, 'native-close-latest')
  assert.equal((await api('/api/files/' + a.id)).content, persisted)
  await screenshot('restarted-fresh-profile')
  await closeWindow()
  report.checks.push('fresh-profile packaged restart reads latest body from real database and closes cleanly')
  report.finalBodySHA256 = hash(Buffer.from(persisted)); report.complete = true; report.finishedAt = new Date().toISOString(); saveReport()
  verifyDesktopSaveReport(out, process.env.GITHUB_SHA)
} catch (error) {
  report.complete = false; report.error = String(error?.stack || error); saveReport()
  if (cdp) { try { await screenshot('failed-state') } catch {} }
  throw error
} finally {
  cdp?.close()
  if (child && child.exitCode === null) {
    // Failure-only cleanup, limited to the process tree created above.
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000 })
    await Promise.race([exited.catch(() => {}), sleep(3000)])
  }
  writeFileSync(path.join(out, 'desktop.log'), trace)
  await server?.dispose()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
console.log('Actual packaged desktop save/retry/quit/restart verification passed.')
