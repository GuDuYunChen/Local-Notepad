import test from 'node:test'
import assert from 'node:assert/strict'
import { UI_SCREEN_COLLECTION_PREFIX, createUiScreenPopupReader, captureUiScreenPopup, captureUiScreenPage, validateUiScreenPopupObservation, validateUiScreensEvidence } from './ui-screens-evidence.mjs'

const focus = () => ({ focused: true, focusVisible: true, inViewport: true, hit: true,
  outlines: [{ owner: 'root', width: 2 }], shadows: [] })
const pageRead = scene => ({ page: scene.page, theme: scene.theme, region: scene.region, regionBounds: structuredClone(scene.regionBounds),
  controls: structuredClone(scene.controls), viewport: { ...scene.viewport }, devicePixelRatio: scene.devicePixelRatio,
  overflow: scene.overflow, regionOverflow: scene.regionOverflow, ...(scene.layout ? { layout: structuredClone(scene.layout) } : {}) })
const popupRead = options => ({ inputId: 'collection-trigger', expanded: true, optionsAvailable: true, ownedByDialog: true,
  value: UI_SCREEN_COLLECTION_PREFIX + 'a', options: structuredClone(options || ['', UI_SCREEN_COLLECTION_PREFIX + 'a', UI_SCREEN_COLLECTION_PREFIX + 'b']
    .map(value => ({ value, height: 32, width: 200, hit: true, disabled: false }))),
  popup: { listId: 'collection-trigger_list', optionId: 'collection-trigger_list_0', optionValue: '',
    root: { left: 100, top: 100, right: 400, bottom: 208, width: 300, height: 108 },
    content: { left: 104, top: 104, right: 396, bottom: 200, width: 292, height: 96 },
    item: { left: 104, top: 104, right: 396, bottom: 136, width: 292, height: 32 },
    ancestors: [{ tag: 'div', class: 'ant-select-item-option', display: 'block', visibility: 'visible', opacity: '1' },
      { tag: 'div', class: 'ant-select-dropdown', display: 'block', visibility: 'visible', opacity: '1' }],
    visible: true, inViewport: true, ownedHit: true, ready: true, paintFrames: 2 } })
