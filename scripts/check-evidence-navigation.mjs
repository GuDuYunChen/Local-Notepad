import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectProjectPlainText, buildEntityTermIndex, scanProjectEntityMentions } from '../src/components/projectEntityMentionUtils.js'
import { createTextEvidenceTarget, createWikiEvidenceTarget, resolveEvidenceTarget } from '../src/components/Editor/utils/evidenceNavigationUtils.js'
import { createEvidenceNavigationStore, beginEvidenceContentLoad, completeEvidenceContentLoad, cancelEvidenceContentLoad, isEvidenceContentReady } from '../src/services/evidenceNavigation.js'

const text = (value, format = 0) => ({ type: 'text', text: value, format })
const p = (...children) => ({ type: 'paragraph', children })
const doc = (...children) => ({ root: { type: 'root', children } })
const link = (id = 'a', title = '关关') => ({ type: 'wiki-link', id, title, sectionPath: [] })
function target(content, match, nth = 0) {
  const snapshot = collectProjectPlainText(content)
  let start = -1
  for (let index = 0; index <= nth; index += 1) start = snapshot.indexOf(match, start + 1)
  assert.ok(start >= 0)
  return createTextEvidenceTarget(content, { start, end: start + match.length, match })
}
const locate = (content, match, nth = 0) => resolveEvidenceTarget(content, target(content, match, nth))

