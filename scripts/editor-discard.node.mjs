import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorQuitRegistry, createEditorQuitParticipant } from '../src/services/editorQuit.mjs'
import { discardEditorDraft, observeEditorDraft } from '../src/services/editorDraftDiscard.mjs'
const state = () => ({ id: 'a', ready: true, content: 'draft', saved: 'stored', pending: [] })
test('explicit discard releases only the approved document without a save receipt', async () => {
  const registry = createEditorQuitRegistry(), s = state(), calls = []
  registry.remember('a', 'draft'); registry.remember('b', 'other draft')
  assert.equal(discardEditorDraft(s, registry, text => calls.push(text)), true)
  assert.deepEqual(calls, ['stored']); assert.equal(registry.pending(), 1)
  await assert.rejects(registry.flush(), error => error.code === 'unresolved')
  registry.saved('b', 'other draft'); await registry.flush()
})
test('discarded refs are clean at unmount and no orphan draft blocks the next workspace', async () => {
  const registry = createEditorQuitRegistry(), s = state()
  registry.remember(s.id, s.content)
  assert.equal(discardEditorDraft(s, registry, text => { s.content = text }), true)
  assert.equal(s.content, s.saved); assert.equal(registry.pending(), 0)
  await registry.flush()
})
test('a newer draft cannot be discarded by an older approval', () => {
  const registry = createEditorQuitRegistry(); registry.remember('a', 'newer')
  assert.equal(discardEditorDraft(state(), registry, () => assert.fail('must not reset')), false)
  assert.equal(registry.pending(), 1)
})
for (const change of [s => s.pending.push(Promise.resolve()), s => s.ready = false, s => s.id = null,
  s => s.content = undefined, s => s.saved = null, s => s.pending = null]) test('unsafe discard refuses without clearing any state: ' + change.toString(), () => {
  const registry = createEditorQuitRegistry(), s = state(); registry.remember('a', 'draft'); change(s)
  assert.equal(discardEditorDraft(s, registry, () => assert.fail('must not reset')), false)
  assert.equal(registry.pending(), 1)
})
test('same-content initialization does not leave an unresolved entry', async () => {
  const registry = createEditorQuitRegistry(); observeEditorDraft(registry, 'a', 'stored', 'stored', false)
  assert.equal(registry.pending(), 0); await registry.flush()
})
test('undo back to the confirmed baseline releases the latest draft', async () => {
  const registry = createEditorQuitRegistry(); observeEditorDraft(registry, 'a', 'draft', 'stored', false)
  assert.equal(registry.pending(), 1)
  observeEditorDraft(registry, 'a', 'stored', 'stored', false); await registry.flush()
})
test('undo while an older write is pending cannot falsely approve exit', async () => {
  const registry = createEditorQuitRegistry(); observeEditorDraft(registry, 'a', 'stored', 'stored', true)
  registry.saved('a', 'older write')
  await assert.rejects(registry.flush(), error => error.code === 'unresolved')
})
test('null editor notifications never create a dirty entry', async () => {
  const registry = createEditorQuitRegistry(); observeEditorDraft(registry, null, 'draft', '', false); await registry.flush()
})
test('a genuine failed current save still blocks exit', async () => {
  const registry = createEditorQuitRegistry(), s = state(); registry.remember('a', 'draft')
  registry.register(createEditorQuitParticipant({ snapshot: () => s, cache() {}, save: () => Promise.reject(new Error('offline')), registry }))
  await assert.rejects(registry.flush(), /offline/); assert.equal(registry.pending(), 1)
})
