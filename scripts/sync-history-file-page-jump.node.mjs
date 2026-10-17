import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHistoryFilePageJump } from '../src/services/syncHistoryFilePageJump.mjs'

for (const [input, total, expected] of [['1', 80, 0], ['80', 80, 79], ['2', 3, 1], [' ２ ', 3, 1], ['００３', 3, 2], ['1', 1, 0]]) {
  test(`parses ${JSON.stringify(input)} within ${total} matching pages`, () => assert.equal(parseHistoryFilePageJump(input, total), expected))
}
for (const value of ['', ' ', '0', '-1', '+2', '1.5', '2e0', '0x02', '1/2', '二', '①', 'Infinity', '9'.repeat(32), '1'.repeat(33), {}, null]) {
  test(`refuses invalid page ${JSON.stringify(value)} rather than silently clamping`, () => assert.throws(() => parseHistoryFilePageJump(value, 3)))
}
test('rejects a page beyond the currently filtered page count, not the original file total', () => {
  assert.throws(() => parseHistoryFilePageJump('3', 2), /1 至 2/)
  assert.throws(() => parseHistoryFilePageJump('81', 80))
})
for (const pages of [0, -1, 1.5, NaN, Infinity, '3', 81]) {
  test(`refuses invalid matching page total ${pages}`, () => assert.throws(() => parseHistoryFilePageJump('1', pages)))
}
