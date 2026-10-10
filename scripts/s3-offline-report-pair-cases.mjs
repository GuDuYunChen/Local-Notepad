import assert from 'node:assert/strict'
import { compareOfflineReportPair as compare, OFFLINE_PAIR_NOTICE } from '../src/services/s3OfflineReportPair.mjs'
import { parseLocalOverviewFile } from '../src/services/s3LocalOverviewFile.mjs'
import { reportFixture } from './s3-local-overview-file-cases.mjs'
const fixture = () => parseLocalOverviewFile(JSON.stringify(reportFixture()))
const clone = value => JSON.parse(JSON.stringify(value))
export function registerOfflinePairTests(test) {
  test('offline pair preserves all twelve metrics with explicit file-only scope', () => {
    const a = fixture(), out = compare(a, a)
    assert.equal(out.source, 'offline-report-pair'); assert.equal(out.sameWorkspaceVerified, false)
    assert.equal(out.completeForPreview, false); assert.equal(out.notice, OFFLINE_PAIR_NOTICE)
    assert.equal(out.generatedA, a.generatedAtUTC); assert.equal(out.generatedB, a.generatedAtUTC)
    assert.equal(out.rows.length, 12); assert.equal(new Set(out.rows.map(r => r.key)).size, 12)
    assert.equal(out.changed, 0); assert.ok(out.rows.every(r => r.a === r.b && r.delta === 0))
    assert.deepEqual(out.rows.map(r => r.key), ['records','recordBytes','attachmentBytes','baseItems',
      'file:records','file:bytes','tag:records','tag:bytes','file-tag:records','file-tag:bytes','attachment:records','attachment:bytes'])
    assert.equal(out.rows[0].a, a.summary.records); assert.equal(out.rows[1].a, a.summary.record_bytes)
    assert.equal(out.rows[2].a, a.summary.attachment_bytes); assert.equal(out.rows[3].a, a.summary.base_items)
    for (let i=0;i<4;i++) { assert.equal(out.rows[4+2*i].a,a.summary.kinds[i].records); assert.equal(out.rows[5+2*i].a,a.summary.kinds[i].record_bytes) }
    assert.ok(!Object.hasOwn(out,'local')); assert.ok(Object.isFrozen(out)&&Object.isFrozen(out.rows)&&out.rows.every(Object.isFrozen))
  })
  test('offline pair B minus A has exact signed values and swapping reverses every delta', () => {
    const a = fixture(), b = clone(a)
    b.summary.records++; b.summary.record_bytes++; b.summary.kinds[0].records++; b.summary.kinds[0].record_bytes++
    const forward = compare(a,b), reverse = compare(b,a)
    assert.equal(forward.changed,4); assert.deepEqual(forward.rows.slice(0,2).map(r=>r.delta),[1,1])
    for(let i=0;i<12;i++){assert.equal(forward.rows[i].a,reverse.rows[i].b);assert.equal(forward.rows[i].b,reverse.rows[i].a);assert.equal(forward.rows[i].delta+reverse.rows[i].delta,0)}
  })
  test('offline pair validates both envelopes and never calls accessors', () => {
    for (const side of [0,1]) {
      let touched=0;const bad={...fixture()};Object.defineProperty(bad,'summary',{enumerable:true,get(){touched++;throw Error('PRIVATE')}})
      const args=[fixture(),fixture()];args[side]=bad
      assert.throws(()=>compare(...args),e=>!e.message.includes('PRIVATE'));assert.equal(touched,0)
    }
  })
  for(const side of [0,1]) for(const kind of ['source','timestamp','extra','counts','order','private']) {
    test(`offline pair refuses ${kind} in report ${side===0?'A':'B'} without partial comparison`,()=>{
      const args=[fixture(),fixture()],bad=clone(args[side]);args[side]=bad
      if(kind==='source')bad.source='native'
      if(kind==='timestamp')bad.generatedAtUTC='2026-02-30T00:00:00.000Z'
      if(kind==='extra')bad.path='PRIVATE'
      if(kind==='counts')bad.summary.records++
      if(kind==='order')bad.summary.kinds.reverse()
      if(kind==='private')bad.summary.kinds[0].filename='PRIVATE'
      assert.throws(()=>compare(...args),e=>!e.message.includes('PRIVATE'))
    })
  }
  test('offline pair never interprets generation time as chronological or workspace identity',()=>{
    const a=clone(fixture()),b=clone(a);a.generatedAtUTC='2030-01-01T00:00:00.000Z';b.generatedAtUTC='1970-01-01T00:00:00.000Z'
    const result=compare(a,b);assert.equal(result.changed,0);assert.equal(result.generatedA,a.generatedAtUTC);assert.equal(result.generatedB,b.generatedAtUTC)
    assert.match(result.notice,/时间先后/);assert.match(result.notice,/数值相同不代表内容相同/)
  })
  test('offline pair supports empty and maximum bounded reports without truncating zeros',()=>{
    const a=clone(fixture());Object.assign(a.summary,{records:0,record_bytes:0,attachment_bytes:0,base_items:0});a.summary.kinds.forEach(k=>Object.assign(k,{records:0,record_bytes:0}))
    const b=clone(a);Object.assign(b.summary,{records:256,record_bytes:2097152,attachment_bytes:67108864,base_items:128});b.summary.kinds.forEach((k,i)=>Object.assign(k,{records:i===0||i===3?128:0,record_bytes:i===0||i===3?1048576:0}))
    const out=compare(a,b);assert.equal(out.rows.length,12);assert.equal(out.rows[2].delta,67108864);assert.equal(out.rows[3].delta,128)
    assert.equal(out.rows.filter(r=>r.delta===0).length,4)
  })
  test('offline pair output is detached and source reports stay unchanged',()=>{
    const a=clone(fixture()),b=clone(fixture()),before=JSON.stringify([a,b]),out=compare(a,b)
    assert.equal(JSON.stringify([a,b]),before);b.summary.records=99;assert.notEqual(out.rows[0].b,99)
  })
}
