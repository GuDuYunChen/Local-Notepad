// Real built renderer + actual isolated Go backend. Linux results are NOT a
// Windows packaged-app or installation acceptance. Only synthetic image data.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const net = require('node:net')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const out = path.resolve(process.env.IMAGE_UI_OUTPUT || path.join(root, 'test-results/image-upload-ui'))
const fixture = process.env.IMAGE_UI_FIXTURE
assert.ok(fixture && path.isAbsolute(fixture), 'Provide a synthetic JPEG fixture path')
assert.ok(fs.statSync(fixture).size > 2 * 1024 * 1024 && fs.statSync(fixture).size < 10 * 1024 * 1024)
fs.mkdirSync(out, { recursive: true })
assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Refuse stale UI report')
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-image-ui-'))
app.setPath('userData', path.join(owned, 'profile'))
const report = { complete: false, productVersion: require('../package.json').version,
  platform: process.platform, electron: process.versions.electron, windowsAcceptance: false,
  installationTested: false, realBuiltRenderer: true, realBackend: true, syntheticDataOnly: true,
  checks: [], screenshots: [], uploads: [], notes: [], backendExit: null }
const binding = file => {
  const data = fs.readFileSync(file)
  return { bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }
}
const builtFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name)
  assert.ok(!entry.isSymbolicLink(), 'No symlink in tested build')
  return entry.isDirectory() ? builtFiles(file) : [file]
})
report.sourceBindings = Object.fromEntries([
  'package.json', 'package-lock.json', 'src/components/Editor/utils/fileUpload.js',
  'src/components/Editor/utils/imageUpload.js', 'src/components/Editor/hooks/useImageUploadSession.js',
  'src/components/Editor/hooks/useEditorWriteScope.js', 'src/components/Editor/plugins/ToolbarPlugin.jsx',
  'src/components/Editor/plugins/PasteImagePlugin.jsx', 'src/styles/redesign.css',
  'scripts/check-image-upload-recovery-ui.cjs',
].map(name => [name, binding(path.join(root, name))]))
report.buildBindings = Object.fromEntries(builtFiles(path.join(root, 'dist')).map(file => [path.relative(root, file).split(path.sep).join('/'), binding(file)]))
report.backendBinding = binding(path.join(root, 'server/bin', process.platform === 'win32' ? 'notepad-server.exe' : 'notepad-server'))
report.fixtureBinding = binding(fixture)
const persist = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
const expectedChecks = ['actual-note-entry', 'toolbar-preview-failure-keeps-one-original',
  'failed-original-preserves-body', 'explicit-same-file-retry', 'encoder-exception-falls-back-without-hanging',
  'explicit-cancel-aborts-without-note-write', 'reading-mode-invalidates-pending-upload',
  'actual-editor-paste-preview-recovery', 'document-switch-does-not-write-to-new-note',
  'save-reload-images-and-original-content', 'minimum-window-dark-cancel-visible-focusable']
