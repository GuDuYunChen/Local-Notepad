import assert from 'node:assert/strict'
import { emptyInspectionDraft, prepareS3Inspection, inspectionNextStep } from '../src/services/s3ReadInspection.mjs'
import { createS3ProbeBinding } from '../src/services/s3ProbeBinding.mjs'

export const sampleDraft = () => ({ ...emptyInspectionDraft(), endpoint: 'https://storage.example', bucket: 'sample-bucket', region: 'us-east-1', prefix: '研究/e\u0301', key: '中文 空格/%2F/片段.json', accessKeyId: 'SYNTHETICID', secretAccessKey: 'TEST_SECRET_123/+=', sessionToken: 'TEST_TOKEN/+=', maxBytes: '1024', consent: true })
export const readable = (bytes = 0) => ({ success: true, status: 200, code: 'OK', data: { outcome: 'readable', httpStatus: 200, acceptedBytes: bytes } })
const outcome = (code, httpStatus = 0) => ({ success: false, status: 422, code: 'probe-not-readable', data: { outcome: code, httpStatus, acceptedBytes: 0 } })
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
export function registerS3ReadInspectionTests(test) {
  test('fresh draft is empty, unconsented, independent and limited to 1 MiB', () => {
    const a = emptyInspectionDraft(), b = emptyInspectionDraft(); a.secretAccessKey = 'changed'
    assert.equal(b.secretAccessKey, ''); assert.equal(b.consent, false); assert.equal(b.maxBytes, '1048576')
  })
  test('admission preserves exact Unicode, percent text, prefix and credentials', () => {
    const d = sampleDraft(), a = prepareS3Inspection(d)
    assert.equal(a.ok, true)
    for (const k of ['endpoint','bucket','region','prefix','key','accessKeyId','secretAccessKey','sessionToken']) assert.equal(a.payload[k], d[k])
    assert.equal(a.payload.maxBytes, 1024); assert.equal(a.payload.readOnly, true)
    assert.equal(Object.isFrozen(a.payload), true); assert.equal('consent' in a.payload, false)
  })
  for (const [name, change, field] of [
    ['missing consent', { consent: false }, 'consent'], ['nonboolean consent', { consent: 'true' }, 'consent'],
    ['blank endpoint', { endpoint: '' }, 'endpoint'], ['insecure external HTTP', { endpoint: 'http://storage.example' }, 'endpoint'],
    ['userinfo including an empty user', { endpoint: 'https://@storage.example' }, 'endpoint'],
    ['path in endpoint', { endpoint: 'https://storage.example/bucket' }, 'endpoint'],
    ['empty query delimiter', { endpoint: 'https://storage.example?' }, 'endpoint'],
    ['empty fragment delimiter', { endpoint: 'https://storage.example#' }, 'endpoint'],
    ['browser-repaired backslash', { endpoint: 'https://storage.example\\bucket' }, 'endpoint'],
    ['leading endpoint whitespace', { endpoint: ' https://storage.example' }, 'endpoint'],
    ['URL-normalized shorthand loopback', { endpoint: 'http://127.1' }, 'endpoint'],
    ['endpoint port zero', { endpoint: 'https://storage.example:0' }, 'endpoint'],
    ['uppercase bucket', { bucket: 'BAD' }, 'bucket'], ['IPv4 bucket', { bucket: '127.0.0.1' }, 'bucket'],
    ['adjacent dot/hyphen bucket', { bucket: 'bad.-bucket' }, 'bucket'], ['empty region', { region: '' }, 'region'],
    ['region whitespace', { region: 'us east 1' }, 'region'], ['prefix trailing slash', { prefix: 'notes/' }, 'prefix'],
    ['prefix parent segment', { prefix: '../notes' }, 'prefix'], ['empty key', { key: '' }, 'key'],
    ['absolute key', { key: '/notes' }, 'key'], ['key parent segment', { key: 'a/../b' }, 'key'],
    ['key control characters', { key: 'x\u0000y' }, 'key'], ['key backslash', { key: 'a\\b' }, 'key'],
    ['unpaired surrogate', { key: '\ud800' }, 'key'], ['key UTF8 byte budget', { key: '文'.repeat(342) }, 'key'],
    ['combined key byte budget', { prefix: 'x'.repeat(900), key: 'y'.repeat(124) }, 'key'],
    ['invalid ID characters', { accessKeyId: 'bad-id' }, 'accessKeyId'],
    ['blank secret', { secretAccessKey: '' }, 'secretAccessKey'], ['secret whitespace', { secretAccessKey: 'secret value' }, 'secretAccessKey'],
    ['oversized secret', { secretAccessKey: 'x'.repeat(4097) }, 'secretAccessKey'],
    ['token newline', { sessionToken: 'x\ny' }, 'sessionToken'], ['token oversized', { sessionToken: 'x'.repeat(16385) }, 'sessionToken'],
    ['zero budget', { maxBytes: '0' }, 'maxBytes'], ['fraction budget', { maxBytes: '1.5' }, 'maxBytes'],
    ['exponential budget', { maxBytes: '1e3' }, 'maxBytes'], ['over-limit budget', { maxBytes: '1048577' }, 'maxBytes'],
  ]) test('rejects ' + name + ' without an accepted payload or secret echo', () => {
    const a = prepareS3Inspection({ ...sampleDraft(), ...change })
    assert.equal(a.ok, false); assert.equal(a.payload, null); assert.ok(a.errors[field])
    assert.ok(!JSON.stringify(a).includes('TEST_SECRET_123')); assert.ok(!JSON.stringify(a).includes('TEST_TOKEN'))
  })
  for (const endpoint of ['http://localhost:9000', 'http://127.0.0.2:9000', 'http://[::1]:9000', 'https://storage.example/'])
    test('admits explicit endpoint ' + endpoint + ' without changing it', () => {
      const a = prepareS3Inspection({ ...sampleDraft(), endpoint }); assert.equal(a.ok, true); assert.equal(a.payload.endpoint, endpoint)
    })
  test('accepts exact 1024-byte joined key, empty token and byte budgets at both limits', () => {
    for (const maxBytes of ['1','1048576']) {
      const a = prepareS3Inspection({ ...sampleDraft(), prefix: 'x'.repeat(900), key: 'y'.repeat(123), sessionToken: '', maxBytes })
      assert.equal(a.ok, true); assert.equal(a.payload.maxBytes, Number(maxBytes))
    }
  })
  test('accessor properties are refused without evaluating credentials', () => {
    let reads = 0; const d = sampleDraft(); Object.defineProperty(d, 'secretAccessKey', { enumerable: true, get() { reads++; throw Error('SECRET') } })
    assert.equal(prepareS3Inspection(d).ok, false); assert.equal(reads, 0)
  })
  test('unknown properties, symbols, inherited records and missing fields are refused', () => {
    const missing = sampleDraft(); delete missing.region
    for (const d of [{ ...sampleDraft(), extra: 1 }, { ...sampleDraft(), [Symbol()]: 1 }, Object.create(sampleDraft()), missing, null, []])
      assert.equal(prepareS3Inspection(d).ok, false)
  })
  test('throwing reflection does not leak arbitrary error messages', () => {
    const d = new Proxy({}, { getPrototypeOf() { throw Error('SENSITIVE-REFLECTION') } })
    const a = prepareS3Inspection(d); assert.equal(a.ok, false); assert.ok(!JSON.stringify(a).includes('SENSITIVE-REFLECTION'))
  })
  test('response guidance never promotes read success or 403/404 into valid credentials', () => {
    assert.match(inspectionNextStep('access-denied'), /不能.*判定密码错误/)
    assert.match(inspectionNextStep('not-found'), /不证明/)
    assert.match(inspectionNextStep('readable'), /不会启用.*同步/)
    assert.ok(!inspectionNextStep('SECRET-UNKNOWN').includes('SECRET-UNKNOWN'))
  })
  test('mount, subscribe and invalidate do not discover the bridge or perform I/O', () => {
    let calls = 0; const b = createS3ProbeBinding({ getBridge() { calls++; return {} } }); const unsub = b.subscribe(() => {}), close = b.connect()
    b.invalidate(); close(); unsub(); assert.equal(calls, 0)
  })
  for (const [code, http] of [['access-denied',401],['access-denied',403],['not-found',404],['redirect-refused',302],['http-failure',500],
    ['too-large',0],['body-rejected',0],['transport-failure',0],['cancelled',0],['deadline-exceeded',0]])
    test('actual existing binding classifies ' + code + '/' + http + ' and can explicitly retry', async () => {
      let calls = 0; const b = createS3ProbeBinding({ getBridge: () => ({ s3ProbeRead: () => ++calls === 1 ? outcome(code,http) : readable(0) }) }), close = b.connect()
      try { const p = prepareS3Inspection(sampleDraft()).payload; const a = await b.read(p)
        assert.equal(a.state,'failed'); assert.equal(a.code,code); assert.equal(a.summary.acceptedBytes,0)
        const good = await b.read(p); assert.equal(good.state,'readable'); assert.equal(good.summary.acceptedBytes,0); assert.equal(calls,2)
      } finally { close() }
    })
  test('stop holds native slot; busy click cannot restore stale success; explicit retry works after settlement', async () => {
    const d = deferred(); let calls = 0
    const b = createS3ProbeBinding({ getBridge: () => ({ s3ProbeRead: () => ++calls === 1 ? d.promise : readable(9) }) }), close = b.connect()
    try { const payload = prepareS3Inspection(sampleDraft()).payload, p = b.read(payload)
      assert.equal(b.snapshot().state,'pending'); b.invalidate(); assert.equal((await p).state,'stopped')
      assert.equal((await b.read(payload)).code,'session-busy'); assert.equal(calls,1)
      d.resolve(readable(20)); await tick(); assert.equal(b.snapshot().state,'stopped')
      assert.equal((await b.read(payload)).summary.acceptedBytes,9); assert.equal(calls,2)
    } finally { close() }
  })
  test('A to B to A input changes cannot revive an old successful result', async () => {
    const d = deferred(), b = createS3ProbeBinding({ getBridge: () => ({ s3ProbeRead: () => d.promise }) }), close = b.connect()
    try { const p=b.read(prepareS3Inspection(sampleDraft()).payload); b.invalidate(); b.invalidate(); d.resolve(readable(20)); await p; await tick()
      assert.equal(b.snapshot().state,'stopped'); assert.equal(b.snapshot().summary,null)
    } finally { close() }
  })
  test('late rejection after close is consumed and does not alter a reopened binding', async () => {
    const d=deferred(), b=createS3ProbeBinding({ getBridge:()=>({s3ProbeRead:()=>d.promise}) }); const close=b.connect()
    const p=b.read(prepareS3Inspection(sampleDraft()).payload); close(); const close2=b.connect()
    d.reject(Error('SECRET-LATE-NATIVE')); await p; await tick(); assert.equal(b.snapshot().state,'idle'); close2()
  })
  test('renderer wait timeout preserves native ownership and ignores late success', async () => {
    let timeout; const d=deferred(), b=createS3ProbeBinding({ getBridge:()=>({s3ProbeRead:()=>d.promise}), schedule(fn){timeout=fn;return 1},cancel(){} }), close=b.connect()
    try { const payload=prepareS3Inspection(sampleDraft()).payload,p=b.read(payload); timeout(); assert.equal((await p).code,'wait-timeout')
      assert.equal((await b.read(payload)).code,'session-busy'); d.resolve(readable()); await tick(); assert.equal(b.snapshot().summary,null)
    } finally { close() }
  })
  test('malformed native replies and over-budget success are refused, not displayed', async () => {
    for (const reply of [{ ...readable(), extra:'SECRET' }, readable(1025)]) {
      const b=createS3ProbeBinding({getBridge:()=>({s3ProbeRead:()=>reply})}),close=b.connect()
      try { const r=await b.read(prepareS3Inspection(sampleDraft()).payload); assert.equal(r.code,'invalid-reply'); assert.equal(r.summary,null); assert.ok(!JSON.stringify(r).includes('SECRET')) } finally { close() }
    }
  })
  test('missing bridge refuses without browser network fallback', async () => {
    const b=createS3ProbeBinding({getBridge:()=>null}),close=b.connect()
    try { assert.equal((await b.read(prepareS3Inspection(sampleDraft()).payload)).code,'native-unavailable') } finally { close() }
  })
}
