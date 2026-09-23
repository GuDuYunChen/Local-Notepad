import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEntityTermIndex, scanProjectEntityMentions } from '../src/components/projectEntityMentionUtils.js'
import {
  buildEntityChapterPreview, buildEntityEvidenceExcerpt, selectProjectEntityEvidence,
} from '../src/components/projectEntityEvidenceUtils.js'

const entity = { id: 'a', label: '关关', noteId: 'char-a' }
const nodes = [entity, { id: 'b', label: '赵三', noteId: 'char-b' }]
const index = () => buildEntityTermIndex(nodes, { a: ['小关'] })
const text = value => ({ type: 'text', text: value })
const doc = (...children) => JSON.stringify({ root: { type: 'root', children } })
const para = (...children) => ({ type: 'paragraph', children })
const link = (id = 'char-a', title = '关关', sectionPath = []) => ({ type: 'wiki-link', id, title, sectionPath })
const preview = (content, options = {}) => buildEntityChapterPreview(content, index(), entity, options)

function modelFixture(total = 13) {
  const evidence = []
  const chapterEntities = {}
  for (let ordinal = 1; ordinal <= total; ordinal += 1) {
    const chapterId = 'c' + ordinal
    evidence.push({
      chapterId, chapterTitle: '第' + ordinal + '章.md', ordinal,
      volumeId: ordinal <= 7 ? 'v1' : '', volumeTitle: ordinal <= 7 ? '第一卷' : '未分卷',
      bestSource: 'wiki', aliasesMatched: ordinal % 2 ? ['小关', 'Ally'] : [],
    })
    chapterEntities[chapterId] = [{
      node: entity, explicitCount: 1, canonicalCount: 2, aliasCount: ordinal % 2 ? 3 : 0,
    }]
  }
  return { entityById: new Map([['a', { ...entity, evidence }]]), chapterEntities }
}

test('default scanner remains count-only', () => {
  const row = scanProjectEntityMentions('关关和小关', index()).get('a')
  assert.equal(row.canonicalCount, 1)
  assert.equal(row.aliasCount, 1)
  assert.equal(Object.hasOwn(row, 'samples'), false)
})

test('samples are capped independently for canonical and alias evidence', () => {
  const row = scanProjectEntityMentions('关关。'.repeat(20) + '小关。'.repeat(10), index(), { sampleLimit: 3 }).get('a')
  assert.equal(row.canonicalCount, 20)
  assert.equal(row.aliasCount, 10)
  assert.equal(row.samples.length, 6)
  assert.equal(row.samples.filter(sample => sample.source === 'alias').length, 3)
})

test('sample limits are finite and capped at ten per source', () => {
  for (const sampleLimit of [-1, 0, Infinity, NaN, 'invalid']) {
    const row = scanProjectEntityMentions('关关', index(), { sampleLimit }).get('a')
    assert.equal(Object.hasOwn(row, 'samples'), false)
  }
  assert.equal(scanProjectEntityMentions('关关'.repeat(30), index(), { sampleLimit: 999 }).get('a').samples.length, 10)
})

test('samples keep leftmost-longest overlap resolution', () => {
  const terms = buildEntityTermIndex(nodes, { a: ['关关先生'] })
  const row = scanProjectEntityMentions('关关先生与关关', terms, { sampleLimit: 3 }).get('a')
  assert.equal(row.canonicalCount + row.aliasCount, 2)
  assert.deepEqual(row.samples.map(sample => sample.term), ['关关先生', '关关'])
})

test('sampling does not mutate or leak regex positions across scans', () => {
  const terms = index()
  const first = scanProjectEntityMentions('小关、关关。', terms, { sampleLimit: 3 })
  assert.deepEqual(scanProjectEntityMentions('小关、关关。', terms, { sampleLimit: 3 }), first)
})

test('formatted Chinese text produces a continuous highlighted match', () => {
  const value = doc(para(text('你好，关'), { ...text('关'), format: 1 }, text('到了。')))
  const row = preview(value)
  assert.equal(row.samples[0].match, '关关')
  assert.equal(row.samples[0].before, '你好，')
  assert.equal(row.samples[0].after, '到了。')
})

