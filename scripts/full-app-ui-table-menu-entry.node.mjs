// Pure current-product keyboard-entry contracts. The DOM and trusted input are
// explicit protocol models, not native Windows execution or acceptance evidence.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import * as editorDriver from './full-app-ui-main-editor.mjs'
import { traverseTableActionMenuWithNativeTabs } from './full-app-ui-shared.mjs'

const clone = value => structuredClone(value)
const tableAction = '.product-table-menu-section:first-child .table-action-menu-item:first-of-type'
const matrix = { theme: 'light', viewport: { width: 704, height: 455 } }

function fixture(t, options = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <button class="workspace-title-button">owned-current-table</button>
    <main class="content"><div class="editor-shell"><div class="editor-container">
      <div class="editor-input" role="textbox" contenteditable="true"><table><tbody>
        <tr><th>R1C1</th><th>R1C2</th><th>R1C3</th></tr>
        <tr><td>R2C1</td><td>R2C2</td><td>R2C3</td></tr>
      </tbody></table><p>after table</p></div>
      <button class="table-action-menu-trigger" aria-label="表格单元格操作" aria-haspopup="menu" aria-expanded="true">···</button>
      <div class="table-action-menu product-table-menu" role="menu" aria-label="表格操作">
        <div class="product-table-menu-section"><div>行与列</div><button class="table-action-menu-item" role="menuitem">上方插入行</button><button class="table-action-menu-item" role="menuitem">下方插入行</button></div>
        <div class="product-table-menu-section"><div>单元格</div><button class="table-action-menu-item" role="menuitem">多选单元格…</button></div>
      </div>
    </div></div></main></body>`, { runScripts: 'outside-only', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const { document } = dom.window
  const root = document.querySelector('.editor-input'), trigger = document.querySelector('.table-action-menu-trigger')
  const menu = document.querySelector('.table-action-menu'), first = document.querySelector(tableAction)
  let active = first
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => active?.isConnected ? active : document.body })
  let content = { root: { type: 'root', version: 1, children: [
    { type: 'table', version: 1, children: [0, 1].map(row => ({ type: 'tablerow', version: 1, children: [0, 1, 2].map(col => ({
      type: 'tablecell', version: 1, colSpan: 1, rowSpan: 1, children: [{ type: 'paragraph', version: 1, indent: 0,
        children: [{ type: 'text', version: 1, text: `R${row + 1}C${col + 1}` }] }],
    })) })) }, { type: 'paragraph', version: 1, indent: 0, children: [{ type: 'text', version: 1, text: 'after table' }] },
  ] } }
  const lexical = { getRootElement: () => root, isEditable: () => true, getEditorState: () => clone(content) }
  root.__lexicalEditor = lexical
  const note = { id: 'owned-table-id', title: 'owned-current-table', content: JSON.stringify(content), is_folder: false, is_deleted: false }
  let savedNote = clone(note)
  const keys = [], checkpoints = [], focusReceipts = [], apiCalls = [], captures = [], listeners = new Map()
  const originalAdd = document.addEventListener.bind(document), originalRemove = document.removeEventListener.bind(document)
  document.addEventListener = (type, callback, capture) => {
    if (type === 'keydown' || type === 'keyup') {
      if (options.listenerAddFailure === type) throw Error('Observed listener registration failure')
      const registered = listeners.get(type) || new Set(); registered.add(callback); listeners.set(type, registered)
    } else originalAdd(type, callback, capture)
  }
  document.removeEventListener = (type, callback, capture) => {
    if (type === 'keydown' || type === 'keyup') {
      if (options.listenerRemoveFailure === type) throw Error('Observed listener cleanup failure')
      listeners.get(type)?.delete(callback)
    } else originalRemove(type, callback, capture)
  }
  dom.window.__fullAppUiEvents = []; dom.window.__fullAppUiTraceTruncated = false
  const send = (type, key, modifiers, eventTarget) => {
    const event = { type, key, isTrusted: options.untrusted !== true, target: eventTarget,
      shiftKey: Boolean(modifiers & 8), ctrlKey: Boolean(modifiers & 2), altKey: Boolean(modifiers & 1), metaKey: Boolean(modifiers & 4),
      isComposing: options.composing === true, keyCode: key === 'Tab' ? 9 : 0, which: key === 'Tab' ? 9 : 0, defaultPrevented: false }
    for (const callback of listeners.get(type) || []) callback(event)
    if (type === 'keydown') dom.window.__fullAppUiEvents.push({ type, key, trusted: event.isTrusted,
      tag: eventTarget?.tagName ?? null, role: eventTarget?.getAttribute('role') ?? null })
  }
  const evaluate = async source => JSON.parse(JSON.stringify(dom.window.eval(source)))
  const key = async (value, modifiers = 0) => {
    const index = keys.length; keys.push({ key: value, modifiers })
    send('keydown', value, options.wrongModifiers ? 0 : modifiers, options.wrongEventTarget ? root : active)
    if (options.duplicateKeyDown) send('keydown', value, modifiers, active)
    if (options.uncertainInput && index === 0) throw Error('Uncertain native key outcome')
    if (!options.noOp || index > 0) {
      if (value === 'Tab' && modifiers === 8 && active === first) active = trigger
      else if (value === 'Tab' && modifiers === 0 && active === trigger) active = first
      else throw Error('Unexpected protocol key or focus owner')
    }
    options.afterKey?.({ index, document, root, trigger, menu, first, lexical,
      setActive: value => { active = value }, setContent: value => { content = value },
      getContent: () => clone(content), setSaved: value => { savedNote = value }, getSaved: () => clone(savedNote) })
    if (!options.missingKeyUp) send('keyup', value, options.wrongModifiers ? 0 : modifiers, active)
  }
  const report = { fullAppUi: { group: 'editor', focus: [] } }
  const context = { matrix: clone(matrix), report, fixture: { notes: { 表格: clone(note) } }, evaluate,
    api: async url => { apiCalls.push(url); assert.equal(url, '/api/files/' + note.id); if (options.apiFailure) throw Error('Original API read failure'); return clone(savedNote) },
    shared: { key }, save: () => { checkpoints.push(clone(report)); if (options.saveFailure) throw Error('Original evidence save failure') },
    until: async (read, _label, ...extra) => { assert.deepEqual(extra, [], 'Entry must retain the original wait budget'); const value = await read(); assert.ok(value, 'Original readiness deadline'); return value },
    openNote: async name => { assert.equal(name, '表格') },
    hit: async selector => { if (selector === '.table-action-menu-trigger') active = first; else { assert.ok(document.querySelector(selector)); active = root } },
    present: async selector => assert.ok(document.querySelector(selector)),
    absent: async selector => assert.equal(document.querySelector(selector), null),
    shot: async (...args) => captures.push(args),
    focus: async (routeId, stateId, selector) => {
      assert.deepEqual([routeId, stateId, selector], ['editor-table-actions', 'actions', tableAction])
      const receipt = await traverseTableActionMenuWithNativeTabs({ key, evaluate }); focusReceipts.push(receipt)
      assert.equal(receipt.reached, true, 'Actual Tab order never reached control: ' + selector)
      return receipt
    },
    press: async (selector, label) => {
      if (label === '多选单元格…') { assert.equal(selector, '.table-action-menu'); menu.remove(); const bar = document.createElement('div'); bar.className = 'table-selection-modebar'; bar.innerHTML = '<button class="primary">完成</button>'; root.parentElement.append(bar) }
      else { assert.equal(label, '完成'); assert.equal(selector, '.table-selection-modebar'); document.querySelector(selector).remove() }
    },
  }
  let forbiddenFocus = 0
  for (const node of [root, trigger, first, menu]) node.focus = () => { forbiddenFocus++; throw Error('Verifier may not focus any product node') }
  return { context, dom, document, root, trigger, menu, first, lexical, note, keys, checkpoints, focusReceipts, captures, apiCalls,
    evaluate, setActive: node => { active = node }, getActive: () => active,
    content: () => clone(content), stored: () => clone(savedNote), forbiddenFocus: () => forbiddenFocus,
    listeners: () => [...listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0) }
}

async function runActualTableEntry(context) {
  const source = readFileSync(new URL('./full-app-ui-main-editor.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("  await openNote('表格');"), end = source.indexOf("  await openNote('图片');", start)
  assert.ok(start >= 0 && end > start, 'Actual driver Table operation boundary is required')
  const run = new Function('ctx', 'assert', 'prepareTableActionMenuKeyboardEntry', 'finishTableActionMenuKeyboardEntry',
    'disposeTableActionMenuKeyboardEntry', `return (async () => {
      const { fixture, openNote, shot, focus, hit, press, present, absent, text, shared, evaluate, cdp, doubleClick, popup, clean } = ctx;
      ${source.slice(start, end)}
    })()`)
  return run(context, assert, editorDriver.prepareTableActionMenuKeyboardEntry,
    editorDriver.finishTableActionMenuKeyboardEntry, editorDriver.disposeTableActionMenuKeyboardEntry)
}

test('actual current-product Table entry retains the complete original native traversal after first-item autofocus', async t => {
  const f = fixture(t)
  await runActualTableEntry(f.context)
  assert.deepEqual(f.keys, [{ key: 'Tab', modifiers: 8 }, { key: 'Tab', modifiers: 0 }, { key: 'Tab', modifiers: 8 }, { key: 'Tab', modifiers: 0 }])
  assert.equal(f.focusReceipts.length, 1); assert.equal(f.focusReceipts[0].reached, true)
  assert.equal(f.focusReceipts[0].forwardTabs, 2); assert.equal(f.focusReceipts[0].reverseTabs, 1)
  assert.deepEqual(f.stored(), f.note); assert.equal(JSON.stringify(f.content()), f.note.content)
  assert.equal(f.forbiddenFocus(), 0); assert.equal(f.listeners(), 0)
  assert.equal(f.context.report.fullAppUi.tableActionMenuKeyboardEntries[0].complete, true)
  assert.equal(f.captures.length, 2, 'Both original Table action and selection-mode scenes remain')
})

const prepare = f => editorDriver.prepareTableActionMenuKeyboardEntry(f.context)
const receipt = f => f.context.report.fullAppUi.tableActionMenuKeyboardEntries?.[0]
const assertUnchanged = f => {
  assert.deepEqual(f.stored(), f.note); assert.equal(JSON.stringify(f.content()), f.note.content)
  assert.equal(f.forbiddenFocus(), 0)
}

for (const initial of ['trigger', 'editor', 'body']) test('Table current-product entry refuses initial focus on ' + initial + ' without native input', async t => {
  const f = fixture(t); f.setActive(initial === 'trigger' ? f.trigger : initial === 'editor' ? f.root : f.document.body)
  await assert.rejects(prepare(f), /must start with its product-focused first item/)
  assert.deepEqual(f.keys, []); assert.equal(receipt(f).complete, false); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

for (const [name, change] of [
  ['missing menu', f => f.menu.remove()],
  ['duplicate editor', f => f.root.after(f.root.cloneNode(true))],
  ['duplicate container', f => f.document.body.append(f.root.parentElement.cloneNode(false))],
  ['duplicate table', f => f.root.append(f.root.querySelector('table').cloneNode(true))],
  ['duplicate trigger', f => f.trigger.after(f.trigger.cloneNode(true))],
  ['duplicate menu', f => f.menu.after(f.menu.cloneNode(true))],
  ['duplicate title', f => f.document.body.append(f.document.querySelector('.workspace-title-button').cloneNode(true))],
  ['disabled first item', f => { f.first.disabled = true }],
  ['disabled trigger', f => { f.trigger.disabled = true }],
  ['non-tabbable first item', f => { f.first.tabIndex = -1 }],
  ['non-tabbable trigger', f => { f.trigger.tabIndex = -1 }],
  ['wrong item role', f => f.first.setAttribute('role', 'button')],
  ['collapsed trigger', f => f.trigger.setAttribute('aria-expanded', 'false')],
  ['foreign menu owner', f => f.document.body.append(f.menu)],
  ['foreign trigger owner', f => f.document.body.append(f.trigger)],
  ['noneditable Lexical instance', f => { f.lexical.isEditable = () => false }],
  ['wrong Lexical root', f => { f.lexical.getRootElement = () => f.document.body }],
  ['unavailable complete editor state', f => { f.lexical.getEditorState = () => ({ root: null }) }],
  ['wrong visible note', f => { f.document.querySelector('.workspace-title-button').textContent = 'different-note' }],
]) test('Table entry refuses ' + name + ' before sending any key', async t => {
  const f = fixture(t); change(f)
  await assert.rejects(prepare(f))
  assert.deepEqual(f.keys, []); assert.equal(receipt(f).complete, false); assert.equal(f.listeners(), 0)
  assert.deepEqual(f.stored(), f.note); assert.equal(f.forbiddenFocus(), 0)
})

for (const kind of ['dirty', 'saving', 'error', 'legacy', 'loading', 'confirmation']) test('Table entry refuses initial ' + kind + ' save/draft state', async t => {
  const f = fixture(t), node = f.document.createElement('div')
  node.className = kind === 'legacy' ? 'editor-unapplied-draft-pill' : kind === 'confirmation' ? 'consumer-confirm-modal' : 'workspace-save-chip ' + kind
  node.textContent = kind
  if (kind === 'loading') { node.className = ''; node.textContent = '正在加载编辑器…'; f.document.querySelector('.content').append(node) }
  else f.document.body.append(node)
  await assert.rejects(prepare(f), /settled draft\/save state/)
  assert.deepEqual(f.keys, []); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

for (const field of ['id', 'title', 'content']) test('Table entry binds the original saved note ' + field + ' before native input', async t => {
  const f = fixture(t), saved = f.stored(); saved[field] += '-changed'
  f.context.api = async () => saved
  await assert.rejects(prepare(f))
  assert.deepEqual(f.keys, []); assert.equal(f.listeners(), 0); assert.equal(receipt(f).complete, false)
})

test('Table reverse Tab no-op fails within the original wait contract without retry or focusing', async t => {
  const f = fixture(t, { noOp: true })
  await assert.rejects(prepare(f), /Original readiness deadline/)
  assert.deepEqual(f.keys, [{ key: 'Tab', modifiers: 8 }]); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

for (const [name, options] of [
  ['untrusted key', { untrusted: true }], ['missing Shift modifier', { wrongModifiers: true }],
  ['composing key', { composing: true }], ['missing keyup', { missingKeyUp: true }],
  ['wrong key target', { wrongEventTarget: true }], ['duplicate keydown', { duplicateKeyDown: true }],
]) test('Table entry refuses ' + name + ' without accepting a native traversal', async t => {
  const f = fixture(t, options)
  await assert.rejects(prepare(f), /native keydown\/keyup pairs|trusted native direction/)
  assert.equal(f.keys.length, 1); assert.equal(receipt(f).entryComplete, false)
  assert.equal(f.listeners(), 0); assertUnchanged(f)
})

test('uncertain Table native input is preserved and never replayed', async t => {
  const f = fixture(t, { uncertainInput: true })
  await assert.rejects(prepare(f), /Uncertain native key outcome/)
  assert.equal(f.keys.length, 1); assert.equal(receipt(f).inputs[0].completed, false)
  assert.equal(receipt(f).ownerDisposal.nativeTrace.rows.length, 1)
  assert.equal(f.listeners(), 0); assertUnchanged(f)
})

for (const owner of ['editor', 'host', 'shell', 'table', 'trigger', 'menu', 'first', 'title', 'lexical']) test('Table entry refuses byte-identical ' + owner + ' owner replacement', async t => {
  const f = fixture(t, { afterKey({ index, document, root, trigger, menu, first, lexical, getContent, setActive }) {
    if (index !== 0) return
    if (owner === 'lexical') { root.__lexicalEditor = { ...lexical }; return }
    const selectors = { editor: '.editor-input', host: '.editor-container', shell: '.editor-shell', table: '.editor-input table',
      trigger: '.table-action-menu-trigger', menu: '.table-action-menu', first: tableAction, title: '.workspace-title-button' }
    const old = document.querySelector(selectors[owner]), replacement = old.cloneNode(true)
    old.replaceWith(replacement)
    const currentEditor = document.querySelector('.editor-input')
    if (currentEditor !== root) currentEditor.__lexicalEditor = { getEditorState: getContent, getRootElement: () => currentEditor, isEditable: () => true }
    if (owner === 'trigger' || owner === 'host' || owner === 'shell') setActive(document.querySelector('.table-action-menu-trigger'))
  } })
  await assert.rejects(prepare(f), /owner identity was replaced|does not own one live/)
  assert.equal(f.keys.length, 1); assert.equal(receipt(f).complete, false); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

test('Table menu disappearance after the native key cannot be hidden by another entry attempt', async t => {
  const f = fixture(t, { afterKey({ index, menu }) { if (index === 0) menu.remove() } })
  await assert.rejects(prepare(f), /missing or ambiguous ownership/)
  assert.equal(f.keys.length, 1); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

test('Table entry compares the whole current document including a different row and cell', async t => {
  const f = fixture(t, { afterKey({ index, getContent, setContent }) {
    if (index !== 0) return
    const current = getContent(); current.root.children[0].children[1].children[2].children[0].children[0].text = 'unexpected edit'
    setContent(current)
  } })
  await assert.rejects(prepare(f), /changed its original documentJSON/)
  assert.equal(f.keys.length, 1); assert.equal(f.listeners(), 0); assert.deepEqual(f.stored(), f.note)
  assert.equal(receipt(f).complete, false)
})

test('Table entry refuses a new dirty save chip after reverse Tab without saving or discarding', async t => {
  const f = fixture(t, { afterKey({ index, document }) {
    if (index !== 0) return
    const chip = document.createElement('span'); chip.className = 'workspace-save-chip dirty'; chip.textContent = '有修改'; document.body.append(chip)
  } })
  await assert.rejects(prepare(f), /changed its original saveState/)
  assert.equal(f.keys.length, 1); assert.equal(f.apiCalls.length, 1); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

test('Table entry preserves the original full traversal failure and disposes only its observer', async t => {
  const f = fixture(t), original = Error('Original focus-visible assertion failure')
  f.context.focus = async () => { throw original }
  await assert.rejects(runActualTableEntry(f.context), error => error === original)
  assert.equal(f.keys.length, 1); assert.equal(f.listeners(), 0); assertUnchanged(f)
  assert.equal(receipt(f).complete, false); assert.equal(receipt(f).stage, 'failed')
  assert.equal(f.captures.length, 1, 'A failed traversal cannot proceed to the selection-mode scene')
})

test('Table entry cannot replace a failed original forward Tab with successful preparation', async t => {
  const f = fixture(t, { afterKey({ index, trigger, setActive }) { if (index === 1) setActive(trigger) } })
  await assert.rejects(runActualTableEntry(f.context), /Actual Tab order never reached control/)
  assert.equal(f.keys.length, 2); assert.equal(receipt(f).entryComplete, true); assert.equal(receipt(f).complete, false)
  assert.equal(f.listeners(), 0); assertUnchanged(f)
})

for (const change of ['document', 'saved-content', 'saved-metadata', 'title']) test('Table finishing refuses changed ' + change + ' across the original traversal', async t => {
  const f = fixture(t, { afterKey({ index, document, getContent, setContent, getSaved, setSaved }) {
    if (index !== 3) return
    if (change === 'document') { const value = getContent(); value.root.children[1].indent = 1; setContent(value) }
    else if (change === 'title') document.querySelector('.workspace-title-button').textContent = 'another current note'
    else { const saved = getSaved(); if (change === 'saved-content') saved.content += ' '; else saved.updated_at = 'unexpected-write'; setSaved(saved) }
  } })
  await assert.rejects(runActualTableEntry(f.context), /changed its original|changed its complete saved note/)
  assert.equal(f.keys.length, 4); assert.equal(f.focusReceipts[0].reached, true)
  assert.equal(receipt(f).complete, false); assert.equal(f.listeners(), 0); assert.equal(f.forbiddenFocus(), 0)
})

test('Table entry refuses a preexisting foreign observer without replacing or disposing it', async t => {
  const f = fixture(t), foreign = { ownerToken: 'another-observer' }
  f.dom.window.__fullAppTableActionMenuKeyboardOwner = foreign
  await assert.rejects(prepare(f), /earlier Table keyboard observer/)
  assert.equal(f.dom.window.__fullAppTableActionMenuKeyboardOwner, foreign)
  assert.deepEqual(f.keys, []); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

test('Table entry retains an API read failure without native input', async t => {
  const f = fixture(t, { apiFailure: true })
  await assert.rejects(prepare(f), /Original API read failure/)
  assert.deepEqual(f.keys, []); assert.equal(f.apiCalls.length, 1); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

test('Table entry retains a checkpoint failure without native input', async t => {
  const f = fixture(t, { saveFailure: true })
  await assert.rejects(prepare(f), /Original evidence save failure/)
  assert.deepEqual(f.keys, []); assert.equal(f.apiCalls.length, 0); assert.equal(f.listeners(), 0); assertUnchanged(f)
})

test('Table observer partial registration disposes its one installed listener', async t => {
  const f = fixture(t, { listenerAddFailure: 'keyup' })
  await assert.rejects(prepare(f), /Observed listener registration failure/)
  assert.equal(f.listeners(), 0); assert.equal(f.dom.window.__fullAppTableActionMenuKeyboardOwner, undefined)
  assert.deepEqual(f.keys, []); assertUnchanged(f)
})

test('Table observer cleanup failure cannot become accepted success', async t => {
  const f = fixture(t, { listenerRemoveFailure: 'keyup' })
  await assert.rejects(runActualTableEntry(f.context), /Table keyboard observer was not disposed/)
  assert.equal(receipt(f).complete, false); assert.equal(receipt(f).ownerDisposal.disposed, false)
  assert.equal(receipt(f).ownerDisposal.cleanup.remaining, 1); assert.equal(f.listeners(), 1)
  assert.equal(f.keys.length, 4); assertUnchanged(f)
})

test('the original helper still refuses first-item focus with zero native keys', async t => {
  const f = fixture(t)
  const result = await traverseTableActionMenuWithNativeTabs({ key: f.context.shared.key, evaluate: f.evaluate })
  assert.equal(result.reached, false); assert.deepEqual(f.keys, [])
  assert.deepEqual(result.initial, { ownerReady: true, triggerFocused: false, firstFocused: true })
  assert.equal(result.forwardTabs, 0); assert.equal(result.reverseTabs, 0); assertUnchanged(f)
})
