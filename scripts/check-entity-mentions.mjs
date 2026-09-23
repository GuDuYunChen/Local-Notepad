import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_ENTITY_ALIASES,
  normalizeEntityTerm,
  entityTermKey,
  normalizeProjectEntityAliases,
  collectProjectPlainText,
  buildEntityTermIndex,
  scanProjectEntityMentions,
  getProjectEntityAliasError,
} from '../src/components/projectEntityMentionUtils.js'

const text = value => ({ type: 'text', text: value })
const paragraph = (...children) => ({ type: 'paragraph', children })
const doc = (...children) => JSON.stringify({ root: { type: 'root', children } })
const nodes = [{ id: 'a', label: '关关' }, { id: 'b', label: '赵三' }]
const scan = (value, entities = nodes, aliases = {}) => scanProjectEntityMentions(
  collectProjectPlainText(value), buildEntityTermIndex(entities, aliases),
)
const count = (result, id, source = 'canonicalCount') => result.get(id)?.[source] || 0

test('normalizes whitespace and Unicode without stringifying invalid aliases', () => {
  assert.equal(normalizeEntityTerm('  Mary\t Jane  '), 'Mary Jane')
  assert.equal(entityTermKey(' E\u0301LODIE '), 'élodie')
  for (const value of [null, undefined, 12, {}, []]) assert.equal(normalizeEntityTerm(value), '')
})

test('deduplicates aliases case-insensitively, preserving the first spelling', () => {
  assert.deepEqual(normalizeProjectEntityAliases({ a: [' Ally ', 'ally', 'ALLY', '小关', '小关', '她'] }), {
    a: ['Ally', '小关'],
  })
})

test('deduplicates canonically equivalent Unicode aliases', () => {
  assert.deepEqual(normalizeProjectEntityAliases({ a: ['E\u0301lodie', 'ÉLODIE'] }), { a: ['Élodie'] })
})

test('rejects malformed storage and non-string entries', () => {
  for (const value of [null, [], 'text', 22]) assert.deepEqual(normalizeProjectEntityAliases(value), {})
  assert.deepEqual(normalizeProjectEntityAliases({ a: [{}, 33, null, '阿三'], b: 'wrong', '': ['无效'] }), { a: ['阿三'] })
})

test('enforces the alias cap after deduplication', () => {
  const aliases = ['Ally', 'ally', ...Array.from({ length: 30 }, (_, i) => '名字' + i)]
  const normalized = normalizeProjectEntityAliases({ a: aliases })
  assert.equal(normalized.a.length, MAX_ENTITY_ALIASES)
  assert.equal(normalized.a[1], '名字0')
})

test('merges IDs normalized by trimming without losing aliases', () => {
  assert.deepEqual(normalizeProjectEntityAliases({ ' a ': ['小关'], a: ['关姑娘'] }), { a: ['小关', '关姑娘'] })
})

test('normalization is idempotent and leaves the input unchanged', () => {
  const input = Object.freeze({ a: Object.freeze([' 小关 ', 'ALLY', 'ally']) })
  const once = normalizeProjectEntityAliases(input)
  assert.deepEqual(normalizeProjectEntityAliases(once), once)
  assert.deepEqual(input.a, [' 小关 ', 'ALLY', 'ally'])
})

test('round-trips reserved property names without prototype mutation', () => {
  const input = JSON.parse('{"__proto__":["阿三"],"constructor":["小关"]}')
  const normalized = normalizeProjectEntityAliases(input)
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype)
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), input)
  assert.equal({}.polluted, undefined)
})

test('uses Unicode code points rather than surrogate pairs for the minimum length', () => {
  assert.deepEqual(normalizeProjectEntityAliases({ a: ['𠮷', '𠮷野', '😀', '😀😀'] }), { a: ['𠮷野', '😀😀'] })
})

test('recognizes a Chinese name split by bold or other formatting', () => {
  assert.equal(count(scan(doc(paragraph(text('关'), { ...text('关'), format: 1 }, text('到了。')))), 'a'), 1)
})

test('preserves inline link and mark continuity', () => {
  const value = doc(paragraph(text('关'), { type: 'link', children: [{ type: 'mark', children: [text('关')] }] }))
  assert.equal(count(scan(value), 'a'), 1)
})

