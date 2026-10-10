import assert from 'node:assert/strict'
import { parseLocalOverviewFile as parse, readLocalOverviewFile as read } from '../src/services/s3LocalOverviewFile.mjs'

export function reportFixture() {
  return { format: 'local-notepad-local-inventory-report', version: 1, generatedAtUTC: '2026-10-09T12:00:00.000Z',
    scope: 'previously-read-local-observation', readOnly: true, completeForPreview: false,
    notice: 'Ignored file-supplied notice', generationTimeIsObservationTime: false,
    records: 2, recordBytes: 110, attachmentBytes: 4, baseItems: 1,
    kinds: ['file', 'tag', 'file-tag', 'attachment'].map((kind, i) => ({ kind, records: i === 0 || i === 3 ? 1 : 0,
      recordBytes: i === 0 ? 60 : i === 3 ? 50 : 0 })) }
}
const raw = () => JSON.stringify(reportFixture())
function harness() {
  const state = { at: 100, reads: 0, aborts: 0, timers: new Map() }
  const reader = { result: null, abort() { state.aborts++ }, readAsArrayBuffer() { state.reads++ } }
  const options = { readerFactory: () => reader, clock: () => state.at,
    schedule: (fn, ms) => { state.timers.set(1, fn); state.wait = ms; return 1 }, cancel: id => state.timers.delete(id) }
  const file = { size: new TextEncoder().encode(raw()).length }
  const load = (text = raw()) => { reader.result = new TextEncoder().encode(text).buffer; reader.onload?.() }
  return { state, reader, options, file, load }
}
export function registerLocalOverviewFileTests(test) {
  test('offline inventory parses exact exported counts as an untrusted immutable file projection', () => {
    const out = parse(raw())
    assert.equal(out.source, 'untrusted-file'); assert.equal(out.summary.records, 2)
    assert.equal(out.summary.record_bytes, 110); assert.equal(out.summary.attachment_bytes, 4)
    assert.equal(out.generatedAtUTC, '2026-10-09T12:00:00.000Z'); assert.equal(out.summary.complete_for_preview, false)
    assert.ok(Object.isFrozen(out) && Object.isFrozen(out.summary) && Object.isFrozen(out.summary.kinds[0]))
  })
  test('offline inventory accepts UTF-8 BOM and CRLF formatting without changing values', () => {
    assert.deepEqual(parse('\uFEFF' + JSON.stringify(reportFixture(), null, 2).replace(/\n/g, '\r\n')), parse(raw()))
  })
  test('offline inventory discards file-supplied instructions and returns no private text', () => {
    const d = reportFixture(); d.notice = '<script>PRIVATE_run_sync</script>'
    assert.ok(!JSON.stringify(parse(JSON.stringify(d))).includes('PRIVATE'))
  })
  for (const field of Object.keys(reportFixture())) test(`offline inventory requires ${field}`, () => {
    const d = reportFixture(); delete d[field]; assert.throws(() => parse(JSON.stringify(d)), /报告格式/)
  })
  test('offline inventory rejects unknown fields and wrong totals, types, scope and versions', () => {
    for (const patch of [{ private: 'PRIVATE' }, { records: 3 }, { version: 2 }, { readOnly: false },
      { scope: 'current-workspace' }, { completeForPreview: true }, { generationTimeIsObservationTime: true },
      { baseItems: -1 }, { recordBytes: 111 }, { attachmentBytes: 33554433 }, { notice: 4 }, { records: '2' }]) {
      assert.throws(() => parse(JSON.stringify({ ...reportFixture(), ...patch })), e => e.code === 'invalid' && !e.message.includes('PRIVATE'))
    }
  })
  test('offline inventory rejects duplicate and escaped duplicate keys at root and rows', () => {
    for (const value of [raw().replace('"records":2', '"records":2,"records":2'),
      raw().replace('"records":2', '"records":2,"\\u0072ecords":2'),
      raw().replace('"kind":"file"', '"kind":"file","kind":"file"')]) assert.throws(() => parse(value))
  })
  test('offline inventory rejects malformed JSON, multiple documents, excessive depth and signed zero', () => {
    for (const value of ['{', raw() + '{}', '[[[[' + raw() + ']]]]', raw().replace('"baseItems":1', '"baseItems":-0')]) assert.throws(() => parse(value))
  })
  test('offline inventory checks all dates with canonical round-trip and does not trust future claims', () => {
    for (const date of ['2026-02-30T00:00:00.000Z', '2026-10-09', 'PRIVATE', null])
      assert.throws(() => parse(JSON.stringify({ ...reportFixture(), generatedAtUTC: date })))
    const future = parse(JSON.stringify({ ...reportFixture(), generatedAtUTC: '9999-12-31T23:59:59.999Z' }))
    assert.equal(future.source, 'untrusted-file')
  })
  test('offline inventory rejects invalid or missing rows and preserves valid zero observations', () => {
    const d = reportFixture(); d.kinds.reverse(); assert.throws(() => parse(JSON.stringify(d)))
    const q = reportFixture(); q.kinds[0].path = 'PRIVATE'; assert.throws(() => parse(JSON.stringify(q)))
    const z = reportFixture(); Object.assign(z, { records: 0, recordBytes: 0, attachmentBytes: 0, baseItems: 0 })
    z.kinds.forEach(row => Object.assign(row, { records: 0, recordBytes: 0 }))
    assert.equal(parse(JSON.stringify(z)).summary.records, 0)
  })
  test('offline inventory rejects UTF-8 byte overflow before parsing', () => {
    for (const value of ['', null, ' '.repeat(4097), '雪'.repeat(1500)]) assert.throws(() => parse(value), e => e.code === 'size')
  })
  test('offline inventory real bounded reader passes bytes through strict decoder and clears handlers', async () => {
    const h = harness(), p = read(h.file, h.options); h.load()
    assert.deepEqual(await p, parse(raw())); assert.equal(h.state.reads, 1); assert.equal(h.state.timers.size, 0)
    assert.equal(h.reader.onload, null); assert.equal(h.state.aborts, 0)
  })
  test('offline inventory validates size before constructing a reader', async () => {
    let calls = 0
    for (const size of [0, -1, 4097, 1.2, NaN, '3']) await assert.rejects(read({ size }, { readerFactory() { calls++ } }), e => e.code === 'size')
    assert.equal(calls, 0)
  })
  test('offline inventory refuses aborted or invalid request options without reading', async () => {
    const h = harness(), c = new AbortController(); c.abort()
    await assert.rejects(read(h.file, { ...h.options, signal: c.signal }), e => e.code === 'aborted')
    await assert.rejects(read(h.file, { ...h.options, timeoutMs: 5001 }), e => e.code === 'read')
    await assert.rejects(read(h.file, { ...h.options, signal: {} }), e => e.code === 'read')
    assert.equal(h.state.reads, 0)
  })
  test('offline inventory cancellation revokes captured late callbacks and cleans owned resources', async () => {
    const h = harness(), c = new AbortController(), p = read(h.file, { ...h.options, signal: c.signal })
    const late = h.reader.onload; c.abort(); h.reader.result = new TextEncoder().encode(raw()).buffer; late()
    await assert.rejects(p, e => e.code === 'aborted'); assert.equal(h.state.aborts, 1); assert.equal(h.state.timers.size, 0)
  })
  test('offline inventory refuses cancellation between completion and promise delivery', async () => {
    const h = harness(), c = new AbortController(), p = read(h.file, { ...h.options, signal: c.signal })
    h.load(); c.abort(); await assert.rejects(p, e => e.code === 'aborted')
  })
  for (const event of ['load', 'error', 'throw']) test(`offline inventory absolute deadline dominates late ${event}`, async () => {
    const h = harness(), p = read(h.file, h.options); h.state.at = 5100
    if (event === 'load') h.load()
    else if (event === 'error') h.reader.onerror()
    else { Object.defineProperty(h.reader, 'result', { get() { throw Error('PRIVATE') } }); h.reader.onload() }
    await assert.rejects(p, e => e.code === 'timeout'); assert.equal(h.state.aborts, 1)
  })
  test('offline inventory timeout requests abort and never retries', async () => {
    const h = harness(), p = read(h.file, h.options); h.state.timers.get(1)()
    await assert.rejects(p, e => e.code === 'timeout'); assert.equal(h.state.reads, 1); assert.equal(h.state.aborts, 1)
  })
  test('offline inventory rejects mismatched length and invalid UTF-8 without replacement characters', async () => {
    for (const invalid of [new Uint8Array([255]).buffer, 'not-bytes']) {
      const h = harness(), p = read({ size: 1 }, h.options); h.reader.result = invalid; h.reader.onload()
      await assert.rejects(p, e => ['read', 'encoding'].includes(e.code))
    }
    const h = harness(), p = read(h.file, h.options); h.reader.result = new ArrayBuffer(1); h.reader.onload()
    await assert.rejects(p, e => e.code === 'read')
  })
  test('offline inventory sanitizes reader errors and synchronous setup exceptions', async () => {
    const h = harness(), p = read(h.file, h.options); h.reader.onerror(Error('PRIVATE'))
    await assert.rejects(p, e => e.code === 'read' && !e.message.includes('PRIVATE'))
    await assert.rejects(read(h.file, { ...h.options, readerFactory() { throw Error('PRIVATE') } }), /未能读取/)
  })
  test('offline inventory synchronous timeout and bad clocks do not start file I/O', async () => {
    const h = harness()
    await assert.rejects(read(h.file, { ...h.options, schedule(fn) { fn(); return 1 } }), e => e.code === 'timeout')
    for (const at of [-1, NaN, Infinity]) await assert.rejects(read(h.file, { ...h.options, clock: () => at }), e => e.code === 'read')
    assert.equal(h.state.reads, 0)
  })
}
