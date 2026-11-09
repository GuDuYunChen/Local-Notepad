import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import controlEvidence from './check-ui-control-render.cjs'

export const UI_SCREEN_PAGES = Object.freeze(['webdav', 'collections', 'pinned'])
export const UI_SCREEN_THEMES = Object.freeze(['light', 'dark'])
export const UI_SCREEN_SIZES = Object.freeze(['wide', 'narrow'])
export const UI_SCREEN_COLLECTION_PREFIX = 'localNotepad.searchCollection.v1:'
const CONTROL_IDS = Object.freeze({ webdav: ['endpoint', 'username', 'password'], collections: ['saved-collection'], pinned: ['query', 'scope', 'order', 'clear'] })
const tolerance = 0.6
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const PAGE_TARGETS = Object.freeze({
  webdav: { region: '.sync-provider-grid', selectors: ['input[aria-label="WebDAV 端点"]', 'input[aria-label="WebDAV 用户名"]', 'input[aria-label="WebDAV 密码"]'] },
  pinned: { region: '.pinned-workspace', selectors: ['.pinned-tools input[aria-label="查找置顶笔记"]', '.pinned-tools [role="combobox"][aria-label="置顶显示范围"]', '.pinned-tools [role="combobox"][aria-label="置顶笔记排序"]', '.pinned-tools button.pinned-clear'] },
})

export function validateUiScreenPageObservation(sample) {
  const target = PAGE_TARGETS[sample?.page]
  assert.ok(target, 'Ordinary page capture target required')
  assert.equal(sample.region, target.region, 'Ordinary page capture region differs')
  assert.ok(UI_SCREEN_THEMES.includes(sample.theme), 'Ordinary page capture theme required')
  assert.ok(sample.viewport && sample.viewport.width > 0 && sample.viewport.height > 0, 'Ordinary page capture viewport required')
  assert.ok(Number.isFinite(sample.devicePixelRatio) && sample.devicePixelRatio > 0, 'Ordinary page capture native scale required')
  assert.ok(sample.overflow <= 1 && sample.regionOverflow <= 1, 'Ordinary page capture may not overflow horizontally')
  const bounds = sample.regionBounds
  assert.ok(bounds && ['left', 'right', 'top', 'bottom', 'width', 'height'].every(key => Number.isFinite(bounds[key])), 'Ordinary page capture region bounds required')
  assert.ok(bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < sample.viewport.width && bounds.top < sample.viewport.height, 'Ordinary page capture region is outside the viewport')
  assert.deepEqual(sample.controls?.map(control => control.id), CONTROL_IDS[sample.page], 'Every original ordinary page target is required')
  assert.deepEqual(sample.controls.map(control => control.selector), target.selectors, 'Ordinary page capture target selectors differ')
  for (const control of sample.controls) {
    assert.equal(control.owner, target.region, 'Ordinary page target owner differs')
    for (const flag of ['owned', 'visible', 'inViewport', 'hit']) assert.equal(control[flag], true, 'Ordinary page target must remain owned, visible and unobscured: ' + flag)
    assert.equal(typeof control.disabled, 'boolean', 'Ordinary page target disabled state required')
    for (const key of ['fieldTag', 'fieldId', 'rootTag', 'rootId']) assert.equal(typeof control[key], 'string', 'Ordinary page target identity required')
    assert.ok(control.ancestors?.length > 0 && control.ancestors.every(css => css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0), 'Ordinary page target ancestors must remain visible')
    assert.ok(['left', 'right', 'top', 'bottom', 'width', 'height'].every(key => Number.isFinite(control[key])), 'Ordinary page target bounds required')
    assert.ok(control.width > 20 && Math.abs(control.height - 40) <= tolerance, 'Ordinary page target must preserve its 40px geometry')
    assert.ok(control.left >= -1 && control.top >= -1 && control.right <= sample.viewport.width + 1 && control.bottom <= sample.viewport.height + 1, 'Ordinary page target is outside the capture viewport')
    assert.ok(Math.abs(control.right - control.left - control.width) <= tolerance && Math.abs(control.bottom - control.top - control.height) <= tolerance, 'Ordinary page target rectangle is inconsistent')
  }
  return sample
}

