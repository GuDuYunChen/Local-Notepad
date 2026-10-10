import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { createDesktopWindowSession } from './desktop-window-session.mjs'

const window = { pid: 100, handle: 300, title: '记事本', cls: 'Chrome_WidgetWin_1',
  visible: true, childText: ['Chrome Legacy Window'] }
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
  const script=Buffer.from(m.calls[0][1].at(-1),'base64').toString('utf16le')
  assert.equal((script.match(/Add-Type -TypeDefinition/g)||[]).length,1)
  assert.ok(script.includes('PostMessage(hwnd, 0x0010'))
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