function complete() {
  const collections = [{ key: UI_SCREEN_COLLECTION_PREFIX + 'a', name: 'A long synthetic collection name that must remain intact in the real dropdown', count: 2 }, { key: UI_SCREEN_COLLECTION_PREFIX + 'b', name: 'Second synthetic collection', count: 2 }]
  const ui = { schema: 1, scope: 'installed-original-three-pages', complete: true,
    setup: { createdThroughUi: true, noteIDs: ['note-a', 'note-b'], collections },
    notesUnchanged: true, syncSettingsUnchanged: true, externalRequests: [], forbiddenRequests: [], runtimeErrors: [], scenes: [] }
  const viewport = { width: 704, height: 455 }
  ui.minimumSidebar = { action: 'collapse', trustedCollapseClicks: 1,
    before: { viewport: { ...viewport }, collapsed: false, occluding: true, collapseButton: { unique: true, inViewport: true, hit: true } },
    after: { viewport: { ...viewport }, collapsed: true, occluding: false },
    entries: ['搜索笔记', '置顶笔记', '更多功能'].map(label => ({ label, viewport: { ...viewport }, unique: true, inViewport: true, hit: true })) }
  for (const size of ['wide', 'narrow']) for (const theme of ['light', 'dark']) for (const page of ['webdav', 'collections', 'pinned']) {
    const viewport = size === 'wide' ? { width: 1084, height: 655 } : { width: 704, height: 455 }
    const ids = page === 'webdav' ? ['endpoint', 'username', 'password'] : page === 'collections' ? ['saved-collection'] : ['query', 'scope', 'order', 'clear']
    const scene = { name: `${theme}-${size}-${page}`, page, theme, size, complete: true, nativeWindow: true,
      viewport, requestedViewport: { ...viewport }, devicePixelRatio: 1, overflow: 0, regionOverflow: 0,
      controls: ids.map((id, index) => {
        const top = page === 'pinned' && size === 'narrow' ? 40 + index * 50 : 40
        return { id, kind: id === 'password' ? 'password' : 'input', height: 40, width: 120, left: 40, right: 160, top, bottom: top + 40,
          ...(id === 'password' ? { innerPadding: [0, 0, 0, 0], innerHeight: 22 } : {}) }
      }), focus: Array.from({ length: page === 'pinned' ? 4 : 1 }, focus), events: { click: 2, Tab: 2, ArrowDown: 3, Enter: 1, Escape: 3 },
      screenshot: { filename: `${theme}-${size}-${page}.png`, bytes: 1500, sha256: 'a'.repeat(64) } }
    if (page === 'collections') scene.popup = { actualSharedControl: true, ownedByDialog: true, repeatClosed: true,
      escapeRetainedDialog: true, escapeRetainedFocus: true, secondEscapeClosedDialog: true, triggerFocusRestored: true,
      keyboardCommitted: true, pointerValue: collections[0].key, keyboardValue: collections[1].key, displayedName: collections[1].name,
      options: ['', ...collections.map(item => item.key)].map(value => ({ value, height: 32, width: 200, hit: true, disabled: false })) }
    if (page === 'collections') {
      const actions = disabled => ['检查当前变化', '备份此资料集 JSON', '删除此资料集'].map(label => ({ label, count: 1, disabled }))
      const stored = () => ({ keys: collections.map(item => item.key).sort(), bytes: 1600, sha256: 'b'.repeat(64) })
      scene.popup.emptySelection = { beforeValue: collections[1].key, trustedOptionClicks: 1,
        cleared: { value: '', expanded: false, focused: true, dialogPresent: true, contextName: null, queryValue: null,
          statusValue: null, rowCount: 0, paginationText: null, emptyMessagePresent: true, actions: actions(true) },
        restored: { value: collections[1].key, expanded: false, focused: true, dialogPresent: true, contextName: collections[1].name,
          queryValue: '', statusValue: 'all', rowCount: 2, paginationText: '第 1 / 1 页', emptyMessagePresent: false, actions: actions(false) },
        storage: { prefix: UI_SCREEN_COLLECTION_PREFIX, before: stored(), cleared: stored(), restored: stored() } }
    }
    if (page === 'pinned') scene.layout = { allHeightsEqual: true, rowsAligned: true, rowCount: size === 'wide' ? 1 : 4 }
    if (page !== 'collections') {
      scene.region = page === 'webdav' ? '.sync-provider-grid' : '.pinned-workspace'
      scene.regionBounds = { left: 20, top: 20, right: viewport.width - 20, bottom: 300, width: viewport.width - 40, height: 280 }
      const selectors = page === 'webdav' ? ['input[aria-label="WebDAV 端点"]', 'input[aria-label="WebDAV 用户名"]', 'input[aria-label="WebDAV 密码"]']
        : ['.pinned-tools input[aria-label="查找置顶笔记"]', '.pinned-tools [role="combobox"][aria-label="置顶显示范围"]', '.pinned-tools [role="combobox"][aria-label="置顶笔记排序"]', '.pinned-tools button.pinned-clear']
      for (const [index, control] of scene.controls.entries()) Object.assign(control, { selector: selectors[index], owner: scene.region,
        fieldTag: control.id === 'clear' ? 'BUTTON' : 'INPUT', fieldId: 'owned-' + control.id, rootTag: control.id === 'password' ? 'SPAN' : 'INPUT',
        rootId: 'owned-root-' + control.id, owned: true, visible: true, inViewport: true, hit: true, disabled: false,
        ancestors: [{ display: 'block', visibility: 'visible', opacity: '1' }] })
      scene.capture = { complete: true, filename: scene.screenshot.filename, before: pageRead(scene), after: pageRead(scene), image: structuredClone(scene.screenshot) }
    }
    if (page === 'collections') {
      const observed = popupRead(scene.popup.options)
      Object.assign(scene.popup, { inputId: observed.inputId, value: observed.value, expanded: true, optionsAvailable: true, paint: observed.popup,
        capture: { complete: true, filename: scene.screenshot.filename, before: structuredClone(observed), after: structuredClone(observed), image: structuredClone(scene.screenshot) } })
    }
    ui.scenes.push(scene)
  }
  return ui
}
test('accepts complete three-page evidence without changing observations', () => {
  const ui = complete(), original = JSON.stringify(ui); validateUiScreensEvidence(ui); assert.equal(JSON.stringify(ui), original)
})
test('cannot promote partial, duplicate or fixture-only scenes to installed-page evidence', () => {
  for (const mutate of [ui => ui.scenes.pop(), ui => { ui.scenes[1] = structuredClone(ui.scenes[0]) }, ui => { ui.scenes[0].nativeWindow = false }, ui => { ui.complete = false }]) {
    const ui = complete(); mutate(ui); assert.throws(() => validateUiScreensEvidence(ui))
  }
})
test('requires the exact704x455 minimum rather than a nearby wider viewport', () => {
  const ui = complete(), scene = ui.scenes.find(scene => scene.size === 'narrow'); scene.viewport.width = 760; scene.requestedViewport.width = 760
  assert.throws(() => validateUiScreensEvidence(ui), /exactly 704x455/)
})
test('requires observed sidebar occlusion, one trusted collapse click and unchanged reachable minimum-window entries', () => {
  for (const mutate of [receipt => { receipt.before.occluding = false }, receipt => { receipt.trustedCollapseClicks = 2 },
    receipt => { receipt.before.collapseButton.hit = false }, receipt => { receipt.after.occluding = true },
    receipt => { receipt.after.viewport.width = 760 }, receipt => { receipt.entries[2].hit = false }]) {
    const ui = complete(); mutate(ui.minimumSidebar); assert.throws(() => validateUiScreensEvidence(ui))
  }
  const ui = complete(), receipt = ui.minimumSidebar
  receipt.action = 'none'; receipt.trustedCollapseClicks = 0; receipt.before.collapsed = true; receipt.before.occluding = false
  validateUiScreensEvidence(ui)
})
test('rejects the original WebDAV double padding and a duplicate focus glow', () => {
  const ui = complete(); ui.scenes[0].controls.find(control => control.id === 'password').innerPadding = [9, 10, 9, 10]
  assert.throws(() => validateUiScreensEvidence(ui), /second padding/)
  const glow = complete(); glow.scenes[0].focus[0].shadows.push({ value: '0 0 0 2px blue' })
  assert.throws(() => validateUiScreensEvidence(glow), /duplicate focus shadow/)
})
test('refuses a saved-collection popup owned by a different container or missing keyboard commitment', () => {
  for (const key of ['actualSharedControl', 'ownedByDialog', 'repeatClosed', 'escapeRetainedDialog', 'escapeRetainedFocus', 'keyboardCommitted', 'secondEscapeClosedDialog', 'triggerFocusRestored']) {
    const ui = complete(); ui.scenes.find(scene => scene.page === 'collections').popup[key] = false
    assert.throws(() => validateUiScreensEvidence(ui), /popup proof/)
  }
})
test('rejects small or obscured options and a wrong displayed saved collection', () => {
  for (const mutate of [popup => { popup.options[1].height = 20 }, popup => { popup.options[1].hit = false }, popup => { popup.displayedName = 'Wrong collection' }]) {
    const ui = complete(); mutate(ui.scenes.find(scene => scene.page === 'collections').popup)
    assert.throws(() => validateUiScreensEvidence(ui))
  }
})
test('rejects unequal toolbar controls, false row claims and missing narrow wrapping', () => {
  for (const mutate of [scene => { scene.controls[3].height = 28 }, scene => { scene.layout.rowCount = 99 }, scene => { scene.layout.rowsAligned = false }]) {
    const ui = complete(); mutate(ui.scenes.find(scene => scene.page === 'pinned'))
    assert.throws(() => validateUiScreensEvidence(ui))
  }
  const ui = complete(), scene = ui.scenes.find(scene => scene.page === 'pinned' && scene.size === 'narrow')
  scene.controls.forEach(control => { control.top = 40; control.bottom = 80 }); scene.layout.rowCount = 1
  assert.throws(() => validateUiScreensEvidence(ui), /must wrap/)
})
test('does not accept missing native input, changed notes, sync writes or external requests', () => {
  for (const mutate of [ui => { ui.scenes[0].events.Tab = 0 }, ui => { ui.notesUnchanged = false }, ui => { ui.syncSettingsUnchanged = false }, ui => ui.forbiddenRequests.push({ pathname: '/api/sync/check' }), ui => ui.externalRequests.push({ origin: 'https://example.invalid' })]) {
    const ui = complete(); mutate(ui); assert.throws(() => validateUiScreensEvidence(ui))
  }
})
test('requires an enabled empty choice beside the exact two nonempty saved collection keys', () => {
  for (const mutate of [popup => { popup.options[0].disabled = true }, popup => { popup.options[1].disabled = true },
    popup => { popup.options[0].value = 'another-key' }, popup => { popup.options[1].value = popup.options[2].value },
    popup => { popup.options[2].value = UI_SCREEN_COLLECTION_PREFIX + 'unrelated' },
    popup => { popup.keyboardValue = '' }, popup => { popup.pointerValue = UI_SCREEN_COLLECTION_PREFIX + 'unrelated' }]) {
    const ui = complete(); mutate(ui.scenes.find(scene => scene.page === 'collections').popup)
    assert.throws(() => validateUiScreensEvidence(ui))
  }
})
test('requires a trusted empty-option choice that clears the complete selected view', () => {
  for (const mutate of [empty => { empty.beforeValue = '' }, empty => { empty.trustedOptionClicks = 0 }, empty => { empty.trustedOptionClicks = 2 },
    empty => { empty.cleared.value = empty.beforeValue }, empty => { empty.cleared.expanded = true }, empty => { empty.cleared.focused = false },
    empty => { empty.cleared.dialogPresent = false }, empty => { empty.cleared.contextName = 'Retained collection' },
    empty => { empty.cleared.queryValue = '' }, empty => { empty.cleared.statusValue = 'all' }, empty => { empty.cleared.paginationText = '第 1 / 1 页' },
    empty => { empty.cleared.rowCount = 2 }, empty => { empty.cleared.emptyMessagePresent = false },
    empty => { empty.cleared.actions[0].disabled = false }, empty => { empty.cleared.actions[1].count = 0 }]) {
    const ui = complete(); mutate(ui.scenes.find(scene => scene.page === 'collections').popup.emptySelection)
    assert.throws(() => validateUiScreensEvidence(ui))
  }
  const ui = complete(); delete ui.scenes.find(scene => scene.page === 'collections').popup.emptySelection
  assert.throws(() => validateUiScreensEvidence(ui), /empty-selection receipt/)
})
test('refuses removed or changed stored collection bytes during empty selection and restoration', () => {
  for (const mutate of [storage => { storage.prefix = 'another-prefix' }, storage => { storage.before.keys.pop() },
    storage => { storage.cleared.keys.pop() }, storage => { storage.restored.keys[1] = UI_SCREEN_COLLECTION_PREFIX + 'replacement' },
    storage => { storage.cleared.sha256 = 'c'.repeat(64) }, storage => { storage.restored.sha256 = 'c'.repeat(64) },
    storage => { storage.before.sha256 = '' }, storage => { storage.cleared.bytes-- }, storage => { storage.restored.bytes-- },
    storage => { storage.before.bytes = 0 }]) {
    const ui = complete(); mutate(ui.scenes.find(scene => scene.page === 'collections').popup.emptySelection.storage)
    assert.throws(() => validateUiScreensEvidence(ui))
  }
})
test('requires the original collection to be restored with its initial filters and real rows', () => {
  for (const mutate of [state => { state.value = '' }, state => { state.contextName = 'Wrong collection' }, state => { state.queryValue = 'retained filter' },
    state => { state.statusValue = 'historical' }, state => { state.paginationText = '第 2 / 2 页' }, state => { state.rowCount = 0 },
    state => { state.emptyMessagePresent = true }, state => { state.expanded = true }, state => { state.focused = false },
    state => { state.dialogPresent = false }, state => { state.actions[2].disabled = true }]) {
    const ui = complete(); mutate(ui.scenes.find(scene => scene.page === 'collections').popup.emptySelection.restored)
    assert.throws(() => validateUiScreensEvidence(ui))
  }
})