function validateUiScreenPageContinuity(expected, actual) {
  validateUiScreenPageObservation(expected); validateUiScreenPageObservation(actual)
  for (const key of ['page', 'region', 'theme', 'devicePixelRatio']) assert.equal(actual[key], expected[key], 'Ordinary page capture ' + key + ' changed')
  assert.deepEqual(actual.viewport, expected.viewport, 'Ordinary page capture viewport changed')
  for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) assert.ok(Math.abs(actual.regionBounds[key] - expected.regionBounds[key]) <= tolerance, 'Ordinary page capture region moved')
  for (const [index, target] of expected.controls.entries()) {
    const current = actual.controls[index]
    for (const key of ['id', 'kind', 'selector', 'owner', 'fieldTag', 'fieldId', 'rootTag', 'rootId', 'disabled']) assert.equal(current[key], target[key], 'Ordinary page capture target identity changed: ' + key)
    for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) assert.ok(Math.abs(current[key] - target[key]) <= tolerance, 'Ordinary page capture target moved: ' + key)
    if (target.kind === 'password') {
      assert.deepEqual(current.innerPadding, target.innerPadding, 'Ordinary page capture password padding changed')
      assert.ok(Math.abs(current.innerHeight - target.innerHeight) <= tolerance, 'Ordinary page capture password height changed')
    }
  }
  if (expected.layout) assert.deepEqual(actual.layout, expected.layout, 'Ordinary page capture toolbar layout changed')
}

export async function captureUiScreenPage({ capture, filename, read, observed, record }) {
  validateUiScreenPageObservation(observed)
  record.complete = false; record.filename = filename
  const image = await capture(filename, async () => {
    // This guard runs after the existing runner paint wait, immediately before
    // the actual PNG. A scroll during that wait must not certify an old sample.
    record.before = await read(); validateUiScreenPageContinuity(observed, record.before)
  })
  assert.ok(record.before, 'Ordinary page screenshot capture omitted the fresh target guard')
  record.image = image
  record.after = await read(); validateUiScreenPageContinuity(record.before, record.after)
  record.complete = true
  return image
}

const popupIdentity = sample => JSON.stringify([sample?.inputId, sample?.popup?.listId, sample?.popup?.optionId, sample?.value])
const visiblePopup = sample => sample?.expanded === true && sample.optionsAvailable === true && sample.ownedByDialog === true &&
  sample.popup?.ready === true && sample.popup.visible === true && sample.popup.inViewport === true && sample.popup.ownedHit === true &&
  sample.popup.ancestors?.length > 0 && sample.popup.ancestors.every(css => css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0)

export function createUiScreenPopupReader(read, paint) {
  let owner = null
  return controlEvidence.paintedPopupReader(async () => {
    const sample = await read()
    if (!visiblePopup(sample)) { owner = null; return sample ? { ...sample, popup: sample.popup && { ...sample.popup, ready: false } } : { expanded: false, optionsAvailable: false, popup: null } }
    const identity = popupIdentity(sample), changed = owner !== null && owner !== identity
    owner = identity
    // A newly owned list cannot inherit a previous popup's completed paint.
    return changed ? { ...sample, popup: { ...sample.popup, ready: false } } : sample
  }, paint)
}

