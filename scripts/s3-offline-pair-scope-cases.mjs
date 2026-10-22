import assert from 'node:assert/strict'
import { offlinePairScopedRows as select } from '../src/services/s3OfflinePairScope.mjs'
import { offlineExportFixture } from './s3-offline-pair-export-cases.mjs'
const fixture = () => offlineExportFixture().comparison
const ids = rows => rows.map(row => row.key)
export function registerOfflinePairScopeTests(test) {
  test('offline scope defaults preserve all twelve original metric references', () => {
    const c = fixture(); assert.equal(select(c), c.rows); assert.equal(select(c).length, 12)
  })
  for (const scope of ['all', 'counts', 'bytes']) test(`offline scope ${scope} is inactive when differences are disabled`, () => {
    const c = fixture(); assert.equal(select(c, false, 'decrease', scope), c.rows)
  })
  for (const [scope, unit] of [['counts', '项'], ['bytes', 'B']]) {
    test(`offline scope ${scope} retains only matching changed metrics`, () => {
      const c = fixture(), rows = select(c, true, 'all', scope)
      assert.deepEqual(ids(rows), ids(c.rows.filter(row => row.delta !== 0 && row.unit === unit)))
      assert.equal(rows.length, 2); assert.ok(Object.isFrozen(rows)); assert.ok(rows.every(row => c.rows.includes(row)))
    })
    for (const direction of ['increase', 'decrease']) test(`offline scope ${scope} composes with ${direction} on each metric`, () => {
      const c = structuredClone(fixture())
      // Opposing class changes: totals can remain unchanged without hiding them.
      c.rows.forEach((row, i) => { row.a = 10; row.b = 10 + (i < 4 ? 0 : i % 4 < 2 ? 1 : -1); row.delta = row.b - row.a })
      const rows = select(c, true, direction, scope)
      assert.deepEqual(ids(rows), ids(c.rows.filter(row => row.unit === unit && (direction === 'increase' ? row.delta > 0 : row.delta < 0))))
      assert.equal(rows.length, 2)
    })
  }
  test('offline scope all preserves the existing full difference view', () => {
    const c = fixture(); assert.deepEqual(select(c, true, 'all', 'all'), c.rows.filter(row => row.delta !== 0))
  })
  test('offline scope distinguishes capacity-only changes from quantity changes', () => {
    const c = structuredClone(fixture()); c.rows.forEach(row => { row.b = row.a + (row.unit === 'B' ? 1 : 0); row.delta = row.b - row.a })
    assert.equal(select(c, true, 'all', 'counts').length, 0); assert.equal(select(c, true, 'all', 'bytes').length, 6)
  })
  test('offline scope never changes confirmed values or any complete export format', () => {
    const out = offlineExportFixture(), before = structuredClone(out.comparison)
    const formats = ['json', 'csv', 'html'], original = formats.map(f => out.prepare(f, 0).raw)
    for (const scope of ['all', 'counts', 'bytes']) for (const d of ['all', 'increase', 'decrease']) select(out.comparison, true, d, scope)
    assert.deepEqual(out.comparison, before); assert.deepEqual(formats.map(f => out.prepare(f, 0).raw), original)
  })
  test('offline scope swapping sides reverses signs without changing unit membership', () => {
    const a = fixture(), b = structuredClone(a); b.rows.forEach(row => { [row.a, row.b] = [row.b, row.a]; row.delta = row.b - row.a })
    assert.deepEqual(ids(select(a, true, 'increase', 'counts')), ids(select(b, true, 'decrease', 'counts')))
  })
  test('offline scope rejects unknown modes without rendering caller content', () => {
    for (const scope of [null, '', 'PRIVATE', {}, 1]) assert.throws(() => select(fixture(), true, 'all', scope), error => !error.message.includes('PRIVATE'))
    assert.throws(() => select(fixture(), true, 'PRIVATE', 'counts'))
  })
}
