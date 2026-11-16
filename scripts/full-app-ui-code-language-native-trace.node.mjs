// Verifier retention/cleanup contracts, not a native-input or product-cause
// reproduction. Call the actual observer/traversal against an explicit protocol
// model; the model's trusted flags and Lexical metadata are never Windows proof.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { observeCodeLanguageKeyboardEntry, traverseCodeLanguageWithNativeKeys } from './full-app-ui-shared.mjs'

const ownerKey = '__fullAppCodeLanguageKeyboardOwner'
const endpointError = 'Code language keyboard original selection endpoints were replaced'

function fixture(t, mode = 'root-div') {
  const dom = new JSDOM(`<!doctype html><html><body><button class="workspace-title-button">Private fixture title</button>
    <div class="editor-input" contenteditable="true" tabindex="0"><p>Private original paragraph</p>
      <div class="code-block-wrapper"><div class="code-block-header"><div><button class="language-selector-button">Plain Text</button></div>
        <div class="code-block-toolbar"><button>自动换行</button><button>复制</button></div></div>
        <textarea class="code-textarea">const privateCode = 1;</textarea><pre class="code-preview">const privateCode = 1;</pre></div></div>
    </body></html>`, { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const { document } = dom.window, editor = document.querySelector('.editor-input')
  const target = editor.querySelector('.language-selector-button'), next = editor.querySelector('.code-block-toolbar button')
  let active = editor, firstEvaluationError = null, getterCalls = 0, registered = 0, unregistered = 0, serializedBoundaryPayload = null
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => active })
  const selection = document.getSelection(), collapse = selection.collapse.bind(selection)
  selection.removeAllRanges()
  for (const name of ['collapse', 'removeAllRanges', 'addRange', 'setBaseAndExtent']) {
    Object.defineProperty(selection, name, { configurable: true, value() { assert.fail('Observer mutated Selection: ' + name) } })
  }
  for (const node of [editor, target, next]) node.focus = () => assert.fail('Observer focused a real control')
  const originalHTML = editor.innerHTML, listeners = new Set(), updates = new Set()
  for (const node of [document, editor]) {
    const add = node.addEventListener.bind(node), remove = node.removeEventListener.bind(node)
    node.addEventListener = (type, callback, options) => {
      if (['keydown', 'keyup', 'selectionchange'].includes(type)) listeners.add({ node, type, callback, capture: !!(typeof options === 'boolean' ? options : options?.capture) })
      return add(type, callback, options)
    }
    node.removeEventListener = (type, callback, options) => {
      const capture = !!(typeof options === 'boolean' ? options : options?.capture)
      for (const row of listeners) if (row.node === node && row.type === type && row.callback === callback && row.capture === capture) listeners.delete(row)
      const result = remove(type, callback, options)
      if (mode === 'cleanup-failure' && type === 'selectionchange') throw Error('modeled removal failed after actual listener removal')
      return result
    }
  }
  const logical = (offset, dirty = false) => ({ anchor: { key: 'private-logical-root-key', type: 'element', offset },
    focus: { key: 'private-logical-root-key', type: 'element', offset }, dirty })
  const lexical = { _rootElement: editor, _editorState: { _selection: logical(0) }, _pendingEditorState: null,
    _dirtyType: 0, _updateTags: new dom.window.Set(),
    registerUpdateListener(callback) {
      if (mode === 'registration-failure') throw Error('modeled registration failed before mutation')
      updates.add(callback); registered++
      return () => { updates.delete(callback); unregistered++ }
    },
    read() { assert.fail('Observer must not flush editor.read') }, update() { assert.fail('Observer must not call editor.update') },
    focus() { assert.fail('Observer must not call editor.focus') }, getEditorState() { assert.fail('Observer must read metadata without calling product methods') } }
  if (mode === 'foreign-editor') lexical._rootElement = document.body
  if (mode === 'metadata-accessor') Object.defineProperty(lexical._editorState, '_selection', {
    configurable: true, get() { getterCalls++; throw Error('must not invoke a metadata accessor') } })
  if (mode !== 'missing-editor') Object.defineProperty(editor, '__lexicalEditor', { configurable: true, writable: true, value: lexical })
  dom.window.__fullAppUiEvents = []; dom.window.__fullAppUiTraceTruncated = false
  const receipt = { ownerToken: 'native-trace-contract:1', eventStart: 0 }, calls = [], keys = [], saved = []
  const classify = source => source.includes('window.__fullAppUiEvents.slice(') ? 'trace' :
    source.endsWith(',"install")') ? 'install' : (source.endsWith(',"dispose")') || source.endsWith(",'dispose')")) ? 'dispose' : 'read'
  const evaluate = async source => {
    const action = classify(source)
    calls.push(action)
    try {
      const value = JSON.parse(JSON.stringify(await dom.window.eval(source)))
      // Exact transport-boundary model: extend only the already returned plain
      // diagnostic, after the actual observer disposed. This is not an event
      // producer, a DOM mutation, or evidence of a Windows-sized trace.
      if (action === 'dispose' && mode.startsWith('serialized-limit-') && value.nativeTrace) {
        const limit = Number(mode.slice('serialized-limit-'.length))
        value.nativeTrace.boundaryPadding = ''
        const fixedBytes = Buffer.byteLength(JSON.stringify(value.nativeTrace), 'utf8')
        assert.ok(fixedBytes < limit)
        value.nativeTrace.boundaryPadding = 'x'.repeat(limit - fixedBytes)
        serializedBoundaryPayload = JSON.stringify(value.nativeTrace)
        assert.equal(Buffer.byteLength(serializedBoundaryPayload, 'utf8'), limit)
      }
      return value
    }
    catch (error) { firstEvaluationError ||= error; throw error }
  }
  const notify = (node, type, event, capture) => {
    for (const row of [...listeners]) if (row.node === node && row.type === type && row.capture === capture) row.callback(event)
  }
  const commit = () => {
    const editorState = lexical._pendingEditorState, tags = new dom.window.Set(lexical._updateTags)
    lexical._editorState = editorState; lexical._pendingEditorState = null; lexical._dirtyType = 0; lexical._updateTags.clear()
    for (const update of [...updates]) update({ editorState, tags, dirtyElements: new dom.window.Map(), dirtyLeaves: new dom.window.Set() })
  }
  const key = async (name, modifiers = 0) => {
    keys.push([name, modifiers])
    // Direct delivery to the observer's actual callback registrations is a
    // protocol model. It is not dispatchEvent/isTrusted/native-input evidence.
    const event = { type: 'keydown', key: name, isTrusted: true, eventPhase: 1, defaultPrevented: false,
      target: active, shiftKey: modifiers === 8, ctrlKey: false, altKey: false, metaKey: false,
      isComposing: false, keyCode: name === 'F6' ? 117 : 9, which: name === 'F6' ? 117 : 9 }
    notify(document, 'keydown', event, true)
    dom.window.__fullAppUiEvents.push({ type: 'keydown', key: name, trusted: true })
    if (name === 'F6') {
      if (mode === 'truncation') for (let i = 0; i < 70; i++) notify(document, 'selectionchange', {
        type: 'selectionchange', isTrusted: true, eventPhase: 2, target: document, defaultPrevented: false }, true)
      active = target
      if (mode !== 'success') collapse(editor, 0)
      if (mode === 'replaced-editor') editor.__lexicalEditor = { ...lexical }
      if (['pending-before-tail', 'commit-before-tail'].includes(mode)) {
        lexical._pendingEditorState = { _selection: logical(0, true) }; lexical._dirtyType = 1
        lexical._updateTags.add('skip-dom-selection')
      }
      if (mode === 'commit-before-tail') commit()
      event.eventPhase = 3; notify(editor, 'keydown', event, false)
      if (mode === 'pending-before-tail') commit()
      notify(document, 'selectionchange', { type: 'selectionchange', isTrusted: true, eventPhase: 2,
        target: document, defaultPrevented: false }, true)
      notify(document, 'keyup', { ...event, type: 'keyup', eventPhase: 1, target: active }, true)
    } else active = modifiers === 8 ? target : next
  }
  const save = () => saved.push(structuredClone(receipt))
  const run = () => traverseCodeLanguageWithNativeKeys({ key, evaluate, receipt, save })
  const observe = action => dom.window.eval(`(${observeCodeLanguageKeyboardEntry.toString()})(${JSON.stringify(receipt.ownerToken)},${JSON.stringify(action)})`)
  return { dom, document, editor, target, selection, collapse, lexical, receipt, calls, keys, saved, listeners, updates,
    run, observe, key, originalHTML, firstEvaluationError: () => firstEvaluationError,
    counters: () => ({ getterCalls, registered, unregistered }), serializedBoundaryPayload: () => serializedBoundaryPayload }
}

