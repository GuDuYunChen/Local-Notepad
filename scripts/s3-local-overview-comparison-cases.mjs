import assert from 'node:assert/strict'
import { compareLocalOverviewReport as compare, comparisonDelta, LOCAL_COMPARISON_NOTICE } from '../src/services/s3LocalOverviewComparison.mjs'
import { parseLocalOverviewFile } from '../src/services/s3LocalOverviewFile.mjs'
import { reportFixture } from './s3-local-overview-file-cases.mjs'

export const comparisonFile = () => parseLocalOverviewFile(JSON.stringify(reportFixture()))
export function comparisonLocal() {
  const value = reportFixture()
  value.records += 2; value.recordBytes += 10; value.attachmentBytes = 1; value.baseItems = 0
  value.kinds[0].records += 2; value.kinds[0].recordBytes += 10
  return parseLocalOverviewFile(JSON.stringify(value)).summary
}
export function registerLocalComparisonTests(test) {
  test('inventory comparison shows exact local minus file totals and categories', () => {
    const file = comparisonFile(), local = comparisonLocal(), out = compare(file, local)
    assert.deepEqual(out.records, { reference: 2, local: 4, delta: 2 })
    assert.deepEqual(out.recordBytes, { reference: 110, local: 120, delta: 10 })
    assert.deepEqual(out.attachmentBytes, { reference: 4, local: 1, delta: -3 })
    assert.deepEqual(out.baseItems, { reference: 1, local: 0, delta: -1 })
    assert.deepEqual(out.kinds.map(r => r.kind), ['file', 'tag', 'file-tag', 'attachment'])
    assert.deepEqual(out.kinds.map(r => r.records.delta), [2, 0, 0, 0])
    assert.deepEqual(out.kinds.map(r => r.recordBytes.delta), [10, 0, 0, 0])
    assert.equal(out.records.delta, out.kinds.reduce((n, r) => n + r.records.delta, 0))
    assert.equal(out.recordBytes.delta, out.kinds.reduce((n, r) => n + r.recordBytes.delta, 0))
  })
  test('inventory comparison equal observations never prove shared workspace or matching content', () => {
    const file = comparisonFile(), out = compare(file, file.summary)
    assert.equal(out.records.delta, 0); assert.equal(out.sameWorkspaceVerified, false)
    assert.equal(out.completeForPreview, false); assert.equal(out.source, 'numeric-comparison')
    assert.equal(out.notice, LOCAL_COMPARISON_NOTICE); assert.match(out.notice, /未验证两者来自同一工作区/)
    assert.deepEqual(Object.keys(out), ['source', 'sameWorkspaceVerified', 'completeForPreview', 'reportGeneratedAtUTC', 'notice', 'records', 'recordBytes', 'attachmentBytes', 'baseItems', 'kinds'])
  })
  test('inventory comparison accepts zero and hard maximum without truncation', () => {
    const empty = reportFixture(); Object.assign(empty, {records:0,recordBytes:0,attachmentBytes:0,baseItems:0})
    empty.kinds.forEach(row => Object.assign(row,{records:0,recordBytes:0}))
    const max = reportFixture(); Object.assign(max,{records:256,recordBytes:2097152,attachmentBytes:67108864,baseItems:128})
    max.kinds.forEach((row,i) => Object.assign(row,{records:i===0||i===3?128:0,recordBytes:i===0||i===3?1048576:0}))
    const a = parseLocalOverviewFile(JSON.stringify(empty)), b = parseLocalOverviewFile(JSON.stringify(max))
    assert.equal(compare(a,b.summary).attachmentBytes.delta,67108864)
    assert.equal(compare(b,a.summary).recordBytes.delta,-2097152)
  })
  test('inventory comparison reversed numeric inputs invert all deltas without inventing chronology', () => {
    const a = comparisonFile(), b = { ...a, generatedAtUTC:'2099-01-01T00:00:00.000Z', summary:comparisonLocal() }
    const forward = compare(a,b.summary), reverse = compare(b,a.summary)
    for (const key of ['records','recordBytes','attachmentBytes','baseItems']) assert.equal(forward[key].delta + reverse[key].delta,0)
    assert.equal(reverse.reportGeneratedAtUTC,b.generatedAtUTC)
    assert.equal(reverse.sameWorkspaceVerified,false)
  })
  test('inventory comparison detaches and recursively freezes every counter', () => {
    const file = structuredClone(comparisonFile()), local = structuredClone(comparisonLocal())
    const original = structuredClone({file,local}), out = compare(file,local)
    assert.deepEqual({file,local},original)
    assert.ok(Object.isFrozen(out) && Object.isFrozen(out.records) && Object.isFrozen(out.kinds))
    assert.ok(out.kinds.every(r=>Object.isFrozen(r)&&Object.isFrozen(r.records)&&Object.isFrozen(r.recordBytes)))
    file.summary.records=99;local.kinds[0].record_bytes=999;assert.equal(out.records.reference,2);assert.equal(out.kinds[0].recordBytes.local,70)
  })
  for (const side of ['file','local']) for (const field of ['records','record_bytes','attachment_bytes','base_items','kinds','complete_for_preview']) {
    test(`inventory comparison refuses invalid ${side} ${field} as a whole`, () => {
      const file=structuredClone(comparisonFile()),local=structuredClone(comparisonLocal())
      ;(side==='file'?file.summary:local)[field]='PRIVATE_VALUE'
      assert.throws(()=>compare(file,local),e=>e.message==='比较依据无效，未显示部分差值。')
    })
  }
  test('inventory comparison refuses incomplete or unknown report provenance', () => {
    for (const source of [undefined,'native','trusted-file','current-workspace',null]) assert.throws(()=>compare({...comparisonFile(),source},comparisonLocal()))
    for (const value of [null,undefined,[],{},'PRIVATE']) assert.throws(()=>compare(value,comparisonLocal()))
    assert.throws(()=>compare({...comparisonFile(),path:'PRIVATE'},comparisonLocal()))
  })
  test('inventory comparison refuses invalid dates without using current clock or trusting recency', () => {
    for(const stamp of ['bad','2026-02-30T12:00:00.000Z','2026-10-09','1969-12-31T00:00:00.000Z',null]) assert.throws(()=>compare({...comparisonFile(),generatedAtUTC:stamp},comparisonLocal()))
  })
  test('inventory comparison rejects accessor and inherited wrappers without invoking getters', () => {
    let touched=0; const file={...comparisonFile()}
    Object.defineProperty(file,'summary',{enumerable:true,get(){touched++;throw Error('PRIVATE')}})
    assert.throws(()=>compare(file,comparisonLocal()));assert.equal(touched,0)
    assert.throws(()=>compare(Object.create(comparisonFile()),comparisonLocal()))
    const hidden={...comparisonFile()};Object.defineProperty(hidden,'source',{enumerable:false,value:'untrusted-file'})
    assert.throws(()=>compare(hidden,comparisonLocal()))
  })
  test('inventory comparison refuses private additions, symbols and nested getters', () => {
    const file={...comparisonFile(),[Symbol('PRIVATE')]:1};assert.throws(()=>compare(file,comparisonLocal()))
    const local=structuredClone(comparisonLocal());local.path='PRIVATE';assert.throws(()=>compare(comparisonFile(),local))
    let touched=0;delete local.path;Object.defineProperty(local.kinds[0],'records',{enumerable:true,get(){touched++;return 1}})
    assert.throws(()=>compare(comparisonFile(),local));assert.equal(touched,0)
  })
  test('inventory comparison enforces aggregate sums and original ordering in both sources', () => {
    for(const side of ['file','local']){
      const file=structuredClone(comparisonFile()),local=structuredClone(comparisonLocal()),target=side==='file'?file.summary:local
      target.records++;assert.throws(()=>compare(file,local));target.records--;target.kinds.reverse();assert.throws(()=>compare(file,local))
    }
  })
  test('inventory comparison preserves signed integer display with no percent or coerced number', () => {
    for(const [value,text] of [[0,'0'],[-0,'0'],[3,'+3'],[-3,'-3'],[67108864,'+67108864']]) assert.equal(comparisonDelta(value),text)
    for(const value of ['1',NaN,Infinity,1.5,null,2**53]) assert.throws(()=>comparisonDelta(value))
  })
}
