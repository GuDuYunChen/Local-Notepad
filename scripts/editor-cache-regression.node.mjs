import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { readEditorDraft, writeEditorDraft } from '../src/services/editorDraftCache.js'
import { createEditorQuitRegistry } from '../src/services/editorQuit.mjs'

// Run the real callbacks, not a second implementation of the cache/save policy.
// React mounting and Lexical loading remain covered by the existing Vitest gates.
const source = fs.readFileSync(process.env.TEXT_EDITOR_SOURCE || new URL('../src/components/TextEditor.jsx', import.meta.url), 'utf8')
function between(start, end, from = 0) {
  const a = source.indexOf(start, from)
  assert.notEqual(a, -1, `Missing source anchor: ${start}`)
  const b = source.indexOf(end, a + start.length)
  assert.notEqual(b, -1, `Missing source end: ${end}`)
  return source.slice(a + start.length, b)
}
const saveCode = between('const saveNow = React.useCallback(', '\n  }, [beginSaving, endSaving])') + '\n  }'
const cacheCode = between('    cache: ', '\n    },\n    save:') + '\n    }'
const unmountCode = between('  useEffect(() => ', '\n  }, [', source.indexOf('  useEffect(() => () => {')) + '\n  }'
const helperCode = source.includes('const cachePendingDraft = React.useCallback(')
  ? between('const cachePendingDraft = React.useCallback(', '\n  }, [])') + '\n  }'
  : null // Allows the same regression tests to reproduce the prior defect.