export function validateUiScreenPopupObservation(sample) {
  assert.ok(visiblePopup(sample), 'Current owned popup and its ancestors must be visible and unobscured')
  assert.ok(typeof sample.inputId === 'string' && sample.inputId, 'Current popup trigger identity required')
  for (const key of ['listId', 'optionId']) assert.ok(typeof sample.popup[key] === 'string' && sample.popup[key], 'Current popup ' + key + ' required')
  assert.equal(sample.popup.paintFrames, 2, 'Popup must be freshly observed after two paint frames')
  for (const key of ['root', 'content', 'item']) {
    const rect = sample.popup[key]
    assert.ok(rect && ['left', 'top', 'right', 'bottom', 'width', 'height'].every(name => Number.isFinite(rect[name])), 'Current popup bounds required')
    assert.ok(rect.width > 0 && rect.height > 0 && rect.right > rect.left && rect.bottom > rect.top, 'Current popup bounds must be positive')
  }
  assert.equal(sample.options?.length, 3, 'Current popup must contain all three original options')
  for (const option of sample.options) {
    assert.equal(option.disabled, false, 'Current popup options must remain selectable')
    assert.ok(option.height >= 31.4 && option.width > 20 && option.hit === true, 'Current popup options must be visible and unobscured')
  }
  return true
}

export async function captureUiScreenPopup({ capture, filename, read, opened, record }) {
  validateUiScreenPopupObservation(opened)
  const identity = popupIdentity(opened), values = opened.options.map(option => option.value)
  const verify = sample => {
    validateUiScreenPopupObservation(sample)
    assert.equal(popupIdentity(sample), identity, 'Popup owner or selection changed before screenshot capture')
    assert.deepEqual(sample.options.map(option => option.value), values, 'Popup options changed before screenshot capture')
  }
  record.complete = false; record.filename = filename
  const image = await capture(filename, async () => {
    // The runner invokes this AFTER its existing double RAF and immediately
    // before Page.captureScreenshot, not before the capture's own paint wait.
    record.before = await read(); verify(record.before)
  })
  assert.ok(record.before, 'Screenshot capture omitted the current-popup guard')
  record.after = await read(); verify(record.after)
  record.image = image; record.complete = true
  return image
}

export function validateUiScreenFocus(sample) {
  assert.equal(sample.focused, true, 'Actual keyboard focus owner required')
  assert.equal(sample.focusVisible, true, 'Native Tab must produce a visible focus cue')
  assert.equal(sample.inViewport, true, 'Focused control must be visible without clipping')
  assert.equal(sample.hit, true, 'Focused control must not be obscured')
  assert.equal(sample.outlines.length, 1, 'Exactly one focus outline required')
  assert.equal(sample.outlines[0].owner, 'root', 'The real outer control must own the focus cue')
  assert.ok(sample.outlines[0].width >= 1.5, 'Focus outline must have a visible width')
  assert.equal(sample.shadows.length, 0, 'Visible duplicate focus shadow refused')
}

export function validateUiScreenMinimumSidebar(receipt) {
  assert.ok(receipt, 'Observed minimum-window sidebar receipt required')
  for (const state of [receipt.before, receipt.after]) {
    assert.deepEqual(state.viewport, { width: 704, height: 455 }, 'Sidebar handling must not change the actual minimum viewport')
    assert.equal(typeof state.collapsed, 'boolean'); assert.equal(typeof state.occluding, 'boolean')
  }
  assert.equal(receipt.after.occluding, false, 'Expanded sidebar still covers actual page content')
  if (receipt.action === 'collapse') {
    assert.equal(receipt.before.collapsed, false); assert.equal(receipt.before.occluding, true)
    for (const key of ['unique', 'inViewport', 'hit']) assert.equal(receipt.before.collapseButton[key], true, 'Real collapse button was not reachable')
    assert.equal(receipt.trustedCollapseClicks, 1, 'Exactly one trusted collapse click required')
    assert.equal(receipt.after.collapsed, true)
  } else {
    assert.equal(receipt.action, 'none'); assert.equal(receipt.before.occluding, false)
    assert.equal(receipt.trustedCollapseClicks, 0); assert.equal(receipt.after.collapsed, receipt.before.collapsed)
  }
  assert.deepEqual(receipt.entries.map(entry => entry.label), ['搜索笔记', '置顶笔记', '更多功能'])
  for (const entry of receipt.entries) {
    assert.deepEqual(entry.viewport, { width: 704, height: 455 })
    for (const key of ['unique', 'inViewport', 'hit']) assert.equal(entry[key], true, 'Actual collapsed-rail entry is not reachable: ' + entry.label)
  }
  return receipt
}

