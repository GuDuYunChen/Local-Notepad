import assert from 'node:assert/strict'
import { offlinePairVisibleRows as visible } from '../src/services/s3OfflinePairView.mjs'
import { createOfflinePairExport } from '../src/services/s3OfflinePairExport.mjs'
import { parseLocalOverviewFile } from '../src/services/s3LocalOverviewFile.mjs'
import { reportFixture } from './s3-local-overview-file-cases.mjs'
const parse = value => parseLocalOverviewFile(JSON.stringify(value))
function fixture(reverse = false) {
  const a = reportFixture(), b = reportFixture()
  b.records++; b.recordBytes++; b.kinds[0].records++; b.kinds[0].recordBytes++
  return createOfflinePairExport(...(reverse ? [parse(b), parse(a)] : [parse(a), parse(b)]))
}
export function registerOfflinePairViewTests(test) {
  test('offline pair filter default view is the original full immutable row list', () => {
    const { comparison: c } = fixture()
    assert.equal(visible(c), c.rows); assert.equal(visible(c, false), c.rows)
    assert.equal(visible(c).length, 12); assert.ok(Object.isFrozen(visible(c)))
  })
  test('offline pair filter equal statistics yield no difference rows but keep all source values', () => {
    const a = parse(reportFixture()), { comparison: c } = createOfflinePairExport(a, a)
    const rows = visible(c, true)
    assert.equal(rows.length, 0); assert.ok(Object.isFrozen(rows)); assert.equal(c.rows.length, 12)
    assert.equal(visible(c, false), c.rows); assert.match(c.notice, /数值相同不代表内容相同/)
  })
  for (const reverse of [false, true]) test(`offline pair filter retains ${reverse ? 'negative' : 'positive'} exact deltas and source order`, () => {
    const { comparison: c } = fixture(reverse), rows = visible(c, true)
    assert.deepEqual(rows.map(row => row.key), ['records', 'recordBytes', 'file:records', 'file:bytes'])
    assert.ok(rows.every(row => row.delta === (reverse ? -1 : 1)))
    for (const row of rows) assert.equal(row, c.rows.find(item => item.key === row.key))
  })
  test('offline pair filter does not miss offsetting categories when aggregate totals match', () => {
    const a = reportFixture(), b = reportFixture()
    b.kinds[0].records = 0; b.kinds[0].recordBytes = 0
    b.kinds[1].records = 1; b.kinds[1].recordBytes = 60
    const c = createOfflinePairExport(parse(a), parse(b)).comparison, rows = visible(c, true)
    assert.deepEqual(c.rows.slice(0, 4).map(row => row.delta), [0, 0, 0, 0])
    assert.deepEqual(rows.map(row => row.key), ['file:records', 'file:bytes', 'tag:records', 'tag:bytes'])
    assert.deepEqual(rows.map(row => row.delta), [-1, -60, 1, 60])
  })
  test('offline pair filter keeps byte-only changes even when every count matches', () => {
    const a = reportFixture(), b = reportFixture(); b.attachmentBytes++
    const c = createOfflinePairExport(parse(a), parse(b)).comparison
    assert.deepEqual(visible(c, true).map(row => [row.key, row.delta]), [['attachmentBytes', 1]])
  })
  test('offline pair filter includes the baseline metric without treating it as note content', () => {
    const a = reportFixture(), b = reportFixture(); b.baseItems--
    const c = createOfflinePairExport(parse(a), parse(b)).comparison
    assert.deepEqual(visible(c, true).map(row => [row.key, row.delta]), [['baseItems', -1]])
  })
  test('offline pair filter toggling never modifies confirmed data or generated timestamps', () => {
    const out = fixture(), before = JSON.stringify(out.comparison)
    for (let i = 0; i < 4; i++) { visible(out.comparison, true); visible(out.comparison, false) }
    assert.equal(JSON.stringify(out.comparison), before); assert.equal(out.comparison.changed, 4)
  })
  for (const format of ['json', 'csv', 'html']) test(`offline pair filter cannot truncate ${format} exports`, () => {
    const out = fixture(true), before = out.prepare(format, 0)
    assert.equal(visible(out.comparison, true).length, 4)
    assert.deepEqual(out.prepare(format, 0), before)
    const all = JSON.parse(out.prepare('json', 0).raw).metrics
    assert.equal(all.length, 12); assert.equal(all.filter(row => row.delta === 0).length, 8)
    assert.equal(all.filter(row => row.delta < 0).length, 4)
  })
}