const memory = new Map()
globalThis.localStorage = {
  setItem(key, value) { memory.set(key, String(value)) },
  getItem(key) { return memory.get(key) ?? null },
  removeItem(key) { memory.delete(key) },
  clear() { memory.clear() },
}
let sequence = 0
function fixture(content = 'baseline') {
  const id = `cache-regression-${++sequence}`
  const receipts = [], errors = []
  const c = {
    currentIdRef: { current: id }, loadedDocumentRef: { current: id },
    contentRef: { current: content }, lastSavedContentRef: { current: 'baseline' },
    deletedIdsRef: { current: new Set() }, inFlightSavesRef: { current: new Map() },
    saveControllersRef: { current: new Set() }, saveTimerRef: { current: null },
    loadAbortRef: { current: null }, pendingStructureMappingsRef: { current: [] },
    onSavedRef: { current: value => receipts.push(value) },
    editorQuit: createEditorQuitRegistry(), writeEditorDraft, AbortController,
    hasHeadingStructureChanged: () => false, beginSaving() {}, endSaving() {},
    setSaveError(value) { errors.push(value) }, setStructureDirty() {}, setLastSavedAt() {},
    window: { clearTimeout() {} }, console: { error() {} },
    api: async (_path, options) => ({ id, content: JSON.parse(options.body).content }),
  }
  vm.createContext(c)
  if (helperCode) c.cachePendingDraft = vm.runInContext(`(${helperCode})`, c)
  c.cache = vm.runInContext(`(${cacheCode})`, c)
  c.unmount = vm.runInContext(`(${unmountCode})`, c)
  c.saveNow = vm.runInContext(`(${saveCode})`, c)
  return { c, id, receipts, errors }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

test('quit inspection does not create a new draft for clean content', () => {
  const { c, id } = fixture(); c.cache(); assert.equal(readEditorDraft(id), null)
})
test('unmount does not stamp clean loaded content as a fresh edit', () => {
  const { c, id } = fixture(); c.unmount(); assert.equal(readEditorDraft(id), null)
})
test('quit inspection does not refresh an existing clean cache timestamp', () => {
  const { c, id } = fixture(); writeEditorDraft(id, 'baseline', 1234)
  const before = readEditorDraft(id); c.cache(); assert.deepEqual(readEditorDraft(id), before)
})
test('no phantom draft masks the next load even with missing server timestamps', () => {
  const { c, id } = fixture(); c.unmount(); localStorage.clear()
  const cached = readEditorDraft(id)
  assert.equal(cached ? cached.content : 'new server text', 'new server text')
})
test('unmount retains a dirty draft before the debounce timer runs', () => {
  const { c, id } = fixture('unsent'); c.editorQuit.remember(id, 'unsent'); c.unmount()
  assert.equal(readEditorDraft(id).content, 'unsent'); assert.equal(c.editorQuit.pending(), 1)
  localStorage.clear(); assert.equal(readEditorDraft(id).content, 'unsent')
})
test('same-document in-flight write retains a reverted baseline for recovery', () => {
  const { c, id } = fixture(); c.inFlightSavesRef.current.set(id, { content: 'older write' })
  c.unmount(); assert.equal(readEditorDraft(id).content, 'baseline')
})
test('a different document in flight cannot dirty the clean current document', () => {
  const { c, id } = fixture(); c.inFlightSavesRef.current.set('other', { content: 'older write' })
  c.cache(); assert.equal(readEditorDraft(id), null)
})
test('unloaded, missing and deleted document identities are never cached on close', () => {
  for (const kind of ['loading', 'missing', 'deleted']) {
    const { c, id } = fixture('draft')
    if (kind === 'loading') c.loadedDocumentRef.current = null
    if (kind === 'missing') c.currentIdRef.current = null
    if (kind === 'deleted') c.deletedIdsRef.current.add(id)
    c.cache(); c.unmount(); assert.equal(readEditorDraft(id), null)
  }
})
for (const kind of ['missing', 'wrong-id', 'wrong-content', 'missing-content']) {
  test(`save receipt ${kind} remains a failure and leaves the draft unresolved`, async () => {
    const { c, id, receipts, errors } = fixture('draft')
    c.editorQuit.remember(id, 'draft')
    const values = { missing: undefined, 'wrong-id': { id: 'other', content: 'draft' },
      'wrong-content': { id, content: 'unexpected' }, 'missing-content': { id } }
    c.api = async () => values[kind]
    await assert.rejects(c.saveNow('external'), /正文保存响应未确认/)
    assert.equal(c.lastSavedContentRef.current, 'baseline')
    assert.equal(c.editorQuit.pending(), 1); assert.equal(receipts.length, 0)
    assert.equal(errors.at(-1), true)
  })
}
test('matching save acknowledgement updates only the matching draft', async () => {
  const { c, id, receipts } = fixture('draft'); c.editorQuit.remember(id, 'draft')
  await c.saveNow('external')
  assert.equal(c.lastSavedContentRef.current, 'draft'); assert.equal(c.editorQuit.pending(), 0)
  assert.equal(receipts.length, 1)
})
test('delayed save acknowledgement preserves a newer cached draft', async () => {
  const { c, id } = fixture('first'); let finish
  c.editorQuit.remember(id, 'first')
  c.api = () => new Promise(resolve => { finish = resolve })
  const pending = c.saveNow('external')
  c.contentRef.current = 'second'; c.editorQuit.remember(id, 'second'); c.cache()
  finish({ id, content: 'first' }); await pending
  assert.equal(readEditorDraft(id).content, 'second')
  assert.equal(c.lastSavedContentRef.current, 'first'); assert.equal(c.editorQuit.pending(), 1)
})
test('reverting during a pending write waits and submits the correct second write', async () => {
  const { c, id } = fixture('changed'); const calls = []
  c.api = (_path, options) => new Promise(resolve => { calls.push({ content: JSON.parse(options.body).content, resolve }) })
  c.editorQuit.remember(id, 'changed'); const first = c.saveNow('external')
  c.contentRef.current = 'baseline'; c.editorQuit.remember(id, 'baseline')
  const second = c.saveNow('quit'); assert.equal(calls.length, 1)
  calls[0].resolve({ id, content: 'changed' }); await first; await flush()
  assert.equal(calls.length, 2); assert.equal(calls[1].content, 'baseline')
  calls[1].resolve({ id, content: 'baseline' }); await second
  assert.equal(c.lastSavedContentRef.current, 'baseline'); assert.equal(c.editorQuit.pending(), 0)
})
