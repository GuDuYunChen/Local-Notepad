import { it, expect } from 'vitest'
import { collectionFixture, collectionReport } from '../test/collectionFixtures'
import { buildCollectionReviewReport, serializeCollectionReviewReport } from './collectionReviewReport'

it('exports all historical entries and additional matches with exact partitions', () => {
  const { collection } = collectionFixture(23), current = collectionReport(25)
  current.items[0].contentSHA256 = 'c'.repeat(64); current.items[1].title = '新标题'
  current.items[2].id = 'replacement'
  const value = buildCollectionReviewReport(collection, current)
  expect(value.rows).toHaveLength(23); expect(value.additional).toHaveLength(3)
  expect(value.counts).toEqual({ historical: 23, unchanged: 20, body: 1, metadata: 1, outside: 1, additional: 3 })
})
it('does not accept caller-supplied difference conclusions', () => {
  const { collection } = collectionFixture()
  const current = { ...collectionReport(), counts: { outside: 999 }, rows: [] }
  expect(buildCollectionReviewReport(collection, current).counts.unchanged).toBe(23)
})
it('JSON is metadata-only and has a distinct non-backup format', () => {
  const { collection } = collectionFixture()
  const current = collectionReport(); current.items[0].snippets = ['secret']; current.items[0].content = 'SECRET_BODY'
  const value = serializeCollectionReviewReport({ ...collection, token: 'SECRET_TOKEN' }, current, 'json')
  const parsed = JSON.parse(value.text)
  expect(parsed.format).toBe('local-notepad-collection-review')
  expect(value.text).not.toMatch(/SECRET|snippets|"raw"|"queue"|"token"/)
  expect(parsed.rows.at(-1).id).toBe('n22')
})
it('supports zero current matches without calling old notes deleted', () => {
  const { collection } = collectionFixture(2), value = buildCollectionReviewReport(collection, collectionReport(0))
  expect(value.counts.outside).toBe(2); expect(value.additional).toHaveLength(0)
  expect(value.rows.every(row => row.current === null)).toBe(true)
  expect(value.limitation).toContain('不等于删除')
})
it('Markdown escapes active markup, line breaks, titles, queries and folder paths', () => {
  const { collection } = collectionFixture(1), current = collectionReport(1)
  const old = structuredClone(collection)
  old.report.items[0].title = '<img src=x>\n# [link](https://example.com) ```'
  old.report.items[0].folderPath = '**unsafe**'
  const output = serializeCollectionReviewReport(old, current)
  expect(output.text).not.toContain('<img'); expect(output.text).not.toContain('```'); expect(output.text).not.toContain('[link]')
  expect(output.text).toContain('&#60;img'); expect(output.text).toContain('&#10;')
})
it('includes the fixed criteria, timestamps, both revisions and parsing caveat', () => {
  const { collection } = collectionFixture(2), current = collectionReport(2)
  current.scope.unsupported = 1; current.scope.revision = 'c'.repeat(64)
  current.exportedAt = '2026-09-24T07:10:00.000Z'
  const output = serializeCollectionReviewReport(collection, current)
  expect(output.text).toContain('固定条件'); expect(output.text).toContain(collection.report.exportedAt)
  expect(output.text).toContain(current.exportedAt); expect(output.text).toContain('c'.repeat(64)); expect(output.text).toContain('1 篇正文格式未能解析')
})
it('leaves history and current data unchanged', () => {
  const { collection } = collectionFixture(), current = collectionReport(), copy = structuredClone(current)
  const before = JSON.stringify(collection)
  serializeCollectionReviewReport(collection, current); serializeCollectionReviewReport(collection, current, 'json')
  expect(JSON.stringify(collection)).toBe(before); expect(current).toEqual(copy)
})
it('rejected scopes and invalid reports do not return partial output', () => {
  const { collection } = collectionFixture(), current = collectionReport()
  current.scope.criteria.since = 9
  expect(() => serializeCollectionReviewReport(collection, current)).toThrow('范围不一致')
  expect(() => serializeCollectionReviewReport(collection, { ...current, items: [] })).toThrow()
})
it('rejects unknown output formats and never uses titles as filenames', () => {
  const { collection } = collectionFixture()
  expect(() => serializeCollectionReviewReport(collection, collectionReport(), 'html')).toThrow()
  expect(serializeCollectionReviewReport(collection, collectionReport()).filename).toBe('Local-Notepad-资料集复查-sample-collection.md')
})
it('handles selected collections without describing extra matches as new notes', () => {
  const { collection } = collectionFixture(2), old = structuredClone(collection)
  old.report.mode = 'selected'; old.report.scope.total = 20; old.report.scope.scanned = 20
  const value = buildCollectionReviewReport(old, collectionReport(4))
  expect(value.counts.additional).toBe(2); expect(value.collection.mode).toBe('selected')
  expect(value.limitation).toContain('不等于新建')
})
it('all 2000 historical IDs are present, including the last page', () => {
  const { collection } = collectionFixture(2000)
  const output = serializeCollectionReviewReport(collection, collectionReport(2000), 'json')
  expect(JSON.parse(output.text).rows.at(-1).id).toBe('n1999')
})
it('excessive escaped Markdown is rejected without truncating', () => {
  const { collection } = collectionFixture(45), old = structuredClone(collection), current = collectionReport(45)
  old.report.items.forEach(item => { item.title = '&'.repeat(14000) })
  current.items.forEach(item => { item.title = '&'.repeat(14000) })
  expect(() => serializeCollectionReviewReport(old, current)).toThrow('8 MiB')
})
