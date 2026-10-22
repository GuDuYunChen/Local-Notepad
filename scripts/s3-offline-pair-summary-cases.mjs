import assert from 'node:assert/strict'
import { summarizeOfflinePair } from '../src/services/s3OfflinePairSummary.mjs'
import { offlineExportFixture } from './s3-offline-pair-export-cases.mjs'

const fixture = () => structuredClone(offlineExportFixture().comparison)
const changed = comparison => { comparison.changed = comparison.rows.filter(row => row.delta !== 0).length; return comparison }
const set = (row, a, b) => Object.assign(row, { a, b, delta: b - a })
export function registerOfflinePairSummaryTests(test) {
  test('offline summary counts four increasing metrics without adding units', () => {
    const result = summarizeOfflinePair(fixture())
    assert.deepEqual(result, { all: { increase: 4, decrease: 0, unchanged: 8, total: 12 },
      counts: { increase: 2, decrease: 0, unchanged: 4, total: 6 }, bytes: { increase: 2, decrease: 0, unchanged: 4, total: 6 } })
  })
  test('offline summary separates opposing categories even when aggregate totals are zero', () => {
    const comparison = fixture(); comparison.rows.forEach(row => set(row, 10, 10))
    set(comparison.rows[4], 10, 11); set(comparison.rows[5], 100, 101)
    set(comparison.rows[6], 11, 10); set(comparison.rows[7], 101, 100)
    const result = summarizeOfflinePair(changed(comparison))
    assert.deepEqual(result.all, { increase: 2, decrease: 2, unchanged: 8, total: 12 })
    for (const key of ['counts', 'bytes']) assert.deepEqual(result[key], { increase: 1, decrease: 1, unchanged: 4, total: 6 })
  })
  test('offline summary reverse direction exchanges increases and decreases', () => {
    const comparison = fixture(); comparison.rows.forEach(row => set(row, row.b, row.a))
    assert.deepEqual(summarizeOfflinePair(comparison).all, { increase: 0, decrease: 4, unchanged: 8, total: 12 })
  })
  test('offline summary all equal counts twelve unchanged metric values only', () => {
    const comparison = fixture(); comparison.rows.forEach(row => set(row, row.a, row.a))
    const result = summarizeOfflinePair(changed(comparison))
    assert.deepEqual(result.all, { increase: 0, decrease: 0, unchanged: 12, total: 12 })
    assert.equal(result.counts.unchanged, 6); assert.equal(result.bytes.unchanged, 6)
  })
  test('offline summary recognizes byte-only and count-only changes independently', () => {
    const comparison = fixture(); comparison.rows.forEach(row => set(row, 1, 1))
    set(comparison.rows[1], 1, 2); set(comparison.rows[3], 2, 1)
    const result = summarizeOfflinePair(changed(comparison))
    assert.equal(result.bytes.increase, 1); assert.equal(result.counts.decrease, 1)
    assert.equal(result.bytes.decrease, 0); assert.equal(result.counts.increase, 0)
  })
  test('offline summary does not mutate confirmed data and returns frozen detached counts', () => {
    const output = offlineExportFixture(), before = output.prepare('json', 0).raw
    const result = summarizeOfflinePair(output.comparison)
    assert.equal(output.prepare('json', 0).raw, before)
    assert.ok(Object.isFrozen(result) && Object.values(result).every(Object.isFrozen))
  })
  test('offline summary never substitutes the four visible rows for all twelve metrics', () => {
    const comparison = fixture(); comparison.rows = comparison.rows.filter(row => row.delta)
    assert.throws(() => summarizeOfflinePair(comparison), /依据不完整/)
  })
  for (const [label, mutate] of [
    ['missing metric', c => c.rows.pop()],
    ['duplicate metric', c => c.rows[1] = c.rows[0]],
    ['wrong order', c => c.rows.reverse()],
    ['incorrect delta', c => c.rows[0].delta++],
    ['incorrect changed count', c => c.changed++],
    ['incorrect unit', c => c.rows[0].unit = 'B'],
    ['nonfinite value', c => c.rows[0].a = Infinity],
    ['negative value', c => c.rows[0].a = -1],
    ['wrong source', c => c.source = 'local-scan'],
  ]) test(`offline summary refuses ${label} without partial statistics`, () => {
    const comparison = fixture(); mutate(comparison)
    assert.throws(() => summarizeOfflinePair(comparison), /依据不完整/)
  })
  test('offline summary does not evaluate accessor properties or disclose their private error', () => {
    const comparison = fixture(); let touched = false
    Object.defineProperty(comparison.rows[0], 'delta', { get() { touched = true; throw Error('PRIVATE') } })
    assert.throws(() => summarizeOfflinePair(comparison), error => !error.message.includes('PRIVATE'))
    assert.equal(touched, false)
  })
  test('offline summary rejects sparse rows and missing comparisons', () => {
    const comparison = fixture(); delete comparison.rows[4]
    for (const value of [comparison, null, undefined, {}, []]) assert.throws(() => summarizeOfflinePair(value), /依据不完整/)
  })
}