function verifyHash(native) {
  assert.ok(native, 'The original endpoint refusal must also retain its bounded native trace')
  const { sha256, bytes, ...plain } = native, encoded = Buffer.from(JSON.stringify(plain), 'utf8')
  assert.equal(bytes, encoded.length); assert.ok(bytes <= 65536)
  assert.equal(sha256, createHash('sha256').update(encoded).digest('hex'))
}
async function refused(f, verifyRetainedMetadata = true) {
  await assert.rejects(f.run(), error => { assert.equal(error, f.firstEvaluationError()); assert.equal(error.message, endpointError); return true })
  assert.equal(f.receipt.error.message, endpointError); assert.equal(f.receipt.reached, false)
  assert.deepEqual(f.keys, [['F6', 0]]); assert.deepEqual(f.calls, ['install', 'read', 'read', 'trace', 'dispose'])
  assert.equal(f.saved.length, 4); assert.deepEqual(f.saved.at(-1), f.receipt)
  assert.equal(f.receipt.forwardTabs, 0); assert.equal(f.receipt.reverseTabs, 0)
  assert.equal(f.receipt.disposal.failureDiagnostic.after.anchor.path.length, 0)
  assert.equal(f.receipt.disposal.failureDiagnostic.after.anchor.offset, 0)
  assert.equal(f.receipt.disposal.failureDiagnostic.observedEndpoints.anchor.role, 'editor')
  assert.equal(f.receipt.disposal.ownedTraceTruncated, false); assert.equal(f.receipt.disposal.ownedEvents.length, 1)
  assert.equal(f.dom.window[ownerKey], undefined); assert.equal(f.listeners.size, 0); assert.equal(f.updates.size, 0)
  assert.equal(f.editor.innerHTML, f.originalHTML)
  if (verifyRetainedMetadata) verifyHash(f.receipt.disposal.nativeTrace)
  return f.receipt.disposal.nativeTrace
}

