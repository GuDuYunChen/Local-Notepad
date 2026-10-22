import assert from 'node:assert/strict'
import { createOfflinePairExport, OFFLINE_PAIR_EXPORT_LIMIT } from '../src/services/s3OfflinePairExport.mjs'
import { parseLocalOverviewFile } from '../src/services/s3LocalOverviewFile.mjs'
import { reportFixture } from './s3-local-overview-file-cases.mjs'
const time = Date.UTC(2026, 9, 10, 0, 0, 0)
const rawPair = () => {
  const a = reportFixture(), b = structuredClone(a)
  b.records++; b.recordBytes++; b.kinds[0].records++; b.kinds[0].recordBytes++
  b.generatedAtUTC = '2026-01-01T00:00:00.000Z'
  return [a, b]
}
const project = raw => parseLocalOverviewFile(JSON.stringify(raw))
export const offlineExportFixture = () => createOfflinePairExport(...rawPair().map(project))
export function readOfflineExportCSV(raw) {
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = raw.charCodeAt(0) === 0xFEFF ? 1 : 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === '"') { if (quoted && raw[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { row.push(cell); cell = '' }
    else if (c === '\r' && raw[i + 1] === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += c
  }
  assert.equal(quoted, false); assert.equal(cell, ''); assert.deepEqual(row, [])
  return rows
}
export function registerOfflinePairExportTests(test) {
  for (const format of ['json', 'csv', 'html']) test(`offline pair export ${format} is bounded and uses its own portable filename`, () => {
    const output = offlineExportFixture(), file = output.prepare(format, time)
    assert.ok(Object.isFrozen(file)); assert.ok(Buffer.byteLength(file.raw) <= OFFLINE_PAIR_EXPORT_LIMIT)
    assert.equal(file.format, format); assert.equal(file.filename, `Local-Notepad-offline-pair-2026-10-10T00-00-00-000Z.${format}`)
    assert.doesNotMatch(file.filename, /[\\/:*?"<>|]/)
  })
  test('offline pair export captures a detached complete frozen model exactly once', () => {
    const [a, b] = rawPair().map(project), input = structuredClone(a), output = createOfflinePairExport(input, b)
    const before = output.prepare('json', time).raw
    input.summary.kinds[0].records = 99; input.generatedAtUTC = 'PRIVATE'
    assert.equal(output.prepare('json', time).raw, before)
    assert.ok(Object.isFrozen(output) && Object.isFrozen(output.comparison) && Object.isFrozen(output.comparison.rows))
    assert.ok(output.comparison.rows.every(Object.isFrozen)); assert.equal(output.comparison.rows.length, 12)
  })
  test('offline pair export JSON names both sources as untrusted files and fixes B minus A', () => {
    const output = offlineExportFixture(), data = JSON.parse(output.prepare('json', time).raw)
    assert.equal(data.format, 'local-notepad-offline-pair-comparison'); assert.equal(data.version, 1)
    assert.equal(data.scope, 'previously-confirmed-file-pair'); assert.equal(data.direction, 'B-minus-A')
    assert.equal(data.reportA.source, 'untrusted-file'); assert.equal(data.reportB.source, 'untrusted-file')
    for (const key of ['sameWorkspaceVerified','contentEqualityVerified','completeForPreview','generationTimeIsObservationTime']) assert.equal(data[key], false)
    assert.equal(data.includesAllMetrics, true); assert.equal(data.metricCount, 12)
    assert.deepEqual(data.metrics, output.comparison.rows)
    assert.equal(data.changedMetricCount, 4); assert.equal(data.metrics[0].delta, 1)
    assert.ok(!Object.hasOwn(data.metrics[0], 'local'))
  })
  test('offline pair export preserves zero and negative deltas instead of silently filtering', () => {
    const [a,b] = rawPair().map(project), output = createOfflinePairExport(b,a)
    for (const format of ['json','csv','html']) assert.ok(output.prepare(format,time).raw.includes('-1'))
    const data = JSON.parse(output.prepare('json',time).raw)
    assert.equal(data.metrics.length,12);assert.equal(data.metrics.filter(r=>r.delta===0).length,8)
    assert.equal(data.metrics[0].delta,-1)
  })
  test('offline pair export equal reports retain twelve rows and deny content equality', () => {
    const a = project(reportFixture()), output = createOfflinePairExport(a,a), data = JSON.parse(output.prepare('json',time).raw)
    assert.equal(data.changedMetricCount,0);assert.equal(data.metrics.length,12)
    assert.ok(data.metrics.every(r=>r.delta===0));assert.equal(data.contentEqualityVerified,false)
  })
  test('offline pair export CSV is one full rectangular table with exact numeric values and provenance', () => {
    const output = offlineExportFixture(), raw = output.prepare('csv',time).raw, csv = readOfflineExportCSV(raw)
    assert.equal(raw.charCodeAt(0),0xFEFF);assert.equal(csv.length,13);assert.ok(csv.every(r=>r.length===11))
    csv.slice(1).forEach((row,i)=>{
      const metric=output.comparison.rows[i]
      assert.deepEqual(row.slice(0,6),[metric.key,metric.label,metric.unit,String(metric.a),String(metric.b),String(metric.delta)])
      assert.equal(row[6],output.comparison.generatedA);assert.equal(row[7],output.comparison.generatedB)
      assert.equal(row[8],new Date(time).toISOString());assert.equal(row[9],'false');assert.match(row[10],/双方都是文件声明/)
    })
    assert.doesNotMatch(raw,/本次本地盘点|=HYPERLINK/)
  })
  test('offline pair export HTML preserves every metric and contains no active or remote content', () => {
    const output = offlineExportFixture(), raw=output.prepare('html',time).raw
    const rows=[...raw.matchAll(/<tr data-offline-metric="([^"]+)"><th scope="row">([^<]+)<\/th><td>(\d+)<\/td><td>(\d+)<\/td><td>([+-]?\d+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
    assert.equal(rows.length,12)
    assert.deepEqual(rows.map(m=>({key:m[1],label:m[2],a:+m[3],b:+m[4],delta:+m[5],unit:m[6]})),output.comparison.rows)
    assert.match(raw,/default-src 'none'/);assert.match(raw,/@media print/);assert.match(raw,/<caption>/)
    assert.doesNotMatch(raw,/<(?:script|iframe|form|img|link|object)\b|\s(?:src|href|onload|onclick)=/i)
    assert.match(raw,/报告 A 声明生成时间/);assert.match(raw,/报告 B 声明生成时间/)
  })
  test('offline pair export disregards file-provided notice text and never copies private text', () => {
    const [a,b]=rawPair();a.notice='PRIVATE <script>alert(1)</script> =HYPERLINK("x")'
    const output=createOfflinePairExport(project(a),project(b))
    for(const format of ['json','csv','html'])assert.doesNotMatch(output.prepare(format,time).raw,/PRIVATE|alert\(1\)|HYPERLINK/)
  })
  for(const side of [0,1]) test(`offline pair export validates complete side ${side===0?'A':'B'} before permitting output`,()=>{
    const pair=rawPair().map(project);const bad=structuredClone(pair[side]);bad.summary.records++;pair[side]=bad
    assert.throws(()=>createOfflinePairExport(...pair),/完整且有效/)
  })
  test('offline pair export rejects getters and extra fields without evaluating private input',()=>{
    const [a,b]=rawPair().map(project);let calls=0
    const hostile={...a,get summary(){calls++;throw Error('PRIVATE')}}
    assert.throws(()=>createOfflinePairExport(hostile,b));assert.equal(calls,0)
    assert.throws(()=>createOfflinePairExport(a,{...b,path:'PRIVATE'}))
  })
  test('offline pair export rejects unsupported formats and invalid times without I/O',()=>{
    const output=offlineExportFixture()
    for(const fmt of ['', 'pdf', 'JSON', {}, null])assert.throws(()=>output.prepare(fmt,time))
    for(const now of [-1,NaN,Infinity,1.5,'PRIVATE',null,253402300800000])assert.throws(()=>output.prepare('json',now),e=>!e.message.includes('PRIVATE'))
    assert.match(output.prepare('json',0).raw,/1970-01-01T00:00:00.000Z/)
  })
  test('offline pair export generation time does not reorder reports or change values',()=>{
    const output=offlineExportFixture(),first=JSON.parse(output.prepare('json',0).raw),last=JSON.parse(output.prepare('json',time).raw)
    assert.deepEqual(first.metrics,last.metrics);assert.deepEqual(first.reportA,last.reportA);assert.deepEqual(first.reportB,last.reportB)
    assert.notEqual(first.generatedAtUTC,last.generatedAtUTC);assert.equal(first.direction,'B-minus-A')
  })
  test('offline pair export maximum allowed reports fit all format limits without truncation',()=>{
    const a=reportFixture();Object.assign(a,{records:256,recordBytes:2097152,attachmentBytes:67108864,baseItems:128})
    a.kinds.forEach((k,i)=>Object.assign(k,{records:i===0||i===3?128:0,recordBytes:i===0||i===3?1048576:0}))
    const output=createOfflinePairExport(project(a),project(a))
    for(const format of ['json','csv','html'])assert.ok(Buffer.byteLength(output.prepare(format,253402300799999).raw)<=OFFLINE_PAIR_EXPORT_LIMIT)
    assert.equal(output.comparison.rows.length,12)
  })
  test('offline pair download uses owned Blob bytes and cleans up success and failed clicks',async()=>{
    const descriptors=new Map(['document','URL','setTimeout'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]))
    const events=[],jobs=[],blobs=[];const anchor={click(){events.push('click')},remove(){events.push('remove')}}
    try{
      Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){events.push('create');return anchor},body:{append(){events.push('append')}}}})
      globalThis.URL={createObjectURL(blob){blobs.push(blob);return 'blob:owned-pair'},revokeObjectURL(url){events.push(url)}}
      globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,1000);jobs.push(fn)}
      const output=offlineExportFixture();assert.deepEqual(events,[])
      assert.throws(()=>output.download('pdf'));assert.equal(blobs.length,0)
      const name=output.download('json');assert.equal(anchor.download,name);assert.equal(anchor.href,'blob:owned-pair')
      assert.equal(JSON.parse(await blobs[0].text()).metricCount,12);assert.deepEqual(events,['create','append','click','remove'])
      jobs.shift()();assert.equal(events.at(-1),'blob:owned-pair')
      anchor.click=()=>{throw Error('synthetic-download-error')};assert.throws(()=>output.download('html'))
      assert.equal(events.at(-1),'remove');jobs.shift()();assert.equal(events.at(-1),'blob:owned-pair')
    }finally{for(const [k,d]of descriptors)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k]}
  })
}
