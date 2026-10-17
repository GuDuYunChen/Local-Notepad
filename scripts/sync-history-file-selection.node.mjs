import test from 'node:test'
import assert from 'node:assert/strict'
import { selectHistoryFilePage, HISTORY_FILE_FILTER_ALL, HISTORY_FILE_PAGE_SIZE } from '../src/services/syncHistoryFileSelection.mjs'
const rows = Object.freeze(Array.from({ length: 61 }, (_, i) => Object.freeze({
  id: 'r' + i, itemID: 'object-' + i, title: i === 60 ? '尾页 星图 ＡＢＣ Café 🌱' : '笔记 ' + i,
  kind: i % 2 ? 'tag' : 'file', status: i === 60 ? 'superseded' : 'resolved',
  resolution: i === 60 ? 'remote-rebind' : i % 3 ? 'remote' : 'local', resolvedAt: 1,
})))
test('pages all accepted records in file order without changing source references', () => {
  assert.equal(HISTORY_FILE_PAGE_SIZE, 25)
  const pages = [0, 1, 2].map(n => selectHistoryFilePage(rows, HISTORY_FILE_FILTER_ALL, n))
  assert.deepEqual(pages.map(p => [p.from, p.to]), [[1, 25], [26, 50], [51, 61]])
  assert.deepEqual(pages.flatMap(p => p.rows), rows); assert.equal(pages[0].rows[0], rows[0])
  assert.ok(pages.every(p => Object.isFrozen(p) && Object.isFrozen(p.rows)))
})
for (const query of ['星图', 'abc', 'CAFÉ', '🌱', 'OBJECT-60', 'r60']) test('finds a last-page record across the whole file: ' + query, () => {
  const p = selectHistoryFilePage(rows, { query })
  assert.deepEqual(p.rows.map(r => r.id), ['r60']); assert.equal(p.from, 1); assert.equal(p.pages, 1)
  assert.equal(p.total, 61); assert.equal(p.matched, 1)
})
test('combines text, type and historical outcome without altering declared file metadata', () => {
  assert.equal(selectHistoryFilePage(rows, { query: '笔记', kind: 'tag', outcome: 'local' }).matched, 10)
  assert.equal(selectHistoryFilePage(rows, { query: '星图', kind: 'file', outcome: 'superseded' }).matched, 1)
  assert.equal(selectHistoryFilePage(rows, { query: '星图', outcome: 'remote' }).matched, 0)
})
test('zero matches have no fake page 1 of 0 or numbered row range', () => {
  const p = selectHistoryFilePage(rows, { query: 'not-present' }, 2)
  assert.equal(p.total, 61); assert.equal(p.matched, 0); assert.equal(p.pages, 0)
  assert.equal(p.page, 0); assert.equal(p.from, 0); assert.equal(p.to, 0); assert.deepEqual(p.rows, [])
})
test('clamps stale page indices to the last available matching page', () => {
  const p = selectHistoryFilePage(rows, { query: '星图' }, 2)
  assert.equal(p.page, 0); assert.deepEqual(p.rows.map(r => r.id), ['r60'])
  assert.equal(selectHistoryFilePage(rows, undefined, 99).page, 2)
})
test('exactly 25 matches do not create an extra page and empty input stays empty', () => {
  assert.equal(selectHistoryFilePage(rows.slice(0, 25)).pages, 1)
  assert.equal(selectHistoryFilePage([]).pages, 0)
})
test('text is literal and never searches unknown/private fields', () => {
  const record = { ...rows[0], content: 'PRIVATE_BODY', hidden: 'PRIVATE_VALUE' }
  assert.equal(selectHistoryFilePage([record], { query: 'PRIVATE_' }).matched, 0)
  assert.equal(selectHistoryFilePage([record], { query: '.*' }).matched, 0)
})
test('invalid page or filter state is rejected, not silently treated as another selection', () => {
  for (const page of [-1, 1.5, NaN, Infinity, '1']) assert.throws(() => selectHistoryFilePage(rows, undefined, page))
  for (const f of [{ kind: '__proto__' }, { outcome: 'made-up' }, { query: {} }]) assert.throws(() => selectHistoryFilePage(rows, f))
})
test('a 2000-record file is fully searchable and pageable without truncation', () => {
  const data = Array.from({ length: 2000 }, (_, i) => ({ ...rows[0], id: 'entry-' + i }))
  assert.equal(selectHistoryFilePage(data).pages, 80)
  assert.equal(selectHistoryFilePage(data, { query: 'entry-1999' }).rows[0].id, 'entry-1999')
  assert.equal(selectHistoryFilePage(data, undefined, 79).to, 2000)
})