const mark = name => { assert.equal(name, expectedChecks[report.checks.length]); report.checks.push(name); persist() }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, name, ms = 15000) {
  const end = Date.now() + ms
  do { if (await check()) return; await sleep(75) } while (Date.now() < end)
  throw new Error('Timed out: ' + name)
}
async function freePort() {
  const s = net.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port
}
let win, backend, proxy, mode = 'normal', modeUploads = 0, backendClosed
let terminal = false
const deadline = setTimeout(() => finish(new Error('UI deadline exceeded')), 150000)
async function finish(error) {
  if (terminal) return
  terminal = true; clearTimeout(deadline)
  if (error) { report.error = error.message; console.error(error.stack) }
  if (win && !win.isDestroyed()) {
    if (error) { try { fs.writeFileSync(path.join(out, 'failure.png'), (await win.capturePage()).toPNG()) } catch {} }
    win.destroy()
  }
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) }
  if (backend) {
    backend.stdin.end()
    let timer
    try { await Promise.race([backendClosed, new Promise(resolve => { timer = setTimeout(resolve, 10000) })]) }
    finally { clearTimeout(timer) }
    if (report.backendExit?.code !== 0) {
      report.error ||= 'Backend did not exit normally'; backend.kill()
    }
  }
  if (report.checks.length !== expectedChecks.length) report.error ||= 'Required UI checks incomplete'
  report.complete = !report.error && report.backendExit?.code === 0; persist()
  console.log(JSON.stringify({ complete: report.complete, checks: report.checks.length, platform: report.platform, windowsAcceptance: false }))
  app.exit(report.complete ? 0 : 1)
}
process.on('unhandledRejection', finish)
process.on('uncaughtException', finish)
app.on('window-all-closed', () => {}) // This runner, not Electron default shutdown, owns final cleanup.
process.on('exit', () => { if (!terminal && !report.complete) { report.error ||= 'Renderer check exited without a complete report'; persist() } })
app.whenReady().then(async () => {
  const port = await freePort(), backendURL = `http://127.0.0.1:${port}`
  const exe = path.join(root, 'server/bin', process.platform === 'win32' ? 'notepad-server.exe' : 'notepad-server')
  const log = fs.createWriteStream(path.join(out, 'backend.log'))
  backend = spawn(exe, [], { cwd: owned, env: { ...process.env, PORT: String(port), NOTEPAD_DATA: path.join(owned, 'data'), NOTEPAD_PARENT_STDIN: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  backend.stdout.pipe(log); backend.stderr.pipe(log)
  backendClosed = new Promise(resolve => backend.once('close', (code, signal) => { report.backendExit = { code, signal }; resolve() }))
  backend.on('error', error => finish(error))
  await until(async () => { try { return (await fetch(backendURL + '/api/health')).ok } catch { return false } }, 'backend')
  const { desktopNote } = await import(pathToFileURL(path.join(root, 'scripts/desktop-save-fixture.mjs')))
  async function create(title) {
    const response = await fetch(backendURL + '/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content: desktopNote(title, '合成验收正文必须保留') }) })
    const body = await response.json(); assert.equal(body.code, 0); report.notes.push(body.data.id); return body.data.id
  }
  const note = await create('图片恢复验收'), other = await create('切换保护验收')
  proxy = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    let entry
    if (req.method === 'POST' && req.url === '/api/upload') {
      modeUploads++
      entry = { mode, sequence: modeUploads, bytes: Number(req.headers['content-length']), forwarded: false }
      report.uploads.push(entry); persist()
      if (mode === 'hold') { req.resume(); res.on('close', () => { entry.connectionClosed = true; persist() }); return }
      if (mode === 'fail-original' || (mode === 'fail-preview' && modeUploads === 2)) {
        req.resume(); res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 1010, message: 'synthetic upload refusal' })); entry.refused = true; persist(); return
      }
      entry.forwarded = true
    }
    const forward = http.request(backendURL + req.url, { method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, response => {
      res.writeHead(response.statusCode, { ...response.headers, 'access-control-allow-origin': '*' })
      response.pipe(res)
    })
    forward.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(forward)
    req.on('aborted', () => forward.destroy())
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${proxy.address().port}`
  const preload = path.join(owned, 'preload.cjs')
  fs.writeFileSync(preload, `require('electron').contextBridge.exposeInMainWorld('__API_BASE__', ${JSON.stringify(base)});`)
  win = new BrowserWindow({ show: true, width: 1200, height: 900, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  win.on('closed', () => { if (!terminal) void finish(new Error('Unexpected renderer window close')) })
  win.webContents.debugger.attach('1.3')
  const evaluate = code => win.webContents.executeJavaScript(code, true)
  const click = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing control');e.click();return true})()`)
  async function open(id) {
    if (!await evaluate(`!!document.querySelector('[data-file-id="${id}"]')`)) {
      await evaluate(`document.querySelector('[aria-label="展开侧边栏"]')?.click()`)
    }
    await until(() => evaluate(`!!document.querySelector('[data-file-id="${id}"]')`), 'note entry')
    await click(`[data-file-id="${id}"]`)
    const title = id === note ? '图片恢复验收' : '切换保护验收'
    await until(() => evaluate(`!!document.querySelector('.editor-input') && document.querySelector('.editor-input').textContent.includes(${JSON.stringify(title)})`), 'editor body')
  }
  async function select() {
    if (!await evaluate(`!!document.querySelector('input[accept="image/*"]')`)) await click('[aria-label="插入内容"]')
    const { root: dom } = await win.webContents.debugger.sendCommand('DOM.getDocument')
    const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: dom.nodeId, selector: 'input[accept="image/*"]' })
    assert.ok(nodeId)
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [fixture] })
  }
  async function body() { return (await (await fetch(backendURL + '/api/files/' + note)).json()).data.content }
  function images(text) {
    const all = []
    const visit = node => { if (node.type === 'image') all.push(node); for (const child of node.children || []) visit(child) }
    visit(JSON.parse(text).root); return all
  }
  async function saveCount(count) {
    await until(() => evaluate(`document.querySelectorAll('.editor-image-block').length === ${count}`), 'inserted image count')
    await evaluate(`document.querySelector('.editor-input').focus()`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control'] })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control'] })
    await until(async () => images(await body()).length === count, 'original Ctrl+S save receipt')
    assert.ok((await body()).includes('合成验收正文必须保留'))
  }
  async function screenshot(name) {
    const bytes = (await win.capturePage()).toPNG(); fs.writeFileSync(path.join(out, name), bytes)
    report.screenshots.push({ name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }); persist()
  }
  const setMode = next => { mode = next; modeUploads = 0 }
  await win.loadFile(path.join(root, 'dist/index.html'))
  await open(note); mark('actual-note-entry')
  setMode('fail-preview'); await select(); await saveCount(1)
  let saved = images(await body()); assert.equal(saved[0].src, saved[0].originalSrc); assert.equal(modeUploads, 2)
  const originalBytes = Buffer.from(await (await fetch(saved[0].originalSrc)).arrayBuffer())
  assert.deepEqual(originalBytes, fs.readFileSync(fixture))
  await until(() => evaluate(`document.body.textContent.includes('已插入原图')`), 'fallback feedback')
  mark('toolbar-preview-failure-keeps-one-original'); await screenshot('toolbar-recovered.png')
  const beforeFailure = await body()
  setMode('fail-original'); await select()
  await until(() => evaluate(`document.body.textContent.includes('1 张失败') && !document.querySelector('input[accept="image/*"]')?.disabled`), 'failure feedback')
  assert.equal(await body(), beforeFailure); assert.equal(modeUploads, 1); mark('failed-original-preserves-body')
  setMode('normal'); await select(); await saveCount(2); assert.equal(modeUploads, 2); mark('explicit-same-file-retry')
  await evaluate(`(()=>{window.__savedToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(){throw new Error('synthetic encoder failure')};return true})()`)
  setMode('normal'); await select(); await saveCount(3); assert.equal(modeUploads, 1)
  await evaluate(`HTMLCanvasElement.prototype.toBlob=window.__savedToBlob;delete window.__savedToBlob`)
  mark('encoder-exception-falls-back-without-hanging')
  const beforeCancel = await body()
  setMode('hold'); await select(); await until(() => Promise.resolve(modeUploads === 1), 'held upload')
  win.focus(); win.webContents.focus()
  await evaluate(`(()=>{window.__imageCancelInput=[];const e=Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='取消图片上传');for(const type of ['keydown','keyup','click'])e.addEventListener(type,event=>window.__imageCancelInput.push({type:event.type,key:event.key||null,trusted:event.isTrusted}));e.focus();return document.activeElement===e})()`)
  // Use the browser input protocol's Enter text as well as its key identity;
  // an Electron raw key pair alone did not produce a button activation here.
  const enter = { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  const releaseEnter = { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  report.keyboardCommands = [enter, releaseEnter]
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', enter)
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', releaseEnter)
  report.keyboardCancel = await evaluate(`window.__imageCancelInput`); persist()
  await until(() => evaluate(`!document.querySelector('[aria-label="图片上传进度"]')`), 'cancelled progress')
  assert.ok(report.keyboardCancel.some(e => e.type === 'keydown' && e.key === 'Enter' && e.trusted))
  assert.ok(report.keyboardCancel.some(e => e.type === 'click' && e.trusted))
  assert.equal(await body(), beforeCancel); mark('explicit-cancel-aborts-without-note-write')
  setMode('hold'); await select(); await until(() => Promise.resolve(modeUploads === 1), 'reading pending upload')
  await click('[aria-label="切换到阅读模式"]'); await click('[aria-label="切换到编辑模式"]')
  await sleep(400); assert.equal(await body(), beforeCancel); mark('reading-mode-invalidates-pending-upload')
  setMode('fail-preview')
  const encoded = fs.readFileSync(fixture).toString('base64')
  await evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'pasted-original.jpg',{type:'image/jpeg'}));const e=document.querySelector('.editor-input');e.focus();e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));return true})()`)
  await saveCount(4); assert.equal(modeUploads, 2); saved = images(await body()); assert.equal(saved[3].src, saved[3].originalSrc)
  report.pasteInput = 'browser ClipboardEvent with actual synthetic JPEG, not operating-system clipboard'
  mark('actual-editor-paste-preview-recovery'); await screenshot('paste-recovered.png')
  setMode('hold'); await select(); await until(() => Promise.resolve(modeUploads === 1), 'switch pending upload')
  await open(other); await sleep(300)
  const otherBody = (await (await fetch(backendURL + '/api/files/' + other)).json()).data.content
  assert.equal(images(otherBody).length, 0); mark('document-switch-does-not-write-to-new-note')
  setMode('normal'); await open(note)
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload() })
  await open(note); await saveCount(4)
  await until(() => evaluate(`Array.from(document.querySelectorAll('.editor-input img')).filter(e=>e.naturalWidth>0).length>=4`), 'persisted image rendering')
  mark('save-reload-images-and-original-content')
  win.setContentSize(704, 455)
  await evaluate(`document.documentElement.dataset.theme='dark'`)
  setMode('hold'); await select(); await until(() => Promise.resolve(modeUploads === 1), 'narrow pending upload')
  // Coordinates/focus alone are insufficient: a pointer-transparent toast can
  // still visually obscure a control. Retain a deterministic old-toast case.
  await evaluate(`window.dispatchEvent(new CustomEvent('local-notepad:toast',{detail:{action:'show',toast:{id:'ui-owned-save-notice',type:'success',content:'正文已保存',duration:3000}}}))`)
  await until(() => evaluate(`!!document.querySelector('.app-toast')`), 'existing feedback visible')
  const bounds = await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='取消图片上传');const r=e.getBoundingClientRect();e.focus();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);const overlaps=Array.from(document.querySelectorAll('.app-toast,.toolbar-more-menu')).filter(v=>!v.contains(e)).filter(v=>{const b=v.getBoundingClientRect();return b.left<r.right&&b.right>r.left&&b.top<r.bottom&&b.bottom>r.top}).length;return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,focused:document.activeElement===e,hit:hit===e||e.contains(hit),overlays:overlaps}})()`)
  report.narrowCancel = bounds; persist()
  assert.equal(bounds.hit, true, 'Cancellation must be hit-testable')
  assert.equal(bounds.overlays, 0, 'Cancellation must not be obscured by menus or feedback')
  assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height && bounds.focused)
  report.narrowCancel = bounds
  await screenshot('narrow-dark-cancel.png')
  const point = { x: Math.round((bounds.left + bounds.right) / 2), y: Math.round((bounds.top + bounds.bottom) / 2), button: 'left', clickCount: 1 }
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point })
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point })
  await until(() => evaluate(`!document.querySelector('[aria-label="图片上传进度"]')`), 'visible pointer cancellation')
  mark('minimum-window-dark-cancel-visible-focusable')
  await saveCount(4)
  report.persistedImages = images(await body()).map(({ src, originalSrc, alt }) => ({ src, originalSrc, alt }))
  await finish()
}).catch(finish)
