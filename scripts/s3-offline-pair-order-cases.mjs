import assert from 'node:assert/strict'
import { offlinePairOrderedRows } from '../src/services/s3OfflinePairOrder.mjs'

const fixture = () => Object.freeze({ rows: Object.freeze([
  ['records', 2, '项'], ['recordBytes', -128, 'B'], ['attachmentBytes', 64, 'B'],
  ['baseItems', 0, '项'], ['file:records', -9, '项'], ['file:bytes', -32, 'B'],
  ['tag:records', 9, '项'], ['tag:bytes', 32, 'B'], ['file-tag:records', 1, '项'],
  ['file-tag:bytes', 0, 'B'], ['attachment:records', 0, '项'], ['attachment:bytes', 8, 'B'],
].map(([key, delta, unit]) => Object.freeze({ key, delta, unit }))) })
const deltas = rows => rows.map(row => row.delta)
export function registerOfflinePairOrderTests(test) {
  test('offline order keeps original complete comparison reference by default', () => {
    const c=fixture(); assert.equal(offlinePairOrderedRows(c),c.rows)
  })
  test('offline order ignores stale sort when differences are disabled', () => {
    const c=fixture(); assert.equal(offlinePairOrderedRows(c,false,'decrease','counts','largest'),c.rows)
  })
  test('offline order never ranks unlike units in all scope', () => {
    const c=fixture(); assert.deepEqual(offlinePairOrderedRows(c,true,'all','all','largest'),c.rows.filter(r=>r.delta!==0))
  })
  test('offline order original selection keeps canonical filtered row order', () => {
    assert.deepEqual(deltas(offlinePairOrderedRows(fixture(),true,'all','counts','original')),[2,-9,9,1])
  })
  test('offline order quantity largest compares magnitude rather than signed value', () => {
    assert.deepEqual(deltas(offlinePairOrderedRows(fixture(),true,'all','counts','largest')),[-9,9,2,1])
  })
  test('offline order quantity smallest retains signs', () => {
    assert.deepEqual(deltas(offlinePairOrderedRows(fixture(),true,'all','counts','smallest')),[1,2,-9,9])
  })
  test('offline order bytes largest keeps exact values', () => {
    assert.deepEqual(deltas(offlinePairOrderedRows(fixture(),true,'all','bytes','largest')),[-128,64,-32,32,8])
  })
  test('offline order bytes smallest ranks a copied list', () => {
    const c=fixture(),before=JSON.stringify(c); const out=offlinePairOrderedRows(c,true,'all','bytes','smallest')
    assert.deepEqual(deltas(out),[8,-32,32,64,-128]);assert.equal(JSON.stringify(c),before);assert.ok(Object.isFrozen(out))
    assert.ok(out.every(row=>c.rows.includes(row)))
  })
  test('offline order combines positive direction with quantity ranking', () => {
    assert.deepEqual(deltas(offlinePairOrderedRows(fixture(),true,'increase','counts','largest')),[9,2,1])
  })
  test('offline order combines negative direction with capacity ranking', () => {
    assert.deepEqual(deltas(offlinePairOrderedRows(fixture(),true,'decrease','bytes','smallest')),[-32,-128])
  })
  test('offline order equal positive and negative magnitudes keep canonical ties', () => {
    const c=fixture();for(const order of ['largest','smallest']) assert.deepEqual(offlinePairOrderedRows(c,true,'all','counts',order).filter(r=>Math.abs(r.delta)===9).map(r=>r.key),['file:records','tag:records'])
  })
  test('offline order empty direction stays empty without synthesized metrics', () => {
    const c={rows:fixture().rows.filter(r=>r.delta<=0)};assert.deepEqual(offlinePairOrderedRows(c,true,'increase','bytes','largest'),[])
  })
  test('offline order handles safe integer endpoints without rounding ties', () => {
    const n=Number.MAX_SAFE_INTEGER;const c={rows:[{key:'a',delta:-(n-1),unit:'B'},{key:'b',delta:n,unit:'B'}]}
    assert.deepEqual(offlinePairOrderedRows(c,true,'all','bytes','largest').map(r=>r.key),['b','a'])
  })
  test('offline order reverse signs leaves magnitude ranking and tie order stable', () => {
    const c=fixture(),rev={rows:c.rows.map(r=>({...r,delta:-r.delta}))}
    assert.deepEqual(offlinePairOrderedRows(c,true,'all','counts','largest').map(r=>r.key),offlinePairOrderedRows(rev,true,'all','counts','largest').map(r=>r.key))
  })
  test('offline order rejects unknown sort scope and direction', () => {
    assert.throws(()=>offlinePairOrderedRows(fixture(),true,'all','counts','PRIVATE'),/无效的差异排序/)
    assert.throws(()=>offlinePairOrderedRows(fixture(),true,'all','PRIVATE','largest'),/无效的指标类型/)
    assert.throws(()=>offlinePairOrderedRows(fixture(),true,'PRIVATE','counts','largest'),/无效的差异方向/)
  })
}