test('previews never join names across paragraphs', () => {
  assert.equal(preview(doc(para(text('关')), para(text('关')))).samples.length, 0)
})

test('excerpt context stays within its paragraph', () => {
  const value = doc(para(text('不应出现的上一段')), para(text('关关来了')), para(text('不应出现的下一段')))
  const result = preview(value).samples[0]
  assert.equal(result.before, '')
  assert.equal(result.after, '来了')
})

test('excerpt cropping is Unicode-safe and explicitly marked', () => {
  const value = '😀'.repeat(60) + '关关' + '𠮷'.repeat(60)
  const result = buildEntityEvidenceExcerpt(value, { start: 120, end: 122, source: 'canonical' }, 4)
  assert.equal(result.before, '😀'.repeat(4))
  assert.equal(result.after, '𠮷'.repeat(4))
  assert.equal(result.leadingEllipsis, true)
  assert.equal(result.trailingEllipsis, true)
  assert.equal(result.match, '关关')
})

test('NFC-normalized offsets highlight the actual case in the body', () => {
  const target = { id: 'a', label: 'Élodie' }
  const terms = buildEntityTermIndex([target])
  const result = buildEntityChapterPreview('Hello E\u0301LODIE!', terms, target)
  assert.equal(result.samples[0].match, 'ÉLODIE')
  assert.equal(result.samples[0].before, 'Hello ')
})

test('aliases appearing after many canonical names still have excerpts', () => {
  const result = preview('关关。'.repeat(50) + '小关到了。', { source: 'alias' })
  assert.equal(result.samples.length, 1)
  assert.equal(result.samples[0].match, '小关')
  assert.equal(result.plainCount, 1)
})

test('omitted sample counts do not truncate mention totals', () => {
  const result = preview('关关。'.repeat(20))
  assert.equal(result.samples.length, 3)
  assert.equal(result.plainCount, 20)
  assert.equal(result.omittedPlainCount, 17)
})

test('WikiLink labels are separate evidence, never fake prose quotes', () => {
  const result = preview(doc(para(link())))
  assert.equal(result.samples.length, 0)
  assert.equal(result.wikiLinks[0].title, '关关')
  assert.equal(result.wikiCount, 1)
})

test('WikiLink evidence follows note ID rather than display title', () => {
  const result = preview(doc(para(link('char-b', '关关'), link('char-a', '旧标题', ['身世']))))
  assert.equal(result.wikiCount, 1)
  assert.deepEqual(result.wikiLinks[0], { title: '旧标题', sectionPath: ['身世'] })
})

test('wiki samples are bounded but all link counts remain available', () => {
  const result = preview(doc(para(...Array.from({ length: 10 }, () => link()))))
  assert.equal(result.wikiLinks.length, 3)
  assert.equal(result.wikiCount, 10)
  assert.equal(result.omittedWikiCount, 7)
})

test('source-specific previews exclude other evidence sources', () => {
  const value = doc(para(text('关关和小关'), link()))
  assert.equal(preview(value, { source: 'wiki' }).samples.length, 0)
  assert.equal(preview(value, { source: 'canonical' }).wikiLinks.length, 0)
  assert.deepEqual(preview(value, { source: 'canonical' }).samples.map(row => row.match), ['关关'])
})

test('malformed serialized content does not invent explicit links', () => {
  for (const content of [null, 'broken json', '{"root":{"children":{}}}', '{"root":{"children":[null,3]}}']) {
    assert.equal(preview(content).wikiCount, 0)
  }
})

test('ambiguous aliases remain suppressed in previews', () => {
  const terms = buildEntityTermIndex(nodes, { a: ['阿三'], b: ['阿三'] })
  assert.equal(buildEntityChapterPreview('阿三来了', terms, entity).samples.length, 0)
})

test('code blocks are excluded from prose excerpts', () => {
  const result = preview(doc({ type: 'code', children: [text('关关')] }, { type: 'code-block', text: '小关' }))
  assert.equal(result.plainCount, 0)
})

test('potential HTML is returned only as ordinary text segments', () => {
  const result = preview('<img src=x onerror=alert(1)>关关</img>')
  assert.equal(result.samples[0].before, '<img src=x onerror=alert(1)>')
  assert.equal(result.samples[0].after, '</img>')
})

