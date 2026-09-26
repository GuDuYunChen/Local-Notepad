import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { captureConflictReview, conflictScope, conflictContentPreview } from '../src/services/syncConflictReview.mjs'
import { buildConflictTextDiff, canCompareConflictText, conflictDiffPage, CONFLICT_DIFF_PAGE_SIZE } from '../src/services/syncConflictDiff.mjs'
import { conflictFixture, fileRecord, settingsFixture, statusFixture } from './fixtures/sync-conflict-review.mjs'
const scope = conflictScope(settingsFixture, statusFixture)
const review = (a, b, changes = {}) => captureConflictReview(conflictFixture({ local_record: fileRecord(a), remote_record: fileRecord(b), ...changes }), scope)
const diff = (a, b) => buildConflictTextDiff(review(a, b))
const ending = { LF: '\n', CR: '\r', CRLF: '\r\n', none: '' }
const reconstruct = (model, side) => model.rows.filter(r => r.kind === 'same' || r.kind === side).map(r => r.text + ending[r.ending]).join('')
const rich = children => JSON.stringify({ root: { type: 'root', children } })
const paragraph = (text, format = 0) => ({ type: 'paragraph', children: [{ type: 'text', text, format }] })

test('changed lines have independent exact line numbers and bounded context', () => {
  const model = diff('前\n本机\n相同\n结尾', '前\n远端\n相同\n新增\n结尾')
  assert.equal(model.state, 'different'); assert.equal(model.groups.length, 2)
  assert.deepEqual(model.counts, { localOnly: 1, remoteOnly: 2, localLines: 4, remoteLines: 5 })
  assert.deepEqual(model.rows.filter(r => r.kind === 'remote').map(r => r.remoteLine), [2, 4])
  assert.equal(reconstruct(model, 'local'), '前\n本机\n相同\n结尾')
  assert.equal(reconstruct(model, 'remote'), '前\n远端\n相同\n新增\n结尾')
})
test('identical body data never implies the whole record is identical', () => {
  const model = diff('相同', '相同')
  assert.equal(model.state, 'same-text'); assert.equal(model.rawEqual, true)
  assert.match(model.message, /其他字段仍可能不同/); assert.equal(model.counts, null)
})
for (const [a, b] of [['', '新\n'], ['旧\n', ''], ['\n', ''], ['', '\n'], ['末尾', '末尾\n'], ['a\nb', 'a\n\nb']]) {
  test(`empty bodies and final/blank lines remain exact: ${JSON.stringify([a, b])}`, () => {
    const model = diff(a, b)
    assert.equal(model.state, 'different'); assert.equal(reconstruct(model, 'local'), a); assert.equal(reconstruct(model, 'remote'), b)
  })
}
for (const [a, b] of [['a\r\nb\r', 'a\nb\n'], [' 缩进\t', '缩进 '], ['é😀', 'e\u0301😀'], ['👩‍💻汉字', '👩‍🔬汉字']]) {
  test(`line endings, whitespace and Unicode are not normalized: ${JSON.stringify([a, b])}`, () => {
    const model = diff(a, b)
    assert.equal(model.state, 'different'); assert.equal(reconstruct(model, 'local'), a); assert.equal(reconstruct(model, 'remote'), b)
  })
}
test('format-only changes retain an explicit raw-data difference warning', () => {
  const model = diff(rich([paragraph('文本')]), rich([paragraph('文本', 1)]))
  assert.equal(model.state, 'same-text'); assert.equal(model.rawEqual, false)
  assert.match(model.message, /不能据此认定版本相同/)
})
test('different WikiLink destinations with the same label are not claimed equal', () => {
  const wiki = id => rich([{ type: 'paragraph', children: [{ type: 'wiki-link', title: '相同名称', noteId: id }] }])
  const model = diff(wiki('a'), wiki('b'))
  assert.equal(model.state, 'same-text'); assert.equal(model.rawEqual, false)
  assert.match(model.message, /链接目标/)
})
test('rich text compares projected paragraphs and table-cell boundaries', () => {
  const a = rich([paragraph('前'), { type: 'table', children: [{ type: 'tablerow', children: [{ type: 'tablecell', children: [paragraph('左')] }, { type: 'tablecell', children: [paragraph('右')] }] }] }])
  const b = a.replace('左', '改')
  const model = diff(a, b)
  assert.equal(reconstruct(model, 'local'), conflictContentPreview(a).text)
  assert.equal(reconstruct(model, 'remote'), conflictContentPreview(b).text)
  assert.match(reconstruct(model, 'local'), /左\n\t右/)
})
test('serialized plain strings are decoded without treating them as blank', () => {
  const model = diff(JSON.stringify('本机\n'), JSON.stringify('远端\n'))
  assert.equal(reconstruct(model, 'local'), '本机\n'); assert.equal(reconstruct(model, 'remote'), '远端\n')
})
test('unrecognized JSON stays visibly raw rather than inventing prose', () => {
  const model = diff('{"opaque":1}', '{"opaque":2}')
  assert.equal(reconstruct(model, 'local'), '{"opaque":1}')
  assert.match(model.sourceNotices[0], /原始文本/)
})
for (const node of [{ type: 'image', src: 'private' }, { type: 'unrecognized-embed', payload: 'private' }]) {
  test(`partial projection of ${node.type} refuses comparison, not false equality`, () => {
    const model = diff(rich([paragraph('same'), node]), rich([paragraph('same'), { ...node, hidden: 'different' }]))
    assert.equal(model.state, 'unavailable'); assert.equal(model.counts, null); assert.equal(model.groups.length, 0)
  })
}
test('truncated matching prefixes cannot hide a difference after the limit', () => {
  const model = diff('长'.repeat(12001) + '甲', '长'.repeat(12001) + '乙')
  assert.equal(model.state, 'unavailable'); assert.match(model.message, /不比较截取片段/)
})
test('oversized serialized input is refused before parsing', () => {
  const model = diff('a'.repeat(512 * 1024 + 1), 'b')
  assert.equal(model.state, 'unavailable'); assert.match(model.message, /读取预算/)
})
test('too many lines and too many LCS cells are refused without partial totals', () => {
  for (const model of [diff('\n'.repeat(2001), 'b'), diff('a\n'.repeat(600), 'b\n'.repeat(600))]) {
    assert.equal(model.state, 'unavailable'); assert.equal(model.counts, null); assert.equal(conflictDiffPage(model), null)
  }
})
test('common edges allow a precise small change in a long note', () => {
  const before = '同\n'.repeat(1600), after = '后\n'.repeat(398)
  const model = diff(before + '甲\n' + after, before + '乙\n' + after)
  assert.equal(model.state, 'different'); assert.equal(model.groups.length, 1)
  assert.equal(model.rows.find(r => r.kind === 'local').localLine, 1601)
})
test('missing, purged, folder and foreign identities cannot be compared as empty notes', () => {
  const valid = review('a', 'b')
  for (const replacement of [null, { ...fileRecord(), state: 'purged', file: undefined }, fileRecord('', { is_folder: true }), { ...fileRecord(), id: 'other' }, { kind: 'tag', state: 'present' }]) {
    const input = { ...valid, remote_record: replacement }
    assert.equal(canCompareConflictText(input), false); assert.equal(buildConflictTextDiff(input).state, 'unavailable')
  }
  assert.equal(canCompareConflictText(null), false)
})
test('recycle-bin text can be read without changing its destructive status', () => {
  const input = review('a', 'b', { remote_record: fileRecord('b', { is_deleted: true }) })
  assert.equal(buildConflictTextDiff(input).state, 'different'); assert.equal(input.remote_record.file.is_deleted, true)
})
test('pagination reaches every changed row exactly once including a large group tail', () => {
  const model = diff('', '新增\n'.repeat(155)), visited = []
  for (let page = 1; page <= 3; page++) {
    const view = conflictDiffPage(model, 0, page)
    assert.equal(view.pages, 3); assert.ok(view.changes.length <= CONFLICT_DIFF_PAGE_SIZE)
    visited.push(...view.changes.map(r => r.remoteLine))
  }
  assert.deepEqual(visited, Array.from({ length: 155 }, (_, i) => i + 1))
})
test('nearby change groups never appear under the label of identical context', () => {
  const model = diff('甲\n同\n乙\n同\n丙', 'A\n同\nB\n同\nC')
  assert.equal(model.groups.length, 3)
  for (let group = 0; group < model.groups.length; group++) {
    const view = conflictDiffPage(model, group)
    assert.ok([...view.before, ...view.after].every(r => r.kind === 'same'))
    assert.equal(view.total, 2)
  }
})
test('invalid navigation is clamped; no hidden pages or invented rows', () => {
  const model = diff('', 'a\n'.repeat(155))
  for (const bad of [NaN, Infinity, '2', null, -99, 0, 1.5]) assert.equal(conflictDiffPage(model, bad, bad).page, 1)
  assert.equal(conflictDiffPage(model, 999, 999).page, 3)
  assert.equal(conflictDiffPage(null), null)
})
test('model is deeply immutable and does not retain mutable caller data or secrets', () => {
  const input = { ...review('a', 'b'), password: 'secret', endpoint: 'private' }
  const before = JSON.stringify(input), model = buildConflictTextDiff(input)
  assert.equal(JSON.stringify(input), before)
  assert.ok(Object.isFrozen(model) && Object.isFrozen(model.rows) && Object.isFrozen(model.groups) && Object.isFrozen(model.counts))
  assert.ok(model.rows.every(Object.isFrozen) && model.groups.every(Object.isFrozen))
  assert.throws(() => { model.rows[0].text = 'mutated' }, TypeError)
  assert.doesNotMatch(JSON.stringify(model), /secret|private|base_hash|remote_hash/)
})
test('hostile markup remains ordinary text and no links or scripts are interpreted', () => {
  const a = '<script>alert(1)</script>', b = '<img src=x onerror=alert(2)>'
  const model = diff(a, b)
  assert.equal(reconstruct(model, 'local'), a); assert.equal(reconstruct(model, 'remote'), b)
})
test('1500 deterministic repeated-line cases reconstruct both projections and preserve minimal edit counts', () => {
  let seed = 0x2f10
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max }
  const words = ['甲', '乙', '😀', 'e\u0301', '', '  ']
  for (let trial = 0; trial < 1500; trial++) {
    const a = Array.from({ length: random(12) }, () => words[random(words.length)] + '\n')
    const b = Array.from({ length: random(12) }, () => words[random(words.length)] + '\n')
    const model = diff(a.join(''), b.join(''))
    if (a.join('') === b.join('')) { assert.equal(model.state, 'same-text'); continue }
    assert.equal(model.state, 'different'); assert.equal(reconstruct(model, 'local'), a.join('')); assert.equal(reconstruct(model, 'remote'), b.join(''))
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    assert.equal(model.counts.localOnly + model.counts.remoteOnly, a.length + b.length - 2 * dp[a.length][b.length])
  }
})
test('diff presentation contains no network, storage, HTML execution, merge or resolver capability', () => {
  for (const name of ['../src/services/syncConflictDiff.mjs', '../src/components/SyncConflictDiff.jsx']) {
    const source = fs.readFileSync(new URL(name, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|localStorage|sessionStorage|indexedDB|electronAPI|\bfetch\s*\(|\bapi\s*\(|onResolve|applyReviewedConflict/)
  }
})

test('diff styling uses defined semantic theme backgrounds and explicit text color', () => {
  const css = fs.readFileSync(new URL('../src/components/SyncConflictDiff.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /--(?:danger|success|warning)-bg/)
  assert.match(css, /background:var\(--danger-light,var\(--paper\)\)/)
  assert.match(css, /background:var\(--success-light,var\(--paper\)\)/)
  assert.match(css, /\.sync-diff-table pre\{color:var\(--ink\);background:transparent/)
})
