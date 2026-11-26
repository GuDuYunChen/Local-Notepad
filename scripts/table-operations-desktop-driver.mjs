import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { contrastRatio } from '../src/services/localAppearance.js'

export const TABLE_OPERATIONS_CHECKS = Object.freeze([
  'native-insertion-cancel-and-create', 'native-cell-edit-and-exact-save',
  'row-column-insert-delete-and-menu-move', 'rectangular-selection-background-merge-split-undo',
  'native-clipboard-copy-clear-paste-and-history',
  'cell-background-header-striping-and-frozen-state', 'native-row-and-column-drag-history',
  'resize-preview-cancel-commit-and-history', 'failed-save-retains-table-and-retry-persists-once',
  'reading-mode-and-document-switch-keep-saved-table', 'renderer-reload-preserves-exact-table-json',
  'large-long-text-table-keeps-final-row-identity', 'native-minimum-window-menu-is-reachable',
  'dark-minimum-window-keeps-table-operations',
])
export const TABLE_OPERATIONS_BUDGET_MS = 180000
const q = JSON.stringify
const hash = value => createHash('sha256').update(value).digest('hex')
const text = node => (node.text || '') + (node.children || []).map(text).join('')
export const tableFromContent = content => {
  const tables = JSON.parse(content).root.children.filter(node => node.type === 'table')
  assert.equal(tables.length, 1, 'Expected exactly one persisted native table')
  return tables[0]
}
export const tableTextRows = content => tableFromContent(content).children.map(row => row.children.map(text))
export function nativeTableContrast(foreground, background) {
  const hex = value => {
    if (/^#[a-f0-9]{6}$/i.test(value || '')) return value
    const match = String(value).match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*1)?\s*\)$/)
    assert.ok(match, 'Expected an opaque computed native text/background colour')
    const components = match.slice(1).map(Number)
    assert.ok(components.every(component => component <= 255))
    return '#' + components.map(component => component.toString(16).padStart(2, '0')).join('')
  }
  return contrastRatio(hex(foreground), hex(background))
}
export function tableOperationSeed(marker) {
  return q({ root: { type: 'root', version: 1, format: '', indent: 0, direction: null, children: [
    { type: 'paragraph', version: 1, format: '', indent: 0, direction: null, children: [
      { type: 'text', version: 1, text: marker, format: 0, detail: 0, mode: 'normal', style: '' },
    ] },
  ] } })
}