test('original empty-to-editor-DIV refusal keeps one hashed anonymous event trace and original calls/save count', async t => {
  const f = fixture(t), native = await refused(f)
  assert.equal(native.available, true); assert.equal(native.observationComplete, true); assert.equal(native.productAccepted, false)
  assert.equal(native.originalWindowsProducerProven, false)
  const capture = native.rows.find(row => row.stage === 'document-keydown-capture')
  const read = native.rows.find(row => row.stage === 'first-read-after-f6')
  assert.equal(capture.dom.rangeCount, 0); assert.equal(capture.dom.anchor, null)
  assert.equal(read.dom.rangeCount, 1); assert.equal(read.dom.anchor.role, 'editor'); assert.equal(read.dom.anchor.offset, 0)
  assert.equal(read.dom.active, 'language'); assert.equal(native.cleanup.remaining, 0)
  const wire = JSON.stringify(native)
  for (const forbidden of ['Private fixture title', 'Private original paragraph', 'const privateCode', 'private-logical-root-key', 'innerHTML', 'textContent']) assert.equal(wire.includes(forbidden), false)
})

test('a controlled pending-before-tail protocol retains both pending and later committed metadata without flushing', async t => {
  const native = await refused(fixture(t, 'pending-before-tail'))
  const tail = native.rows.find(row => row.stage === 'root-keydown-tail'), commit = native.rows.find(row => row.stage === 'lexical-committed-update')
  assert.ok(tail.sequence < commit.sequence); assert.ok(tail.pending); assert.equal(tail.pending.selection.dirty, true)
  assert.deepEqual(tail.pendingTags.known, ['skip-dom-selection']); assert.equal(commit.pending, null)
  assert.equal(commit.committed.id, commit.current.id); assert.deepEqual(commit.committed.tags.known, ['skip-dom-selection'])
  assert.equal(native.observationComplete, true)
})

test('a controlled commit-before-tail protocol is distinguishable without assigning it to the real Windows producer', async t => {
  const native = await refused(fixture(t, 'commit-before-tail'))
  const tail = native.rows.find(row => row.stage === 'root-keydown-tail'), commit = native.rows.find(row => row.stage === 'lexical-committed-update')
  assert.ok(commit.sequence < tail.sequence); assert.equal(tail.pending, null); assert.equal(commit.current.id, tail.current.id)
  assert.equal(native.observationComplete, true)
})

for (const mode of ['missing-editor', 'foreign-editor']) test(mode + ' is explicit unavailable metadata and never replaces the original refusal', async t => {
  const native = await refused(fixture(t, mode))
  assert.equal(native.available, false); assert.equal(native.unavailableReason, 'lexical-owner-missing-or-foreign')
  assert.equal(native.observationComplete, false); assert.deepEqual(native.rows, []); assert.equal(native.cleanup.installed, 0)
})

test('a replaced Lexical owner is never rebound or accepted as a complete trace', async t => {
  const native = await refused(fixture(t, 'replaced-editor'))
  assert.equal(native.ownerChanged, true); assert.equal(native.observationComplete, false); assert.ok(native.captureErrors > 0)
  assert.equal(native.cleanup.remaining, 0)
})

test('metadata accessors are not executed and unavailable snapshots cannot replace the original endpoint error', async t => {
  const f = fixture(t, 'metadata-accessor'), native = await refused(f)
  assert.equal(f.counters().getterCalls, 0); assert.ok(native.captureErrors > 0)
  assert.equal(native.observationComplete, false); assert.equal(native.cleanup.remaining, 0)
})

