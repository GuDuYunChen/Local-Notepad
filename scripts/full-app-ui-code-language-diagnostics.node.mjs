// Pure verifier evidence-retention contracts. The focus and native-key boundary
// is an explicit protocol model, not Windows, product or trusted-input proof.
// Original owner/content/traversal refusal contracts remain in shared.node.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { observeCodeLanguageKeyboardEntry, traverseCodeLanguageWithNativeKeys } from './full-app-ui-shared.mjs'

const endpointError = 'Code language keyboard original selection endpoints were replaced'
const ownerKey = '__fullAppCodeLanguageKeyboardOwner'

function fixture(t, fault = null) {
  const dom = new JSDOM(`<!doctype html><html><body><button class="workspace-title-button">Owned diagnostic note</button>
    <div class="editor-input" contenteditable="true" tabindex="0"><p class="original-text">unchanged original text</p>
      <div class="code-block-wrapper"><div class="code-block-header"><div><button class="language-selector-button">Plain Text</button></div>
        <div class="code-block-toolbar"><button>自动换行</button><button>复制</button></div></div>
        <textarea class="code-textarea">const original = 1;</textarea><pre class="code-preview">const original = 1;</pre></div>
    </div><p class="foreign">foreign text</p></body></html>`, { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const { document } = dom.window
  const editor = document.querySelector('.editor-input'), target = editor.querySelector('.language-selector-button')
  const next = editor.querySelector('.code-block-toolbar button'), paragraph = editor.querySelector('.original-text')
  let active = editor, deepText = null
  if (fault === 'deep-endpoint') {
    let parent = paragraph
    for (let i = 0; i < 70; i++) { const span = document.createElement('span'); parent.append(span); parent = span }
    deepText = document.createTextNode('deep unchanged text'); parent.append(deepText)
  }
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => active?.isConnected ? active : document.body })
  for (const node of [editor, target, next]) node.focus = () => assert.fail('The observer must never focus a control')
  const selection = document.getSelection()
  selection.removeAllRanges()
  if (fault === 'same-path-replacement') selection.collapse(paragraph.firstChild, 2)
  const originalHTML = editor.innerHTML, originalNode = selection.anchorNode
  const listeners = new Set(), add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
  document.addEventListener = (type, listener, options) => { if (type === 'keydown') listeners.add(listener); return add(type, listener, options) }
  document.removeEventListener = (type, listener, options) => { if (type === 'keydown') listeners.delete(listener); return remove(type, listener, options) }
  dom.window.__fullAppUiEvents = []; dom.window.__fullAppUiTraceTruncated = false
  const receipt = { ownerToken: 'code-language-diagnostic:1', eventStart: 0 }, calls = [], keys = [], saved = []
  let evaluationError = null
  const classify = source => source.includes('window.__fullAppUiEvents.slice(') ? 'trace' :
    source.endsWith(',"install")') ? 'install' : (source.endsWith(',"dispose")') || source.endsWith(",'dispose')")) ? 'dispose' : 'read'
  const evaluate = async source => {
    calls.push(classify(source))
    try { return JSON.parse(JSON.stringify(await dom.window.eval(source))) }
    catch (error) { evaluationError ||= error; throw error }
  }
  const key = async (name, modifiers = 0) => {
    keys.push([name, modifiers])
    // Model the browser-to-observer protocol directly; do not dispatch a fake
    // trusted DOM event or call the product's keyboard implementation.
    const event = { type: 'keydown', key: name, isTrusted: true, target: active, shiftKey: modifiers === 8,
      ctrlKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: name === 'F6' ? 117 : 9, which: name === 'F6' ? 117 : 9 }
    for (const listener of listeners) listener(event)
    dom.window.__fullAppUiEvents.push({ type: 'keydown', key: name, trusted: true })
    if (name === 'F6') {
      active = target
      if (fault === 'language-button' || fault === 'collection-error') selection.collapse(target, 0)
      if (fault === 'language-text') selection.collapse(target.firstChild, 2)
      if (fault === 'same-path-replacement') {
        const replacement = paragraph.firstChild.cloneNode(true)
        paragraph.firstChild.replaceWith(replacement); selection.collapse(replacement, 2)
      }
      if (fault === 'foreign-endpoint') selection.collapse(document.querySelector('.foreign').firstChild, 0)
      if (fault === 'deep-endpoint') selection.collapse(deepText, 1)
      if (fault === 'collection-error') Object.defineProperty(dom.window[ownerKey].snapshot, 'selection', {
        configurable: true, get: () => { throw Error('Only diagnostic collection should reach this injected failure') },
      })
    } else active = modifiers === 8 ? target : next
  }
  const save = () => saved.push(structuredClone(receipt))
  const run = () => traverseCodeLanguageWithNativeKeys({ key, evaluate, receipt, save })
  const observe = action => dom.window.eval(`(${observeCodeLanguageKeyboardEntry.toString()})(${JSON.stringify(receipt.ownerToken)},${JSON.stringify(action)})`)
  return { dom, document, editor, target, next, paragraph, selection, originalHTML, originalNode,
    receipt, calls, keys, saved, run, observe, listeners, evaluationError: () => evaluationError }
}