test('all source totals include each provenance without losing mixed chapters', () => {
  const result = selectProjectEntityEvidence(modelFixture(), 'a')
  assert.equal(result.totalRows, 13)
  assert.equal(result.totalMentions, 60)
  assert.equal(result.pageCount, 3)
  assert.equal(result.rows.length, 6)
})

test('alias filtering includes chapters whose bestSource is wiki', () => {
  const result = selectProjectEntityEvidence(modelFixture(), 'a', { source: 'alias' })
  assert.equal(result.totalRows, 7)
  assert.equal(result.totalMentions, 21)
  assert.equal(result.rows[0].bestSource, 'wiki')
})

test('canonical and wiki filters use their own totals', () => {
  assert.equal(selectProjectEntityEvidence(modelFixture(), 'a', { source: 'canonical' }).totalMentions, 26)
  assert.equal(selectProjectEntityEvidence(modelFixture(), 'a', { source: 'wiki' }).totalMentions, 13)
})

test('pagination reaches chapters beyond the previous ten-chapter cutoff', () => {
  const result = selectProjectEntityEvidence(modelFixture(), 'a', { page: 3 })
  assert.deepEqual(result.rows.map(row => row.ordinal), [13])
})

test('ungrouped volume is distinct from all volumes', () => {
  assert.equal(selectProjectEntityEvidence(modelFixture(), 'a', { volumeId: '' }).totalRows, 6)
  assert.equal(selectProjectEntityEvidence(modelFixture(), 'a', { volumeId: null }).totalRows, 13)
  assert.equal(selectProjectEntityEvidence(modelFixture(), 'a', { volumeId: 'v1' }).totalRows, 7)
})

test('search matches chapter title, volume title or normalized matched alias', () => {
  assert.equal(selectProjectEntityEvidence(modelFixture(), 'a', { query: '第13章' }).totalRows, 1)
  assert.equal(selectProjectEntityEvidence(modelFixture(), 'a', { query: '第一卷' }).totalRows, 7)
  assert.equal(selectProjectEntityEvidence(modelFixture(), 'a', { query: '  aLLY  ' }).totalRows, 7)
})

test('source, volume and search filters compose', () => {
  const result = selectProjectEntityEvidence(modelFixture(), 'a', { source: 'alias', volumeId: '', query: '小关' })
  assert.deepEqual(result.rows.map(row => row.ordinal), [9, 11, 13])
  assert.equal(result.totalMentions, 9)
})

test('empty or missing entities return a stable empty view', () => {
  for (const result of [selectProjectEntityEvidence(null, 'missing'), selectProjectEntityEvidence(modelFixture(), 'missing')]) {
    assert.equal(result.totalRows, 0)
    assert.equal(result.page, 1)
    assert.equal(result.pageCount, 1)
  }
})

test('filtering does not mutate the existing intelligence model', () => {
  const model = modelFixture()
  const before = structuredClone(model)
  selectProjectEntityEvidence(model, 'a', { source: 'alias', query: 'ally', page: 2 })
  assert.deepEqual(model, before)
})

test('invalid pagination and source inputs stay bounded', () => {
  const model = modelFixture()
  assert.equal(selectProjectEntityEvidence(model, 'a', { page: 999 }).page, 3)
  assert.equal(selectProjectEntityEvidence(model, 'a', { page: Infinity }).page, 1)
  assert.equal(selectProjectEntityEvidence(model, 'a', { pageSize: 999 }).pageSize, 20)
  assert.equal(selectProjectEntityEvidence(model, 'a', { pageSize: 'bad' }).pageSize, 6)
  assert.equal(selectProjectEntityEvidence(model, 'a', { source: 'bad' }).totalRows, 13)
})

test('live data shrinking clamps the current page instead of hiding the remaining rows', () => {
  const result = selectProjectEntityEvidence(modelFixture(2), 'a', { page: 3 })
  assert.equal(result.page, 1)
  assert.equal(result.rows.length, 2)
})

test('volume options do not disappear when another filter returns no matches', () => {
  const result = selectProjectEntityEvidence(modelFixture(), 'a', { query: '不存在' })
  assert.equal(result.totalRows, 0)
  assert.equal(result.volumes.length, 2)
})