export function validateUiScreensEvidence(ui) {
  assert.equal(ui.schema, 1)
  assert.equal(ui.scope, 'installed-original-three-pages')
  assert.equal(ui.complete, true, 'Incomplete actual-page run refused')
  assert.equal(ui.setup.createdThroughUi, true, 'Collections must be saved through the installed UI')
  assert.equal(ui.setup.noteIDs.length, 2)
  assert.equal(new Set(ui.setup.noteIDs).size, 2)
  assert.equal(ui.setup.collections.length, 2)
  assert.equal(new Set(ui.setup.collections.map(item => item.key)).size, 2)
  assert.ok(ui.setup.collections.every(item => item.key && item.name && item.count === 2))
  assert.ok(ui.setup.collections.some(item => item.name.length > 30), 'Long saved collection name required')
  assert.equal(ui.notesUnchanged, true, 'Original synthetic note bodies and metadata must remain unchanged')
  assert.equal(ui.syncSettingsUnchanged, true, 'No sync configuration may be modified')
  assert.deepEqual(ui.externalRequests, [], 'External requests are outside this visual check')
  assert.deepEqual(ui.forbiddenRequests, [], 'Sync/probe or non-theme settings writes refused')
  assert.deepEqual(ui.runtimeErrors, [], 'Actual renderer exceptions refused')
  validateUiScreenMinimumSidebar(ui.minimumSidebar)
  assert.equal(ui.scenes.length, 12, 'All three pages in both themes and both native sizes are required')
  const names = new Set()
  for (const scene of ui.scenes) {
    assert.ok(UI_SCREEN_PAGES.includes(scene.page))
    assert.ok(UI_SCREEN_THEMES.includes(scene.theme))
    assert.ok(UI_SCREEN_SIZES.includes(scene.size))
    assert.equal(scene.name, `${scene.theme}-${scene.size}-${scene.page}`)
    assert.ok(!names.has(scene.name), 'Duplicate actual-page scene'); names.add(scene.name)
    assert.equal(scene.complete, true)
    assert.equal(scene.nativeWindow, true, 'Emulated page dimensions are not native window evidence')
    const { width, height } = scene.viewport
    assert.ok(Number.isFinite(width) && Number.isFinite(height))
    if (scene.size === 'wide') assert.ok(width >= 1000 && height >= 600, 'Actual wide window required')
    else assert.deepEqual(scene.viewport, { width: 704, height: 455 }, 'The actual minimum client viewport must be exactly 704x455')
    assert.deepEqual(scene.viewport, scene.requestedViewport, 'Actual client viewport must match the recorded native request')
    assert.ok(Number.isFinite(scene.devicePixelRatio) && scene.devicePixelRatio > 0, 'Native device scale must be recorded')
    assert.ok(scene.overflow <= 1 && scene.regionOverflow <= 1, 'Actual page may not overflow horizontally')
    assert.deepEqual(scene.controls.map(item => item.id), CONTROL_IDS[scene.page], 'All original screenshot controls required')
    for (const control of scene.controls) {
      assert.ok(Number.isFinite(control.height) && Math.abs(control.height - 40) <= tolerance, `${scene.page}/${control.id}: ordinary control height must be 40px`)
      assert.ok(control.width > 20 && control.left >= -1 && control.right <= width + 1, 'Control must stay inside the real viewport')
      assert.ok(Number.isFinite(control.top) && Number.isFinite(control.bottom) && Math.abs(control.bottom - control.top - control.height) <= tolerance)
      if (control.id === 'password') {
        assert.equal(control.kind, 'password')
        assert.deepEqual(control.innerPadding, [0, 0, 0, 0], 'WebDAV affix child must not have a second padding layer')
        assert.ok(control.innerHeight > 0 && control.innerHeight < control.height)
      }
    }
    assert.equal(scene.focus.length, scene.page === 'pinned' ? 4 : 1)
    scene.focus.forEach(validateUiScreenFocus)
    assert.ok(scene.events.click > 0 && scene.events.Tab > 0, 'Trusted pointer and keyboard events required')
    if (scene.page === 'collections') {
      const popup = scene.popup
      for (const flag of ['actualSharedControl', 'ownedByDialog', 'repeatClosed', 'escapeRetainedDialog', 'escapeRetainedFocus', 'secondEscapeClosedDialog', 'triggerFocusRestored', 'keyboardCommitted']) assert.equal(popup[flag], true, 'Missing saved-collection popup proof: ' + flag)
      const opened = { ...popup, popup: popup.paint }
      validateUiScreenPopupObservation(opened)
      assert.equal(popup.value, popup.pointerValue, 'Popup capture must show the pointer-selected collection')
      assert.equal(popup.capture?.complete, true, 'Fresh popup screenshot capture proof required')
      assert.equal(popup.capture.filename, scene.screenshot.filename, 'Popup capture must bind this screenshot')
      assert.deepEqual(popup.capture.image, scene.screenshot, 'Popup capture screenshot identity differs')
      for (const sample of [popup.capture.before, popup.capture.after]) {
        validateUiScreenPopupObservation(sample)
        assert.equal(popupIdentity(sample), popupIdentity(opened), 'Popup capture changed its owner or selection')
        assert.deepEqual(sample.options.map(option => option.value), popup.options.map(option => option.value), 'Popup capture changed its options')
      }
      assert.notEqual(popup.pointerValue, popup.keyboardValue)
      assert.equal(popup.options.length, 3, 'Placeholder and both real saved collections required')
      const collectionKeys = ui.setup.collections.map(item => item.key).sort()
      assert.ok(collectionKeys.includes(popup.pointerValue) && collectionKeys.includes(popup.keyboardValue), 'Pointer and keyboard choices must select the two stored collections')
      assert.deepEqual(popup.options.map(option => option.value).sort(), ['', ...collectionKeys], 'The empty choice and exact two stored collections are required')
      for (const option of popup.options) {
        assert.equal(option.disabled, false, 'The empty choice and both real collections must remain selectable')
        assert.ok(option.height >= 31.4 && option.width > 20)
        assert.equal(option.hit, true, 'Actual popup option must be visible and unobscured')
      }
      assert.ok(['ArrowDown', 'Enter', 'Escape'].every(key => scene.events[key] > 0))
      assert.equal(popup.displayedName, ui.setup.collections.find(item => item.key === popup.keyboardValue)?.name)
      const empty = popup.emptySelection
      assert.ok(empty, 'Native empty-selection receipt required')
      assert.equal(empty.beforeValue, popup.keyboardValue, 'The selected collection must be cleared through its real empty option')
      assert.equal(empty.trustedOptionClicks, 1, 'Exactly one trusted click on the actual empty option required')
      for (const state of [empty.cleared, empty.restored]) {
        assert.equal(state.dialogPresent, true); assert.equal(state.focused, true); assert.equal(state.expanded, false)
        assert.deepEqual(state.actions.map(action => action.label), ['检查当前变化', '备份此资料集 JSON', '删除此资料集'])
        assert.ok(state.actions.every(action => action.count === 1), 'Actual collection actions must be unambiguous')
      }
      assert.equal(empty.cleared.value, '')
      for (const field of ['contextName', 'queryValue', 'statusValue', 'paginationText']) assert.equal(empty.cleared[field], null, 'Clearing selection must remove its view context: ' + field)
      assert.equal(empty.cleared.rowCount, 0); assert.equal(empty.cleared.emptyMessagePresent, true)
      assert.ok(empty.cleared.actions.every(action => action.disabled === true), 'Selected-collection actions must be disabled after clearing')
      assert.equal(empty.restored.value, popup.keyboardValue)
      assert.equal(empty.restored.contextName, popup.displayedName)
      assert.equal(empty.restored.queryValue, ''); assert.equal(empty.restored.statusValue, 'all')
      assert.equal(empty.restored.paginationText, '第 1 / 1 页'); assert.equal(empty.restored.rowCount, 2)
      assert.equal(empty.restored.emptyMessagePresent, false)
      assert.ok(empty.restored.actions.every(action => action.disabled === false), 'Restored collection actions must remain enabled')
      assert.equal(empty.storage.prefix, UI_SCREEN_COLLECTION_PREFIX)
      assert.ok(collectionKeys.every(key => key.startsWith(UI_SCREEN_COLLECTION_PREFIX)))
      for (const phase of ['before', 'cleared', 'restored']) {
        const snapshot = empty.storage[phase]
        assert.deepEqual(snapshot.keys, collectionKeys, 'Clearing or restoring selection must preserve every stored collection key')
        assert.match(snapshot.sha256, /^[a-f0-9]{64}$/)
        assert.ok(Number.isSafeInteger(snapshot.bytes) && snapshot.bytes > 2, 'Complete stored-collection byte receipt required')
        assert.equal(snapshot.sha256, empty.storage.before.sha256, 'Clearing or restoring selection changed stored collection bytes')
        assert.equal(snapshot.bytes, empty.storage.before.bytes, 'Stored collection byte length changed')
      }
    }
    if (scene.page === 'pinned') {
      assert.equal(scene.layout.allHeightsEqual, true)
      assert.equal(scene.layout.rowsAligned, true)
      assert.ok(scene.controls.every(control => control.top >= -1 && control.bottom <= height + 1), 'All four actual toolbar controls must be present in the screenshot')
      const rows = []
      for (const control of scene.controls) {
        const row = rows.find(row => Math.abs(row[0].top - control.top) <= tolerance)
        if (row) row.push(control); else rows.push([control])
      }
      assert.equal(scene.layout.rowCount, rows.length, 'Recorded rows must match actual control coordinates')
      assert.ok(rows.every(row => Math.max(...row.map(control => control.bottom)) - Math.min(...row.map(control => control.bottom)) <= tolerance))
      if (scene.size === 'narrow') assert.ok(scene.layout.rowCount >= 2, 'Actual narrow toolbar must wrap')
      else assert.equal(scene.layout.rowCount, 1, 'Actual wide toolbar should share a baseline')
    }
    const image = scene.screenshot
    assert.equal(path.basename(image.filename), image.filename)
    assert.ok(image.filename.endsWith('.png') && image.bytes > 100)
    assert.match(image.sha256, /^[a-f0-9]{64}$/)
    if (scene.page !== 'collections') {
      assert.ok(scene.capture?.complete, 'Ordinary page screenshot requires complete fresh target capture proof')
      assert.equal(scene.capture.filename, image.filename, 'Ordinary page capture must bind this screenshot')
      assert.deepEqual(scene.capture.image, image, 'Ordinary page capture screenshot identity differs')
      validateUiScreenPageContinuity(scene, scene.capture.before)
      validateUiScreenPageContinuity(scene.capture.before, scene.capture.after)
    }
  }
  for (const size of UI_SCREEN_SIZES) for (const theme of UI_SCREEN_THEMES) for (const page of UI_SCREEN_PAGES) {
    assert.ok(names.has(`${theme}-${size}-${page}`), 'Missing required actual-page evidence')
  }
  return ui
}

export function verifyUiScreensFiles(ui, out) {
  validateUiScreensEvidence(ui)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  for (const scene of ui.scenes) {
    const image = scene.screenshot, bytes = readFileSync(path.join(out, image.filename))
    assert.equal(bytes.length, image.bytes)
    assert.equal(hash(bytes), image.sha256, 'Screenshot bytes changed')
    assert.deepEqual(bytes.subarray(0, 8), signature, 'Actual PNG bytes required')
    assert.equal(bytes.readUInt32BE(16), Math.round(scene.viewport.width * scene.devicePixelRatio), 'Screenshot width must match the observed native viewport and scale')
    assert.equal(bytes.readUInt32BE(20), Math.round(scene.viewport.height * scene.devicePixelRatio), 'Screenshot height must match the observed native viewport and scale')
  }
  return ui
}
