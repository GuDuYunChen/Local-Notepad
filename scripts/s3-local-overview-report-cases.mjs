import { verifyReportClipboardTotal } from './check-local-overview-report-desktop.mjs'
import assert from 'node:assert/strict'
import { prepareLocalOverviewReport as prepare, requestLocalOverviewDownload as download,
  createLocalOverviewClipboard as clipboard, LOCAL_REPORT_COPY_WAIT_MS } from '../src/services/s3LocalOverviewReport.mjs'
import { localOverviewSuccess } from './s3-local-overview-binding-cases.mjs'
const summary = () => localOverviewSuccess().data
const when = Date.UTC(2026, 9, 9, 12, 0, 0)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function fixture(write = async () => {}) {
  let at = 0, timer, calls = 0, clears = 0
  const service = clipboard({ write: text => { calls++; return write(text) }, reportTime: () => when,
    clock: () => at, schedule: fn => { timer = fn; return 1 }, cancel: () => { clears++ } })
  return { service, get calls() { return calls }, get clears() { return clears },
    at: value => { at = value }, timeout: () => { at = LOCAL_REPORT_COPY_WAIT_MS; timer() } }
}
export function registerLocalOverviewReportTests(test) {
  test('inventory clipboard evidence accepts exact LF and Windows CRLF totals', () => {
    for (const newline of ['\n', '\r\n']) {
      verifyReportClipboardTotal(['report', '记录合计：2', 'scope', ''].join(newline), 2)
      verifyReportClipboardTotal('report' + newline + '记录合计：2', 2)
    }
  })
  test('inventory clipboard evidence still rejects wrong, duplicate and partial total lines', () => {
    for (const text of ['记录合计：20\r\n', '记录合计：2 extra\n', '记录合计：2 \r\n',
      'prefix记录合计：2\n', '记录合计：2\r', '记录合计：2\r\n记录合计：2\r\n', 'no total']) {
      assert.throws(() => verifyReportClipboardTotal(text, 2))
    }
  })
  test('inventory clipboard evidence rejects missing text and invalid expected counts', () => {
    for (const text of [null, undefined, 2, {}]) assert.throws(() => verifyReportClipboardTotal(text, 2))
    for (const count of [-1, 2.5, '2', NaN]) assert.throws(() => verifyReportClipboardTotal('记录合计：2\n', count))
  })
  test('inventory report outputs exact counts, four categories and explicit limited scope', () => {
    const s = summary(), out = prepare(s, when), json = JSON.parse(out.raw)
    assert.deepEqual(Object.keys(json), ['format','version','generatedAtUTC','scope','readOnly','completeForPreview','notice','generationTimeIsObservationTime','records','recordBytes','attachmentBytes','baseItems','kinds'])
    assert.equal(json.format, 'local-notepad-local-inventory-report'); assert.equal(json.version, 1)
    assert.equal(json.records, s.records); assert.equal(json.recordBytes, s.record_bytes)
    assert.equal(json.attachmentBytes, s.attachment_bytes); assert.equal(json.baseItems, s.base_items)
    assert.deepEqual(json.kinds, s.kinds.map(k => ({kind:k.kind,records:k.records,recordBytes:k.record_bytes})))
    assert.equal(json.readOnly, true); assert.equal(json.completeForPreview, false)
    assert.equal(json.generationTimeIsObservationTime, false); assert.equal(json.generatedAtUTC,'2026-10-09T12:00:00.000Z')
    assert.match(out.text, /不是读取完成时间/); assert.match(out.text, /不是笔记备份/); assert.match(out.text, /数据可能已经变化/)
    assert.ok(Object.isFrozen(out)); assert.ok(out.raw.endsWith('\n'))
  })
  test('inventory report allows a valid empty observation without calling it a backup', () => {
    const s=summary(); Object.assign(s,{records:0,record_bytes:0,attachment_bytes:0,base_items:0})
    s.kinds.forEach(k=>Object.assign(k,{records:0,record_bytes:0}))
    const out=prepare(s,when); assert.equal(JSON.parse(out.raw).records,0); assert.match(out.text,/不是笔记备份/)
  })
  test('inventory report allows original maximum budgets without truncation', () => {
    const s=summary(); Object.assign(s,{records:256,record_bytes:2097152,attachment_bytes:67108864,base_items:128})
    s.kinds.forEach((k,i)=>Object.assign(k,{records:i===0||i===3?128:0,record_bytes:i===0||i===3?1048576:0}))
    const out=prepare(s,when); assert.equal(JSON.parse(out.raw).records,256)
    assert.ok(Buffer.byteLength(out.raw)<4096); assert.ok(Buffer.byteLength(out.text)<4096)
  })
  for(const key of ['records','record_bytes','attachment_bytes','base_items','kinds','read_only','observed_stable','complete_for_preview']) test(`inventory report rejects invalid ${key} without partial output`,()=>{
    const s=summary(); s[key]='PRIVATE'; assert.throws(()=>prepare(s,when),/统计或报告时间无效/)
  })
  test('inventory report refuses excess private fields and getters without reading them',()=>{
    let touched=0;const s=summary();Object.defineProperty(s,'path',{enumerable:true,get(){touched++;throw Error('PRIVATE')}})
    assert.throws(()=>prepare(s,when),error=>!error.message.includes('PRIVATE'));assert.equal(touched,0)
    const other=summary();other.kinds[0].title='PRIVATE';assert.throws(()=>prepare(other,when))
  })
  test('inventory report rejects aggregate mismatch and changed kind ordering',()=>{
    const s=summary();s.records++;assert.throws(()=>prepare(s,when))
    const r=summary();r.kinds.reverse();assert.throws(()=>prepare(r,when))
  })
  test('inventory report does not mutate its source or retain mutable references',()=>{
    const s=summary(),before=structuredClone(s),out=prepare(s,when);assert.deepEqual(s,before)
    s.kinds[0].records=77;assert.notEqual(JSON.parse(out.raw).kinds[0].records,77)
  })
  test('inventory report rejects invalid generation clocks without interpolating input',()=>{
    for(const at of [NaN,Infinity,-1,1.1,'PRIVATE',null,253402300800000]) assert.throws(()=>prepare(summary(),at),e=>!e.message.includes('PRIVATE'))
    assert.equal(JSON.parse(prepare(summary(),0).raw).generatedAtUTC,'1970-01-01T00:00:00.000Z')
  })
  test('inventory report generates portable filenames independent of caller strings',()=>{
    const out=prepare(summary(),when);assert.match(out.filename,/^Local-Notepad-local-inventory-2026-10-09T12-00-00-000Z\.json$/)
    assert.doesNotMatch(out.filename,/[\\/:*?"<>|]/)
  })
  test('inventory clipboard reserves before reentrant input validation and makes no implicit write',async()=>{
    const f=fixture();assert.equal(f.calls,0);let nested
    const s=new Proxy(summary(),{ownKeys(target){nested??=f.service.copy(summary());return Reflect.ownKeys(target)}})
    assert.equal((await f.service.copy(s)).code,'copied');assert.equal((await nested).code,'copy-busy');assert.equal(f.calls,1)
  })
  test('inventory clipboard rejects invalid summaries before invoking clipboard API',async()=>{
    const f=fixture();assert.equal((await f.service.copy(null)).code,'invalid-report');assert.equal(f.calls,0)
    assert.equal((await f.service.copy(summary())).code,'copied');assert.equal(f.calls,1)
  })
  test('inventory clipboard writes only bounded report text and waits for real receipt',async()=>{
    const d=deferred();let text;const f=fixture(t=>{text=t;return d.promise});let result
    const p=f.service.copy(summary());p.then(v=>{result=v});await flush();assert.equal(result,undefined)
    assert.equal(text,prepare(summary(),when).text);assert.equal((await f.service.copy(summary())).code,'copy-busy')
    d.resolve();assert.equal((await p).code,'copied');assert.equal(f.clears,1)
  })
  for(const mode of ['reject','throw','missing-receipt']) test(`inventory clipboard ${mode} cannot claim success or leak details`,async()=>{
    const f=fixture(()=>{if(mode==='throw')throw Error('PRIVATE');if(mode==='reject')return Promise.reject(Error('PRIVATE'));return undefined})
    assert.deepEqual(await f.service.copy(summary()),{code:'copy-unconfirmed'});assert.equal(f.calls,1)
  })
  test('inventory clipboard timeout holds actual slot until late completion and permits only explicit retry',async()=>{
    const d=deferred();let n=0;const f=fixture(()=>++n===1?d.promise:Promise.resolve())
    const p=f.service.copy(summary());f.timeout();assert.equal((await p).code,'copy-timeout')
    assert.equal((await f.service.copy(summary())).code,'copy-busy');assert.equal(f.calls,1)
    d.resolve();await flush();assert.equal((await p).code,'copy-timeout');assert.equal(f.calls,1)
    assert.equal((await f.service.copy(summary())).code,'copied');assert.equal(f.calls,2)
  })
  for(const ok of [true,false]) test(`inventory clipboard absolute deadline also applies to late ${ok?'success':'rejection'}`,async()=>{
    const d=deferred(),f=fixture(()=>d.promise);const p=f.service.copy(summary());f.at(5000)
    if(ok)d.resolve();else d.reject(Error('PRIVATE'));assert.equal((await p).code,'copy-timeout')
  })
  test('inventory clipboard bad or regressing monotonic clocks never confirm success',async()=>{
    for(const at of [NaN,-1]){const d=deferred(),f=fixture(()=>d.promise);const p=f.service.copy(summary());f.at(at);d.resolve();assert.equal((await p).code,'copy-unconfirmed')}
  })
  test('inventory clipboard synchronous expired scheduler cannot start an OS write',async()=>{
    let calls=0;const c=clipboard({schedule:fn=>{fn();return 1},cancel(){},write(){calls++}})
    assert.equal((await c.copy(summary())).code,'copy-timeout');assert.equal(calls,0)
  })
  test('inventory download validates before DOM/URL access and always revokes its owned URL',async()=>{
    const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldURL=globalThis.URL,oldTimer=globalThis.setTimeout
    const seen=[],timers=[],blobs=[]
    const link={remove(){seen.push('remove')},click(){seen.push('click')}}
    try{
      Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){seen.push('create');return link},body:{append(){seen.push('append')}}}})
      globalThis.URL={createObjectURL(blob){blobs.push(blob);return 'blob:owned'},revokeObjectURL(url){seen.push(url)}}
      globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,1000);timers.push(fn)}
      assert.throws(()=>download(null));assert.deepEqual(seen,[]);assert.equal(blobs.length,0)
      const filename=download(summary());assert.match(filename,/\.json$/);assert.equal(link.href,'blob:owned');assert.equal(link.download,filename)
      assert.deepEqual(seen,['create','append','click','remove']);assert.equal(JSON.parse(await blobs[0].text()).records,summary().records)
      timers.shift()();assert.equal(seen.at(-1),'blob:owned')
      link.click=()=>{throw Error('synthetic-download-failure')};assert.throws(()=>download(summary()));assert.equal(seen.at(-1),'remove');timers.shift()();assert.equal(seen.at(-1),'blob:owned')
    }finally{if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;globalThis.URL=oldURL;globalThis.setTimeout=oldTimer}
  })
}
