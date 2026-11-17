import assert from 'node:assert/strict'

// Only these two unchanged route targets opt into the product's F6 entry.
// Other controls continue through their original shared.focus path.
export function decoratorKeyboardKind(routeId, stateId, selector) {
  if (routeId === 'editor-callout' && stateId === 'default' && selector === '[aria-label="选择提示图标"]') return 'callout'
  if (routeId === 'editor-toggle' && stateId === 'expanded' && selector === '[aria-label="折叠块标题"]') return 'toggle'
  return null
}

// Serialized into the installed renderer. This observer never focuses, clicks,
// changes a Selection or calls editor.update. All input comes from native CDP
// key events in traverseDecoratorWithNativeKeys below.
export function observeDecoratorKeyboardEntry(ownerToken, kind, action = 'read', retainSelection = false) {
  const storageKey = '__fullAppDecoratorKeyboardOwner'
  const owned = window[storageKey]
  const configs = {
    callout: { block: '.callout-block', entry: '.callout-header .callout-icon-btn', next: '.callout-content .callout-textarea', fieldTag: 'TEXTAREA' },
    toggle: { block: '.toggle-block', entry: '.toggle-header .toggle-arrow-button', next: '.toggle-header .toggle-title-input', fieldTag: 'INPUT' },
  }
  const config = configs[kind]
  if (!config || typeof ownerToken !== 'string' || !ownerToken) throw Error('Decorator keyboard observer identity is invalid')
  const sameOwner = state => {
    const { editor, block, entry, next } = state.refs
    return Object.values(state.refs).every(node => node?.isConnected) &&
      document.querySelectorAll('.editor-input[contenteditable="true"]').length === 1 &&
      document.querySelector('.editor-input[contenteditable="true"]') === editor &&
      editor.querySelectorAll(config.block).length === 1 && editor.querySelector(config.block) === block &&
      block.querySelectorAll(config.entry).length === 1 && block.querySelector(config.entry) === entry &&
      block.querySelectorAll(config.next).length === 1 && block.querySelector(config.next) === next
  }
  if (action === 'dispose') {
    if (!owned) return { disposed: true, absent: true, ownerToken, kind }
    if (owned.ownerToken !== ownerToken || owned.kind !== kind) throw Error('Decorator keyboard observer token changed')
    try {
      document.removeEventListener('keydown', owned.onKey, true)
      return { disposed: true, ownerToken, kind, identityRetained: sameOwner(owned),
        ownedEvents: owned.events.slice(), ownedTraceTruncated: owned.truncated }
    } finally { delete window[storageKey] }
  }
  if (!['read', 'install'].includes(action)) throw Error('Decorator keyboard observer operation is invalid')
  const one = (parent, selector) => {
    const matches = parent.querySelectorAll(selector)
    if (matches.length !== 1) throw Error('Decorator keyboard owner missing or ambiguous: ' + selector)
    return matches[0]
  }
  const editor = one(document, '.editor-input[contenteditable="true"]')
  const block = one(editor, config.block), entry = one(block, config.entry), next = one(block, config.next)
  const refs = { editor, block, entry, next }
  if (action === 'read') {
    if (!owned || owned.ownerToken !== ownerToken || owned.kind !== kind) throw Error('Decorator keyboard observer token changed')
    if (Object.keys(refs).some(name => refs[name] !== owned.refs[name])) throw Error('Decorator keyboard owner identity was replaced')
  }
  if (!Object.values(refs).every(node => node.isConnected) || block.closest('.editor-input[contenteditable]') !== editor ||
      entry.tagName !== 'BUTTON' || next.tagName !== config.fieldTag || entry.disabled || next.disabled || next.readOnly ||
      entry.tabIndex < 0 || next.tabIndex < 0 || entry.closest(config.block) !== block || next.closest(config.block) !== block) {
    throw Error('Decorator keyboard does not own enabled editable adjacent controls')
  }
  if (kind === 'callout' && (entry.getAttribute('aria-expanded') !== 'false' || block.querySelector('.callout-icon-picker'))) {
    throw Error('Decorator keyboard unexpectedly opened the icon picker')
  }
  if (kind === 'toggle' && (entry.getAttribute('aria-expanded') !== 'true' || !block.querySelector('.toggle-content'))) {
    throw Error('Decorator keyboard changed the expanded block')
  }
  if (document.querySelector('.workspace-save-chip,.editor-unapplied-draft-pill,.save-state.error,.save-state.saving,.quit-save-veil,.consumer-confirm-modal')) {
    throw Error('Decorator keyboard changed the clean note or entered a pending action')
  }
  const lexical = editor.__lexicalEditor
  if (!lexical || typeof lexical.getRootElement !== 'function' || lexical.getRootElement() !== editor ||
      typeof lexical.getEditorState !== 'function') throw Error('Decorator keyboard actual Lexical owner is unavailable')
  const state = lexical.getEditorState()
  const selection = document.getSelection()
  if (!selection || selection.rangeCount > 1) throw Error('Decorator keyboard selection is unavailable or ambiguous')
  const point = (node, offset) => {
    if (!node) return null
    if (node !== editor && !editor.contains(node)) return { outsideEditor: true, type: node.nodeType, offset }
    const path = [], type = node.nodeType
    while (node !== editor) { const parent = node.parentNode; path.unshift([...parent.childNodes].indexOf(node)); node = parent }
    return { path, type, offset }
  }
  const logical = state._selection
  const logicalPoint = value => value && ({ key: value.key, offset: value.offset, type: value.type })
  if (logical !== null && (!logical?.anchor || !logical?.focus)) throw Error('Decorator keyboard logical selection is not a range')
  const selectionSnapshot = {
    rangeCount: selection.rangeCount, collapsed: selection.isCollapsed, text: selection.toString(),
    anchor: point(selection.anchorNode, selection.anchorOffset), focus: point(selection.focusNode, selection.focusOffset),
    logical: logical === null ? null : { anchor: logicalPoint(logical.anchor), focus: logicalPoint(logical.focus), format: logical.format, style: logical.style },
  }
  const snapshot = {
    content: JSON.stringify(state), documentTitle: one(document, '.workspace-title-button').textContent.trim(),
    values: [...block.querySelectorAll('input,textarea')].map(field => ({ tag: field.tagName, value: field.value, readOnly: field.readOnly, disabled: field.disabled })),
    entryText: entry.textContent.trim(), expanded: entry.getAttribute('aria-expanded'),
  }
  if (action === 'install') {
    if (owned) throw Error('Decorator keyboard previous observer was not disposed')
    if (selectionSnapshot.anchor?.outsideEditor || selectionSnapshot.focus?.outsideEditor) throw Error('Decorator keyboard entry selection is outside its editor')
    const installed = { ownerToken, kind, refs, snapshot, selectionSnapshot,
      selectionNodes: [selection.anchorNode, selection.focusNode], events: [], truncated: false, onKey: null }
    installed.onKey = event => {
      if (installed.events.length >= 8) { installed.truncated = true; return }
      const name = node => node === editor ? 'editor' : node === entry ? 'entry' : node === next ? 'next' : 'other'
      installed.events.push({ type: event.type, key: event.key, trusted: event.isTrusted,
        target: name(event.target), active: name(document.activeElement), shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
        composing: event.isComposing || event.keyCode === 229 || event.which === 229 })
    }
    window[storageKey] = installed
    document.addEventListener('keydown', installed.onKey, { capture: true, passive: true })
  } else {
    for (const name of Object.keys(snapshot)) if (JSON.stringify(snapshot[name]) !== JSON.stringify(owned.snapshot[name])) {
      throw Error('Decorator keyboard changed its original ' + name)
    }
    // F6 leaves the original editor selection intact. Native Tab into a text
    // input then owns that input's caret/selection, while the original body,
    // control values and clean-save gates remain invariant throughout.
    if (retainSelection && (owned.selectionNodes[0] !== selection.anchorNode || owned.selectionNodes[1] !== selection.focusNode ||
        JSON.stringify(selectionSnapshot) !== JSON.stringify(owned.selectionSnapshot))) {
      throw Error('Decorator F6 entry changed its original DOM or logical selection')
    }
  }
  const installed = window[storageKey]
  return { ...snapshot, selection: selectionSnapshot, ownerToken, kind, ownerReady: true,
    active: document.activeElement === editor ? 'editor' : document.activeElement === entry ? 'entry' : document.activeElement === next ? 'next' : 'other',
    ownedEvents: installed.events.slice(), ownedTraceTruncated: installed.truncated }
}