test('refuses transparent popup ancestry even when option dimensions and hit testing pass', () => {
  const ui = complete(), popup = ui.scenes.find(scene => scene.page === 'collections').popup
  popup.paint.ancestors[1].opacity = '0'
  assert.throws(() => validateUiScreensEvidence(ui), /popup|paint|opacity/i)
})

test('refuses a popup screenshot based only on a sample read before the paint boundary', () => {
  const ui = complete(), popup = ui.scenes.find(scene => scene.page === 'collections').popup
  popup.paint.paintFrames = 0
  assert.throws(() => validateUiScreensEvidence(ui), /popup|paint/i)
})

test('refuses screenshot evidence without a fresh read of the same popup at capture', () => {
  const ui = complete(), popup = ui.scenes.find(scene => scene.page === 'collections').popup
  popup.capture.before.inputId = 'old-owner'; popup.capture.after.inputId = 'different-owner'
  assert.throws(() => validateUiScreensEvidence(ui), /popup|capture/i)
})

test('popup readiness waits for paint and a fresh visible read without blocking its existing deadline', async () => {
  const frames = [], sample = popupRead()
  const read = createUiScreenPopupReader(() => structuredClone(sample), () => new Promise(resolve => frames.push(resolve)))
  assert.equal((await read()).popup.paintFrames, 0)
  assert.equal((await read()).popup.paintFrames, 0); assert.equal(frames.length, 1)
  sample.popup.ancestors[1].opacity = '0'
  assert.equal((await read()).popup.ready, false)
  frames[0](); await new Promise(resolve => setImmediate(resolve))
  sample.popup.ancestors[1].opacity = '1'
  assert.equal((await read()).popup.paintFrames, 0); assert.equal(frames.length, 2)
  frames[1](); await new Promise(resolve => setImmediate(resolve))
  validateUiScreenPopupObservation(await read())
  sample.popup.listId = 'new-owned-list'
  assert.equal((await read()).popup.ready, false)
  assert.equal((await read()).popup.paintFrames, 0); assert.equal(frames.length, 3)
})

