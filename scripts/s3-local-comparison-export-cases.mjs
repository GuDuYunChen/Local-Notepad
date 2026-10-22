import assert from 'node:assert/strict'
import { createLocalComparisonExport as create, COMPARISON_EXPORT_LIMIT, COMPARISON_EXPORT_NOTICE } from '../src/services/s3LocalComparisonExport.mjs'
import { comparisonFile, comparisonLocal } from './s3-local-overview-comparison-cases.mjs'
const at = Date.UTC(2026, 9, 10, 12)
const build = () => create(comparisonFile(), comparisonLocal())
// Independent parser for this fixed-schema CSV (including quoted fields).
export function comparisonCSVRows(raw) {
  assert.equal(raw[0], '\ufeff')
  return raw.slice(1).split('\r\n').slice(0, -1).map(line => {
    const cells = []; let value = '', quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++ }
        else quoted = !quoted
      } else if (c === ',' && !quoted) { cells.push(value); value = '' }
      else value += c
    }
    assert.equal(quoted, false); cells.push(value); return cells
  })
}
export function registerComparisonExportTests(test) {
  test('comparison export captures the same full twelve metrics as its displayed comparison', () => {
    const output = build(), json = JSON.parse(output.prepare('json', at).raw)
    assert.equal(json.metrics.length, 12); assert.equal(json.metricCount, 12); assert.equal(json.changedMetricCount, 6)
    assert.deepEqual(json.metrics.map(row => [row.id, row.reference, row.local, row.delta]),
      [...output.display.totals, ...output.display.categories].map(row => [row.id, row.values.reference, row.values.local, row.values.delta]))
    assert.equal(json.metrics[0].delta, 2); assert.equal(json.metrics[2].delta, -3)
    assert.ok(Object.isFrozen(output) && Object.isFrozen(output.display))
  })
  test('comparison export states direction, provenance, generation time and non-backup limits', () => {
    const data = JSON.parse(build().prepare('json', at).raw)
    assert.equal(data.format, 'local-notepad-local-comparison-report'); assert.equal(data.version, 1)
    assert.equal(data.direction, 'local-minus-reference'); assert.equal(data.scope, 'previously-confirmed-numeric-comparison')
    assert.equal(data.sameWorkspaceVerified, false); assert.equal(data.completeForPreview, false)
    assert.equal(data.generationTimeIsObservationTime, false); assert.equal(data.includesAllMetrics, true)
    assert.equal(data.generatedAtUTC, '2026-10-10T12:00:00.000Z'); assert.equal(data.notice, COMPARISON_EXPORT_NOTICE)
    assert.match(data.notice, /不是笔记备份/); assert.match(data.notice, /不代表内容相同/)
  })
  test('comparison export never silently exports the filtered six-row view', () => {
    const output = build(); assert.equal(output.display.changedCount, 6)
    assert.equal(JSON.parse(output.prepare('json', at).raw).metrics.length, 12)
    assert.equal(comparisonCSVRows(output.prepare('csv', at).raw).length, 13)
  })
  test('comparison export preserves zero deltas and original values without claiming content equality', () => {
    const file = comparisonFile(), data = JSON.parse(create(file, file.summary).prepare('json', at).raw)
    assert.equal(data.changedMetricCount, 0); assert.equal(data.metrics.length, 12)
    assert.ok(data.metrics.every(row => row.delta === 0 && row.reference === row.local))
    assert.equal(data.sameWorkspaceVerified, false)
  })
  test('comparison export snapshot cannot change when original inputs are mutated', () => {
    const file = structuredClone(comparisonFile()), local = structuredClone(comparisonLocal())
    const before = structuredClone({ file, local }), output = create(file, local), first = output.prepare('json', at).raw
    assert.deepEqual({ file, local }, before)
    file.summary.records = 999; local.kinds[0].record_bytes = 999; file.generatedAtUTC = 'PRIVATE'
    assert.equal(output.prepare('json', at).raw, first)
  })
  for (const which of ['report', 'local', 'extra', 'sum', 'order', 'timestamp']) {
    test(`comparison export rejects invalid ${which} before creating any output`, () => {
      let file = structuredClone(comparisonFile()), local = structuredClone(comparisonLocal())
      if (which === 'report') file = null
      if (which === 'local') local = null
      if (which === 'extra') file.private = 'PRIVATE'
      if (which === 'sum') local.records++
      if (which === 'order') local.kinds.reverse()
      if (which === 'timestamp') file.generatedAtUTC = '=PRIVATE()'
      assert.throws(() => create(file, local), error => !error.message.includes('PRIVATE'))
    })
  }
  test('comparison export does not execute private input accessors', () => {
    const file = structuredClone(comparisonFile()); let touched = 0
    Object.defineProperty(file, 'summary', { enumerable: true, get() { touched++; throw Error('PRIVATE') } })
    assert.throws(() => create(file, comparisonLocal())); assert.equal(touched, 0)
  })
  test('comparison export rejects invalid formats and clocks without caller text in errors', () => {
    const output = build()
    for (const format of ['PRIVATE', null, {}, 'CSV', '__proto__']) assert.throws(() => output.prepare(format, at), /未导出部分数据/)
    for (const now of [-1, Infinity, NaN, 'PRIVATE', 1.1, 253402300800000]) assert.throws(() => output.prepare('json', now), /未导出部分数据/)
    assert.match(output.prepare('csv', 0).filename, /1970-01-01/)
  })
  test('comparison CSV independently decodes to the exact JSON numeric columns and fixed metadata', () => {
    const output = build(), json = JSON.parse(output.prepare('json', at).raw), file = output.prepare('csv', at)
    const rows = comparisonCSVRows(file.raw); assert.equal(rows.length, 13)
    assert.ok(rows.every(row => row.length === 10)); assert.equal(rows[0][5], '差值（本次减报告）')
    for (const [i, row] of rows.slice(1).entries()) {
      assert.deepEqual(row.slice(0, 6), Object.values(json.metrics[i]).map(String))
      assert.equal(row[6], json.referenceGeneratedAtUTC); assert.equal(row[7], json.generatedAtUTC)
      assert.equal(row[8], 'false'); assert.equal(row[9], COMPARISON_EXPORT_NOTICE)
    }
    assert.ok(!file.raw.replace(/\r\n/g, '').includes('\n')); assert.equal(file.mime, 'text/csv;charset=utf-8')
  })
  test('comparison export fields are whitelisted and contain no source bodies paths or identifiers', () => {
    const json = JSON.parse(build().prepare('json', at).raw)
    assert.deepEqual(Object.keys(json), ['format','version','generatedAtUTC','referenceGeneratedAtUTC','generationTimeIsObservationTime',
      'scope','direction','sameWorkspaceVerified','completeForPreview','includesAllMetrics','metricCount','changedMetricCount','notice','metrics'])
    assert.ok(json.metrics.every(row => Object.keys(row).join(',') === 'id,label,unit,reference,local,delta'))
  })
  test('comparison export filename is portable and content never exceeds the hard byte limit', () => {
    for (const format of ['json','csv']) {
      const file = build().prepare(format, at)
      assert.ok(Object.isFrozen(file)); assert.ok(Buffer.byteLength(file.raw) <= COMPARISON_EXPORT_LIMIT)
      assert.equal(file.filename, `Local-Notepad-comparison-2026-10-10T12-00-00-000Z.${format}`)
      assert.doesNotMatch(file.filename, /[\\/:*?"<>|]/)
    }
  })
  test('comparison export represents maximum positive and negative byte differences exactly', () => {
    const empty = structuredClone(comparisonFile()), max = structuredClone(comparisonLocal())
    Object.assign(empty.summary, { records:0, record_bytes:0, attachment_bytes:0, base_items:0 })
    empty.summary.kinds.forEach(row => Object.assign(row, { records:0, record_bytes:0 }))
    Object.assign(max, { records:256, record_bytes:2097152, attachment_bytes:67108864, base_items:128 })
    max.kinds.forEach((row,i) => Object.assign(row, { records:i===0||i===3?128:0, record_bytes:i===0||i===3?1048576:0 }))
    const a = create(empty,max), b = create({...empty, summary:max},empty.summary)
    assert.equal(JSON.parse(a.prepare('json',at).raw).metrics[2].delta,67108864)
    assert.equal(JSON.parse(b.prepare('json',at).raw).metrics[2].delta,-67108864)
    assert.ok(Buffer.byteLength(a.prepare('csv',at).raw) <= COMPARISON_EXPORT_LIMIT)
  })
  test('comparison download is explicit, validates format before DOM and cleans owned resources on failure', async () => {
    const oldDoc = Object.getOwnPropertyDescriptor(globalThis,'document'), oldURL = globalThis.URL, oldTimer = globalThis.setTimeout
    const calls = [], blobs = [], timers = []
    const link = { remove() { calls.push('remove') }, click() { calls.push('click') } }
    try {
      Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){calls.push('create');return link},body:{append(){calls.push('append')}}}})
      globalThis.URL = { createObjectURL(blob){blobs.push(blob);return 'blob:comparison'},revokeObjectURL(url){calls.push(url)} }
      globalThis.setTimeout = (fn,ms) => { assert.equal(ms,1000);timers.push(fn) }
      const output = build(); assert.deepEqual(calls,[])
      assert.throws(() => output.download('PRIVATE')); assert.equal(blobs.length,0)
      output.download('json'); assert.equal(JSON.parse(await blobs[0].text()).metrics.length,12)
      assert.deepEqual(calls,['create','append','click','remove']); assert.match(link.download,/\.json$/)
      timers.shift()(); assert.equal(calls.at(-1),'blob:comparison')
      link.click = () => { throw Error('synthetic') }
      assert.throws(() => output.download('csv')); assert.equal(calls.at(-1),'remove')
      timers.shift()(); assert.equal(calls.at(-1),'blob:comparison')
    } finally {
      if(oldDoc)Object.defineProperty(globalThis,'document',oldDoc);else delete globalThis.document
      globalThis.URL=oldURL;globalThis.setTimeout=oldTimer
    }
  })
}
