import test from 'node:test'
import assert from 'node:assert/strict'
import { captureEditorDraftRecovery as capture, recoverEditorDraft as recover } from '../src/services/editorDraftRecovery.mjs'
import { createEditorSaveAttempt } from '../src/services/editorSaveTransaction.mjs'
const id = 'draft'
const draft = (base = 'base', text = 'local', attempt = null, conflicted = false) => ({
  content: text, editedAt: 1, recovery: capture(id, base, attempt, conflicted),
})
test('unconfirmed draft age never changes its persisted base or grants permission to overwrite', () => {
  const d = draft(), copy = structuredClone(d)
  assert.deepEqual(recover(id, d, 'base'), { content: 'local', expectedContent: 'base', attempt: null, review: false, recovered: true })
  assert.equal(recover(id, d, 'changed').review, true)
  assert.deepEqual(d, copy)
})
test('no timestamp or equality shortcut can release an outstanding immutable request', () => {
  const attempt = createEditorSaveAttempt(id, 'base', 'local')
  const r = recover(id, draft('base', 'base', attempt), 'base')
  assert.deepEqual(r.attempt, attempt); assert.equal(r.recovered, true)
  assert.equal(r.review, false); assert.ok(Object.isFrozen(r.attempt))
})
test('serializing a newer draft retains the earlier uncertain token and payload', () => {
  const attempt = createEditorSaveAttempt(id, 'base', 'first', [{from:['old'],to:['new']}])
  const serialized = JSON.parse(JSON.stringify(draft('base', 'newest', attempt)))
  assert.deepEqual(recover(id, serialized, 'first').attempt, attempt)
  assert.equal(recover(id, serialized, 'first').content, 'newest')
})
test('a clean matching read can retire a draft only when no uncertain request remains', () => {
  assert.equal(recover(id, draft('old', 'local'), 'local').recovered, false)
  assert.equal(recover(id, draft('local', 'local', createEditorSaveAttempt(id,'local','first')), 'local').recovered, true)
})
test('legacy and malformed provenance preserve text for review rather than silently writing', () => {
  for (const recovery of [undefined, null, {version:9}, {version:1,id:'other',expectedContent:'base',conflicted:false}, {version:1,id,expectedContent:10,conflicted:false}]) {
    const r = recover(id, {content:'old draft', editedAt:1,recovery}, 'base')
    assert.equal(r.content,'old draft'); assert.equal(r.review,true); assert.equal(r.attempt,null)
  }
})
test('foreign, malformed or oversized cached tokens are never replayed', () => {
  const good = createEditorSaveAttempt(id,'base','local')
  for (const change of [a=>a.id='another',a=>a.requestID='../',a=>a.requestID=42,a=>a.expected=null,a=>a.content={},a=>a.mappings='{}',a=>a.mappings=' '.repeat(65537),a=>a.mappings=JSON.stringify(Array(501).fill({}))]) {
    const a={...good};change(a)
    const d=draft();d.recovery={...d.recovery,attempt:a}
    const r=recover(id,d,'base');assert.equal(r.attempt,null);assert.equal(r.review,true)
  }
})
test('a saved-base comparison does not silently dismiss an explicitly tracked conflict', () => {
  assert.equal(recover(id,draft('base','local',null,true),'base').review,true)
})
test('missing or corrupt cached bodies never become an empty-body write', () => {
  for (const d of [null,undefined,false,[],{}, {content:null},{content:0},{content:{}}]) {
    const r=recover(id,d,'database');assert.equal(r.content,'database');assert.equal(r.recovered,false);assert.equal(r.attempt,null)
  }
})
test('capturing recovery information freezes a copy, not the mutable caller attempt', () => {
  const a={...createEditorSaveAttempt(id,'base','local')}, saved=capture(id,'base',a)
  const token=saved.attempt.requestID;a.requestID='changed';assert.equal(saved.attempt.requestID,token)
  assert.ok(Object.isFrozen(saved));assert.ok(Object.isFrozen(saved.attempt))
})