test('recognizes a Latin name split across formatting nodes', () => {
  assert.equal(count(scan(doc(paragraph(text('Al'), text('ice'))), [{ id: 'a', label: 'Alice' }]), 'a'), 1)
})

test('does not concatenate Chinese names across paragraphs', () => {
  assert.equal(count(scan(doc(paragraph(text('关')), paragraph(text('关')))), 'a'), 0)
})

test('does not assemble a multi-word name across paragraphs', () => {
  assert.equal(count(scan(doc(paragraph(text('Mary')), paragraph(text('Jane'))), [{ id: 'a', label: 'Mary Jane' }]), 'a'), 0)
})

test('does not concatenate table cells or explicit line breaks', () => {
  const table = doc({ type: 'table', children: [{ type: 'tablerow', children: [
    { type: 'tablecell', children: [text('关')] }, { type: 'tablecell', children: [text('关')] },
  ] }] })
  assert.equal(count(scan(table), 'a'), 0)
  assert.equal(count(scan(doc(paragraph(text('关'), { type: 'linebreak' }, text('关')))), 'a'), 0)
})

for (const type of ['wiki-link', 'code', 'code-block', 'code-highlight', 'image', 'formula']) {
  test('excludes ' + type + ' content and keeps its neighbors separate', () => {
    const value = doc(paragraph(text('关'), { type, text: '关关', title: '关关', children: [text('关关')] }, text('关')))
    assert.equal(count(scan(value), 'a'), 0)
  })
}

test('supports plain text and JSON-encoded plain strings', () => {
  assert.equal(count(scan('关关到了。'), 'a'), 1)
  assert.equal(count(scan(JSON.stringify('关关到了。')), 'a'), 1)
})

test('ignores metadata-only JSON and tolerates malformed child fields', () => {
  assert.equal(count(scan('{"title":"关关"}'), 'a'), 0)
  assert.doesNotThrow(() => scan(doc({ type: 'paragraph', children: {} })))
  assert.equal(collectProjectPlainText(null), '')
})

test('retains todo text without joining separate todo blocks', () => {
  assert.equal(count(scan(doc({ type: 'todo', text: '关关出发' })), 'a'), 1)
  assert.equal(count(scan(doc({ type: 'todo', text: '关' }, { type: 'todo', text: '关' })), 'a'), 0)
})

test('does not treat substrings of Latin words as entities', () => {
  const result = scan('Anna Ann ANN Annette _Ann Ann_ 1Ann Ann1.', [{ id: 'a', label: 'Ann' }])
  assert.equal(count(result, 'a'), 2)
})

test('treats regex metacharacters as literal names', () => {
  for (const label of ['A+B', 'X.Y', 'C++', '${name}', 'A[0]', 'a\\b']) {
    assert.equal(count(scan(label + ' ' + label, [{ id: 'a', label }]), 'a'), 2, label)
  }
})

test('normalizes decomposed Unicode and supports non-Latin case folding', () => {
  assert.equal(count(scan('E\u0301lodie ÉLODIE', [{ id: 'a', label: 'Élodie' }]), 'a'), 2)
  assert.equal(count(scan('АЛЕКС Алекс', [{ id: 'a', label: 'Алекс' }]), 'a'), 2)
})

test('does not double-count aliases differing only from the canonical name by case', () => {
  const result = scan('Alice ALICE', [{ id: 'a', label: 'Alice' }], { a: ['alice', 'ALICE'] })
  assert.equal(count(result, 'a'), 2)
  assert.equal(count(result, 'a', 'aliasCount'), 0)
})

test('prefers the longest overlapping alias instead of counting one span twice', () => {
  const result = scan('关关先生见到了关关。', nodes, { a: ['关关先生'] })
  assert.equal(count(result, 'a'), 1)
  assert.equal(count(result, 'a', 'aliasCount'), 1)
  assert.deepEqual([...result.get('a').aliasesMatched], ['关关先生'])
})

test('prefers the complete entity name over a shorter name contained in it', () => {
  const result = scan('青崖镇，青崖。', [{ id: 'a', label: '青崖' }, { id: 'b', label: '青崖镇' }])
  assert.equal(count(result, 'a'), 1)
  assert.equal(count(result, 'b'), 1)
})

