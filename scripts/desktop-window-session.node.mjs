import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { createDesktopWindowSession, desktopWindowWorkerArguments } from './desktop-window-session.mjs'
import { selectDesktopUnappliedDialog, UNAPPLIED_QUIT_DIALOG_CAPTION, UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE } from './desktop-window-target.mjs'

const window = { pid: 100, handle: 300, title: '记事本', cls: 'Chrome_WidgetWin_1',
  visible: true, childText: ['Chrome Legacy Window'] }
const executablePath = 'C:\\owned-reading-contract\\Notepad.exe'
const unappliedDialog = { pid: 100, handle: 400, title: UNAPPLIED_QUIT_DIALOG_CAPTION,
  cls: '#32770', visible: true, childText: [UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE, 'OK'], image: executablePath }
function accessibleDialog() {
  // Only the native Error/OK shape was captured in artifact 12198073599.
  // UIA names below are synthetic contract inputs, not observed native evidence.
  const dialog = { ...unappliedDialog, childText: ['OK'] }
  const boundWindow = { pid: dialog.pid, handle: dialog.handle, image: dialog.image, title: dialog.title, cls: dialog.cls, visible: true }
  dialog.accessibility = { source: 'UIAutomation.FromHandle.FindAll.Descendants', status: 'complete',
    budgetMs: 2000, elapsedMs: 12, boundWindow, revalidatedWindow: { ...boundWindow },
    root: { pid: 100, handle: 400, name: 'Error', cls: '#32770' },
    elements: [UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE, 'OK'].map(name => ({ pid: 100, handle: 0, name, cls: 'Text' })),
    errorCode: null, errorType: null }
  return dialog
}
function mock({ ready = true, response, replyDelay = 0, holdExit = false } = {}) {
  const child = new EventEmitter(), calls = [], commands = [], events = []
  let ended = false, killed = 0
  const exit = (code, signal = null) => {
    if (ended) return; ended = true; child.emit('exit', code, signal)
  }
  child.pid = 800; child.stdout = new PassThrough(); child.stderr = new PassThrough()
  const send = value => child.stdout.write(JSON.stringify(value) + '\r\n')
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      const request = JSON.parse(chunk.toString()); commands.push(request); callback()
      const value = response ? response(request)
        : request.op === 'inspect' ? { id: request.id, ok: true, windows: [{ ...window, pid: request.pid }] }
          : request.op === 'dismiss-unapplied' ? { id: request.id, ok: true, posted: true, window: structuredClone(unappliedDialog), windows: [structuredClone(unappliedDialog)] }
          : { id: request.id, ok: true, posted: true }
      if (value !== undefined) {
        if (replyDelay) setTimeout(() => send(value), replyDelay)
        else queueMicrotask(() => send(value))
      }
    },
    final(callback) { callback(); if (!holdExit) queueMicrotask(() => exit(0)) },
  })
  child.kill = () => { killed++; queueMicrotask(() => exit(null, 'SIGTERM')); return true }
  const spawnWorker = (...args) => {
    calls.push(args); if (ready) queueMicrotask(() => send({ protocol: 1, ready: true })); return child
  }
  return { child, spawnWorker, calls, commands, events, send, exit, get killed() { return killed } }
}
function session(t, options = {}, budget = {}) {
  const m = mock(options)
  const s = createDesktopWindowSession({ spawnWorker: m.spawnWorker,
    startupMs: 500, requestMs: 500, onEvent: e => m.events.push(e), ...budget })
  t.after(() => s.dispose())
  return { m, s }
}