test('a paint completed during a DOM read cannot certify that earlier installed-page sample', async () => {
  const sample = popupRead(), frames = []; let resolveRead, reads = 0
  const read = createUiScreenPopupReader(() => ++reads === 2 ? new Promise(resolve => { resolveRead = resolve }) : structuredClone(sample),
    () => new Promise(resolve => frames.push(resolve)))
  assert.equal((await read()).popup.paintFrames, 0)
  const staleRead = read()
  await new Promise(resolve => setImmediate(resolve)); frames[0]()
  await new Promise(resolve => setImmediate(resolve)); resolveRead(structuredClone(sample))
  assert.equal((await staleRead).popup.paintFrames, 0)
  assert.equal((await read()).popup.paintFrames, 2)
})

test('popup paint errors remain failures and a never-completed frame does not block polling', async () => {
  const read = createUiScreenPopupReader(popupRead, () => new Promise(() => {}))
  assert.equal((await read()).popup.paintFrames, 0); assert.equal((await read()).popup.paintFrames, 0)
  const failure = Error('Renderer paint failed'), failed = createUiScreenPopupReader(popupRead, async () => { throw failure })
  await failed(); await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(failed, error => error === failure)
})

test('capture rechecks the currently owned popup after the runner paint wait and after the image', async () => {
  const opened = popupRead(), record = {}, order = [], image = { filename: 'popup.png', bytes: 1200, sha256: 'a'.repeat(64) }
  const actual = await captureUiScreenPopup({ opened, filename: image.filename, record,
    read: async () => { order.push('read-current-popup'); return structuredClone(opened) },
    capture: async (filename, guard) => { assert.equal(filename, image.filename); order.push('existing-two-frames'); await guard(); order.push('capture-image'); return image } })
  assert.deepEqual(order, ['existing-two-frames', 'read-current-popup', 'capture-image', 'read-current-popup'])
  assert.deepEqual(actual, image); assert.equal(record.complete, true); assert.deepEqual(record.image, image)
  assert.deepEqual(record.before, opened); assert.deepEqual(record.after, opened)
})

