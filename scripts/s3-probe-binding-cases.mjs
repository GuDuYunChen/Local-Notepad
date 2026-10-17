import assert from 'node:assert/strict'
import { createS3ProbeBinding } from '../src/services/s3ProbeBinding.mjs'
import { S3_PROBE_LIMITATION } from '../src/services/s3ReadProbe.mjs'

const input = () => ({ endpoint: 'https://synthetic.invalid', bucket: 'synthetic-bucket', region: 'us-east-1',
  key: '目录/e\u0301.json', accessKeyId: 'AKIASYNTHETIC', secretAccessKey: 'PRIVATE_SECRET', maxBytes: 256, readOnly: true })
const ok = () => ({ success: true, status: 200, code: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: 13 } })
const later = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function fixture(invoke = () => ok()) {
  const calls=[], timers=new Map(); let id=0, discovered=0
  const binding = createS3ProbeBinding({
    getBridge: () => { discovered++; return { s3ProbeRead: p => { calls.push(p); return invoke(p) } } },
    schedule: fn => { timers.set(++id,fn); return id }, cancel: key => timers.delete(key),
  })
  return { binding, calls, timers, discovered: () => discovered }
}
function publicOnly(state) {
  assert.ok(Object.isFrozen(state)); assert.equal(state.limitation, S3_PROBE_LIMITATION)
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_|AKIASYNTHETIC|synthetic\.invalid/)
}