test('64 native sampling attempts truncate only the new trace, leaving original ownedEvents/ownedTraceTruncated intact', async t => {
  const native = await refused(fixture(t, 'truncation'))
  assert.equal(native.truncated, true); assert.equal(native.attempts, 64); assert.ok(native.rows.length <= 64)
  assert.equal(native.observationComplete, false); assert.equal(native.cleanup.remaining, 0)
})

test('exactly 65536 metadata bytes retain their digest in the original disposal/save response', async t => {
  const f = fixture(t, 'serialized-limit-65536'), native = await refused(f)
  assert.equal(native.bytes, 65536); assert.equal(native.available, true); assert.equal(native.observationComplete, true)
  assert.equal(native.sha256, createHash('sha256').update(f.serializedBoundaryPayload()).digest('hex'))
  assert.equal(native.originalWindowsProducerProven, false)
})

test('65537 metadata bytes become a bounded unavailable digest without replacing the original endpoint refusal', async t => {
  const f = fixture(t, 'serialized-limit-65537'), native = await refused(f, false)
  assert.ok(native, 'The original refusal must retain an explicit metadata-limit result')
  assert.equal(native.bytes, 65537); assert.equal(native.sha256, createHash('sha256').update(f.serializedBoundaryPayload()).digest('hex'))
  assert.equal(native.available, false); assert.equal(native.unavailableReason, 'serialized-metadata-limit')
  assert.equal(native.payloadRetained, false); assert.equal(native.truncated, true); assert.equal(native.observationComplete, false)
  assert.equal(native.productAccepted, false); assert.equal(native.originalWindowsProducerProven, false)
  assert.equal(native.rows, undefined); assert.equal(native.boundaryPadding, undefined)
  assert.ok(Buffer.byteLength(JSON.stringify(native), 'utf8') < 1024)
})

test('a registration exception is unavailable and conservatively refuses unproven trace cleanup without replacing the first error', async t => {
  const f = fixture(t, 'registration-failure'), native = await refused(f)
  assert.equal(native.available, false); assert.equal(native.unavailableReason, 'native-trace-registration-failed')
  assert.equal(native.registrationCleanupUnknown, true); assert.equal(native.observationComplete, false)
  assert.equal(f.receipt.disposal.disposed, false); assert.ok(f.receipt.cleanupError)
})

test('one trace disposer failure still runs all other removers and preserves the original endpoint exception', async t => {
  const f = fixture(t, 'cleanup-failure'), native = await refused(f)
  assert.equal(f.receipt.disposal.disposed, false); assert.ok(f.receipt.cleanupError)
  assert.equal(native.cleanup.errors, 1); assert.equal(native.observationComplete, false)
  assert.deepEqual(f.counters(), { getterCalls: 0, registered: 1, unregistered: 1 })
})

test('the first failed read freezes event rows and later reads cannot replace its observations', async t => {
  const f = fixture(t)
  f.observe('install'); f.observe('read'); await f.key('F6')
  assert.throws(() => f.observe('read'), error => error.message === endpointError)
  const native = f.dom.window[ownerKey].nativeTrace
  assert.ok(native, 'The original refusal must retain its new native trace before any repeated read')
  const rows = JSON.stringify(native.rows)
  f.collapse(f.target, 0)
  assert.throws(() => f.observe('read'), error => error.message === endpointError)
  assert.equal(JSON.stringify(native.rows), rows)
  const result = f.observe('dispose')
  assert.equal(JSON.stringify(result.nativeTrace.rows), rows); assert.equal(result.disposed, true)
  assert.equal(f.listeners.size, 0); assert.equal(f.updates.size, 0); assert.equal(f.dom.window[ownerKey], undefined)
})

test('a successful original traversal returns no new trace field and cleans the owned observer with the same actions', async t => {
  const f = fixture(t, 'success'), receipt = await f.run()
  assert.equal(receipt.reached, true); assert.deepEqual(f.keys, [['F6', 0], ['Tab', 0], ['Tab', 8]])
  assert.deepEqual(f.calls, ['install', 'read', 'read', 'read', 'read', 'read', 'read', 'trace', 'dispose']); assert.equal(f.saved.length, 9)
  assert.deepEqual(Object.keys(receipt.disposal), ['disposed', 'ownerToken', 'identityRetained', 'ownedEvents', 'ownedTraceTruncated'])
  assert.equal(JSON.stringify(receipt).includes('nativeTrace'), false)
  assert.equal(f.listeners.size, 0); assert.equal(f.updates.size, 0); assert.equal(f.dom.window[ownerKey], undefined)
  assert.deepEqual(f.counters(), { getterCalls: 0, registered: 1, unregistered: 1 })
  assert.equal(f.editor.innerHTML, f.originalHTML)
})