export async function traverseDecoratorWithNativeKeys({ key, evaluate, receipt, save }) {
  assert.ok(['callout', 'toggle'].includes(receipt.kind), 'Unknown decorator keyboard route')
  Object.assign(receipt, { nativeEntry: null, forwardTabs: 0, reverseTabs: 0, reached: false,
    observations: [], inputs: [], ownerInstalled: false })
  let failure = null
  const expression = (action, retainSelection = false) => `(${observeDecoratorKeyboardEntry.toString()})(${JSON.stringify(receipt.ownerToken)},${JSON.stringify(receipt.kind)},${JSON.stringify(action)},${retainSelection})`
  const read = async (stage, action = 'read', retainSelection = false) => {
    const value = await evaluate(expression(action, retainSelection))
    if (action === 'install') receipt.ownerInstalled = true
    receipt.observations.push({ stage, value }); receipt.stage = stage; save()
    return value
  }
  const trace = async () => {
    const value = await evaluate(`({events:window.__fullAppUiEvents.slice(${Number(receipt.eventStart)}),traceTruncated:window.__fullAppUiTraceTruncated})`)
    Object.assign(receipt, value)
    assert.equal(value.traceTruncated, false, 'Decorator keyboard global trace was truncated')
    return value
  }
  save()
  try {
    const initial = await read('initial', 'install')
    assert.equal(initial.active, 'editor', 'Actual Lexical editor must own decorator F6 entry')
    const steps = [['F6', 0, 'editor', 'entry'], ['Tab', 0, 'entry', 'next'], ['Tab', 8, 'next', 'entry']]
    // The existing Toggle focus target is its title input. Preserve that exact
    // target after proving both directions between it and the arrow action.
    if (receipt.kind === 'toggle') steps.push(['Tab', 0, 'entry', 'next'])
    for (const [name, modifiers, beforeFocus, afterFocus] of steps) {
      const input = { key: name, modifiers, complete: false }; receipt.inputs.push(input); save()
      input.before = await evaluate(expression('read', name === 'F6'))
      assert.equal(input.before.active, beforeFocus, 'Decorator keyboard focus changed before native input')
      await key(name, modifiers); input.complete = true
      if (name === 'F6') receipt.nativeEntry = 'F6'
      else if (modifiers === 8) receipt.reverseTabs++
      else receipt.forwardTabs++
      const after = await read('after-' + receipt.inputs.length, 'read', name === 'F6')
      assert.equal(after.active, afterFocus, 'Decorator native key did not reach its adjacent control')
    }
    const returned = receipt.observations.at(-1).value
    receipt.ownedEvents = returned.ownedEvents
    assert.equal(returned.ownedTraceTruncated, false, 'Decorator keyboard owned trace was truncated')
    assert.deepEqual(receipt.ownedEvents.map(event => [event.key, event.shiftKey, event.target]),
      steps.map(([name, modifiers, before]) => [name, modifiers === 8, before]), 'Decorator trusted owner trace did not prove exact adjacent traversal')
    assert.ok(receipt.ownedEvents.every(event => event.type === 'keydown' && event.trusted &&
      !event.ctrlKey && !event.altKey && !event.metaKey && !event.composing && event.target === event.active), 'Decorator requires trusted unmodified owned keys')
    const globalTrace = await trace(), keys = globalTrace.events.filter(event => event.type === 'keydown')
    assert.deepEqual(keys.map(event => event.key), steps.map(([name]) => name), 'Decorator global trace did not retain its real key sequence')
    assert.ok(keys.every(event => event.trusted), 'Decorator global trace contains untrusted keys')
    assert.ok(!globalTrace.events.some(event => ['click', 'input', 'change'].includes(event.type)), 'Decorator keyboard traversal triggered an extra activation or edit')
    receipt.reached = true
    return receipt
  } catch (error) {
    failure = error; receipt.reached = false
    receipt.error = { name: error.name, message: error.message, stack: error.stack }
    throw error
  } finally {
    try {
      if (!receipt.events) {
        try { await trace() } catch (error) { receipt.traceError = { name: error.name, message: error.message } }
      }
      receipt.disposal = await evaluate(expression('dispose'))
      receipt.ownedEvents ||= receipt.disposal.ownedEvents || []
      assert.equal(receipt.disposal.disposed, true, 'Decorator keyboard observer was not disposed')
      if (receipt.ownerInstalled) assert.equal(receipt.disposal.absent, undefined, 'Decorator keyboard observer disappeared before disposal')
      if (!failure) assert.equal(receipt.disposal.identityRetained, true, 'Decorator keyboard owner changed before disposal')
    } catch (error) {
      receipt.reached = false; receipt.cleanupError = { name: error.name, message: error.message }
      if (!failure) throw error
    } finally {
      try { save() } catch (error) { if (!failure) throw error; receipt.saveError = { name: error.name, message: error.message } }
    }
  }
}
