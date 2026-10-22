import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { createS3ProbeScope } from '../electron/s3-probe-scope.js'

function fixture(options = {}) {
  const state = { closing: false, expected: 'file:///synthetic-app/dist/index.html',
    destroyed: false, contentsDestroyed: false }
  const contents = new EventEmitter()
  contents.mainFrame = { url: state.expected }
  contents.getURL = () => state.contentsURL ?? contents.mainFrame.url
  contents.isDestroyed = () => state.contentsDestroyed
  const win = new EventEmitter()
  win.webContents = contents; win.isDestroyed = () => state.destroyed
  state.window = win
  const timers = new Map(); let serial = 0
  const config = { getWindow: () => state.window, getExpectedURL: () => state.expected,
    isClosing: () => state.closing, schedule: fn => { timers.set(++serial, fn); return serial },
    cancelTimer: id => timers.delete(id), ...options }
  const scope = createS3ProbeScope(config)
  return { scope, state, contents, win, timers, config, event: { sender: contents, senderFrame: contents.mainFrame } }
}
const listenerTotal = f => f.contents.eventNames().reduce((n,e) => n + f.contents.listenerCount(e), 0) +
  f.win.eventNames().reduce((n,e) => n + f.win.listenerCount(e), 0)

export function registerS3ProbeScopeTests(test) {
  test('pinned main frame acquires a lease without retaining a request payload', () => {
    const f = fixture(), lease = f.scope.acquire(f.event, 'request-1')
    assert.equal(lease.ok, true); assert.equal(lease.mayDeliver(), true)
    assert.deepEqual(Object.keys(lease).sort(), ['mayDeliver','ok','release','signal'])
    assert.equal(f.timers.size, 1); assert.equal(listenerTotal(f), 5)
    lease.release(); assert.equal(f.timers.size, 0); assert.equal(listenerTotal(f), 0)
    assert.equal(lease.mayDeliver(), false)
  })
  for (const [name, apply] of [
    ['missing window', f => { f.state.window = null }],
    ['destroyed window', f => { f.state.destroyed = true }],
    ['destroyed webContents', f => { f.state.contentsDestroyed = true }],
    ['other webContents', f => { f.event.sender = new EventEmitter() }],
    ['iframe with identical URL', f => { f.event.senderFrame = { url: f.state.expected } }],
    ['absent senderFrame', f => { f.event.senderFrame = null }],
    ['app quit in progress', f => { f.state.closing = true }],
    ['unknown close state', f => { f.state.closing = undefined }],
    ['different local HTML', f => { f.contents.mainFrame.url = 'file:///synthetic-other/document.html' }],
    ['remote main document', f => { f.contents.mainFrame.url = 'https://untrusted.example/' }],
    ['query on document', f => { f.contents.mainFrame.url += '?page=other' }],
    ['webContents/frame disagree', f => { f.state.contentsURL = 'file:///synthetic-app/dist/other.html' }],
    ['invalid native getter', f => { f.contents.getURL = () => { throw new Error('do not expose input') } }],
  ]) test(`rejects ${name} before installing listeners`, () => {
    const f = fixture(); apply(f)
    assert.deepEqual(f.scope.acquire(f.event, 'request-1'), { ok: false, code: 'untrusted-probe-sender' })
    assert.equal(f.timers.size, 0); assert.equal(listenerTotal(f), 0)
  })
  for (const [name, expected, actual, accepted] of [
    ['app fragment', 'file:///synthetic-app/dist/index.html', 'file:///synthetic-app/dist/index.html#notes', true],
    ['dev root', 'http://localhost:5000/', 'http://localhost:5000/', true],
    ['dev fragment', 'http://localhost:5000/', 'http://localhost:5000/#notes', true],
    ['dev other path', 'http://localhost:5000/', 'http://localhost:5000/untrusted', false],
    ['dev other host', 'http://localhost:5000/', 'http://127.0.0.1:5000/', false],
    ['dev userinfo', 'http://localhost:5000/', 'http://user@localhost:5000/', false],
    ['unexpected dev port', 'http://localhost:5000/', 'http://localhost:5001/', false],
    ['arbitrary expected remote URL', 'https://untrusted.example/', 'https://untrusted.example/', false],
    ['expected URL with query', 'file:///synthetic-app/dist/index.html?x=1', 'file:///synthetic-app/dist/index.html?x=1', false],
    ['nonlocal expected file host', 'file://server/share/index.html', 'file://server/share/index.html', false],
  ]) test(`document pin: ${name}`, () => {
    const f = fixture(); f.state.expected = expected; f.contents.mainFrame.url = actual
    const lease = f.scope.acquire(f.event, 'request-1'); assert.equal(lease.ok, accepted)
    lease.release?.(); assert.equal(listenerTotal(f), 0)
  })
  for (const requestId of ['', 'x'.repeat(65), 'with space', null, 123, {}, '雪']) test(`invalid request identity ${JSON.stringify(requestId)}`, () => {
    const f = fixture(); assert.deepEqual(f.scope.acquire(f.event, requestId), { ok: false, code: 'invalid-probe-request' })
    assert.equal(listenerTotal(f), 0)
  })
  for (const [name, fire] of [
    ['legacy main-frame navigation', f => f.contents.emit('did-start-navigation', {}, 'file:///other.html', false, true)],
    ['modern main-frame navigation', f => f.contents.emit('did-start-navigation', { isMainFrame: true })],
    ['ambiguous navigation metadata', f => f.contents.emit('did-start-navigation', {})],
    ['conflicting navigation metadata', f => f.contents.emit('did-start-navigation', { isMainFrame: false }, '', false, true)],
    ['renderer crash', f => f.contents.emit('render-process-gone', {}, {reason:'crashed'})],
    ['webContents destruction', f => f.contents.emit('destroyed')],
    ['native close even when prevented', f => f.win.emit('close', {preventDefault(){}})],
    ['closed window', f => f.win.emit('closed')],
    ['deadline', f => [...f.timers.values()][0]()],
    ['application closing cancellation', f => f.scope.abortAll()],
    ['bridge disposal', f => f.scope.dispose()],
  ]) test(`aborts on ${name}, withholds result and waits for release`, () => {
    const f = fixture(), lease = f.scope.acquire(f.event, 'a')
    fire(f); assert.equal(lease.signal.aborted, true); assert.equal(lease.mayDeliver(), false)
    assert.equal(f.scope.acquire(f.event, 'b').ok, false)
    lease.release(); lease.release(); assert.equal(listenerTotal(f), 0); assert.equal(f.timers.size, 0)
  })
  test('subframe navigation leaves the active main-frame request intact', () => {
    const f = fixture(), lease = f.scope.acquire(f.event, 'a')
    f.contents.emit('did-start-navigation', {}, 'about:blank', false, false)
    f.contents.emit('did-start-navigation', { isMainFrame: false })
    assert.equal(lease.mayDeliver(), true); lease.release()
  })
  test('cancellation is owner/id bound; aborted attempt holds its slot until settlement', () => {
    const f = fixture(), lease = f.scope.acquire(f.event, 'a')
    assert.equal(f.scope.cancel(f.event, 'old'), false)
    assert.equal(f.scope.cancel({sender:f.contents,senderFrame:{url:f.state.expected}},'a'),false)
    assert.equal(f.scope.cancel(f.event, 'a'), true)
    assert.deepEqual(f.scope.acquire(f.event, 'b'), { ok:false,code:'probe-busy' })
    lease.release(); const next = f.scope.acquire(f.event, 'b'); assert.equal(next.ok, true)
    assert.equal(f.scope.cancel(f.event, 'a'), false); assert.equal(next.mayDeliver(), true); next.release()
  })
  test('busy rejects without a queue; idempotent old release cannot unlock a new lease', () => {
    const f = fixture(), first = f.scope.acquire(f.event, 'a')
    assert.equal(f.scope.acquire(f.event, 'b').code, 'probe-busy')
    first.release(); const second = f.scope.acquire(f.event, 'b'); first.release()
    assert.equal(f.scope.acquire(f.event, 'c').code, 'probe-busy'); second.release()
  })
  for (const [name, alter] of [
    ['same frame navigates without notification', f => { f.contents.mainFrame.url = 'file:///other.html' }],
    ['window replaced', f => { f.state.window = { ...f.win, webContents: f.contents, isDestroyed: () => false } }],
    ['main frame replaced', f => { f.contents.mainFrame = {url:f.state.expected} }],
    ['quitting after request start', f => { f.state.closing = true }],
  ]) test(`late-result recheck: ${name}`, () => {
    const f = fixture(), lease = f.scope.acquire(f.event, 'a'); alter(f)
    assert.equal(lease.mayDeliver(), false); lease.release()
  })
  test('partial listener failure aborts and unwinds without exposing native error', () => {
    const f = fixture(); const original = f.win.on
    f.win.on = () => { throw new Error('SYNTHETIC_PRIVATE_CONTEXT') }
    assert.deepEqual(f.scope.acquire(f.event,'a'), {ok:false,code:'probe-scope-unavailable'})
    assert.equal(listenerTotal(f), 0); assert.equal(f.timers.size, 0)
    f.win.on = original; const lease=f.scope.acquire(f.event,'b'); assert.equal(lease.ok,true); lease.release()
  })
  test('dispose prevents reentry after release', () => {
    const f=fixture(), lease=f.scope.acquire(f.event,'a'); f.scope.dispose(); lease.release()
    assert.equal(f.scope.acquire(f.event,'b').code,'untrusted-probe-sender')
  })
  test('real bounded timer aborts, releases, and does not leave listeners behind', async () => {
    const f=fixture({timeoutMs:5,schedule:setTimeout,cancelTimer:clearTimeout})
    const lease=f.scope.acquire(f.event,'a')
    try { await sleep(25); assert.equal(lease.signal.aborted,true) }
    finally { lease.release() }
    assert.equal(listenerTotal(f),0)
  })
  test('scope never prevents close or removes an existing save/quit listener', () => {
    const f=fixture(); let saved=0, prevented=0
    const saveGuard=() => { saved++ }
    f.win.on('close',saveGuard)
    const lease=f.scope.acquire(f.event,'a')
    f.win.emit('close',{preventDefault(){prevented++}})
    assert.equal(saved,1); assert.equal(prevented,0); assert.equal(lease.signal.aborted,true)
    lease.release(); assert.deepEqual(f.win.listeners('close'),[saveGuard])
    f.win.emit('close',{}); assert.equal(saved,2)
  })
  test('foreign cancellation cannot reveal or affect a trusted pending request', () => {
    const f=fixture(), lease=f.scope.acquire(f.event,'a')
    assert.equal(f.scope.cancel({sender:new EventEmitter(),senderFrame:f.contents.mainFrame},'a'),false)
    assert.equal(lease.signal.aborted,false); lease.release()
  })
  test('timer creation failure releases all scope registrations', () => {
    const f=fixture({schedule(){throw new Error('SYNTHETIC_PRIVATE_CONTEXT')}})
    assert.deepEqual(f.scope.acquire(f.event,'a'),{ok:false,code:'probe-scope-unavailable'})
    assert.equal(listenerTotal(f),0)
  })
  test('invalid native owner getter returns only a fixed denial', () => {
    const f=fixture({getWindow(){throw new Error('SYNTHETIC_PRIVATE_CONTEXT')}})
    assert.deepEqual(f.scope.acquire(f.event,'a'),{ok:false,code:'untrusted-probe-sender'})
  })
  test('invalid expected URL getter returns only a fixed denial', () => {
    const f=fixture({getExpectedURL(){throw new Error('SYNTHETIC_PRIVATE_CONTEXT')}})
    assert.deepEqual(f.scope.acquire(f.event,'a'),{ok:false,code:'untrusted-probe-sender'})
  })
  for (const timeoutMs of [0,8001,1.5,NaN,Infinity,'1']) test(`invalid internal timeout ${String(timeoutMs)}`, () => {
    assert.throws(() => fixture({timeoutMs}), /Invalid S3 probe scope configuration/)
  })
}