async function refused(f, message = endpointError) {
  await assert.rejects(f.run(), error => {
    assert.equal(error, f.evaluationError())
    assert.equal(error.message, message)
    return true
  })
  assert.equal(f.receipt.error.message, message)
  assert.equal(f.receipt.reached, false)
  assert.equal(f.receipt.nativeEntry, 'F6')
  assert.equal(f.receipt.forwardTabs, 0); assert.equal(f.receipt.reverseTabs, 0)
  assert.deepEqual(f.keys, [['F6', 0]])
  assert.deepEqual(f.calls, ['install', 'read', 'read', 'trace', 'dispose'])
  assert.equal(f.saved.length, 4)
  assert.deepEqual(f.receipt.observations.map(x => x.stage), ['initial'])
  assert.equal(f.receipt.disposal.disposed, true)
  assert.equal(f.receipt.disposal.identityRetained, true)
  assert.equal(f.listeners.size, 0)
  assert.equal(f.dom.window[ownerKey], undefined)
  assert.equal(f.editor.innerHTML, f.originalHTML)
  assert.deepEqual(f.saved.at(-1), f.receipt)
  return f.receipt.disposal.failureDiagnostic
}

test('failed empty-to-button observation retains its same-read endpoints through original disposal and save', async t => {
  const f = fixture(t, 'language-button'), diagnostic = await refused(f)
  assert.ok(diagnostic, 'The original endpoint refusal must also retain its failed observation')
  assert.equal(diagnostic.kind, 'selection-endpoint-identity')
  assert.equal(diagnostic.action, 'read')
  assert.equal(diagnostic.before.rangeCount, 0)
  assert.equal(diagnostic.before.anchor, null); assert.equal(diagnostic.before.focus, null)
  assert.equal(diagnostic.after.rangeCount, 1)
  assert.equal(diagnostic.after.anchor.type, 1); assert.equal(diagnostic.after.anchor.offset, 0)
  assert.equal(diagnostic.after.anchor.pathTruncated, false)
  assert.equal(diagnostic.anchorIdentityRetained, false); assert.equal(diagnostic.focusIdentityRetained, false)
  assert.equal(diagnostic.active, 'language')
  assert.equal(diagnostic.originalEndpoints.anchor, null)
  assert.equal(diagnostic.observedEndpoints.anchor.nodeName, 'BUTTON')
  assert.equal(diagnostic.observedEndpoints.anchor.role, 'language')
  assert.equal(diagnostic.observedEndpoints.anchor.connectedAtFailure, true)
  assert.equal(diagnostic.observedEndpoints.anchor.sameOwnerDocument, true)
  assert.equal(diagnostic.captureFailed, undefined)
})

test('failed empty-to-text observation distinguishes language descendants without copying text or markup', async t => {
  const f = fixture(t, 'language-text'), diagnostic = await refused(f)
  assert.ok(diagnostic, 'Failed text endpoints must be retained')
  assert.equal(diagnostic.after.anchor.type, 3); assert.equal(diagnostic.after.anchor.offset, 2)
  assert.equal(diagnostic.observedEndpoints.anchor.nodeName, '#text')
  assert.equal(diagnostic.observedEndpoints.anchor.role, 'language-descendant')
  const wire = JSON.stringify(diagnostic)
  assert.equal(wire.includes('Plain Text'), false)
  assert.equal(wire.includes('const original'), false)
  assert.equal(wire.includes('innerHTML'), false)
  assert.equal(wire.includes('textContent'), false)
})

