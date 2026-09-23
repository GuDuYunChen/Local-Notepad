import assert from 'node:assert/strict'
import { test } from 'node:test'
import { REVIEW_ARCHIVE_FORMAT, readReviewArchive } from '../src/services/evidenceReviewArchiveData.js'
import { compareReviewArchives, selectReviewComparisonRows, buildReviewComparisonReport } from '../src/services/evidenceReviewComparison.js'

const chapter = (id, ordinal = 1, title = id + '.md') => ({ id, ordinal, title })
function archive(id, patch = {}, savedAt = '2026-09-23T10:00:00.000Z') {
  return { format: REVIEW_ARCHIVE_FORMAT, version: 1, id, savedAt, data: {
    projectId: 'p', entityId: 'e', entityLabel: '关关', filters: { query: '', source: 'all', volumeId: null, page: 1 },
    chapters: [chapter('c1'), chapter('c2', 2), chapter('c3', 3)], chapterId: 'c1', reviewedIds: [], annotations: {}, ...patch,
  } }
}
const note = (text = '', needsChanges = false) => ({ text, needsChanges })
const compare = (a = {}, b = {}) => compareReviewArchives(archive('a', a), archive('b', b))

test('identical metadata in different snapshots stays unchanged', () => {
  const result = compare(); assert.equal(result.totals.unchanged, 3); assert.equal(result.totals.changed, 0)
})
test('rejects the same archive, cross-project and cross-entity pairs', () => {
  assert.throws(() => compareReviewArchives(archive('a'), archive('a')), /不同/)
  assert.throws(() => compare({}, { projectId: 'other' }), /同一项目/)
  assert.throws(() => compare({}, { entityId: 'other' }), /同一实体/)
})
test('rejects malformed, future version or duplicate chapter data', () => {
  for (const bad of [null, {}, { ...archive('b'), version: 2 }, archive('b', { chapters: [chapter('c1'), chapter('c1')] })]) {
    assert.throws(() => compareReviewArchives(archive('a'), bad))
  }
})
test('joins chapter IDs rather than identical titles or ordinals', () => {
  const result = compare({ chapters: [chapter('c1', 1, '同名')] }, { chapters: [chapter('c9', 1, '同名')], chapterId: 'c9' })
  assert.equal(result.totals.added, 1); assert.equal(result.totals.removed, 1); assert.equal(result.totals.common, 0)
})
test('removing an unresolved chapter is not a cleared issue', () => {
  const result = compare({ annotations: { c3: note('待修', true) } }, { chapters: [chapter('c1'), chapter('c2', 2)] })
  assert.equal(result.totals.removedWithIssue, 1); assert.equal(result.totals.issueCleared, 0)
})
test('newly scoped unresolved chapters are separate from new common-chapter flags', () => {
  const result = compare({}, { chapters: [chapter('c1'), chapter('c2', 2), chapter('c3', 3), chapter('c4', 4)], annotations: { c4: note('', true), c2: note('', true) } })
  assert.equal(result.totals.addedWithIssue, 1); assert.equal(result.totals.issueAdded, 1)
})
test('clearing a flag and retaining an issue are counted independently', () => {
  const result = compare({ annotations: { c1: note('old', true), c2: note('仍待修', true) } }, { annotations: { c1: note('old'), c2: note('仍待修', true) } })
  assert.equal(result.totals.issueCleared, 1); assert.equal(result.totals.issueRetained, 1)
  assert.equal(result.rows[0].after.state, 'pending')
})
test('historical reviewed marks are a state change, never a body approval', () => {
  const result = compare({}, { reviewedIds: ['c1'] })
  assert.equal(result.totals.stateChanged, 1); assert.equal(result.totals.issueCleared, 0)
  assert.match(buildReviewComparisonReport(result), /不证明问题已修复或当前正文已审核/)
})
test('notes distinguish addition, editing and erasure without trimming Unicode', () => {
  const result = compare({ annotations: { c2: note('旧注'), c3: note('删除') } }, { annotations: { c1: note('😀\n新注 '), c2: note('旧注\n补充') } })
  assert.equal(result.totals.noteChanged, 3); assert.equal(result.rows[0].after.note, '😀\n新注 ')
  assert.equal(result.rows[2].after.note, '')
})
test('an absent annotation equals an empty annotation with no flag', () => {
  assert.equal(compare({}, { annotations: { c1: note() } }).totals.changed, 0)
})
test('name and ordinal edits are detected even without note changes', () => {
  const result = compare({}, { chapters: [chapter('c1', 20, '新标题'), chapter('c2', 2), chapter('c3', 3)] })
  assert.equal(result.totals.titleChanged, 1); assert.equal(result.totals.ordinalChanged, 1)
  assert.equal(result.totals.noteChanged, 0)
})
test('relative order detects reordering without treating a new leading chapter as a move', () => {
  assert.equal(compare({}, { chapters: [chapter('new'), chapter('c1'), chapter('c2', 2), chapter('c3', 3)] }).totals.orderChanged, 0)
  assert.equal(compare({}, { chapters: [chapter('c3', 3), chapter('c2', 2), chapter('c1')] }).totals.orderChanged, 2)
})
test('results use B order then A-only entries in A order', () => {
  const result = compare({}, { chapters: [chapter('c3', 3), chapter('c4', 4), chapter('c1')] })
  assert.deepEqual(result.rows.map(row => row.id), ['c3', 'c4', 'c1', 'c2'])
})
test('all scope fields are reported but view pagination is not a scope change', () => {
  const result = compare({}, { filters: { query: '小关', source: 'alias', volumeId: '', page: 2 } })
  assert.deepEqual(result.filterChanges, ['source', 'volumeId', 'query'])
  assert.equal(compare({}, { filters: { query: '', source: 'all', volumeId: null, page: 3 } }).filterChanges.length, 0)
})
test('selection direction is explicit even with reversed or identical timestamps', () => {
  const a = archive('a', {}, '2026-09-23T11:00:00.000Z'), b = archive('b')
  assert.equal(compareReviewArchives(a, b).reverseChronology, true)
  assert.equal(compare().sameTimestamp, true)
})
test('swapping snapshots reverses additions and cleared/new issue flags', () => {
  const a = archive('a', { annotations: { c1: note('', true) } })
  const b = archive('b', { chapters: [chapter('c1'), chapter('c2', 2)] })
  const forward = compareReviewArchives(a, b), reverse = compareReviewArchives(b, a)
  assert.equal(forward.totals.removed, reverse.totals.added)
  assert.equal(forward.totals.issueCleared, reverse.totals.issueAdded)
})
test('comparison is immutable, detached and cannot modify input archives', () => {
  const a = readReviewArchive(JSON.stringify(archive('a'))), b = archive('b', { annotations: { c1: note('文本') } })
  const before = JSON.stringify([a, b]); const result = compareReviewArchives(a, b)
  assert.equal(JSON.stringify([a, b]), before)
  assert.throws(() => { result.rows[0].after.note = 'bad' }, TypeError)
  b.data.annotations.c1.text = 'edited'; assert.equal(result.rows[0].after.note, '文本')
})
test('reserved object property IDs remain inert data', () => {
  const chapters = [chapter('__proto__'), chapter('constructor', 2)]
  const result = compare({ chapters, chapterId: '__proto__' }, { chapters, chapterId: '__proto__', annotations: JSON.parse('{"__proto__":{"text":"安全","needsChanges":true}}') })
  assert.equal(result.rows[0].after.note, '安全'); assert.equal({}.polluted, undefined)
})
test('unknown manuscript fields and runtime tokens never enter output', () => {
  const a = archive('a'); a.data.content = 'PRIVATE_BODY'; a.data.returnToken = 'PRIVATE_TOKEN'
  const result = compareReviewArchives(a, archive('b'))
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  assert.equal(buildReviewComparisonReport(result).includes('PRIVATE'), false)
})
test('filtering and Unicode search inspect both sides, and removed notes remain discoverable', () => {
  const result = compare({ annotations: { c3: note('Élodie 待改', true) } }, { chapters: [chapter('c1'), chapter('c2', 2)] })
  assert.equal(selectReviewComparisonRows(result, { state: 'scope', query: ' E\u0301LODIE ' }).total, 1)
  assert.equal(selectReviewComparisonRows(result, { state: 'cleared' }).total, 0)
})
test('issue filter includes unchanged unresolved issues; default includes only changed rows', () => {
  const data = { annotations: { c1: note('疑点', true) } }; const result = compare(data, data)
  assert.equal(selectReviewComparisonRows(result).total, 0)
  assert.equal(selectReviewComparisonRows(result, { state: 'issues' }).total, 1)
})
test('pagination clamps invalid pages and reaches beyond the first eight', () => {
  const chapters = Array.from({ length: 19 }, (_, i) => chapter('c' + (i + 1), i + 1))
  const result = compare({ chapters }, { chapters, annotations: Object.fromEntries(chapters.map(c => [c.id, note('变更')])) })
  assert.equal(selectReviewComparisonRows(result, { page: 999 }).rows.length, 3)
  assert.equal(selectReviewComparisonRows(result, { page: NaN }).page, 1)
  assert.equal(selectReviewComparisonRows(result, { page: -7 }).page, 1)
  assert.equal(selectReviewComparisonRows(result, { state: 'bogus', query: {} }).total, 19)
})
test('no match and empty models have a stable empty first page', () => {
  const empty = selectReviewComparisonRows(null, { page: 99 }); assert.equal(empty.page, 1); assert.equal(empty.total, 0)
  assert.equal(selectReviewComparisonRows(compare(), { query: 'none' }).total, 0)
})
test('Markdown report covers the full union regardless of UI selection', () => {
  const chapters = Array.from({ length: 19 }, (_, i) => chapter('c' + (i + 1), i + 1))
  const result = compare({ chapters }, { chapters, annotations: { c19: note('末页备注') } })
  selectReviewComparisonRows(result, { query: '找不到' })
  const report = buildReviewComparisonReport(result, new Date('2026-09-23T12:00:00Z'))
  assert.match(report, /末页备注/); assert.match(report, /章节 ID：c19/); assert.match(report, /未变化 18/)
})
test('Markdown escapes HTML, fake headings, links and multiline titles', () => {
  const result = compare({}, { chapters: [chapter('c1', 1, '# 假标题\n<script>x</script>'), chapter('c2', 2), chapter('c3', 3)],
    annotations: { c1: note('# 假章\n<img src=x onerror=alert(1)>\n[点我](javascript:run)') } })
  const report = buildReviewComparisonReport(result)
  assert.equal(report.includes('<script>'), false); assert.equal(report.includes('<img'), false)
  assert.equal(report.includes('\n# 假章'), false); assert.match(report, /&lt;img/)
})
test('10,000-chapter comparison keeps accurate partitions without truncation', () => {
  const chapters = Array.from({ length: 10000 }, (_, i) => chapter('c' + (i + 1), i + 1, '章'))
  const result = compare({ chapters }, { chapters: [...chapters].reverse() })
  assert.equal(result.totals.total, 10000)
  assert.equal(result.totals.total, result.totals.added + result.totals.removed + result.totals.changed + result.totals.unchanged)
})
