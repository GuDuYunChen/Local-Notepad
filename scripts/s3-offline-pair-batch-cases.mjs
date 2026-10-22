import assert from 'node:assert/strict'
import { selectOfflinePairFiles as select, readOfflinePairFiles as read } from '../src/services/s3OfflinePairBatch.mjs'
import { reportFixture } from './s3-local-overview-file-cases.mjs'
const file = size => ({ size })
const pair = () => [file(100), file(101)]
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
const flush = async () => { for(let i=0;i<8;i++)await Promise.resolve() }
export function registerOfflinePairBatchTests(test) {
  test('offline batch selection is metadata-only and captures the original A-B order', () => {
    const list=pair(), result=select(list);assert.equal(result.code,'pair-selected')
    assert.equal(result.files[0],list[0]);assert.equal(result.files[1],list[1]);list.reverse()
    assert.notEqual(result.files[0],list[0]);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.files))
  })
  test('offline batch cancellation is distinct from invalid selection counts', () => {
    assert.equal(select([]).code,'pair-cancelled')
    for(const files of [undefined,null,[file(1)],[file(1),file(1),file(1)],{length:'2'},{length:Infinity}])assert.equal(select(files).code,'pair-count')
  })
  for(const size of [0,-1,4097,1.5,NaN,'10'])test(`offline batch rejects both sides before I/O for invalid size ${String(size)}`, async () => {
    let calls=0
    for(const side of [0,1]) { const files=pair();files[side]=file(size)
      await assert.rejects(read(files,{read(){calls++}}),e=>e.code==='pair-size') }
    assert.equal(calls,0)
  })
  test('offline batch exact per-file 4KiB limit does not become a combined truncation', () => {
    assert.equal(select([file(4096),file(4096)]).code,'pair-selected')
    assert.equal(select([file(1),file(4097)]).code,'pair-size')
  })
  test('offline batch never reads filenames, paths or content during selection', () => {
    const values=pair()
    for(const f of values)for(const key of ['name','path','text','arrayBuffer'])Object.defineProperty(f,key,{get(){throw Error('PRIVATE')}})
    assert.equal(select(values).code,'pair-selected')
    assert.equal(select({get length(){throw Error('PRIVATE')}}).code,'pair-unavailable')
  })
  test('offline batch empty and invalid signals never start a reader', async () => {
    let calls=0;const c=new AbortController();c.abort()
    for(const signal of [c.signal,{}])await assert.rejects(read(pair(),{signal,read(){calls++}}))
    await assert.rejects(read([],{read(){calls++}}));assert.equal(calls,0)
  })
  test('offline batch waits for both readers and never adopts a partial pair', async () => {
    const a=deferred(),b=deferred(),files=pair();let completed=false
    const p=read(files,{read:f=>f===files[0]?a.promise:b.promise});p.then(()=>{completed=true})
    b.resolve('B');await flush();assert.equal(completed,false)
    a.resolve('A');const result=await p;assert.deepEqual(result,{a:'A',b:'B'});assert.ok(Object.isFrozen(result))
  })
  for(const side of [0,1])test(`offline batch failure on side ${side} cancels sibling and never leaks exception text`, async () => {
    const tasks=[deferred(),deferred()],signals=[];let n=0
    const p=read(pair(),{read:(_file,{signal})=>{signals.push(signal);return tasks[n++].promise}})
    const rejected=assert.rejects(p,e=>e.code==='pair-read-failed'&&!e.message.includes('PRIVATE'))
    tasks[side].reject(Error('PRIVATE_PATH'));await rejected
    assert.equal(signals.length,2);assert.equal(signals[0],signals[1]);assert.equal(signals[0].aborted,true)
    tasks[1-side].resolve('late');await flush()
  })
  test('offline batch synchronous reader failure does not start the other reader', async () => {
    let calls=0,signal
    await assert.rejects(read(pair(),{read:(_f,options)=>{calls++;signal=options.signal;throw Error('PRIVATE')}}),e=>e.code==='pair-read-failed')
    assert.equal(calls,1);assert.equal(signal.aborted,true)
  })
  test('offline batch caller cancellation reaches both readers and revokes late completions', async () => {
    const c=new AbortController(),a=deferred(),b=deferred(),signals=[];let n=0
    const p=read(pair(),{signal:c.signal,read:(_f,{signal})=>{signals.push(signal);return [a,b][n++].promise}})
    const rejected=assert.rejects(p,e=>e.code==='pair-aborted')
    await flush();assert.equal(signals.length,2);c.abort();assert.ok(signals.every(s=>s.aborted));a.resolve('A');b.resolve('B');await rejected
  })
  test('offline batch late sibling rejection is observed after a synchronous second-reader failure', async () => {
    const first=deferred();let n=0
    const p=read(pair(),{read:()=>{if(n++===0)return first.promise;throw Error('PRIVATE_SECOND')}})
    await assert.rejects(p,e=>e.code==='pair-read-failed')
    first.reject(Error('PRIVATE_LATE'));await flush();assert.equal(n,2)
  })
  test('offline batch immediate caller cancellation prevents both deferred reader starts', async () => {
    const c=new AbortController();let n=0
    const p=read(pair(),{signal:c.signal,read:()=>{n++;return Promise.resolve('unexpected')}})
    c.abort();await assert.rejects(p,e=>e.code==='pair-aborted');assert.equal(n,0)
  })
  test('offline batch removes the caller listener after success and after failure', async () => {
    for(const reject of [false,true]){
      const c=new AbortController(),add=c.signal.addEventListener.bind(c.signal),remove=c.signal.removeEventListener.bind(c.signal)
      let attached=0,detached=0
      c.signal.addEventListener=(...args)=>{attached++;return add(...args)}
      c.signal.removeEventListener=(...args)=>{detached++;return remove(...args)}
      try{await read(pair(),{signal:c.signal,read:()=>reject?Promise.reject(Error()):Promise.resolve('ok')})}catch{}
      assert.equal(attached,1);assert.equal(detached,1)
    }
  })
  test('offline batch runs the production UTF-8 parser for both files without partial data', async () => {
    const previous=Object.getOwnPropertyDescriptor(globalThis,'FileReader')
    const a=JSON.stringify(reportFixture()),b=JSON.stringify({...reportFixture(),generatedAtUTC:'2026-10-10T00:00:00.000Z'})
    const contents=new Map(),files=[file(Buffer.byteLength(a)),file(Buffer.byteLength(b))]
    contents.set(files[0],a);contents.set(files[1],b)
    Object.defineProperty(globalThis,'FileReader',{configurable:true,value:class{
      abort(){this.aborted=true}
      readAsArrayBuffer(f){queueMicrotask(()=>{if(this.aborted)return;this.result=new TextEncoder().encode(contents.get(f)).buffer;this.onload?.()})}
    }})
    try{
      const result=await read(files);assert.equal(result.a.source,'untrusted-file');assert.equal(result.b.summary.records,2)
      assert.notEqual(result.a.generatedAtUTC,result.b.generatedAtUTC);assert.ok(Object.isFrozen(result.a.summary))
      contents.set(files[1],'{');files[1].size=1
      await assert.rejects(read(files),e=>e.code==='pair-read-failed')
    }finally{if(previous)Object.defineProperty(globalThis,'FileReader',previous);else delete globalThis.FileReader}
  })
}
