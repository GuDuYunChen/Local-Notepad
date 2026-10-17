import assert from 'node:assert/strict'
import { prepareLocalComparisonDisplay as prepare } from '../src/services/s3LocalOverviewDisplay.mjs'
import { comparisonFile, comparisonLocal } from './s3-local-overview-comparison-cases.mjs'

export function registerLocalComparisonDisplayTests(test) {
  test('comparison display preserves twelve ordered metrics and both original values', () => {
    const out = prepare(comparisonFile(), comparisonLocal())
    assert.equal(out.metricCount, 12); assert.equal(out.totals.length, 4); assert.equal(out.categories.length, 8)
    assert.deepEqual(out.totals.map(r => r.id), ['records', 'recordBytes', 'attachmentBytes', 'baseItems'])
    assert.deepEqual(out.totals[0].values, { reference: 2, local: 4, delta: 2 })
    assert.deepEqual(out.categories.map(r => r.id), ['file:records','file:recordBytes','tag:records','tag:recordBytes','file-tag:records','file-tag:recordBytes','attachment:records','attachment:recordBytes'])
    assert.equal(out.comparison.sameWorkspaceVerified, false); assert.equal(out.comparison.completeForPreview, false)
  })
  test('comparison display retains positive and negative differences but excludes every zero', () => {
    const out = prepare(comparisonFile(), comparisonLocal())
    assert.equal(out.changedCount, 6); assert.equal(out.changedTotals.length, 4); assert.equal(out.changedCategories.length, 2)
    assert.deepEqual(out.changedTotals.map(r => r.values.delta), [2, 10, -3, -1])
    assert.ok([...out.changedTotals, ...out.changedCategories].every(r => r.values.delta !== 0))
    assert.equal(out.metricCount - out.changedCount, 6)
  })
  test('comparison display empty difference view retains all original zero-valued rows', () => {
    const file = comparisonFile(), out = prepare(file, file.summary)
    assert.equal(out.changedCount, 0); assert.equal(out.changedTotals.length, 0); assert.equal(out.changedCategories.length, 0)
    assert.equal(out.totals.length + out.categories.length, 12)
    assert.ok([...out.totals, ...out.categories].every(r => r.values.delta === 0))
    assert.equal(out.comparison.sameWorkspaceVerified, false)
  })
  test('comparison display does not hide offsetting category changes when aggregate totals match', () => {
    const file = comparisonFile(), local = structuredClone(file.summary)
    local.kinds[0].records = 2; local.kinds[0].record_bytes = 110
    local.kinds[3].records = 0; local.kinds[3].record_bytes = 0; local.attachment_bytes = 0
    const out = prepare(file, local)
    assert.equal(out.comparison.records.delta, 0); assert.equal(out.comparison.recordBytes.delta, 0)
    assert.deepEqual(out.changedCategories.map(r => r.values.delta), [1, 50, -1, -50])
    assert.equal(out.changedCount, 5)
  })
  test('comparison display counts metrics rather than distinct changed objects', () => {
    const out = prepare(comparisonFile(), comparisonLocal())
    assert.equal(out.changedCount, out.changedTotals.length + out.changedCategories.length)
    assert.notEqual(out.changedCount, out.comparison.records.delta)
  })
  test('comparison display filtering never mutates, drops or reorders the source observations', () => {
    const file = structuredClone(comparisonFile()), local = structuredClone(comparisonLocal())
    const before = structuredClone({file, local}), out = prepare(file, local)
    assert.deepEqual({file, local}, before)
    for (const row of out.changedCategories) assert.ok(out.categories.includes(row))
    for (const row of out.changedTotals) assert.ok(out.totals.includes(row))
    local.records = 99; file.summary.records = 99
    assert.equal(out.totals[0].values.local, 4); assert.equal(out.totals[0].values.reference, 2)
  })
  test('comparison display freezes all rows, subsets and counts', () => {
    const out = prepare(comparisonFile(), comparisonLocal())
    assert.ok(Object.isFrozen(out))
    for (const rows of [out.totals,out.categories,out.changedTotals,out.changedCategories]) {
      assert.ok(Object.isFrozen(rows)); assert.ok(rows.every(r => Object.isFrozen(r) && Object.isFrozen(r.values)))
      assert.throws(() => rows.push({}), TypeError)
    }
  })
  for (const side of ['file', 'local']) test(`comparison display rejects invalid ${side} observations before building any rows`, () => {
    const file = structuredClone(comparisonFile()), local = structuredClone(comparisonLocal())
    ;(side === 'file' ? file.summary : local).records = 999
    assert.throws(() => prepare(file, local), /比较依据无效/)
  })
  test('comparison display rejects private fields and getters without evaluating them', () => {
    const file = {...comparisonFile()}; let touched = 0
    Object.defineProperty(file, 'summary', {enumerable:true,get(){ touched++; throw Error('PRIVATE') }})
    assert.throws(() => prepare(file, comparisonLocal()), e => !e.message.includes('PRIVATE')); assert.equal(touched,0)
    assert.throws(() => prepare({...comparisonFile(),path:'PRIVATE'}, comparisonLocal()), /比较依据无效/)
  })
  test('comparison display keeps delta direction when the inputs are reversed', () => {
    const file = comparisonFile(), local = comparisonLocal()
    const a = prepare(file, local), b = prepare({...file,summary:local}, file.summary)
    assert.equal(a.changedCount, b.changedCount)
    const left = [...a.totals,...a.categories], right = [...b.totals,...b.categories]
    left.forEach((row,i) => assert.equal(row.values.delta + right[i].values.delta, 0))
  })
}