test('maps a normal text occurrence to exact raw offsets', () => {
  assert.deepEqual(locate(doc(p(text('你好关关，再见'))), '关关'), {
    status: 'found', kind: 'text', anchor: { path: [0, 0], offset: 2 }, focus: { path: [0, 0], offset: 4 },
  })
})
test('selects the requested repeated occurrence, never simply the first match', () => {
  assert.equal(locate(doc(p(text('关关。关关。关关。'))), '关关', 2).anchor.offset, 6)
})
test('maps names split between differently formatted nodes', () => {
  const result = locate(doc(p(text('前关'), text('关后', 1))), '关关')
  assert.deepEqual(result.anchor, { path: [0, 0], offset: 1 })
  assert.deepEqual(result.focus, { path: [0, 1], offset: 1 })
})
test('maps through nested inline links and marks', () => {
  const result = locate(doc(p(text('关'), { type: 'link', children: [{ type: 'mark', children: [text('关')] }] })), '关关')
  assert.deepEqual(result.focus.path, [0, 1, 0, 0])
})
test('maps NFC-composed characters back to decomposed raw text', () => {
  const result = locate(doc(p(text('E\u0301lodie在此'))), 'Élodie')
  assert.equal(result.anchor.offset, 0)
  assert.equal(result.focus.offset, 7)
})
test('maps a combining sequence spanning two formatting nodes', () => {
  const result = locate(doc(p(text('E'), text('\u0301lodie', 1))), 'Élodie')
  assert.deepEqual(result.anchor, { path: [0, 0], offset: 0 })
  assert.deepEqual(result.focus, { path: [0, 1], offset: 6 })
})
test('maps collapsed spaces tabs and nonbreaking spaces to the complete raw range', () => {
  const result = locate(doc(p(text('  Mary\t \u00a0 Jane  '))), 'Mary Jane')
  assert.equal(result.anchor.offset, 2)
  assert.equal(result.focus.offset, 14)
})
test('preserves UTF-16 offsets after astral characters', () => {
  const result = locate(doc(p(text('😀𠮷关关'))), '关关')
  assert.equal(result.anchor.offset, 4)
  assert.equal(result.focus.offset, 6)
})
test('does not select half a surrogate or half a grapheme', () => {
  const content = doc(p(text('😀👨‍👩‍👧‍👦')))
  const half = createTextEvidenceTarget(content, { start: 0, end: 1 })
  assert.notEqual(resolveEvidenceTarget(content, half).status, 'found')
  assert.notEqual(locate(content, '👨').status, 'found')
})
test('includes the complete decomposed Korean grapheme', () => {
  const result = locate(doc(p(text('\u1100\u1161나다'))), '가나')
  assert.equal(result.focus.offset, 3)
})
test('keeps table-cell paths and paragraph boundaries', () => {
  const content = doc({ type: 'table', children: [{ type: 'tablerow', children: [
    { type: 'tablecell', children: [p(text('无关'))] }, { type: 'tablecell', children: [p(text('关关'))] },
  ] }] })
  assert.deepEqual(locate(content, '关关').anchor.path, [0, 0, 1, 0, 0])
})
test('omitted code and WikiLink text never shift the selected prose node', () => {
  const content = doc({ type: 'code', children: [text('关关')] }, p(link(), text('关关')))
  assert.deepEqual(locate(content, '关关').anchor.path, [1, 1])
})
test('todo decorator text fails safely rather than inventing a text node', () => {
  assert.equal(locate(doc({ type: 'todo', text: '关关' }), '关关').status, 'unsupported')
})
test('content edits invalidate stale evidence without fuzzy guessing', () => {
  const old = doc(p(text('关关出发了')))
  assert.equal(resolveEvidenceTarget(doc(p(text('前文新增关关出发了'))), target(old, '关关')).status, 'stale')
})
test('formatting-only changes can be remapped against the live node structure', () => {
  const old = doc(p(text('关关来了')))
  const next = doc(p(text('关', 1), text('关来了')))
  assert.equal(resolveEvidenceTarget(next, target(old, '关关')).status, 'found')
})
test('raw legacy text can navigate after it is loaded into a plain paragraph', () => {
  const descriptor = target('关关来了', '关关')
  assert.equal(resolveEvidenceTarget(doc(p(text('关关来了'))), descriptor).status, 'found')
})
test('invalid descriptors do not throw or select anything', () => {
  const content = doc(p(text('关关')))
  for (const value of [null, {}, { version: 2 }, { version: 1, kind: 'text', snapshot: '关关', start: -1, end: 2 }]) {
    assert.equal(resolveEvidenceTarget(content, value).status, 'invalid')
  }
  assert.equal(createTextEvidenceTarget(content, { start: 0, end: 2, match: '赵三' }), null)
})
test('WikiLink positioning uses note identity and occurrence index', () => {
  const content = doc(p(link('b', '关关'), link('a', '旧名'), link('a', '关关')))
  const descriptor = createWikiEvidenceTarget(content, 'a', 1)
  assert.deepEqual(resolveEvidenceTarget(content, descriptor), { status: 'found', kind: 'wiki', path: [0, 2] })
})
test('removed or renamed links invalidate their old targets', () => {
  const content = doc(p(link(), text('后文')))
  const descriptor = createWikiEvidenceTarget(content, 'a')
  assert.equal(resolveEvidenceTarget(doc(p(link('a', '新名'), text('后文'))), descriptor).status, 'stale')
  assert.equal(resolveEvidenceTarget(doc(p(text('后文'))), descriptor).status, 'stale')
})
test('invalid or missing WikiLink occurrences cannot create targets', () => {
  for (const ordinal of [-1, 1, NaN]) assert.equal(createWikiEvidenceTarget(doc(p(link())), 'a', ordinal), null)
  assert.equal(createWikiEvidenceTarget(doc(p(link())), 'missing'), null)
})
test('navigation leaves both content and descriptor untouched', () => {
  const content = doc(p(text('关关来了')))
  const descriptor = target(content, '关关')
  const snapshot = JSON.stringify([content, descriptor])
  resolveEvidenceTarget(content, descriptor)
  assert.equal(JSON.stringify([content, descriptor]), snapshot)
})
test('scanner samples remain resolvable over 1000 deterministic formatting/Unicode cases', () => {
  const index = buildEntityTermIndex([{ id: 'a', label: 'Élodie' }, { id: 'b', label: '关关' }])
  for (let seed = 0; seed < 1000; seed += 1) {
    const name = seed % 2 ? 'E\u0301lodie' : '关关'
    const split = seed % name.length
    const content = doc(p(text('😀'.repeat(seed % 5) + ' \t' + name.slice(0, split)), text(name.slice(split), 1)), p(text('关关。')))
    const plain = collectProjectPlainText(content)
    for (const evidence of scanProjectEntityMentions(plain, index, { sampleLimit: 10 }).values()) {
      for (const sample of evidence.samples) assert.equal(resolveEvidenceTarget(content, createTextEvidenceTarget(content, sample)).status, 'found', 'seed=' + seed)
    }
  }
})

