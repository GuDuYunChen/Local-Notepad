// Verifier protocol contracts, not native Windows or product-keyboard evidence.
// The DOM describes real control ownership; the CDP boundary below explicitly
// models key receipts without dispatching forged trusted DOM events.
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { decoratorKeyboardKind, observeDecoratorKeyboardEntry, traverseDecoratorWithNativeKeys } from './full-app-ui-decorator-keyboard.mjs'
import { createFullAppUiShared } from './full-app-ui-shared.mjs'

function fixture(t, kind = 'callout', fault = null) {
  const callout = '<div class="callout-block"><div class="callout-header"><button class="callout-icon-btn" aria-label="选择提示图标" aria-expanded="false">💡</button></div><div class="callout-content"><textarea class="callout-textarea">原始提示正文</textarea></div></div>'
  const toggle = '<div class="toggle-block"><div class="toggle-header"><button class="toggle-arrow-button" aria-label="收起折叠块" aria-expanded="true">▶</button><input class="toggle-title-input" aria-label="折叠块标题" value="原始折叠标题"></div><div class="toggle-content"><textarea>原始折叠内容</textarea></div></div>'
  const dom = new JSDOM('<!doctype html><html><body><button class="workspace-title-button">合成编辑器笔记</button><div class="editor-input" contenteditable="true" role="textbox" tabindex="0"><p>未修改的原始正文</p>' + (kind === 'callout' ? callout : toggle) + '</div><button id="foreign">其它控件</button></body></html>', { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const { document } = dom.window
  const editor = document.querySelector('.editor-input'), block = editor.querySelector(kind === 'callout' ? '.callout-block' : '.toggle-block')
  const entry = block.querySelector('button'), next = block.querySelector(kind === 'callout' ? 'textarea' : 'input')
  const target = kind === 'callout' ? entry : next
  const selector = kind === 'callout' ? '[aria-label="选择提示图标"]' : '[aria-label="折叠块标题"]'
  const routeId = 'editor-' + kind, stateId = kind === 'callout' ? 'default' : 'expanded'
  let active = fault === 'initial-not-root' ? document.body : editor
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => active?.isConnected ? active : document.body })
  for (const node of [editor, entry, next]) {
    node.focus = () => assert.fail('The verifier must not focus its required controls')
    node.click = () => assert.fail('The verifier must not click its required controls')
  }
  const model = { root: { children: [{ type: 'paragraph', text: '未修改的原始正文', indent: 0 }, { type: kind, text: '未修改的节点正文' }] } }
  const state = { _selection: null, toJSON: () => model }
  editor.__lexicalEditor = { getRootElement: () => editor, getEditorState: () => state,
    update: () => assert.fail('The observer must never update Lexical') }
  const selection = document.getSelection()
  selection.removeAllRanges()
  if (kind === 'toggle') {
    const paragraph = editor.querySelector('p').firstChild
    selection.setBaseAndExtent(paragraph, 1, paragraph, 3)
    state._selection = { anchor: { key: 'text-key', offset: 1, type: 'text' }, focus: { key: 'text-key', offset: 3, type: 'text' }, format: 1, style: '' }
  }
  const initialModel = JSON.stringify(model), initialSelection = state._selection && structuredClone(state._selection)
  if (fault === 'disabled') next.disabled = true
  if (fault === 'duplicate') editor.append(block.cloneNode(true))
  const listeners = new Set(), add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
  document.addEventListener = (type, listener, options) => { if (type === 'keydown') listeners.add(listener); return add(type, listener, options) }
  document.removeEventListener = (type, listener, options) => { if (type === 'keydown') listeners.delete(listener); return remove(type, listener, options) }
  dom.window.__fullAppUiEvents = []; dom.window.__fullAppUiTraceTruncated = false
  const receipt = { ownerToken: 'decorator-contract:' + kind, kind, eventStart: 0 }, keys = [], saved = [], evaluations = []
  const evaluate = async source => {
    evaluations.push(source)
    return JSON.parse(JSON.stringify(await dom.window.eval(source)))
  }
  const key = async (name, modifiers = 0) => {
    keys.push([name, modifiers])
    if (fault === 'key-failure') throw Error('Modeled native input channel failure')
    const event = { type: 'keydown', key: name, target: active, isTrusted: fault !== 'untrusted',
      ctrlKey: false, altKey: false, metaKey: false, shiftKey: modifiers === 8,
      isComposing: false, keyCode: name === 'F6' ? 117 : 9, which: name === 'F6' ? 117 : 9 }
    for (const listener of listeners) listener(event)
    dom.window.__fullAppUiEvents.push({ type: 'keydown', key: name, trusted: fault !== 'untrusted' })
    if (name === 'F6') {
      if (fault !== 'no-entry') active = entry
      if (fault === 'content') model.root.children[0].indent = 1
      if (fault === 'value') next.value = '其它值'
      if (fault === 'dom-selection') selection.collapse(entry, 0)
      if (fault === 'logical-selection') state._selection = { anchor: { key: 'changed', offset: 0, type: 'element' }, focus: { key: 'changed', offset: 0, type: 'element' }, format: 0, style: '' }
      if (fault === 'owner-replaced') { const replacement = entry.cloneNode(true); entry.replaceWith(replacement); active = replacement }
      if (fault === 'dirty') { const dirty = document.createElement('span'); dirty.className = 'workspace-save-chip'; document.body.append(dirty) }
      if (fault === 'extra-click') dom.window.__fullAppUiEvents.push({ type: 'click', trusted: true })
      if (fault === 'trace-truncated') dom.window.__fullAppUiTraceTruncated = true
    } else {
      active = fault === 'nonadjacent-tab' ? document.querySelector('#foreign') : modifiers === 8 ? entry : next
      // A text field's native caret is not the preceding editor's DOM range.
      // This must not weaken the separate invariant on the original body.
      if (fault === 'input-caret') selection.collapse(next, 0)
    }
  }
  const save = () => saved.push(structuredClone(receipt))
  const run = () => traverseDecoratorWithNativeKeys({ key, evaluate, receipt, save })
  const observe = (action = 'read', keep = false) => dom.window.eval(`(${observeDecoratorKeyboardEntry.toString()})(${JSON.stringify(receipt.ownerToken)},${JSON.stringify(kind)},${JSON.stringify(action)},${keep})`)

  // Layout only exists in the protocol fixture. Production observeFullAppFocus
  // still reads the real installed window and keeps its original exact gates.
  const rect = { left: 0, top: 0, right: 704, bottom: 455, x: 0, y: 0, width: 704, height: 455 }
  for (const node of document.querySelectorAll('*')) {
    Object.assign(node.style, { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible',
      transform: 'none', perspective: 'none', filter: 'none', backdropFilter: 'none', translate: 'none', rotate: 'none', scale: 'none',
      contain: 'none', contentVisibility: 'visible', willChange: 'auto', outlineStyle: 'none', outlineWidth: '0px', boxShadow: 'none' })
    node.getBoundingClientRect = () => rect
    node.getClientRects = () => [rect]
    for (const [name, value] of Object.entries({ clientLeft: 0, clientTop: 0, clientWidth: 704, clientHeight: 455 })) Object.defineProperty(node, name, { configurable: true, value })
    node.scrollIntoView = () => assert.fail('The fixture control already fits')
  }
  target.style.outlineStyle = 'solid'; target.style.outlineWidth = '2px'; target.style.outlineColor = 'rgb(112, 87, 217)'
  if (fault === 'duplicate-glow') target.style.boxShadow = '0 0 0 2px rgb(112, 87, 217)'
  const matches = dom.window.Element.prototype.matches
  dom.window.Element.prototype.matches = function (value) {
    return value === ':focus-visible' ? this === active && fault !== 'focus-ring-hidden' : matches.call(this, value)
  }
  Object.defineProperty(dom.window, 'innerWidth', { value: 704 }); Object.defineProperty(dom.window, 'innerHeight', { value: 455 })
  document.elementFromPoint = () => fault === 'hit-obscured' ? document.body : target
  dom.window.requestAnimationFrame = callback => { callback(); return 1 }
  const report = { fullAppUi: { group: 'editor', focus: [] } }, commands = []
  const shared = createFullAppUiShared({ report, evaluate, routes: [{ id: routeId }], matrix: { theme: 'light', viewport: { width: 704, height: 455 } },
    click: () => assert.fail('Decorator focus must start with F6 from the body, without a field click'),
    until: () => assert.fail('No polling or waiting is needed in this exact key protocol'),
    capture: () => assert.fail('The keyboard protocol must not replace the original screenshots'), save: () => {},
    cdp: { send: async (method, params) => {
      commands.push({ method, ...params }); assert.equal(method, 'Input.dispatchKeyEvent')
      if (params.type === 'rawKeyDown') await key(params.key, params.modifiers)
    } },
  })
  const runShared = () => shared.focus(selector, { routeId, stateId })
  return { run, runShared, observe, receipt, keys, saved, evaluations, listeners, document, dom, editor, entry, next, state,
    model, initialModel, initialSelection, selector, routeId, stateId, report, commands }
}