test('same-path same-content endpoint replacement still throws and records lost node identity', async t => {
  const f = fixture(t, 'same-path-replacement'), diagnostic = await refused(f)
  assert.ok(diagnostic, 'Equal endpoint paths must not hide reference replacement')
  assert.deepEqual(diagnostic.before.anchor, diagnostic.after.anchor)
  assert.equal(diagnostic.anchorIdentityRetained, false)
  assert.equal(diagnostic.focusIdentityRetained, false)
  assert.equal(diagnostic.originalEndpoints.anchor.connectedAtFailure, false)
  assert.equal(diagnostic.observedEndpoints.anchor.connectedAtFailure, true)
  assert.notEqual(f.selection.anchorNode, f.originalNode)
})

test('only the first failed endpoint observation is retained for an owned observer', t => {
  const f = fixture(t)
  f.observe('install')
  f.selection.collapse(f.target, 0)
  assert.throws(() => f.observe('read'), error => error.message === endpointError)
  const first = f.dom.window[ownerKey].failureDiagnostic
  assert.ok(first, 'The first failure must be captured before the original throw')
  const frozen = JSON.stringify(first)
  f.selection.collapse(f.next, 0)
  assert.throws(() => f.observe('read'), error => error.message === endpointError)
  assert.equal(f.dom.window[ownerKey].failureDiagnostic, first)
  assert.equal(JSON.stringify(first), frozen)
  const disposal = f.observe('dispose')
  assert.equal(JSON.stringify(disposal.failureDiagnostic), frozen)
  assert.equal(f.listeners.size, 0); assert.equal(f.dom.window[ownerKey], undefined)
})

test('diagnostic collection failure cannot replace the original endpoint error or prevent cleanup', async t => {
  const f = fixture(t, 'collection-error'), diagnostic = await refused(f)
  assert.ok(diagnostic, 'A bounded unavailable marker must survive a diagnostic-only failure')
  assert.deepEqual(diagnostic, { schemaVersion: 1, kind: 'selection-endpoint-identity', action: 'read', captureFailed: true })
  assert.equal(f.receipt.cleanupError, undefined)
  assert.equal(f.receipt.saveError, undefined)
})

test('successful original F6 and adjacent Tab protocol adds no diagnostic field or extra read/save', async t => {
  const f = fixture(t), receipt = await f.run()
  assert.equal(receipt, f.receipt); assert.equal(receipt.reached, true)
  assert.deepEqual(f.keys, [['F6', 0], ['Tab', 0], ['Tab', 8]])
  assert.deepEqual(f.calls, ['install', 'read', 'read', 'read', 'read', 'read', 'read', 'trace', 'dispose'])
  assert.equal(f.saved.length, 9)
  assert.deepEqual(receipt.observations.map(x => x.stage), ['initial', 'entered', 'forward', 'returned'])
  assert.deepEqual(Object.keys(receipt.disposal), ['disposed', 'ownerToken', 'identityRetained', 'ownedEvents', 'ownedTraceTruncated'])
  assert.equal(Object.hasOwn(receipt.disposal, 'failureDiagnostic'), false)
  assert.equal(JSON.stringify(receipt).includes('failureDiagnostic'), false)
  assert.equal(f.selection.rangeCount, 0)
  assert.equal(f.editor.innerHTML, f.originalHTML)
  assert.equal(f.listeners.size, 0); assert.equal(f.dom.window[ownerKey], undefined)
})

test('earlier out-of-editor selection refusal is unchanged and is not relabeled as endpoint diagnostics', async t => {
  const f = fixture(t, 'foreign-endpoint')
  const diagnostic = await refused(f, 'Code language keyboard selection left its editor')
  assert.equal(diagnostic, undefined)
  assert.equal(Object.hasOwn(f.receipt.disposal, 'failureDiagnostic'), false)
})

test('failed endpoint paths have an explicit fixed bound and truncation marker', async t => {
  const f = fixture(t, 'deep-endpoint'), diagnostic = await refused(f)
  assert.ok(diagnostic, 'The failed deep endpoint must retain a bounded description')
  for (const point of [diagnostic.after.anchor, diagnostic.after.focus]) {
    assert.equal(point.path.length, 64)
    assert.ok(point.pathLength > 64)
    assert.equal(point.pathTruncated, true)
    assert.equal(point.type, 3); assert.equal(point.offset, 1)
  }
  assert.equal(diagnostic.observedEndpoints.anchor.role, 'editor-descendant')
  assert.ok(diagnostic.observedEndpoints.anchor.nodeName.length <= 64)
  assert.ok(JSON.stringify(diagnostic).length < 4096)
})