test('capture refuses a popup hidden or replaced during its own frame wait without taking an image', async () => {
  for (const mutate of [sample => { sample.popup.ancestors[1].opacity = '0' }, sample => { sample.popup.listId = 'another-list' },
    sample => { sample.value = UI_SCREEN_COLLECTION_PREFIX + 'b' }, sample => { sample.popup.paintFrames = 0 }]) {
    const opened = popupRead(), current = structuredClone(opened), record = {}; let captured = false
    await assert.rejects(() => captureUiScreenPopup({ opened, filename: 'popup.png', record, read: async () => current,
      capture: async (_, guard) => { mutate(current); await guard(); captured = true; return { filename: 'popup.png' } } }))
    assert.equal(captured, false); assert.equal(record.complete, false)
  }
})

test('capture refuses a missing pre-image guard or changed post-image ownership', async () => {
  const opened = popupRead(), image = { filename: 'popup.png', bytes: 1200, sha256: 'a'.repeat(64) }
  await assert.rejects(() => captureUiScreenPopup({ opened, filename: image.filename, record: {}, read: popupRead, capture: async () => image }), /omitted.*guard/)
  const record = {}; let captured = false
  await assert.rejects(() => captureUiScreenPopup({ opened, filename: image.filename, record,
    read: async () => { const sample = popupRead(); if (captured) sample.inputId = 'replacement'; return sample },
    capture: async (_, guard) => { await guard(); captured = true; return image } }), /owner|selection/)
  assert.equal(record.complete, false)
})