test('only the original Callout default and Toggle expanded targets select the F6 route', () => {
  assert.equal(decoratorKeyboardKind('editor-callout', 'default', '[aria-label="选择提示图标"]'), 'callout')
  assert.equal(decoratorKeyboardKind('editor-toggle', 'expanded', '[aria-label="折叠块标题"]'), 'toggle')
  for (const args of [['editor-callout', 'icons', '[aria-label="选择提示图标"]'], ['editor-toggle', 'collapsed', '[aria-label="折叠块标题"]'],
    ['other', 'default', '[aria-label="选择提示图标"]'], ['editor-callout', 'default', '.callout-icon-btn']]) {
    assert.equal(decoratorKeyboardKind(...args), null)
  }
})

for (const kind of ['callout', 'toggle']) {
  test(`${kind} preserves original selection on F6 and proves both adjacent Tab directions`, async t => {
    const f = fixture(t, kind), result = await f.run()
    const expected = [['F6', 0], ['Tab', 0], ['Tab', 8]]
    if (kind === 'toggle') expected.push(['Tab', 0])
    assert.deepEqual(f.keys, expected)
    assert.equal(result.reached, true); assert.equal(result.nativeEntry, 'F6')
    assert.equal(result.reverseTabs, 1); assert.equal(result.forwardTabs, kind === 'toggle' ? 2 : 1)
    assert.equal(JSON.stringify(f.model), f.initialModel); assert.deepEqual(f.state._selection, f.initialSelection)
    assert.equal(result.disposal.disposed, true); assert.equal(result.disposal.identityRetained, true)
    assert.equal(f.listeners.size, 0); assert.equal(f.dom.window.__fullAppDecoratorKeyboardOwner, undefined)
    assert.ok(f.saved.some(item => item.reached === true && item.disposal?.disposed))
  })
  test(`${kind} runs through shared.focus without the old field click or generic Tab search`, async t => {
    const f = fixture(t, kind), result = await f.runShared()
    assert.equal(result.focused, true); assert.equal(result.focusVisible, true); assert.equal(result.trustedTab, true)
    assert.equal(result.nativeSourceOrder.kind, kind); assert.equal(result.nativeSourceOrder.reached, true)
    assert.equal(f.report.fullAppUi.focus.length, 1); assert.equal(f.report.fullAppUi.decoratorKeyboardEntries.length, 1)
    assert.equal(result.selector, f.selector); assert.equal(f.commands.length, kind === 'toggle' ? 8 : 6)
    assert.ok(f.commands.every(command => command.method === 'Input.dispatchKeyEvent'))
    assert.deepEqual(result.outlines.map(item => item.width), [2]); assert.deepEqual(result.shadows, [])
  })
  test(`${kind} keeps native input caret ownership after F6 without permitting body edits`, async t => {
    const f = fixture(t, kind, 'input-caret')
    assert.equal((await f.run()).reached, true)
    assert.equal(JSON.stringify(f.model), f.initialModel)
  })
}