const workerBytes = readFileSync(new URL('./desktop-window-worker.ps1', import.meta.url))
function decodeWorkerSpawn([command, args, options], expectedBytes = workerBytes) {
  assert.equal(command, 'powershell.exe')
  assert.equal(args.length, 4)
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  assert.deepEqual(options, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  assert.match(args[3], /^[A-Za-z0-9+/]+={0,2}$/)
  const commandLine = [command, ...args].map(value => '"' + value + '"').join(' ') + '\0'
  assert.ok(commandLine.length < 32767)
  const bootstrap = Buffer.from(args[3], 'base64').toString('utf16le')
  assert.equal(Buffer.from(bootstrap, 'utf16le').toString('base64'), args[3])
  const payload = bootstrap.match(/\[Convert\]::FromBase64String\('([A-Za-z0-9+/]+={0,2})'\)/)?.[1]
  assert.ok(payload)
  assert.equal(bootstrap.replace(payload, '<gzip>'),
    "$ErrorActionPreference='Stop';$desktopPayload=[Convert]::FromBase64String('<gzip>');" +
    '$desktopStream=[IO.MemoryStream]::new($desktopPayload);' +
    '$desktopZip=[IO.Compression.GZipStream]::new($desktopStream,[IO.Compression.CompressionMode]::Decompress);' +
    '$desktopReader=[IO.StreamReader]::new($desktopZip,[Text.UTF8Encoding]::new($false,$true),$false);' +
    'try{$desktopSource=$desktopReader.ReadToEnd()}finally{$desktopReader.Dispose()};' +
    '&([ScriptBlock]::Create($desktopSource))')
  assert.equal(Buffer.from(payload, 'base64').toString('base64'), payload)
  const decoded = gunzipSync(Buffer.from(payload, 'base64'), { maxOutputLength: 1024 * 1024 })
  assert.deepEqual(decoded, expectedBytes)
  return decoded
}

test('spawned helper command stays below the Windows CreateProcessW limit including NUL', async t => {
  const { m, s } = session(t)
  await s.ready
  const [command, args] = m.calls[0]
  // Quote every argument to conservatively include the Windows spawn overhead.
  const commandLine = [command, ...args].map(value => '"' + value + '"').join(' ') + '\0'
  assert.ok(commandLine.length < 32767, 'Windows command line has ' + commandLine.length + ' UTF-16 code units including NUL')
})

test('actual spawned compressed payload preserves every UTF8 worker byte with explicit decoding', async t => {
  const { m, s } = session(t)
  await s.ready
  const source = decodeWorkerSpawn(m.calls[0]).toString('utf8')
  assert.ok(source.includes(UNAPPLIED_QUIT_DIALOG_TITLE))
  assert.ok(source.includes(UNAPPLIED_QUIT_DIALOG_MESSAGE))
})

for (const [name, change] of [
  ['another executable', call => { call[0] = 'other.exe' }],
  ['unexpected startup arguments', call => { call[1].unshift('-ExecutionPolicy', 'Bypass') }],
  ['malformed encoded command', call => { call[1][3] = '!' + call[1][3] }],
  ['oversized encoded command', call => { call[1][3] = call[1][3].repeat(3) }],
  ['invalid gzip payload', call => {
    const bootstrap = Buffer.from(call[1][3], 'base64').toString('utf16le')
    call[1][3] = Buffer.from(bootstrap.replace(/FromBase64String\('[A-Za-z0-9+/=]+'\)/,
      "FromBase64String('" + Buffer.from('not a gzip stream').toString('base64') + "')"), 'utf16le').toString('base64')
  }],
]) test('spawn payload contract rejects ' + name, async t => {
  const { m, s } = session(t)
  await s.ready
  const call = structuredClone(m.calls[0]); change(call)
  assert.throws(() => decodeWorkerSpawn(call))
})

for (const [name, source] of [
  ['non-buffer source', 'not a Buffer'],
  ['empty worker', Buffer.alloc(0)],
  ['invalid UTF8 bytes', Buffer.from([0xff, 0xfe])],
]) test('worker startup rejects ' + name + ' before spawning', () => {
  assert.throws(() => desktopWindowWorkerArguments(source), error => error.code === 'INVALID_WORKER_UTF8')
})

test('worker startup refuses a valid UTF8 payload that would exceed the Windows command limit', () => {
  const source = Buffer.from(Array.from({ length: 2048 }, (_, i) => createHash('sha256').update(String(i)).digest('hex')).join('\n'))
  assert.throws(() => desktopWindowWorkerArguments(source), error => error.code === 'WORKER_COMMAND_LIMIT')
})

for (const [name, source] of [
  ['UTF8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), workerBytes])],
  ['Windows CRLF', Buffer.from(workerBytes.toString('utf8').replace(/\r?\n/g, '\r\n'))],
]) test('compressed source byte transport preserves ' + name, () => {
  // Byte transport only; this does not claim Windows PowerShell execution here.
  decodeWorkerSpawn(['powershell.exe', desktopWindowWorkerArguments(source),
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }], source)
})

test('Electron Windows TaskDialog uses Error caption with separate exact instruction and content', () => {
  // This is the documented Electron 31.7.7 mapping, not a captured Windows run.
  const dialog = { ...unappliedDialog, title: 'Error',
    childText: [UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE, 'OK'] }
  assert.deepEqual(selectDesktopUnappliedDialog([window, dialog], 100, executablePath), dialog)
})

test('Error and OK native text requires separately bound accessible instruction and full content', () => {
  const dialog = accessibleDialog()
  assert.throws(() => selectDesktopUnappliedDialog([{ ...dialog, accessibility: undefined }], 100, executablePath))
  assert.equal(selectDesktopUnappliedDialog([window, dialog], 100, executablePath), dialog)
  assert.deepEqual(dialog.childText, ['OK'])
})

test('accessible inspection carries the exact authorized executable to the native helper', async t => {
  const { m, s } = session(t)
  await s.inspect(100, executablePath)
  assert.deepEqual(m.commands, [{ id: 1, op: 'inspect', pid: 100, executablePath }])
})

test('fresh native dismissal receipt retains its actual revalidated window without caller mutation', async t => {
  const { s } = session(t, { response: request => ({ id: request.id, ok: true, posted: true,
    window: structuredClone(unappliedDialog), windows: [structuredClone(unappliedDialog)] }) })
  assert.equal(await s.dismissUnappliedDialog(unappliedDialog, executablePath), true)
  const event = s.events().at(-1)
  assert.deepEqual(event.window, unappliedDialog)
  event.window.childText.push('caller mutation')
  assert.deepEqual(s.events().at(-1).window.childText, unappliedDialog.childText)
})

for (const [name, change] of [
  ['unidentified source', a => a.source = 'renderer text'],
  ['timeout', a => { a.status = 'timeout'; a.errorCode = 'UIA_TIMEOUT'; a.elapsedMs = 2001 }],
  ['unsupported provider', a => { a.status = 'unsupported'; a.errorCode = 'UIA_UNSUPPORTED' }],
  ['stale native handle', a => a.revalidatedWindow.handle++],
  ['wrong native executable', a => a.boundWindow.image = 'C:\\other\\Other.exe'],
  ['UIA root in another process', a => a.root.pid++],
  ['UIA root from another HWND', a => a.root.handle++],
  ['descendant from another process', a => a.elements[0].pid++],
  ['missing full instruction', a => a.elements[0].name = '退出未完成'],
  ['missing full content', a => a.elements[1].name = '尚未应用'],
  ['unbounded enumeration', a => a.elements = Array.from({ length: 65 }, () => ({ ...a.elements[0] }))],
]) test('accessible dialog refuses ' + name, () => {
  const dialog = accessibleDialog(); change(dialog.accessibility)
  assert.throws(() => selectDesktopUnappliedDialog([dialog], 100, executablePath))
})

test('another visible Error HWND prevents accessible selection even without matching text', () => {
  const dialog = accessibleDialog(), other = { ...unappliedDialog, handle: 401, childText: ['OK'] }
  assert.throws(() => selectDesktopUnappliedDialog([dialog, other], 100, executablePath))
})

for (const code of ['UIA_ASSEMBLY_UNAVAILABLE', 'UIA_PREWARM_FAILED']) test('records precise helper startup refusal ' + code, async t => {
  const { m, s } = session(t, { ready: false })
  const diagnostic = { source: 'UIAutomation', errorType: 'ObservedException', hresult: -1 }
  m.send({ protocol: 1, ready: false, error: code, diagnostic })
  await assert.rejects(s.ready, error => error.code === code)
  assert.deepEqual(s.events().at(-1).diagnostic, diagnostic)
  assert.equal(m.commands.length, 0)
})

for (const [name, change] of [
  ['missing fresh native array', r => delete r.windows],
  ['another fresh handle', r => { r.window.handle++; r.windows[0].handle++ }],
  ['another fresh image', r => { r.window.image = 'C:\\other\\Other.exe'; r.windows[0].image = r.window.image }],
  ['ambiguous fresh Error windows', r => r.windows.push({ ...r.windows[0], handle: 401 })],
]) test('fresh dismissal rejects ' + name + ' and never replays the close', async t => {
  const { m, s } = session(t, { response: request => {
    const reply = { id: request.id, ok: true, posted: true, window: structuredClone(unappliedDialog), windows: [structuredClone(unappliedDialog)] }
    change(reply); return reply
  } })
  await assert.rejects(s.dismissUnappliedDialog(unappliedDialog, executablePath), error => error.code === 'INVALID_DISMISS_OBSERVATION')
  await assert.rejects(s.dismissUnappliedDialog(unappliedDialog, executablePath), error => error.code === 'SESSION_UNAVAILABLE')
  assert.equal(m.commands.length, 1)
})

test('fresh UIA timeout retains original native OK text and failure code without reporting dismissal', async t => {
  const observed = accessibleDialog()
  Object.assign(observed.accessibility, { status: 'timeout', errorCode: 'UIA_TIMEOUT', elapsedMs: 2001, root: null, elements: [] })
  const { m, s } = session(t, { response: request => ({ id: request.id, ok: true, posted: false,
    window: observed, windows: [observed], reason: 'UIA_TIMEOUT' }) })
  await assert.rejects(s.dismissUnappliedDialog(unappliedDialog, executablePath), error => error.code === 'DISMISS_NOT_CONFIRMED')
  const failure = s.events().at(-1)
  assert.equal(failure.reason, 'UIA_TIMEOUT')
  assert.deepEqual(failure.nativeWindows[0].childText, ['OK'])
  assert.equal(failure.nativeWindow.accessibility.status, 'timeout')
  assert.equal(m.commands.length, 1)
  assert.equal(s.events().some(event => event.type === 'dismiss-unapplied' && event.completed), false)
})

test('the specific unapplied dialog is dismissed once and the event journal cannot be edited by a caller', async t => {
  const { m, s } = session(t)
  await s.ready
  assert.deepEqual(selectDesktopUnappliedDialog([window, unappliedDialog], 100, executablePath), unappliedDialog)
  assert.equal(await s.dismissUnappliedDialog(unappliedDialog, executablePath), true)
  assert.deepEqual(m.commands, [{ id: 1, op: 'dismiss-unapplied', pid: 100, handle: 400, executablePath }])
  const observed = s.events()
  observed[0].type = 'forged'; observed.push({ type: 'forged' })
  assert.deepEqual(s.events().map(event => event.type), ['spawn', 'ready', 'dismiss-unapplied'])
  assert.equal(s.events().at(-1).completed, true)
})

for (const [name, patch] of [
  ['different error title', { title: 'another window' }],
  ['application instruction used as native caption', { title: UNAPPLIED_QUIT_DIALOG_TITLE }],
  ['Error caption without application instruction', { childText: [UNAPPLIED_QUIT_DIALOG_MESSAGE, 'OK'] }],
  ['Error caption without complete message', { childText: [UNAPPLIED_QUIT_DIALOG_TITLE, 'OK'] }],
  ['partial unapplied message', { childText: ['未应用'] }],
  ['renderer instead of native dialog', { cls: 'Chrome_WidgetWin_1' }],
  ['hidden dialog', { visible: false }],
  ['missing native handle', { handle: 0 }],
  ['missing image', { image: undefined }],
  ['different executable', { image: 'C:\\unrelated\\Other.exe' }],
]) test('unapplied dismissal refuses ' + name + ' before posting any native request', async t => {
  const { m, s } = session(t)
  assert.throws(() => s.dismissUnappliedDialog({ ...unappliedDialog, ...patch }, executablePath))
  assert.equal(m.commands.length, 0)
})

test('native unapplied selection refuses another process and ambiguous matching dialogs', () => {
  assert.throws(() => selectDesktopUnappliedDialog([{ ...unappliedDialog, pid: 999 }], 100, executablePath))
  assert.throws(() => selectDesktopUnappliedDialog([unappliedDialog, { ...unappliedDialog, handle: 401 }], 100, executablePath))
  assert.throws(() => selectDesktopUnappliedDialog([unappliedDialog, { ...unappliedDialog }], 100, executablePath))
})

test('an unconfirmed native dismissal is never replayed or reported as a completed action', async t => {
  const { m, s } = session(t, { response: request => ({ id: request.id, ok: true, posted: false }) })
  await assert.rejects(s.dismissUnappliedDialog(unappliedDialog, executablePath), error => error.code === 'DISMISS_NOT_CONFIRMED')
  await assert.rejects(s.dismissUnappliedDialog(unappliedDialog, executablePath), error => error.code === 'SESSION_UNAVAILABLE')
  assert.equal(m.commands.length, 1)
  assert.equal(s.events().some(event => event.type === 'dismiss-unapplied' && event.completed), false)
})

test('one prewarmed helper handles both processes and four requests with no replay', async t => {
  const {m,s}=session(t)
  await s.ready
  for (const pid of [100,200]) {
    const rows=await s.inspect(pid); assert.equal(rows[0].pid,pid)
    assert.equal(await s.close(rows[0]),true)
  }
  assert.equal(await s.dispose(),true)
  assert.equal(m.calls.length,1); assert.equal(m.killed,0)
  assert.deepEqual(m.commands.map(x=>[x.id,x.op,x.pid]),[[1,'inspect',100],[2,'close',100],[3,'inspect',200],[4,'close',200]])
  assert.deepEqual(m.events.map(x=>x.type),['spawn','ready','inspect','close','inspect','close','disposed'])
  assert.equal(m.calls[0][0],'powershell.exe')
  assert.deepEqual(m.calls[0][2].stdio,['pipe','pipe','pipe'])
  assert.equal(m.calls[0][2].windowsHide,true)
  const script=decodeWorkerSpawn(m.calls[0]).toString('utf8')
  assert.equal((script.match(/Add-Type -TypeDefinition/g)||[]).length,1)
  assert.ok(script.includes('PostMessage(hwnd, 0x0010'))
  assert.ok(script.includes('const string caption = "' + UNAPPLIED_QUIT_DIALOG_CAPTION + '"'))
  assert.ok(script.includes('const string title = "' + UNAPPLIED_QUIT_DIALOG_TITLE + '"'))
  assert.ok(script.includes('const string message = "' + UNAPPLIED_QUIT_DIALOG_MESSAGE + '"'))
  assert.ok(script.includes('chosen.title != caption'))
  assert.ok(script.includes('if (!matchesTitle || !matchesMessage) return result;'))
  assert.ok(script.includes('AutomationElement.FromHandle(new IntPtr(window.handle))'))
  assert.ok(script.includes('root.FindAll(TreeScope.Descendants,Condition.TrueCondition)'))
  assert.ok(script.includes('thread.SetApartmentState(ApartmentState.MTA)'))
  assert.ok(script.includes('job.done.WaitOne(2000)'))
  assert.ok(script.includes('poisoned=true'))
  assert.ok(!script.includes('AutomationElement.RootElement'))
  assert.ok(!script.includes('InvokePattern'))
  assert.ok(!script.includes('Stop-Process'))
})
test('a pending native request does not block the Node event loop', async t => {
  const {s}=session(t,{replyDelay:30})
  let heartbeat=false
  setTimeout(()=>{heartbeat=true},1)
  await s.inspect(100)
  assert.equal(heartbeat,true)
})
test('read waits for explicit startup acknowledgement without issuing requests early', async t => {
  const {m,s}=session(t,{ready:false})
  const read=s.inspect(100)
  await delay(5); assert.equal(m.commands.length,0)
  m.send({protocol:1,ready:true})
  assert.equal((await read)[0].pid,100)
})
test('startup timeout fails once and never sends a window command', async t => {
  const {m,s}=session(t,{ready:false},{startupMs:20})
  await assert.rejects(s.ready,e=>e.code==='STARTUP_TIMEOUT')
  assert.equal(m.commands.length,0); assert.equal(m.calls.length,1)
})
test('native request timeout never retries WM_CLOSE or declares completion', async t => {
  const {m,s}=session(t,{response:()=>undefined},{requestMs:20})
  await assert.rejects(s.close(window),e=>e.code==='REQUEST_TIMEOUT')
  m.send({id:1,ok:true,posted:true})
  await assert.rejects(s.inspect(100),e=>e.code==='SESSION_UNAVAILABLE')
  assert.equal(m.commands.length,1); assert.equal(m.calls.length,1)
  assert.equal(m.events.some(e=>e.type==='close'&&e.completed),false)
})
test('another PID, malformed windows and unsuccessful close replies fail closed', async t => {
  for (const reply of [
    {id:1,ok:true,windows:[{...window,pid:999}]},
    {id:1,ok:true,windows:{}},
    {id:1,ok:true,windows:[{...window,childText:['ok',5]}]},
  ]) {
    const {m,s}=session(t,{response:()=>reply})
    await assert.rejects(s.inspect(100),e=>e.code==='INVALID_WINDOWS')
    assert.equal(m.commands.length,1)
  }
  const {m,s}=session(t,{response:r=>({id:r.id,ok:true,posted:false})})
  await assert.rejects(s.close(window),e=>e.code==='CLOSE_NOT_CONFIRMED')
  assert.equal(m.commands.length,1)
})
test('one PowerShell list wrapper is accepted, but unrelated wrappers are not', async t => {
  const {s}=session(t,{response:r=>({id:r.id,ok:true,windows:[[window]]})})
  assert.deepEqual(await s.inspect(100),[window])
})
test('empty window query is not a fabricated main window', async t => {
  const {m,s}=session(t,{response:r=>({id:r.id,ok:true,windows:[]})})
  assert.deepEqual(await s.inspect(100),[])
  assert.throws(()=>s.close(undefined)); assert.equal(m.commands.length,1)
})
test('ambiguous or stale request acknowledgement cannot satisfy another request', async t => {
  const {m,s}=session(t,{response:r=>({id:r.id+1,ok:true,windows:[window]})})
  await assert.rejects(s.inspect(100),e=>e.code==='UNCONFIRMED_REPLY')
  assert.equal(m.calls.length,1)
})
test('unsolicited second readiness is a protocol failure, not another startup', async t => {
  const {m,s}=session(t); await s.ready
  m.send({protocol:1,ready:true})
  await assert.rejects(s.inspect(100),e=>e.code==='SESSION_UNAVAILABLE')
  assert.equal(m.calls.length,1)
})
test('invalid JSON and excessive output stop the helper without exposing raw text', async t => {
  for (const raw of ['PRIVATE_NOT_JSON\n','x'.repeat(256*1024+1)]) {
    const {m,s}=session(t,{ready:false})
    m.child.stdout.write(raw)
    await assert.rejects(s.ready,e=>!e.message.includes('PRIVATE_')&&['INVALID_REPLY','REPLY_LIMIT'].includes(e.code))
  }
})
test('split UTF8/line messages remain one reply', async t => {
  const {m,s}=session(t,{ready:false})
  m.child.stdout.write('{"protocol":1,')
  m.child.stdout.write('"ready":true}\r\n')
  assert.equal((await s.inspect(100))[0].title,'记事本')
})
test('spawn error is bounded and does not expose raw exception/command', async t => {
  const {m,s}=session(t,{ready:false})
  m.child.emit('error',new Error('PRIVATE_EXEC_PATH'))
  await assert.rejects(s.ready,e=>e.code==='SPAWN_ERROR'&&!e.message.includes('PRIVATE'))
})
test('early helper exit invalidates pending requests', async t => {
  const {m,s}=session(t,{response:()=>undefined}); await s.ready
  const pending=s.inspect(100); await delay(1); m.exit(1)
  await assert.rejects(pending,e=>e.code==='EARLY_EXIT')
})
test('concurrent commands are refused rather than silently queued or deduplicated', async t => {
  const {m,s}=session(t,{response:()=>undefined}); await s.ready
  const first=s.inspect(100); await delay(1)
  await assert.rejects(s.inspect(200),e=>e.code==='REQUEST_IN_PROGRESS')
  m.send({id:1,ok:true,windows:[window]}); await first
  assert.equal(m.commands.length,1)
})
test('dispose is idempotent and ignores late replies after cancelling pending work', async t => {
  const {m,s}=session(t,{response:()=>undefined}); await s.ready
  const pending=s.inspect(100); const reject=assert.rejects(pending,e=>e.code==='DISPOSED')
  await delay(1)
  const a=s.dispose(), b=s.dispose(); assert.equal(a,b); await a; await reject
  m.send({id:1,ok:true,windows:[window]})
  await assert.rejects(s.inspect(100),e=>e.code==='DISPOSED')
  assert.equal(m.commands.length,1)
})
test('invalid PID and non-renderer close target never reach the worker', async t => {
  const {m,s}=session(t); await s.ready
  for(const pid of [0,-1,1.1,2**32,'100']) await assert.rejects(s.inspect(pid),e=>e.code==='INVALID_PID')
  for(const patch of [{visible:false},{title:''},{cls:'other'},{childText:[]},{handle:0}]) {
    assert.throws(()=>s.close({...window,...patch}))
  }
  assert.equal(m.commands.length,0)
})
test('startup/request budgets must be bounded before creating any helper', () => {
  for(const value of [0,-1,1.1,Infinity,30001]) {
    assert.throws(()=>createDesktopWindowSession({startupMs:value}))
    assert.throws(()=>createDesktopWindowSession({requestMs:value}))
  }
})


// A stream error used to escape the session as an uncaught EventEmitter error.
// Exercise real streams, preserve the raw exception only in the synthetic input.
for (const stream of ['stdout', 'stderr']) {
  test(stream + ' failure before readiness is a bounded rejection, not a runner crash', async t => {
    const {m,s}=session(t,{ready:false})
    const rejected=assert.rejects(s.ready,e=>e.code==='PIPE_ERROR'&&!e.message.includes('PRIVATE'))
    m.child[stream].destroy(new Error('PRIVATE_PIPE_DETAIL'))
    await rejected
    assert.equal(await s.dispose(),false); assert.equal(m.commands.length,0)
    assert.equal(m.killed,1); assert.equal(m.calls.length,1)
    assert.equal(JSON.stringify(m.events).includes('PRIVATE'),false)
  })
  test(stream + ' failure during inspection rejects the request and prevents reuse', async t => {
    const {m,s}=session(t,{response:()=>undefined}); await s.ready
    const pending=s.inspect(100), rejected=assert.rejects(pending,e=>e.code==='PIPE_ERROR')
    await delay(1); m.child[stream].destroy(new Error('PRIVATE_PIPE_DETAIL')); await rejected
    await assert.rejects(s.inspect(100),e=>e.code==='SESSION_UNAVAILABLE')
    assert.equal(m.commands.length,1); assert.equal(m.events.some(e=>e.completed),false)
    assert.equal(await s.dispose(),false)
  })
  test(stream + ' failure while idle invalidates the session without sending a command', async t => {
    const {m,s}=session(t); await s.ready
    m.child[stream].destroy(new Error('PRIVATE_PIPE_DETAIL')); await delay(1)
    await assert.rejects(s.inspect(100),e=>e.code==='SESSION_UNAVAILABLE')
    assert.equal(m.commands.length,0); assert.equal(m.events.filter(e=>e.type==='failed').length,1)
  })
  test(stream + ' errors after completed disposal are consumed without reopening the session', async t => {
    const {m,s}=session(t); await s.ready; assert.equal(await s.dispose(),true)
    const before=JSON.stringify(m.events)
    m.child[stream].destroy(new Error('PRIVATE_LATE_PIPE')); await delay(1)
    assert.equal(JSON.stringify(m.events),before); assert.equal(m.killed,0)
    await assert.rejects(s.inspect(100),e=>e.code==='DISPOSED')
  })
}
for (const stream of ['stdin','stdout','stderr']) {
  test(stream + ' failure during shutdown cannot be reported as a clean disposal', async t => {
    const {m,s}=session(t,{holdExit:true}); await s.ready
    const done=s.dispose()
    m.child[stream].emit('error',new Error('PRIVATE_SHUTDOWN_PIPE'))
    m.exit(0)
    assert.equal(await done,false); assert.equal(m.events.at(-1).clean,false)
    assert.equal(m.commands.length,0); assert.equal(m.killed,0)
  })
}
test('output failure after sending close never replays WM_CLOSE or accepts a late reply', async t => {
  const {m,s}=session(t,{response:()=>undefined}); await s.ready
  const pending=s.close(window), rejected=assert.rejects(pending,e=>e.code==='PIPE_ERROR')
  await delay(1); m.child.stdout.destroy(new Error('PRIVATE_CLOSE_PIPE')); await rejected
  m.child.stderr.emit('error',new Error('SECOND_PIPE'))
  await assert.rejects(s.close(window),e=>e.code==='SESSION_UNAVAILABLE')
  assert.equal(m.commands.length,1); assert.equal(m.commands[0].op,'close')
  assert.equal(m.events.some(e=>e.type==='close'&&e.completed),false)
  assert.equal(m.events.filter(e=>e.type==='failed').length,1); assert.equal(m.killed,1)
})
test('late protocol data during disposal is drained without killing the helper again', async t => {
  const {m,s}=session(t,{response:()=>undefined,holdExit:true}); await s.ready
  const pending=s.inspect(100), rejected=assert.rejects(pending,e=>e.code==='DISPOSED')
  await delay(1); const done=s.dispose()
  m.send({id:1,ok:true,windows:[window]}); m.child.stdout.write('PRIVATE_INVALID_REPLY\n')
  m.child.stdout.write('x'.repeat(256*1024+1)); m.exit(0)
  await rejected; assert.equal(await done,true); assert.equal(m.killed,0)
  assert.equal(m.events.some(e=>e.type==='failed'||e.completed),false)
})
test('simultaneous output errors fail once and terminate only the owned helper', async t => {
  const {m,s}=session(t,{ready:false})
  const rejected=assert.rejects(s.ready,e=>e.code==='PIPE_ERROR')
  m.child.stdout.emit('error',new Error('PRIVATE_STDOUT'))
  m.child.stderr.emit('error',new Error('PRIVATE_STDERR'))
  m.child.stdin.emit('error',new Error('PRIVATE_STDIN'))
  await rejected; assert.equal(m.killed,1); assert.equal(m.calls.length,1)
  assert.equal(m.events.filter(e=>e.type==='failed').length,1)
})