test('suppresses duplicate canonical names and reports all owners', () => {
  const entities = [{ id: 'a', label: '关关' }, { id: 'b', label: '关关' }]
  const index = buildEntityTermIndex(entities)
  assert.deepEqual(index.canonicalConflicts, [{ label: '关关', entityIds: ['a', 'b'] }])
  assert.equal(scanProjectEntityMentions('关关出现了', index).size, 0)
})

test('a unique alias still disambiguates an entity with a duplicate canonical name', () => {
  const result = scan('关关和关姑娘。', [{ id: 'a', label: '关关' }, { id: 'b', label: '关关' }], { a: ['关姑娘'] })
  assert.equal(count(result, 'a'), 0)
  assert.equal(count(result, 'a', 'aliasCount'), 1)
  assert.equal(result.has('b'), false)
})

test('suppresses shared aliases and reports conflicts', () => {
  const index = buildEntityTermIndex(nodes, { a: ['阿三'], b: ['阿三'] })
  assert.deepEqual(index.aliasConflicts, [{ alias: '阿三', entityIds: ['a', 'b'] }])
  assert.equal(scanProjectEntityMentions('阿三出现', index).size, 0)
})

test('preserves a unique canonical name when another entity claims it as an alias', () => {
  const result = scan('赵三来了。', nodes, { a: ['赵三'] })
  assert.equal(count(result, 'b'), 1)
  assert.equal(result.has('a'), false)
})

test('orphaned alias records do not suppress active entities and remain stored', () => {
  const aliases = { a: ['小关'], deleted: ['小关'] }
  const index = buildEntityTermIndex(nodes, aliases)
  assert.equal(index.aliasConflicts.length, 0)
  assert.equal(count(scanProjectEntityMentions('小关', index), 'a', 'aliasCount'), 1)
  assert.deepEqual(normalizeProjectEntityAliases(aliases), aliases)
})

test('ambiguous longer spans block misleading shorter matches', () => {
  const entities = [...nodes, { id: 'c', label: '姑娘' }]
  const result = scan('关姑娘来了。', entities, { a: ['关姑娘'], b: ['关姑娘'] })
  assert.equal(result.size, 0)
})

test('reusing the compiled index does not leak regex position between chapters', () => {
  const index = buildEntityTermIndex(nodes, { a: ['小关'] })
  for (let i = 0; i < 3; i += 1) {
    const result = scanProjectEntityMentions('小关与赵三。小关。', index)
    assert.equal(count(result, 'a', 'aliasCount'), 2)
    assert.equal(count(result, 'b'), 1)
  }
})

test('matching results do not depend on entity catalog order', () => {
  const entities = [{ id: 'a', label: '青崖' }, { id: 'b', label: '青崖镇' }]
  const summarize = result => [...result].map(([id, e]) => [id, e.canonicalCount, e.aliasCount]).sort()
  assert.deepEqual(summarize(scan('青崖镇和青崖', entities)), summarize(scan('青崖镇和青崖', [...entities].reverse())))
})

test('the alias editor rejects canonical duplicates, existing aliases and cross-entity conflicts', () => {
  const entities = [{ id: 'a', label: 'Alice', aliases: ['Ally'] }, { id: 'b', label: 'Bob', aliases: ['Bobby'] }]
  assert.match(getProjectEntityAliasError(entities, 'a', ' ALICE '), /原名相同/)
  assert.match(getProjectEntityAliasError(entities, 'a', 'ally'), /已经存在/)
  assert.match(getProjectEntityAliasError(entities, 'a', 'BOB'), /占用/)
  assert.match(getProjectEntityAliasError(entities, 'a', 'bobby'), /占用/)
  assert.equal(getProjectEntityAliasError(entities, 'a', '小爱'), '')
})

test('the alias editor explicitly rejects the twenty-fifth alias', () => {
  const entities = [{ id: 'a', label: '关关', aliases: Array.from({ length: 24 }, (_, i) => '别名' + i) }]
  assert.match(getProjectEntityAliasError(entities, 'a', '关姑娘'), /24/)
  assert.match(getProjectEntityAliasError(entities, 'missing', '关姑娘'), /先选择/)
  assert.match(getProjectEntityAliasError(entities, 'a', '她'), /2 个字符/)
})