for (const [fault, message] of [
  ['initial-not-root', /must own decorator F6 entry/],
  ['disabled', /enabled editable adjacent controls/], ['duplicate', /missing or ambiguous/],
  ['no-entry', /did not reach its adjacent control/], ['nonadjacent-tab', /did not reach its adjacent control/],
  ['content', /changed its original content/], ['value', /changed its original values/],
  ['dom-selection', /changed its original DOM or logical selection/], ['logical-selection', /changed its original DOM or logical selection/],
  ['owner-replaced', /owner identity was replaced/], ['dirty', /changed the clean note/],
  ['untrusted', /trusted unmodified owned keys/], ['trace-truncated', /global trace was truncated/],
  ['extra-click', /extra activation or edit/], ['key-failure', /native input channel failure/],
]) {
  test(`decorator keyboard refuses ${fault}, retains failure and disposes without a retry`, async t => {
    const f = fixture(t, 'callout', fault)
    await assert.rejects(f.run(), message)
    assert.equal(f.receipt.reached, false); assert.match(f.receipt.error.message, message)
    assert.equal(f.listeners.size, 0); assert.equal(f.dom.window.__fullAppDecoratorKeyboardOwner, undefined)
    assert.ok(f.saved.at(-1).error)
    if (['initial-not-root', 'disabled', 'duplicate'].includes(fault)) assert.equal(f.keys.length, 0)
    else assert.equal(f.keys.filter(([key]) => key === 'F6').length, 1)
  })
}

for (const fault of ['focus-ring-hidden', 'hit-obscured', 'duplicate-glow']) {
  test(`shared.focus retains its original ${fault} rejection after decorator key traversal`, async t => {
    const f = fixture(t, 'toggle', fault)
    await assert.rejects(f.runShared(), fault === 'duplicate-glow' ? /duplicate focus glow/ : /focus was not visible and reachable/)
    assert.equal(f.report.fullAppUi.decoratorKeyboardEntries[0].reached, true)
    assert.equal(f.listeners.size, 0)
  })
}