export function registerS3ProbeBindingTests(test) {
  test('S3 binding construction, subscribe and committed connection never discover a bridge', () => {
    const f=fixture(); const off=f.binding.subscribe(() => {}); const close=f.binding.connect()
    f.binding.invalidate(); off(); close(); assert.equal(f.discovered(),0); assert.equal(f.timers.size,0)
  })
  test('S3 binding reads only after connect and never reflects an input after disconnect', async () => {
    const f=fixture(), poison=new Proxy({}, {getPrototypeOf(){throw new Error('PRIVATE_SECRET')}})
    assert.equal((await f.binding.read(poison)).code,'disposed')
    const close=f.binding.connect(); close(); assert.equal((await f.binding.read(poison)).code,'disposed')
    assert.equal(f.calls.length,0); assert.equal(f.discovered(),0)
  })
  test('S3 binding snapshot identity stays stable until an actual state change', async () => {
    const f=fixture(), start=f.binding.snapshot(); assert.equal(f.binding.snapshot(),start)
    const close=f.binding.connect(), connected=f.binding.snapshot(); assert.equal(f.binding.snapshot(),connected)
    await f.binding.read(input()); const done=f.binding.snapshot(); assert.equal(f.binding.snapshot(),done); close()
  })
  test('S3 binding publishes pending and final sanitized state exactly once each', async () => {
    const f=fixture(), close=f.binding.connect(), states=[]
    const off=f.binding.subscribe(() => { states.push(f.binding.snapshot()) })
    // Ordinary observers are notified without arguments; their failures are isolated.
    await f.binding.read(input()); assert.deepEqual(states.map(s=>s.state),['pending','readable'])
    states.forEach(publicOnly); off(); close(); assert.equal(states.length,2)
  })
  test('S3 binding notifications receive no request, credentials or response arguments', async () => {
    const f=fixture(), close=f.binding.connect(); let seen=0
    const off=f.binding.subscribe(function(){assert.equal(arguments.length,0); seen++})
    await f.binding.read(input()); assert.equal(seen,2); off(); close()
  })
  for (const mode of ['resolve','reject']) test(`S3 binding disconnect suppresses late native ${mode} and releases timers`, async () => {
    const d=later(), f=fixture(()=>d.promise), close=f.binding.connect(), states=[]
    const off=f.binding.subscribe(()=>states.push(f.binding.snapshot().code))
    const p=f.binding.read(input()); close(); assert.equal((await p).code,'disposed'); const count=states.length
    d[mode](mode==='resolve'?ok():new Error('PRIVATE_SECRET')); await tick()
    assert.equal(states.length,count); assert.equal(f.binding.snapshot().code,'disposed'); assert.equal(f.timers.size,0)
    publicOnly(f.binding.snapshot()); off()
  })
  test('S3 binding invalidation drops a completed summary without retaining the request', async () => {
    const f=fixture(),close=f.binding.connect(); await f.binding.read(input())
    assert.equal(f.binding.snapshot().state,'readable'); f.binding.invalidate()
    assert.equal(f.binding.snapshot().summary,null); publicOnly(f.binding.snapshot()); close()
  })
  test('S3 binding A-B-A invalidation cannot revive an old result or permit a duplicate request', async () => {
    const d=later(),f=fixture(()=>d.promise),close=f.binding.connect(), first=f.binding.read(input())
    f.binding.invalidate(); f.binding.invalidate(); assert.equal((await first).code,'wait-stopped')
    assert.equal((await f.binding.read(input())).code,'session-busy'); assert.equal(f.calls.length,1)
    d.resolve(ok()); await tick(); assert.notEqual(f.binding.snapshot().state,'readable'); close()
  })
  test('S3 binding duplicate read does not replace the pending visible result with its busy reply', async () => {
    const d=later(),f=fixture(()=>d.promise),close=f.binding.connect(), first=f.binding.read(input())
    assert.equal((await f.binding.read(input())).code,'session-busy'); assert.equal(f.binding.snapshot().state,'pending')
    d.resolve(ok()); await first; assert.equal(f.binding.snapshot().state,'readable'); assert.equal(f.calls.length,1); close()
  })
  test('S3 binding timeout is observable but does not claim native cancellation or release its session slot', async () => {
    const d=later(),f=fixture(()=>d.promise),close=f.binding.connect(), first=f.binding.read(input())
    ;[...f.timers.values()][0](); assert.equal((await first).code,'wait-timeout')
    assert.equal(f.binding.snapshot().code,'wait-timeout'); assert.equal((await f.binding.read(input())).code,'session-busy')
    d.resolve(ok()); await tick(); assert.equal(f.binding.snapshot().code,'wait-timeout'); close()
  })
  test('S3 binding reactivation is lazy and an obsolete cleanup cannot close a newer lifetime', async () => {
    const f=fixture(),old=f.binding.connect(); old(); const close=f.binding.connect(); old()
    assert.equal(f.discovered(),0); assert.equal((await f.binding.read(input())).state,'readable'); close()
  })
  test('S3 binding a prior lifetime cannot publish into a freshly connected one', async () => {
    const d=later(),f=fixture(()=>d.promise),old=f.binding.connect(),first=f.binding.read(input()); old()
    const close=f.binding.connect(), fresh=f.binding.snapshot(); d.resolve(ok()); await first; await tick()
    assert.equal(f.binding.snapshot(),fresh); assert.equal(f.calls.length,1); close()
  })
  test('S3 binding duplicate connection is rejected without dropping the active session', async () => {
    const f=fixture(),close=f.binding.connect(); assert.throws(()=>f.binding.connect(),/already connected/)
    assert.equal((await f.binding.read(input())).state,'readable'); close()
  })
  test('S3 binding bad observer is rejected before any bridge lookup', () => {
    const f=fixture(); for(const value of [null,undefined,1,{},'PRIVATE_SECRET']) assert.throws(()=>f.binding.subscribe(value),/Invalid S3 probe observer/)
    assert.equal(f.discovered(),0)
  })
  test('S3 binding observer errors cannot swallow completion or block another observer', async () => {
    const f=fixture(),close=f.binding.connect(); let count=0
    const bad=f.binding.subscribe(()=>{throw new Error('PRIVATE_SECRET')}),good=f.binding.subscribe(()=>count++)
    assert.equal((await f.binding.read(input())).state,'readable'); assert.equal(count,2)
    bad();good();close()
  })
  test('S3 binding duplicate listener registrations have independently idempotent unsubscribe handles', async () => {
    const f=fixture(),close=f.binding.connect(); let count=0; const listener=()=>count++
    const a=f.binding.subscribe(listener),b=f.binding.subscribe(listener); a();a()
    await f.binding.read(input()); assert.equal(count,2); b();close();assert.equal(count,2)
  })
  test('S3 binding listener removal during notification skips only the removed subscription', async () => {
    const f=fixture(),close=f.binding.connect(); let count=0,offB
    const offA=f.binding.subscribe(()=>offB()); offB=f.binding.subscribe(()=>count++)
    await f.binding.read(input()); assert.equal(count,0); offA();close()
  })
  test('S3 binding observer invalidation during pending is not overwritten by old completion', async () => {
    const d=later(),f=fixture(()=>d.promise),close=f.binding.connect()
    const off=f.binding.subscribe(()=>{if(f.binding.snapshot().state==='pending')f.binding.invalidate()})
    const p=f.binding.read(input()); assert.equal((await p).code,'wait-stopped'); d.resolve(ok());await tick()
    assert.equal(f.binding.snapshot().code,'wait-stopped'); off();close()
  })
  test('S3 binding observer disconnection consumes the pending rejection without later publication', async () => {
    const d=later(),f=fixture(()=>d.promise),close=f.binding.connect()
    const off=f.binding.subscribe(()=>{if(f.binding.snapshot().state==='pending')close()})
    const p=f.binding.read(input()); assert.equal((await p).code,'disposed'); d.reject(new Error('PRIVATE_SECRET'));await tick()
    assert.equal(f.binding.snapshot().code,'disposed');off()
  })
  test('S3 binding invalid or absent bridge never requests a browser fallback', async () => {
    const f=fixture(),close=f.binding.connect(); assert.equal((await f.binding.read({})).code,'invalid-input');assert.equal(f.discovered(),0);close()
    const b=createS3ProbeBinding({getBridge:()=>null}),disconnect=b.connect()
    assert.equal((await b.read(input())).code,'native-unavailable'); publicOnly(b.snapshot());disconnect()
  })
  test('S3 binding consumes success settled immediately before disconnect instead of returning it to a dead caller', async () => {
    const f=fixture(),close=f.binding.connect(),p=f.binding.read(input())
    queueMicrotask(close)
    const result=await p; assert.equal(result.code,'disposed'); assert.equal(result.summary,null)
  })
  test('S3 binding invalidation between native settlement and observation cannot return stale success', async () => {
    const f=fixture(),close=f.binding.connect(),p=f.binding.read(input())
    queueMicrotask(()=>f.binding.invalidate())
    const result=await p; assert.notEqual(result.state,'readable'); assert.equal(result.summary,null); close()
  })
  test('S3 binding final-state observer invalidation also suppresses the Promise success result', async () => {
    const f=fixture(),close=f.binding.connect()
    const off=f.binding.subscribe(()=>{if(f.binding.snapshot().state==='readable')f.binding.invalidate()})
    const result=await f.binding.read(input()); assert.notEqual(result.state,'readable'); assert.equal(result.summary,null)
    off();close()
  })

}