function clockStore() {
  let time = 0
  const jobs = new Map()
  let id = 0
  const store = createEvidenceNavigationStore({ now: () => time, schedule: fn => { jobs.set(++id, fn); return id }, unschedule: token => jobs.delete(token) })
  return { store, jobs, tick: value => { time += value } }
}
test('request store is document-scoped and consumed exactly once', () => {
  const { store, jobs } = clockStore()
  const id = store.start('chapter-a', { version: 1 })
  assert.equal(store.peek('chapter-b'), null)
  assert.equal(store.take(id, 'chapter-b'), null)
  assert.ok(store.take(id, 'chapter-a'))
  assert.equal(store.take(id, 'chapter-a'), null)
  assert.equal(jobs.size, 0)
})
test('new requests supersede old requests without allowing stale cancellation', () => {
  const { store, jobs } = clockStore()
  const first = store.start('a', { version: 1 })
  const second = store.start('b', { version: 1 })
  assert.equal(store.cancel(first), false)
  assert.equal(store.peek().id, second)
  assert.equal(jobs.size, 1)
})
test('expiration clears manuscript snapshots and invokes the supplied notice', () => {
  const { store, jobs } = clockStore()
  let expired = 0
  store.start('a', { version: 1, snapshot: '正文' }, () => expired++)
  ;[...jobs.values()][0]()
  assert.equal(store.peek(), null)
  assert.equal(expired, 1)
})
test('expired requests never replay even before the timeout callback runs', () => {
  const { store, tick } = clockStore()
  store.start('a', { version: 1 })
  tick(30000)
  assert.equal(store.peek('a'), null)
})
test('subscriptions can be removed without leaking notifications', () => {
  const { store } = clockStore()
  let calls = 0
  const unsubscribe = store.subscribe(() => calls++)
  store.start('a', { version: 1 })
  unsubscribe()
  store.cancel()
  assert.equal(calls, 1)
})
test('readiness requires the exact editor document and initial content', () => {
  const editor = {}
  const token = beginEvidenceContentLoad(editor, 'a', 'content')
  assert.equal(isEvidenceContentReady(editor, 'a', 'content'), false)
  completeEvidenceContentLoad(editor, token)
  assert.equal(isEvidenceContentReady(editor, 'a', 'content'), true)
  assert.equal(isEvidenceContentReady(editor, 'b', 'content'), false)
  assert.equal(isEvidenceContentReady(editor, 'a', 'different'), false)
  cancelEvidenceContentLoad(editor, token)
  assert.equal(isEvidenceContentReady(editor, 'a', 'content'), false)
})
test('obsolete or StrictMode cleanup cannot complete or cancel a newer load', () => {
  const editor = {}
  const old = beginEvidenceContentLoad(editor, 'a', 'old')
  const next = beginEvidenceContentLoad(editor, 'a', 'next')
  completeEvidenceContentLoad(editor, old)
  assert.equal(isEvidenceContentReady(editor, 'a', 'next'), false)
  completeEvidenceContentLoad(editor, next)
  cancelEvidenceContentLoad(editor, old)
  assert.equal(isEvidenceContentReady(editor, 'a', 'next'), true)
})