test('ordinary page evidence refuses a target scrolled out between its observation and PNG', () => {
  for (const phase of ['before', 'after']) {
    const ui = complete(), scene = ui.scenes.find(item => item.page === 'pinned')
    const target = scene.capture[phase].controls[0]
    Object.assign(target, { top: scene.viewport.height + 10, bottom: scene.viewport.height + 50, inViewport: false, hit: false })
    assert.throws(() => validateUiScreensEvidence(ui), /target|viewport|capture/i)
  }
})

test('ordinary page evidence requires both fresh target reads tied to the exact screenshot', () => {
  for (const mutate of [scene => { delete scene.capture }, scene => { delete scene.capture.before }, scene => { delete scene.capture.after },
    scene => { scene.capture.complete = false }, scene => { scene.capture.filename = 'other.png' }, scene => { scene.capture.image.sha256 = 'c'.repeat(64) }]) {
    const ui = complete(); mutate(ui.scenes[0]); assert.throws(() => validateUiScreensEvidence(ui), /target|capture|screenshot/i)
  }
})

test('ordinary page PNG reads refuse a hidden, obscured, moved or differently owned target', () => {
  for (const mutate of [sample => { sample.controls[0].visible = false }, sample => { sample.controls[0].hit = false },
    sample => { sample.controls[0].left += 2; sample.controls[0].right += 2 }, sample => { sample.controls[0].owner = '.other-page' },
    sample => { sample.controls[0].fieldId = 'different-field' }, sample => { sample.controls[0].ancestors[0].opacity = '0' },
    sample => { sample.theme = sample.theme === 'dark' ? 'light' : 'dark' }]) {
    const ui = complete(); mutate(ui.scenes[0].capture.after); assert.throws(() => validateUiScreensEvidence(ui), /target|capture|viewport|theme/i)
  }
})

test('ordinary page capture reads its actual target after runner paint and immediately after PNG', async () => {
  const scene = complete().scenes.find(item => item.page === 'pinned'), observed = pageRead(scene), record = {}, order = []
  const actual = await captureUiScreenPage({ observed, filename: scene.screenshot.filename, record,
    read: async () => { order.push('read'); return structuredClone(observed) },
    capture: async (filename, guard) => { order.push('paint'); await guard(); order.push('png'); return scene.screenshot } })
  assert.deepEqual(order, ['paint', 'read', 'png', 'read'])
  assert.deepEqual(actual, scene.screenshot); assert.equal(record.complete, true)
  assert.deepEqual(record.before, observed); assert.deepEqual(record.after, observed); assert.deepEqual(record.image, actual)
})

test('ordinary capture refuses scrolling during its paint wait and target loss after the PNG', async () => {
  const scene = complete().scenes.find(item => item.page === 'pinned'), observed = pageRead(scene)
  for (const phase of ['paint', 'png']) {
    let current = structuredClone(observed), captures = 0
    const record = {}, loseTarget = () => { current.controls[0].inViewport = false; current.controls[0].top += 1000; current.controls[0].bottom += 1000 }
    await assert.rejects(() => captureUiScreenPage({ observed, filename: scene.screenshot.filename, record, read: async () => structuredClone(current),
      capture: async (filename, guard) => {
        if (phase === 'paint') loseTarget()
        await guard(); captures++
        if (phase === 'png') loseTarget()
        return scene.screenshot
      } }), /target|viewport|capture/i)
    assert.equal(captures, phase === 'paint' ? 0 : 1); assert.equal(record.complete, false)
    assert.equal(record[phase === 'paint' ? 'before' : 'after'].controls[0].inViewport, false)
    if (phase === 'png') assert.deepEqual(record.image, scene.screenshot)
  }
})

test('ordinary capture refuses an omitted guard and preserves the original capture error', async () => {
  const scene = complete().scenes[0], observed = pageRead(scene)
  await assert.rejects(() => captureUiScreenPage({ observed, filename: scene.screenshot.filename, record: {}, read: async () => observed,
    capture: async () => scene.screenshot }), /omitted.*guard/)
  const failure = new Error('actual PNG capture failed'), record = {}
  await assert.rejects(() => captureUiScreenPage({ observed, filename: scene.screenshot.filename, record, read: async () => observed,
    capture: async (filename, guard) => { await guard(); throw failure } }), error => error === failure)
  assert.equal(record.complete, false); assert.equal(record.after, undefined)
})