// This driver is shared by packaged and installed applications. It never reads
// private Lexical state, dispatches synthetic Table/input events, sets input
// values, or replaces transport/timers. Library refresh is the existing setup
// event; scrollIntoView only reveals native targets. Owned notes use the real
// API for initial seeding; all Table operations use Chromium mouse/keyboard input.
export async function verifyTableOperationsDesktop(context) {
  const { api, evaluate, click, cdp, until, capture: captureNative, report, save, resizeSmall } = context
  const started = performance.now()
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  const capture = async filename => {
    // Let the real transient feedback expire before reviewing Table controls.
    // Keep error feedback visible for failed-save evidence. The shared until
    // remains bounded by the original business deadline; timers and DOM stay
    // untouched, and the runner's emergency failure capture is independent.
    await until(() => evaluate("!document.querySelector('.app-toast.success,.app-toast.warning')"), 'Transient Table feedback did not finish before capture')
    await captureNative(filename)
  }
  const recordInput = (method, params) => {
    report.nativeInputs.push({ sequence: report.nativeInputs.length + 1, method, ...params })
    save()
    assert.ok(performance.now() - started < TABLE_OPERATIONS_BUDGET_MS, 'Table native business budget exceeded')
    return cdp.send(method, params)
  }
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await recordInput('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code, modifiers })
    await settle()
  }
  const type = value => recordInput('Input.insertText', { text: value })
  const mark = name => {
    assert.equal(name, TABLE_OPERATIONS_CHECKS[report.checks.length])
    report.checks.push(name); report.businessElapsedMs = performance.now() - started; save()
  }
  const cellSelector = (row, column) => `.editor-input table tr:nth-of-type(${row + 1}) > :is(td,th):nth-child(${column + 1})`
  const observe = () => evaluate(`(() => {
    const root=document.querySelector('.editor-input'),table=root?.querySelector('table')
    return {editable:root?.getAttribute('contenteditable'),rootFocused:document.activeElement===root,
      modebarFocused:!!document.querySelector('.table-selection-modebar')?.contains(document.activeElement),width:innerWidth,height:innerHeight,
      overflow:document.documentElement.scrollWidth>innerWidth+1,
      tables:root?.querySelectorAll('table').length||0,selection:document.querySelector('.table-selection-modebar')?.textContent||'',
      selectionOutlineBackgrounds:[...document.querySelectorAll('.table-selection-outline')].map(outline=>getComputedStyle(outline).backgroundColor),
      rows:table?[...table.rows].map(row=>[...row.cells].map(cell=>({text:cell.textContent,colSpan:cell.colSpan,rowSpan:cell.rowSpan,tag:cell.tagName,
        width:cell.getBoundingClientRect().width,inlineWidth:cell.style.width,background:getComputedStyle(cell).backgroundColor,
        position:getComputedStyle(cell).position,top:cell.getBoundingClientRect().top}))):[],
      rowStriping:table?.classList.contains('editor-table-row-striping')||false,
      frozenRow:table?.getAttribute('data-lexical-frozen-row')||null,frozenColumn:table?.getAttribute('data-lexical-frozen-column')||null}
  })()`)
  const point = async (selector, edge = false) => until(() => evaluate(`(() => {
    const nodes=[...document.querySelectorAll(${q(selector)})].filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0)
    if(nodes.length!==1)return null
    const node=nodes[0];node.scrollIntoView({block:'nearest',inline:'nearest'})
    const r=node.getBoundingClientRect(),x=${edge ? 'r.right-1' : 'r.x+r.width/2'},y=r.y+Math.min(r.height/2,18),hit=document.elementFromPoint(x,y)
    return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&hit&&node.contains(hit)?{x,y,width:r.width}:null
  })()`), 'Native table target missing, ambiguous, or covered: ' + selector)
  // Chromium 126 MouseEventManager::HandleMouseDraggedEvent requires button
  // kLeft as well as the pressed-buttons mask; an omitted button cancels drag.
  // https://github.com/chromium/chromium/blob/126.0.6478.234/third_party/blink/renderer/core/input/mouse_event_manager.cc
  const move = (p, buttons = 0) => recordInput('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, buttons, button: buttons & 1 ? 'left' : 'none' })
  const press = p => recordInput('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  const release = p => recordInput('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
  const wheel = (p, deltaX, deltaY) => recordInput('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX, deltaY })
  const frozenView = () => evaluate(`(() => {
    const table=document.querySelector('.editor-input table'),head=table.rows[0].cells[0],normal=table.rows[1].cells[1]
    const t=table.getBoundingClientRect(),h=head.getBoundingClientRect(),n=normal.getBoundingClientRect()
    return {scrollTop:table.scrollTop,scrollLeft:table.scrollLeft,scrollWidth:table.scrollWidth,clientWidth:table.clientWidth,
      headTop:h.top,headLeft:h.left,normalTop:n.top,normalLeft:n.left,tableTop:t.top,tableLeft:t.left}
  })()`)
  const mode = async editable => {
    const label = editable ? '切换到编辑模式' : '切换到阅读模式'
    if (await evaluate(`!!document.querySelector('button[aria-label=${q(label)}]')`)) await click(`button[aria-label="${label}"]`)
    await until(() => evaluate(`document.querySelector('.editor-input')?.getAttribute('contenteditable')===${q(String(editable))}`), 'Table editing mode did not settle')
  }
  const clean = () => until(() => evaluate("!document.querySelector('.workspace-save-chip.dirty,.save-state')"), 'Table save was not acknowledged')
  const createNote = (title, content) => api('/api/files', { method: 'POST', body: q({ title, content, is_folder: false }) })
  const open = async (note, marker) => {
    const selector = '[data-file-id=' + q(note.id) + ']'
    await evaluate("window.dispatchEvent(new Event('library:refresh'))")
    let expanded = false
    await until(async () => {
      if (!expanded && await evaluate("!!document.querySelector('.workspace-sidebar.collapsed button[aria-label=\"展开侧边栏\"]')")) {
        expanded = true; await click('button[aria-label="展开侧边栏"]')
      }
      return evaluate(`!!document.querySelector('.workspace-sidebar:not(.collapsed) .file-list .tree-list')&&!!document.querySelector(${q(selector)})`)
    }, 'Owned Table note missing from real library')
    await click(selector)
    await until(() => evaluate(`document.querySelector('.workspace-title-button')?.textContent===${q(note.title)}&&document.querySelector('.editor-input')?.textContent.includes(${q(marker)})`), 'Owned Table note did not open')
    await clean()
  }
  const prefix = 'TABLE2492-' + randomUUID().slice(0, 8)
  const main = await createNote(prefix + '.md', tableOperationSeed(prefix))
  const destination = await createNote(prefix + '-destination.md', tableOperationSeed(prefix + '-destination'))
  report.fixture = { mainID: main.id, destinationID: destination.id, marker: prefix, seedContent: main.content }
  report.snapshots = {}; report.nativeInputs ||= []; save()
  const route = '/api/files/' + encodeURIComponent(main.id)
  const body = async () => (await api(route)).content
  const checkpoint = async (name, predicate = () => true, noteRoute = route) => {
    await key('s', 83, 2)
    const content = await until(async () => {
      const actual = (await api(noteRoute)).content
      return predicate(actual) ? actual : false
    }, 'Persisted Table JSON differs at ' + name)
    await clean()
    report.snapshots[name] = { content, sha256: hash(content), ui: await observe() }; save()
    return content
  }
  const expectRows = expected => value => { try { assert.deepEqual(tableTextRows(value), expected); return true } catch { return false } }
  const exact = expected => value => { try { assert.deepEqual(JSON.parse(value), JSON.parse(expected)); return true } catch { return false } }
  const menu = async (row, column, label) => {
    await click(cellSelector(row, column) + ' p')
    await click('[aria-label="表格单元格操作"]')
    await until(() => evaluate("!!document.querySelector('.table-action-menu[role=menu]')"), 'Table action menu did not open')
    if (label) await click({ selector: '.table-action-menu button', text: label })
    await settle()
  }
  const undo = async () => { await click('.editor-toolbar [aria-label="撤销"]'); await settle() }
  const redo = async () => { await click('.editor-toolbar [aria-label="重做"]'); await settle() }

  await open(main, prefix); await mode(true)
  await click('.editor-input > p'); await key('End', 35, 2); await key('Enter', 13)
  await click('[aria-label="插入内容"]'); await click('.table-insert-trigger')
  await key('Escape', 27)
  assert.equal((await observe()).tables, 0)
  // Close the outer insertion menu with the user's existing toggle.
  await click('[aria-label="插入内容"]')
  await click('[aria-label="插入内容"]'); await click('.table-insert-trigger')
  await click('.tm-grid-cell[aria-label="3 行 3 列"]')
  await until(async () => (await observe()).rows.length === 3, 'Native insertion did not create three rows')
  mark('native-insertion-cancel-and-create')

  const originalRows = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, col) => `R${row + 1}C${col + 1}`))
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    await click(cellSelector(row, col) + ' p')
    if (row === 2 && col === 2) {
      // The pinned protocol defines imeSetComposition(text, selectionStart,
      // selectionEnd). InputHandler::InsertText commits through ImeCommitText.
      // https://github.com/chromium/chromium/blob/126.0.6478.234/third_party/blink/public/devtools_protocol/browser_protocol.pdl
      const control = { text: originalRows[row][col], before: await observe(), compositionInputStart: report.nativeInputs.length }
      report.imeControl = control; save()
      assert.equal(control.before.rootFocused, true); assert.equal(control.before.rows[2][2].text, '')
      await recordInput('Input.imeSetComposition', { text: control.text, selectionStart: 4, selectionEnd: 4 }); await settle()
      control.compositionInputEnd = report.nativeInputs.length; control.composing = await observe(); save()
      assert.equal(control.composing.rootFocused, true)
      // Chromium exposes a transient U+200B composition sentinel in the DOM
      // until ImeCommitText commits the candidate. It is not document text.
      assert.match(control.composing.rows[2][2].text, /^R3C3\u200b?$/)
      control.commitInputStart = report.nativeInputs.length
      await type(control.text); await settle()
      control.commitInputEnd = report.nativeInputs.length; control.committed = await observe(); save()
      assert.equal(control.committed.rootFocused, true)
      assert.deepEqual(control.committed.rows.map(row => row.map(cell => cell.text)), originalRows)
    } else await type(originalRows[row][col])
  }
  report.imeControl.saveInputStart = report.nativeInputs.length
  const initial = await checkpoint('initial', expectRows(originalRows))
  report.imeControl.saveInputEnd = report.nativeInputs.length; report.imeControl.snapshot = 'initial'; save()
  assert.ok(tableFromContent(initial).children.every(row => row.children.length === 3))
  await capture('table-native-inserted.png'); mark('native-cell-edit-and-exact-save')

  await menu(1, 1, '上方插入行')
  await checkpoint('insert-row', expectRows([originalRows[0], ['', '', ''], originalRows[1], originalRows[2]]))
  await menu(1, 1, '删除当前行'); await checkpoint('delete-row', exact(initial))
  await menu(1, 1, '左侧插入列')
  await checkpoint('insert-column', expectRows(originalRows.map(row => [row[0], '', row[1], row[2]])))
  await menu(1, 1, '删除当前列'); await checkpoint('delete-column', exact(initial))
  await menu(0, 0, '当前行下移')
  await checkpoint('menu-row-move', expectRows([originalRows[1], originalRows[0], originalRows[2]]))
  await undo(); await checkpoint('menu-row-undo', exact(initial))
  await menu(0, 0, '当前列右移')
  await checkpoint('menu-column-move', expectRows(originalRows.map(row => [row[1], row[0], row[2]])))
  await undo(); await checkpoint('menu-column-undo', exact(initial))
  mark('row-column-insert-delete-and-menu-move')

  // Retain a real text range in an unselected cell before entering the bulk
  // mode. Native editing must not act on that older range behind the two-cell
  // overlay. Selection and focus are observed through DOM APIs only.
  report.selectionIsolation = { rangeStages: [], operations: [] }; save()
  const sourceInputStart = report.nativeInputs.length
  await click(cellSelector(0, 2) + ' p'); await key('Home', 36); await key('End', 35, 8)
  const textSelection = () => evaluate(`(() => {
    const root=document.querySelector('.editor-input'),table=root?.querySelector('table'),selection=window.getSelection()
    const location=node=>{const element=node?.nodeType===1?node:node?.parentElement,cell=element?.closest('td,th')
      if(!cell||!table?.contains(cell))return null
      return {row:[...table.rows].indexOf(cell.parentElement),column:[...cell.parentElement.cells].indexOf(cell),text:cell.textContent}}
    return {rootFocused:document.activeElement===root,text:selection?.toString()||'',anchor:location(selection?.anchorNode),focus:location(selection?.focusNode)}
  })()`)
  const observeRangeStage = async stage => {
    report.selectionIsolation.rangeStages.push({ stage, afterInput: report.nativeInputs.length, ...(await textSelection()) }); save()
  }
  report.selectionIsolation.source = { inputStart: sourceInputStart, inputEnd: report.nativeInputs.length, ...(await textSelection()) }; save()
  assert.equal(report.selectionIsolation.source.rootFocused, true)
  assert.equal(report.selectionIsolation.source.text, 'R1C3', 'Native text range must cover the unselected source cell')
  await click('[aria-label="表格单元格操作"]')
  await until(() => evaluate("!!document.querySelector('.table-action-menu[role=menu]')"), 'Table action menu did not open')
  await observeRangeStage('menu-opened')
  await click({ selector: '.table-action-menu button', text: '多选单元格…' }); await settle()
  await observeRangeStage('mode-entered')
  const start = await point(cellSelector(1, 0)), end = await point(cellSelector(1, 1))
  const selectionInputStart = report.nativeInputs.length
  await move(start); await press(start); await observeRangeStage('rectangle-started')
  await move(end, 1); await observeRangeStage('rectangle-moved')
  await release(end); await settle()
  report.selectionIsolation.rectangle = { inputStart: selectionInputStart, inputEnd: report.nativeInputs.length }
  report.selectionIsolation.selected = await observe()
  report.selectionIsolation.retainedRange = await textSelection(); save()
  assert.match(report.selectionIsolation.selected.selection, /已选择 2 个单元格/)
  assert.deepEqual(report.selectionIsolation.selected.selectionOutlineBackgrounds, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], 'Bulk selection outlines must not cover cell text or saved colours')
  assert.equal(report.selectionIsolation.selected.rootFocused, true, 'Bulk selection must leave native keyboard input on the editor root')
  assert.equal(report.selectionIsolation.retainedRange.text, 'R1C3', 'Isolation exercise requires the retained unselected text range')
  assert.equal(await body(), initial, 'Selection alone wrote the document')
  for (const [name, action] of [
    ['insert-text', () => type('TABLE-SELECTION-INPUT-MUST-NOT-WRITE')],
    ['backspace', () => key('Backspace', 8)], ['delete', () => key('Delete', 46)],
    ['enter', () => key('Enter', 13)], ['cut', () => key('x', 88, 2)],
  ]) {
    const operation = { name, inputStart: report.nativeInputs.length, before: await observe() }
    report.selectionIsolation.operations.push(operation); save()
    assert.equal(operation.before.rootFocused, true, 'Isolation input lost editor focus: ' + name)
    assert.match(operation.before.selection, /已选择 2 个单元格/)
    await action(); await settle()
    operation.inputEnd = report.nativeInputs.length; operation.after = await observe(); save()
    assert.equal(operation.after.rootFocused, true, 'Blocked input moved editor focus: ' + name)
    assert.match(operation.after.selection, /已选择 2 个单元格/)
    assert.deepEqual(operation.after.rows.map(row => row.map(cell => cell.text)), originalRows, 'Bulk selection leaked native input into a cell: ' + name)
    operation.snapshot = 'selection-input-' + name; operation.saveInputStart = report.nativeInputs.length; save()
    await checkpoint(operation.snapshot, exact(initial))
    operation.saveInputEnd = report.nativeInputs.length; save()
  }
  // Composition begins before cancelable beforeinput. Blocking it may move
  // native focus to the existing bulk controls, unlike the five key cases.
  const ime = { before: await observe(), compositionInputStart: report.nativeInputs.length }
  report.selectionIsolation.ime = ime; save()
  assert.equal(ime.before.rootFocused, true)
  await recordInput('Input.imeSetComposition', { text: '表', selectionStart: 1, selectionEnd: 1 }); await settle()
  ime.compositionInputEnd = report.nativeInputs.length; ime.composing = await observe(); save()
  assert.equal(ime.composing.rootFocused, false); assert.equal(ime.composing.modebarFocused, true)
  assert.match(ime.composing.selection, /已选择 2 个单元格/)
  assert.deepEqual(ime.composing.rows.map(row => row.map(cell => cell.text)), originalRows)
  ime.commitInputStart = report.nativeInputs.length
  await type('表'); await settle()
  ime.commitInputEnd = report.nativeInputs.length; ime.committed = await observe(); save()
  assert.equal(ime.committed.rootFocused, false); assert.equal(ime.committed.modebarFocused, true)
  assert.match(ime.committed.selection, /已选择 2 个单元格/)
  assert.deepEqual(ime.committed.rows.map(row => row.map(cell => cell.text)), originalRows)
  ime.snapshot = 'selection-input-ime'; ime.saveInputStart = report.nativeInputs.length; save()
  await checkpoint(ime.snapshot, exact(initial))
  ime.saveInputEnd = report.nativeInputs.length; save()

  // The command panel is another content-entry path. Exercise its real search
  // input and Enter handler while the rectangle still owns editing, then save
  // the complete document so an inserted block outside the table cannot hide.
  const paletteWarning = '请先点击“完成”退出单元格多选，再输入或修改正文'
  const paletteView = async () => ({ ...(await observe()), ...(await evaluate(`(() => {
    const dialogs=[...document.querySelectorAll('.editor-command-palette[role="dialog"][aria-label="编辑器命令"]')]
    const dialog=dialogs[0],input=dialog?.querySelector('input[aria-label="搜索编辑器命令"]')
    return {dialogCount:dialogs.length,searchInputFocused:!!input&&document.activeElement===input,query:input?.value??null,
      options:dialog?[...dialog.querySelectorAll('.editor-command-item[role="option"]')].map(option=>({
        label:option.querySelector('strong')?.textContent.trim(),selected:option.getAttribute('aria-selected')==='true',disabled:option.disabled})):[],
      warnings:[...document.querySelectorAll('.app-toast.warning .app-toast-content')].map(node=>node.textContent.trim())}
  })()`)) })
  await until(async () => !(await paletteView()).warnings.includes(paletteWarning), 'Previous bulk-input feedback did not expire before the command-panel action')
  const palette = { label: '编辑器命令', query: 'divider', command: '分割线', before: await paletteView(), inputStart: report.nativeInputs.length }
  report.selectionIsolation.palette = palette; save()
  palette.openInputStart = report.nativeInputs.length
  palette.launcher = await evaluate(`(() => {
    const buttons=[...document.querySelectorAll('.editor-toolbar button[aria-label="编辑器命令"]')]
    if(buttons.length!==1)return null
    const button=buttons[0],r=button.getBoundingClientRect()
    return {label:button.getAttribute('aria-label'),disabled:button.disabled,left:r.left,top:r.top,width:r.width,height:r.height}
  })()`)
  assert.equal(palette.launcher?.label, palette.label); assert.equal(palette.launcher.disabled, false)
  await click('.editor-toolbar button[aria-label="编辑器命令"]')
  palette.openInputEnd = report.nativeInputs.length
  palette.opened = await until(async () => {
    const view = await paletteView()
    return view.dialogCount === 1 && view.searchInputFocused && view.query === '' ? view : false
  }, 'Native command panel did not focus its actual search input'); save()
  palette.queryInputStart = report.nativeInputs.length
  await type(palette.query); await settle()
  palette.queryInputEnd = report.nativeInputs.length
  palette.filtered = await until(async () => {
    const view = await paletteView()
    return view.dialogCount === 1 && view.searchInputFocused && view.query === palette.query && view.options.length === 1 &&
      view.options[0].label === palette.command && view.options[0].selected && !view.options[0].disabled ? view : false
  }, 'Native command search did not resolve to the single divider action'); save()
  palette.executeInputStart = report.nativeInputs.length
  await key('Enter', 13)
  palette.executeInputEnd = report.nativeInputs.length
  palette.after = await until(async () => {
    const view = await paletteView()
    return view.dialogCount === 0 && view.warnings.includes(paletteWarning) ? view : false
  }, 'Native command panel did not close with the bulk-selection refusal'); save()
  palette.feedback = palette.after.warnings.find(value => value === paletteWarning)
  for (const view of [palette.before, palette.opened, palette.filtered, palette.after]) {
    assert.match(view.selection, /已选择 2 个单元格/)
    assert.deepEqual(view.rows.map(row => row.map(cell => cell.text)), originalRows)
  }
  palette.snapshot = 'selection-input-palette'; palette.saveInputStart = report.nativeInputs.length; save()
  await checkpoint(palette.snapshot, exact(initial))
  palette.saveInputEnd = report.nativeInputs.length; palette.inputEnd = report.nativeInputs.length; save()
  assert.match(report.snapshots[palette.snapshot].ui.selection, /已选择 2 个单元格/)
  assert.deepEqual(report.snapshots[palette.snapshot].ui.rows.map(row => row.map(cell => cell.text)), originalRows)
  await click({ selector: '.table-selection-modebar button', text: '浅黄' })
  const colored = await checkpoint('selected-background', value => {
    const table = tableFromContent(value)
    return table.children[1].children.slice(0, 2).every(cell => cell.backgroundColor === '#fff3cd')
  })
  await click({ selector: '.table-selection-modebar button', text: '合并' })
  const merged = await checkpoint('merged', value => tableFromContent(value).children[1].children[0].colSpan === 2)
  assert.deepEqual(tableTextRows(merged)[1], ['R2C1R2C2', 'R2C3'])
  await capture('table-native-merged.png')
  await click({ selector: '.table-selection-modebar button', text: '拆分' })
  const split = await checkpoint('split', value => tableFromContent(value).children[1].children.length === 3)
  assert.deepEqual(tableTextRows(split)[1], ['R2C1R2C2', '', 'R2C3'])
  await undo(); await checkpoint('split-undo', exact(merged))
  await undo(); await checkpoint('merge-undo', exact(colored))
  await click({ selector: '.table-selection-modebar button', text: '完成' })
  mark('rectangular-selection-background-merge-split-undo')

  await menu(1, 0, '多选单元格…')
  const clipboardStart = await point(cellSelector(1, 0)), clipboardEnd = await point(cellSelector(1, 1))
  await move(clipboardStart); await press(clipboardStart); await move(clipboardEnd, 1); await release(clipboardEnd); await settle()
  report.clipboard = { method: 'native-copy-and-paste-buttons', selection: (await observe()).selection }
  assert.match(report.clipboard.selection, /已选择 2 个单元格/)
  const clipboardAction = async (label, expectedFeedback) => {
    const observedLabel = await evaluate(`(() => {
      const buttons=[...document.querySelectorAll('.table-selection-modebar button')]
      const matching=buttons.filter(button=>button.textContent.trim()===${q(label)}&&!button.disabled)
      return matching.length===1?matching[0].textContent.trim():null
    })()`)
    assert.equal(observedLabel, label, 'System clipboard action is unavailable')
    const inputStart = report.nativeInputs.length
    // The production button owns navigator.clipboard / execCommand. No test
    // writes, stubs, reads, permissions override, or replacement buffer is used.
    await click({ selector: '.table-selection-modebar button', text: label })
    const inputEnd = report.nativeInputs.length
    const feedback = await until(() => evaluate(`(() => {
      const content=[...document.querySelectorAll('.app-toast-content')].map(node=>node.textContent.trim())
      return content.find(value=>value===${q(expectedFeedback)})||null
    })()`), 'Native system clipboard operation did not acknowledge success: ' + label)
    await until(() => evaluate("document.querySelector('.table-selection-modebar')?.getAttribute('aria-busy')==='false'"), 'Native clipboard operation remained busy')
    return { label: observedLabel, inputStart, inputEnd, feedback }
  }
  report.clipboard.copy = await clipboardAction('复制', '已复制所选单元格')
  await checkpoint('clipboard-copied', exact(colored))
  await click({ selector: '.table-selection-modebar button', text: '清空' })
  const clearedRows = originalRows.map(row => [...row]); clearedRows[1][0] = ''; clearedRows[1][1] = ''
  const cleared = await checkpoint('clipboard-cleared', expectRows(clearedRows))
  assert.ok(tableFromContent(cleared).children[1].children.slice(0, 2).every(cell => cell.backgroundColor === '#fff3cd'))
  report.clipboard.paste = await clipboardAction('粘贴', '已粘贴到所选区域')
  await checkpoint('clipboard-pasted', exact(colored))
  await undo(); await checkpoint('clipboard-paste-undo', exact(cleared))
  await undo(); await checkpoint('clipboard-clear-undo', exact(colored))
  await redo(); await checkpoint('clipboard-clear-redo', exact(cleared))
  await redo(); await checkpoint('clipboard-paste-redo', exact(colored))
  await capture('table-native-clipboard-restored.png')
  await click({ selector: '.table-selection-modebar button', text: '完成' })
  mark('native-clipboard-copy-clear-paste-and-history')

  await menu(0, 1, '蓝色')
  await menu(0, 1, '切换首行表头'); await menu(0, 1, '切换首列表头')
  await menu(0, 1, '隔行底色'); await menu(0, 1, '固定首行'); await menu(0, 1, '固定首列')
  const styled = await checkpoint('styled', value => {
    const table = tableFromContent(value)
    return table.rowStriping === true && table.frozenRowCount === 1 && table.frozenColumnCount === 1 && table.children[0].children[1].backgroundColor === '#cff4fc'
  })
  const styledTable = tableFromContent(styled), priorTable = tableFromContent(colored)
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    assert.equal(styledTable.children[row].children[col].headerState, priorTable.children[row].children[col].headerState ^ (row === 0 ? 1 : 0) ^ (col === 0 ? 2 : 0))
  }
  report.styledView = await observe()
  assert.equal(report.styledView.rowStriping, true); assert.equal(report.styledView.frozenRow, 'true'); assert.equal(report.styledView.frozenColumn, 'true')
  assert.equal(report.styledView.rows[0][1].background, 'rgb(207, 244, 252)')
  await capture('table-native-styled.png'); mark('cell-background-header-striping-and-frozen-state')

  const nativeDrag = async (kind, fromRow, fromCol, toRow, toCol) => {
    const receipt = { kind, inputStart: report.nativeInputs.length, intercepted: [], completed: false }
    report.nativeDrags ||= []; report.nativeDrags.push(receipt); save()
    const sourceCell = await point(cellSelector(fromRow, fromCol))
    await move(sourceCell); await settle()
    const control = kind === 'row' ? '.table-reorder-handle.row' : '.table-reorder-handle.col'
    const source = await point(control), target = await point(cellSelector(toRow, toCol))
    receipt.source = source; receipt.target = target; save()
    let intercepted
    const detach = cdp.onEvent(event => {
      if (event.method !== 'Input.dragIntercepted') return
      intercepted = event.params.data
      receipt.intercepted.push({ afterInputSequence: report.nativeInputs.length, data: structuredClone(intercepted) }); save()
    })
    try {
      await cdp.send('Input.setInterceptDrags', { enabled: true })
      await move(source); await press(source)
      await move({ x: source.x + 9, y: source.y + 9 }, 1)
      await until(() => intercepted, 'Native table dragstart did not produce real drag data')
      assert.ok(intercepted.items.some(item => item.mimeType === 'application/x-local-notepad-table-reorder'))
      for (const type of ['dragEnter', 'dragOver', 'drop']) await recordInput('Input.dispatchDragEvent', { type, x: target.x, y: target.y, data: intercepted })
      await release(target); await settle()
      receipt.inputEnd = report.nativeInputs.length; receipt.completed = true; save()
    } finally { try { await cdp.send('Input.setInterceptDrags', { enabled: false }) } finally { detach() } }
  }
  await nativeDrag('row', 0, 0, 2, 0)
  const rowDragged = await checkpoint('row-dragged', expectRows([originalRows[1], originalRows[2], originalRows[0]]))
  await undo(); await checkpoint('row-drag-undo', exact(styled))
  await redo(); await checkpoint('row-drag-redo', exact(rowDragged))
  await undo(); await checkpoint('row-drag-restored', exact(styled))
  await nativeDrag('col', 0, 0, 0, 2)
  const colDragged = await checkpoint('column-dragged', expectRows(originalRows.map(row => [row[1], row[2], row[0]])))
  await undo(); await checkpoint('column-drag-undo', exact(styled))
  await redo(); await checkpoint('column-drag-redo', exact(colDragged))
  await undo(); await checkpoint('column-drag-restored', exact(styled))
  mark('native-row-and-column-drag-history')

  const startResize = async () => {
    const edge = await point(cellSelector(0, 0), true)
    await move(edge); await settle()
    const handle = await point('.table-column-resizer')
    await move(handle); await press(handle)
    return { ...handle, cellWidth: edge.width }
  }
  const cancelStart = await startResize()
  await move({ x: cancelStart.x + 70, y: cancelStart.y }, 1); await settle()
  assert.equal(await body(), styled, 'Resize preview entered the database')
  await key('Escape', 27); await release({ x: cancelStart.x + 70, y: cancelStart.y }); await settle()
  await checkpoint('resize-cancelled', exact(styled))
  const resizeStart = await startResize(), resizedWidth = Math.max(70, Math.min(600, Math.round(resizeStart.cellWidth + 50)))
  await move({ x: resizeStart.x + 50, y: resizeStart.y }, 1); await release({ x: resizeStart.x + 50, y: resizeStart.y }); await settle()
  const resized = await checkpoint('resized', value => tableFromContent(value).colWidths?.[0] === resizedWidth)
  assert.ok(tableFromContent(resized).children.every(row => row.children[0].width === resizedWidth))
  await undo(); await checkpoint('resize-undo', exact(styled))
  await redo(); await checkpoint('resize-redo', exact(resized))
  const autoFit = async () => {
    await move(await point(cellSelector(0, 0), true)); await settle()
    const handle = await point('.table-column-resizer')
    await move(handle)
    for (const clickCount of [1, 2]) for (const type of ['mousePressed', 'mouseReleased']) {
      await recordInput('Input.dispatchMouseEvent', { type, x: handle.x, y: handle.y, button: 'left', clickCount })
    }
    await settle()
  }
  await autoFit()
  const fitted = await checkpoint('autofit', value => {
    const width = tableFromContent(value).colWidths?.[0]
    return width >= 70 && width < resizedWidth
  })
  await autoFit(); await checkpoint('autofit-repeat', exact(fitted))
  await undo(); await checkpoint('autofit-undo', exact(resized))
  await redo(); await checkpoint('autofit-redo', exact(fitted))
  mark('resize-preview-cancel-commit-and-history')

  const failureRequestStart = report.requests.length
  await cdp.send('Network.setBlockedURLs', { urls: ['http://127.0.0.1:27121' + route] })
  try {
    await click(cellSelector(2, 2) + ' p'); await key('End', 35); await type('-offline-retry')
    await key('s', 83, 2); await key('s', 83, 2)
    await until(() => evaluate("document.querySelector('.save-state.error')?.textContent.includes('保存未确认')"), 'Real failed table save did not retain its error')
    assert.equal(await body(), fitted)
    report.failedSave = { persisted: await body(), visible: await observe(), duplicateSaveKeys: 2, requestStartIndex: failureRequestStart }
    await capture('table-native-failed-save.png'); save()
  } finally { await cdp.send('Network.setBlockedURLs', { urls: [] }) }
  await click('.status-retry-btn')
  const retriedRows = originalRows.map(row => [...row]); retriedRows[2][2] += '-offline-retry'
  const retried = await checkpoint('retried', expectRows(retriedRows))
  report.failedSave.successfulWrites = report.requests.slice(failureRequestStart).filter(request =>
    request.path === route && request.method === 'PUT' && request.status === 200 && request.postData.includes('-offline-retry')).length
  assert.equal(report.failedSave.successfulWrites, 1, 'Retry or repeated Save issued duplicate successful Table writes')
  mark('failed-save-retains-table-and-retry-persists-once')

  await mode(false)
  assert.equal(await evaluate("document.querySelectorAll('.table-column-resizer,.table-reorder-handle,.table-action-menu-trigger,.table-selection-modebar').length"), 0)
  await click(cellSelector(0, 0)); await type('READONLY-FORBIDDEN'); await settle()
  assert.equal(await body(), retried)
  await mode(true); await menu(0, 0)
  await open(destination, prefix + '-destination'); await open(main, 'R1C1')
  assert.equal(await evaluate("!!document.querySelector('.table-action-menu[role=menu],.table-selection-modebar')"), false)
  assert.equal(await body(), retried)
  mark('reading-mode-and-document-switch-keep-saved-table')
  const origin = await evaluate('performance.timeOrigin')
  await cdp.send('Page.reload')
  await until(() => evaluate(`performance.timeOrigin!==${origin}&&!!document.querySelector('.workspace-sidebar')`), 'Real Table renderer reload did not complete')
  await open(main, 'R1C1'); await mode(true)
  assert.equal(await body(), retried)
  report.reloaded = { content: await body(), sha256: hash(await body()), ui: await observe(), originBefore: origin, originAfter: await evaluate('performance.timeOrigin') }
  assert.deepEqual(report.reloaded.ui.rows.map(row => row.map(cell => cell.text)), retriedRows)
  await capture('table-native-reloaded.png'); mark('renderer-reload-preserves-exact-table-json')

  const largeJSON = JSON.parse(initial), largeTable = tableFromContent(initial)
  largeTable.colWidths = [240, 320, 240]; largeTable.frozenRowCount = 1; largeTable.frozenColumnCount = 1
  largeTable.children = Array.from({ length: 80 }, (_, row) => {
    const value = structuredClone(largeTable.children[0])
    value.children.forEach((cell, col) => {
      cell.headerState = row === 0 ? 1 : 0; cell.width = largeTable.colWidths[col]
      cell.children = [structuredClone(cell.children[0])]
      cell.children[0].children = [structuredClone(cell.children[0].children[0])]
      cell.children[0].children[0].text = `LONG-${row + 1}-${col + 1}-` + (col === 0 && row > 0 ? '连续长文本'.repeat(36) : 'value')
    })
    return value
  })
  largeJSON.root.children = largeJSON.root.children.map(node => node.type === 'table' ? largeTable : node)
  const large = await createNote(prefix + '-large.md', q(largeJSON)), largeRoute = '/api/files/' + encodeURIComponent(large.id)
  report.fixture.largeID = large.id; report.largeSeed = { content: large.content, sha256: hash(large.content) }; save()
  await open(large, 'LONG-1-1-'); await mode(true)
  await point(cellSelector(0, 0))
  const verticalPoint = await point('.editor-input table'), verticalBefore = await frozenView()
  await wheel(verticalPoint, 0, 120)
  const verticalAfter = await until(async () => {
    const view = await frozenView(); return view.scrollTop - verticalBefore.scrollTop > 20 && view
  }, 'Real native wheel did not scroll the frozen table vertically')
  assert.ok(Math.abs(verticalAfter.headTop - verticalBefore.headTop) <= 1)
  assert.ok(verticalBefore.normalTop - verticalAfter.normalTop > 20)
  report.frozenScroll = { vertical: { before: verticalBefore, after: verticalAfter } }; save()
  assert.equal((await api(largeRoute)).content, large.content, 'Frozen scrolling changed persisted Table state')
  await click(cellSelector(79, 2) + ' p'); await key('End', 35); await type('-tail-saved')
  const largeSaved = await checkpoint('large-saved', value => tableTextRows(value)[79][2].endsWith('-tail-saved'), largeRoute)
  const largeExpected = tableTextRows(large.content); largeExpected[79][2] += '-tail-saved'
  assert.deepEqual(tableTextRows(largeSaved), largeExpected)
  await menu(79, 1)
  await capture('table-native-long.png'); await key('Escape', 27)
  mark('large-long-text-table-keeps-final-row-identity')

  await resizeSmall()
  await until(() => evaluate('innerWidth>=640&&innerWidth<=720&&innerHeight>=400'), 'Native minimum Table window did not settle')
  if (await evaluate("innerWidth<=820&&!!document.querySelector('.workspace-sidebar:not(.collapsed)')")) await click('.workspace-sidebar button[aria-label="折叠侧边栏"]')
  const horizontalPoint = await point('.editor-input table')
  await wheel(horizontalPoint, -1000, 0)
  await until(async () => (await frozenView()).scrollLeft <= 1, 'Native horizontal wheel did not return Table to its first column')
  const horizontalBefore = await frozenView()
  assert.ok(horizontalBefore.scrollWidth - horizontalBefore.clientWidth > 40, 'Wide Table fixture does not exercise real horizontal overflow')
  await wheel(horizontalPoint, 120, 0)
  const horizontalAfter = await until(async () => {
    const view = await frozenView(); return view.scrollLeft - horizontalBefore.scrollLeft > 20 && view
  }, 'Real native wheel did not scroll the frozen table horizontally')
  assert.ok(Math.abs(horizontalAfter.headLeft - horizontalBefore.headLeft) <= 1)
  assert.ok(horizontalBefore.normalLeft - horizontalAfter.normalLeft > 20)
  report.frozenScroll.horizontal = { before: horizontalBefore, after: horizontalAfter }; save()
  await menu(79, 1)
  const menuView = () => evaluate(`(() => {const node=document.querySelector('.table-action-menu'),r=node?.getBoundingClientRect();return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1}:null})()`)
  report.smallMenu = await menuView()
  assert.ok(report.smallMenu.left >= 0 && report.smallMenu.right <= report.smallMenu.width + 1)
  assert.ok(report.smallMenu.top >= 0 && report.smallMenu.bottom <= report.smallMenu.height + 1)
  assert.equal(report.smallMenu.overflow, false)
  await capture('table-native-small.png'); await key('Escape', 27)
  assert.equal((await api(largeRoute)).content, largeSaved)
  mark('native-minimum-window-menu-is-reachable')
  await click('.workspace-sidebar-more[aria-label="更多功能"]')
  if (await evaluate("document.documentElement.getAttribute('data-theme')!=='dark'")) await click('.theme-toggle[aria-label="切换主题"]')
  await click('.workspace-sidebar-more[aria-label="更多功能"]')
  await until(() => evaluate("document.documentElement.getAttribute('data-theme')==='dark'"), 'Actual Table dark theme did not settle')
  await menu(79, 1)
  report.darkMenu = await menuView()
  report.darkMenu.theme = await evaluate("document.documentElement.getAttribute('data-theme')")
  assert.ok(report.darkMenu.top >= 0 && report.darkMenu.bottom <= report.darkMenu.height + 1)
  await key('Escape', 27)
  await menu(79, 1, '蓝色')
  await checkpoint('large-dark-saved', value => tableFromContent(value).children[79].children[1].backgroundColor === '#cff4fc', largeRoute)
  report.darkCell = await evaluate(`(() => {
    const cell=document.querySelector(${q(cellSelector(79, 1))}),walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT)
    const node=walker.nextNode(),element=node?.parentElement
    return {text:node?.textContent||'',foreground:getComputedStyle(element).color,background:getComputedStyle(cell).backgroundColor}
  })()`)
  assert.ok(nativeTableContrast(report.darkCell.foreground, report.darkCell.background) >= 4.5, 'Actual dark-theme Table text is unreadable on its custom background')
  await menu(79, 1); await capture('table-native-dark.png'); await key('Escape', 27)
  mark('dark-minimum-window-keeps-table-operations')
  report.saved = { main: await api(route), large: await api(largeRoute), destination: await api('/api/files/' + encodeURIComponent(destination.id)) }
  report.businessElapsedMs = performance.now() - started
  assert.ok(report.businessElapsedMs < TABLE_OPERATIONS_BUDGET_MS)
  save()
}
