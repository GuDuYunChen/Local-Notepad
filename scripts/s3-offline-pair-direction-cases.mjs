import assert from 'node:assert/strict'
import { offlinePairDirectionalRows as visible } from '../src/services/s3OfflinePairDirection.mjs'

const fixture = deltas => Object.freeze({ rows: Object.freeze(deltas.map((delta, i) =>
  Object.freeze({ key: String(i), a: Math.max(0, -delta), b: Math.max(0, delta), delta, unit: i % 2 ? 'B' : '项' }))) })
export function registerOfflinePairDirectionTests(test) {
  test('offline direction default preserves all twelve original metric objects', () => {
    const c = fixture([0,0,0,0,1,64,-1,-64,0,0,0,0])
    assert.equal(visible(c), c.rows); assert.equal(visible(c).length, 12)
  })
  for (const direction of ['all','increase','decrease']) test(`offline direction ${direction} cannot filter when differences are disabled`, () => {
    const c = fixture([1,-1,0]); assert.equal(visible(c,false,direction),c.rows)
  })
  test('offline direction all changes keeps positive and negative rows in source order', () => {
    const c = fixture([0,1,0,-1,64,-64]); const rows=visible(c,true)
    assert.deepEqual(rows.map(r=>r.delta),[1,-1,64,-64]); assert.ok(Object.isFrozen(rows))
  })
  test('offline direction increase includes only strictly positive metrics', () => {
    const c = fixture([0,2,-2,40,-40]); const rows=visible(c,true,'increase')
    assert.deepEqual(rows,[c.rows[1],c.rows[3]]);assert.ok(Object.isFrozen(rows))
  })
  test('offline direction decrease includes only strictly negative metrics', () => {
    const c = fixture([0,2,-2,40,-40]);assert.deepEqual(visible(c,true,'decrease'),[c.rows[2],c.rows[4]])
  })
  test('offline direction keeps opposing categories when aggregate changes cancel', () => {
    const c=fixture([0,0,0,0,1,64,-1,-64,0,0,0,0])
    assert.deepEqual(visible(c,true,'increase').map(r=>r.key),['4','5'])
    assert.deepEqual(visible(c,true,'decrease').map(r=>r.key),['6','7'])
  })
  test('offline direction counts byte-only changes independently from record counts', () => {
    const c=fixture([0,0,0,0,0,25,0,-25,0,0,0,0])
    assert.equal(visible(c,true,'increase')[0].unit,'B');assert.equal(visible(c,true,'decrease')[0].unit,'B')
  })
  test('offline direction zero observations produce empty change lists, not lost source rows', () => {
    const c=fixture(Array(12).fill(0));for(const d of ['all','increase','decrease'])assert.equal(visible(c,true,d).length,0)
    assert.equal(visible(c).length,12)
  })
  test('offline direction an empty direction can coexist with nonzero opposite changes', () => {
    const c=fixture([1,100,0]);assert.equal(visible(c,true,'decrease').length,0);assert.equal(visible(c,true,'all').length,2)
  })
  test('offline direction changing filters preserves complete export basis and row identity', () => {
    const c=fixture([0,1,-2]),before=JSON.stringify(c)
    for(const d of ['increase','decrease','all','increase']) for(const row of visible(c,true,d)) assert.ok(c.rows.includes(row))
    assert.equal(JSON.stringify(c),before);assert.equal(visible(c,false),c.rows)
  })
  test('offline direction reverse comparisons reverse positive and negative membership', () => {
    const c=fixture([1,-2,0,64]),reverse=fixture(c.rows.map(r=>-r.delta))
    assert.deepEqual(visible(c,true,'increase').map(r=>r.key),visible(reverse,true,'decrease').map(r=>r.key))
  })
  test('offline direction rejects unsupported choices instead of showing an accidental empty result', () => {
    const c=fixture([1]);for(const d of ['',null,1,'PRIVATE','positive',{}])assert.throws(()=>visible(c,true,d),/无效的差异方向/)
  })
}
