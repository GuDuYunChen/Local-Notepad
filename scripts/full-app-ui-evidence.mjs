// Pure verifier contracts. These functions never start Electron, fake a page,
// modify a report, or treat a complete-looking JSON object as a native run.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FULL_APP_GROUPS = Object.freeze(['settings', 'projects', 'research', 'editor', 'local-sync-lab'])
export const FULL_APP_PRODUCT_SOURCE_FILES = Object.freeze([
  'scripts/native-ui-select.mjs', 'scripts/check-ui-control-render.cjs', 'scripts/desktop-save-fixture.mjs',
  'scripts/desktop-window-session.mjs', 'scripts/desktop-window-target.mjs', 'scripts/desktop-window-worker.ps1',
  'scripts/local-export-directory-session.mjs', 'scripts/local-export-directory-worker.ps1', 'scripts/installer-lifecycle-core.mjs',
])
// These pure product parsers are imported by the verifier's owned offline
// fixture setup. They remain pinned application sources, not verifier copies.
export const FULL_APP_RUNTIME_SOURCE_FILES = Object.freeze([
  'electron/s3-local-overview-codec.js',
  'src/services/s3LocalOverviewComparison.mjs', 'src/services/s3LocalOverviewFile.mjs', 'src/services/s3LocalOverviewReport.mjs',
  'src/services/s3OfflinePairDirection.mjs', 'src/services/s3OfflinePairOrder.mjs', 'src/services/s3OfflinePairScope.mjs',
  'src/services/s3OfflinePairView.mjs', 'src/services/s3OfflineReportPair.mjs',
  'src/services/syncClockPreference.mjs', 'src/services/syncConflictHistory.mjs', 'src/services/syncHistoryExport.mjs',
  'src/services/syncHistoryFile.mjs', 'src/services/syncHistoryFileOrder.mjs', 'src/services/syncHistoryFileSelection.mjs',
  'src/services/syncHistorySearch.mjs', 'src/services/syncHistorySummary.mjs', 'src/services/syncHistoryTime.mjs',
  'server/cmd/notepad-server/main.go', 'server/internal/backup/backup.go', 'server/internal/model/file.go',
  'server/internal/syncengine/engine.go', 'server/internal/syncengine/recovery_runner.go',
  'server/internal/syncengine/conflict_history.go', 'server/internal/syncjob/policy.go',
  'src/services/syncConflictReview.mjs', 'src/services/syncConflictQueue.mjs', 'src/services/syncConflictDiff.mjs', 'src/services/syncPlanView.mjs',
])
export const FULL_APP_VERIFIER_SOURCE_FILES = Object.freeze([
  'scripts/run-full-app-ui-installed.mjs', 'scripts/check-full-app-ui-desktop.mjs', 'scripts/full-app-ui-shared.mjs', 'scripts/full-app-ui-shared.node.mjs',
  'scripts/full-app-ui-projects.mjs', 'scripts/full-app-ui-settings.mjs', 'scripts/full-app-ui-offline-settings.mjs', 'scripts/full-app-ui-research.mjs', 'scripts/full-app-ui-main-editor.mjs', 'scripts/full-app-ui-navigation.mjs',
  'scripts/full-app-ui-local-sync-lab.mjs', 'scripts/check-local-sync-lab-desktop.mjs', 'scripts/full-app-ui-local-sync-seed.mjs', 'scripts/full-app-ui-local-sync-seed.node.mjs',
  'scripts/full-app-ui-evidence.mjs', 'scripts/full-app-ui-evidence.node.mjs', 'scripts/full-app-ui-window-worker.ps1',
  'scripts/full-app-ui-routes.json', 'scripts/ui-screens-product-sources.json',
  'scripts/run-ui-screens-installed.mjs', 'scripts/check-ui-screens-desktop.mjs',
  'scripts/ui-screens-evidence.mjs', 'scripts/ui-screens-evidence.node.mjs', '.github/workflows/local-installation-2f86.yml',
])
export const FULL_APP_MATRIX = Object.freeze(['light', 'dark'].flatMap(theme =>
  [{ width: 704, height: 455 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]
    .map(viewport => Object.freeze({ theme, viewport: Object.freeze(viewport) }))))
const SCOPE = 'installed-actual-app-page-matrix'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const clone = value => structuredClone(value)
const token = value => { assert.equal(typeof value, 'string'); assert.match(value, /^[a-z0-9][a-z0-9-]*$/); return value }
const nonempty = value => { assert.equal(typeof value, 'string'); assert.ok(value.length > 0); return value }
const digest = value => assert.match(value || '', /^[a-f0-9]{64}$/)
const commit = value => assert.match(value || '', /^[a-f0-9]{40}$/)
const positive = value => assert.ok(Number.isFinite(value) && value > 0)
const extent = viewport => { assert.ok(Number.isInteger(viewport?.width) && Number.isInteger(viewport?.height)); positive(viewport.width); positive(viewport.height) }
const matrixKey = item => [item.theme, item.viewport?.width, item.viewport?.height].join(':')
const sceneKey = item => [item.routeId, item.stateId, matrixKey(item)].join(':')
const routeMatrixKey = item => [item.routeId, matrixKey(item)].join(':')
const exactSet = (actual, expected, label) => {
  assert.equal(new Set(actual).size, actual.length, 'Duplicate ' + label)
  assert.deepEqual([...actual].sort(), [...expected].sort(), 'Missing or unexpected ' + label)
}
const imageIdentity = image => {
  assert.match(image?.filename || '', /^[a-z0-9][a-z0-9_-]*\.png$/)
  assert.ok(Number.isSafeInteger(image.bytes) && image.bytes > 1000)
  digest(image.sha256); return image
}
const fileIdentity = file => {
  assert.equal(typeof file?.filename, 'string'); assert.equal(path.basename(file.filename), file.filename)
  assert.ok(file.filename && Number.isSafeInteger(file.bytes) && file.bytes > 0); digest(file.sha256)
}
const sameImage = (actual, expected) => assert.deepEqual(actual, expected, 'Screenshot record is not bound to the actual captured image')

export function fullAppProductPageSources(ledger) {
  const files = [...new Set(Object.values(ledger.groups).flatMap(group => group.routes.map(route => route.source))
    .concat(ledger.sourceCoverage.map(entry => entry.file)))].sort()
  for (const file of files) {
    assert.match(file, /^src\/[a-zA-Z0-9_./-]+\.(jsx?|tsx?|mjs|css)$/)
    assert.ok(!file.split('/').some(part => part === '..' || part === '.' || part === ''), 'Product source path must not escape or alias its pinned location')
  }
  return files
}

export function validateFullAppUiLedger(ledger) {
  assert.equal(ledger?.schemaVersion, 1); assert.equal(ledger.scope, SCOPE)
  commit(ledger.productSource?.commit); commit(ledger.productSource.tree)
  assert.equal(ledger.productSource.dirty, false, 'Route ledger must describe an immutable clean product')
  exactSet(Object.keys(ledger.groups), FULL_APP_GROUPS, 'application group')
  assert.deepEqual(ledger.matrix, FULL_APP_MATRIX, 'The declared light/dark and exact three native sizes must not be reduced')
  const allRoutes = []
  for (const group of FULL_APP_GROUPS) {
    const routes = ledger.groups[group].routes
    assert.ok(Array.isArray(routes) && routes.length > 0, 'A group cannot accept an empty route manifest')
    for (const route of routes) {
      token(route.id); nonempty(route.title); nonempty(route.root)
      assert.match(route.source, /^src\/[a-zA-Z0-9_./-]+\.(jsx?|tsx?)$/); assert.ok(!route.source.split('/').includes('..'))
      assert.ok(Array.isArray(route.requiredStates) && route.requiredStates.length > 0)
      for (const state of route.requiredStates) token(state)
      assert.equal(new Set(route.requiredStates).size, route.requiredStates.length)
      if (route.stateRoots !== undefined) {
        assert.ok(route.stateRoots && !Array.isArray(route.stateRoots) && typeof route.stateRoots === 'object')
        for (const [state, root] of Object.entries(route.stateRoots)) {
          assert.ok(route.requiredStates.includes(state), 'A state root must belong to a declared state'); nonempty(root)
        }
      }
      if (route.editorExceptions !== undefined) {
        assert.ok(Array.isArray(route.editorExceptions) && route.editorExceptions.length > 0)
        for (const exception of route.editorExceptions) {
          nonempty(exception?.selector); nonempty(exception.reason)
          assert.match(exception.source, /^src\/[a-zA-Z0-9_./-]+\.(jsx?|tsx?)$/)
          assert.ok(!exception.source.split('/').includes('..'))
        }
        assert.equal(new Set(route.editorExceptions.map(item => item.selector)).size, route.editorExceptions.length)
      }
      allRoutes.push(route)
    }
  }
  assert.equal(new Set(allRoutes.map(route => route.id)).size, allRoutes.length, 'Routes must belong to exactly one group')
  assert.ok(Array.isArray(ledger.sourceCoverage) && ledger.sourceCoverage.length > 0)
  for (const entry of ledger.sourceCoverage) {
    assert.match(entry.file, /^src\/[a-zA-Z0-9_./-]+\.(jsx?|tsx?|mjs|css)$/)
    assert.ok(!entry.file.split('/').includes('..')); nonempty(entry.classification); nonempty(entry.reason)
    commit(entry.blob); digest(entry.sha256); assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0)
    assert.ok(Array.isArray(entry.routeIds)); assert.equal(new Set(entry.routeIds).size, entry.routeIds.length)
    for (const id of entry.routeIds) assert.ok(allRoutes.some(route => route.id === id), 'Coverage refers to an undeclared route')
  }
  assert.equal(new Set(ledger.sourceCoverage.map(entry => entry.file)).size, ledger.sourceCoverage.length)
  for (const route of allRoutes) assert.ok(ledger.sourceCoverage.some(entry => entry.file === route.source && entry.routeIds.includes(route.id)), 'Route source is not independently mapped: ' + route.id)
  assert.ok(Array.isArray(ledger.openCoverage))
  return ledger
}

export function validateFullAppLedgerSourceIdentity(ledger, sources) {
  validateFullAppUiLedger(ledger)
  assert.equal(ledger.productSource.commit, sources.productCommit, 'Route ledger belongs to a different immutable product commit')
  assert.equal(ledger.productSource.tree, sources.productTree, 'Route ledger belongs to a different immutable product tree')
  assert.equal(ledger.productSource.dirty, false)
  exactSet(Object.keys(sources.actualPages), fullAppProductPageSources(ledger), 'ledger-bound actual source')
  exactSet(Object.keys(sources.actualPageDetails), fullAppProductPageSources(ledger), 'ledger-bound actual source bytes')
  for (const entry of ledger.sourceCoverage) {
    assert.equal(entry.blob, sources.actualPages[entry.file], 'Route ledger blob differs from the pinned actual product: ' + entry.file)
    assert.deepEqual(sources.actualPageDetails[entry.file], { blob: entry.blob, bytes: entry.bytes, sha256: entry.sha256 },
      'Route ledger byte/hash provenance differs from the pinned Git source: ' + entry.file)
  }
  return ledger
}

function validateFocus(sample) {
  nonempty(sample.selector)
  assert.equal(sample.trustedTab, true, 'Keyboard focus must follow actual trusted Tab input')
  for (const key of ['focused', 'focusVisible', 'inViewport', 'hit']) assert.equal(sample[key], true, 'Actual native keyboard focus proof required: ' + key)
  assert.equal(sample.outlines?.length, 1, 'Exactly one actual focus outline required')
  assert.equal(sample.outlines[0].owner, 'root'); assert.ok(sample.outlines[0].width >= 1.5)
  nonempty(sample.outlines[0].color); assert.deepEqual(sample.shadows, [], 'Duplicate visible focus shadow')
}

export const COLLAPSED_SIDEBAR_EXPAND = '.workspace-sidebar [aria-label="展开侧边栏"]'
const exactRectangle = (rect, label) => {
  for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) assert.ok(Number.isFinite(rect?.[key]), label + ' has no real ' + key)
  positive(rect.width); positive(rect.height)
  assert.ok(Math.abs(rect.right - rect.left - rect.width) <= 0.00001 && Math.abs(rect.bottom - rect.top - rect.height) <= 0.00001, label + ' edges disagree')
}
const insideRectangle = (rect, port) => rect.left >= port.left && rect.top >= port.top && rect.right <= port.right && rect.bottom <= port.bottom
const sameSidebarGeometry = (before, after) => {
  for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
    assert.ok(Math.abs(before.sidebarIcon.controlBounds[key] - after.sidebarIcon.controlBounds[key]) <= 0.6, 'Sidebar moved while obtaining its focus proof')
  }
  assert.deepEqual(after.sidebarIcon.scrollPositions, before.sidebarIcon.scrollPositions, 'Scrolling cannot repair the collapsed rail before its focus proof')
}

// This additional gate applies only to the repaired real collapsed sidebar.
// Other route focus contracts and every original scene remain unchanged.
export function validateCollapsedSidebarObservation(sample, matrix, { focusRequired = true } = {}) {
  assert.equal(sample.selector, COLLAPSED_SIDEBAR_EXPAND)
  assert.deepEqual(sample.viewport, matrix.viewport); assert.equal(sample.theme, matrix.theme)
  const rail = sample.sidebarIcon
  assert.equal(rail?.collapsed, true); assert.equal(rail.tag, 'BUTTON'); assert.equal(rail.disabled, false)
  assert.equal(rail.layout, 'icon'); assert.equal(rail.size, 'middle')
  exactRectangle(rail.controlBounds, 'Sidebar button'); exactRectangle(rail.viewportBounds, 'Actual viewport')
  assert.ok(insideRectangle(rail.controlBounds, rail.viewportBounds), 'Sidebar button leaves the actual viewport')
  assert.ok(Math.abs(rail.controlBounds.width - 40) <= 0.6 && Math.abs(rail.controlBounds.height - 40) <= 0.6, 'Sidebar icon button must keep the actual middle 40px density')
  assert.equal(rail.iconCount, 1); assert.equal(rail.glyphCount, 1)
  for (const item of [rail.icon, rail.glyph]) {
    exactRectangle(item?.bounds, 'Sidebar icon content'); assert.equal(item.painted, true)
    assert.ok(insideRectangle(item.bounds, rail.controlBounds), 'Sidebar icon content leaves its button')
  }
  assert.ok(insideRectangle(rail.glyph.bounds, rail.icon.bounds), 'Sidebar glyph leaves its official icon wrapper')
  for (const [start, extent] of [['left', 'width'], ['top', 'height']]) {
    assert.ok(Math.abs(rail.icon.bounds[start] + rail.icon.bounds[extent] / 2 - rail.controlBounds[start] - rail.controlBounds[extent] / 2) <= 0.6, 'Sidebar icon wrapper is not centered in its middle-density button')
  }
  assert.equal(rail.glyph.text, '›')
  for (const key of ['inViewport', 'hit']) assert.equal(sample[key], true, 'Sidebar button is clipped or obscured: ' + key)
  assert.ok(Array.isArray(rail.scrollPositions) && rail.scrollPositions.length > 0)
  for (const position of rail.scrollPositions) for (const key of ['left', 'top']) assert.ok(Number.isFinite(position[key]))
  if (!focusRequired) return sample
  assert.equal(sample.focused, true); assert.equal(sample.focusVisible, true)
  assert.equal(sample.outlines?.length, 1); assert.equal(sample.outlines[0].owner, 'root')
  assert.equal(rail.outline.width, 2); assert.equal(rail.outline.offset, 2)
  assert.equal(sample.outlines[0].width, rail.outline.width); assert.equal(sample.outlines[0].color, rail.outline.color)
  assert.deepEqual(sample.shadows, [])
  exactRectangle(rail.outlineBounds, 'Sidebar outer focus ring')
  const box = rail.controlBounds, outer = rail.outline.width + rail.outline.offset
  assert.deepEqual(rail.outlineBounds, { left: box.left - outer, top: box.top - outer, right: box.right + outer, bottom: box.bottom + outer, width: box.width + 2 * outer, height: box.height + 2 * outer })
  assert.ok(insideRectangle(rail.outlineBounds, rail.viewportBounds), 'Sidebar focus ring leaves the actual viewport')
  assert.ok(Array.isArray(sample.clippingAncestors) && sample.clippingAncestors.length > 0)
  for (const ancestor of sample.clippingAncestors) {
    const p = ancestor.clientPort
    assert.ok(p && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(p[key])), 'Missing actual ancestor client port')
    if (/hidden|auto|scroll|clip/.test(ancestor.appliedOverflowX)) assert.ok(rail.outlineBounds.left >= p.left && rail.outlineBounds.right <= p.left + p.width, 'Sidebar focus ring is clipped horizontally')
    if (/hidden|auto|scroll|clip/.test(ancestor.appliedOverflowY)) assert.ok(rail.outlineBounds.top >= p.top && rail.outlineBounds.bottom <= p.top + p.height, 'Sidebar focus ring is clipped vertically')
  }
  assert.equal(rail.ringSamples?.length, 12)
  const positions = ['left', 'right', 'top', 'bottom'].flatMap(side => [1 / 3, 1 / 2, 2 / 3].map(fraction => ({ side, fraction })))
  for (const [index, point] of rail.ringSamples.entries()) {
    const { side, fraction } = positions[index], vertical = side === 'left' || side === 'right', middle = rail.outline.offset + rail.outline.width / 2
    assert.equal(point.side, side); assert.equal(point.fraction, fraction)
    assert.equal(point.x, vertical ? box[side] + (side === 'left' ? -middle : middle) : box.left + box.width * fraction)
    assert.equal(point.y, vertical ? box.top + box.height * fraction : box[side] + (side === 'top' ? -middle : middle))
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
    assert.ok(point.topElement && typeof point.topElement.tag === 'string'); assert.ok(['ancestor', 'control', 'descendant', 'foreign'].includes(point.topElement.relation))
    assert.equal(point.hitWithinOwner, point.topElement.relation !== 'foreign')
  }
  assert.ok(Array.isArray(rail.pointerTransparentOverlaps), 'Potential painted pointer-transparent overlaps must be observed')
  return sample
}

export function validateCollapsedSidebarFocus(sample, matrix) {
  assert.equal(sample.routeId, 'nav-sidebar'); assert.equal(sample.stateId, 'collapsed')
  validateFocus(sample); validateCollapsedSidebarObservation(sample, matrix)
  validateCollapsedSidebarObservation(sample.beforeTab, matrix, { focusRequired: false })
  sameSidebarGeometry(sample.beforeTab, sample)
  assert.ok(sample.events?.some(event => event.type === 'keydown' && event.key === 'Tab' && event.trusted), 'Sidebar focus needs its own actual Tab event')
  return sample
}

export function validateFullAppPopupObservation(sample) {
  assert.equal(sample?.expanded, true); assert.equal(sample.optionsAvailable, true)
  nonempty(sample.inputId); assert.equal(typeof sample.value, 'string')
  const popup = sample.popup
  for (const key of ['ready', 'visible', 'inViewport', 'ownedHit']) assert.equal(popup?.[key], true, 'Owned popup must be visible and hit-testable: ' + key)
  assert.equal(popup.paintFrames, 2, 'Popup must be freshly observed after completed paint')
  nonempty(popup.listId); nonempty(popup.optionId)
  for (const key of ['root', 'content', 'item']) {
    const rect = popup[key]
    for (const field of ['left', 'top', 'right', 'bottom', 'width', 'height']) assert.ok(Number.isFinite(rect?.[field]))
    positive(rect.width); positive(rect.height); assert.ok(rect.right > rect.left && rect.bottom > rect.top)
  }
  assert.ok(Array.isArray(popup.ancestors) && popup.ancestors.length > 0)
  for (const node of popup.ancestors) {
    assert.notEqual(node.display, 'none'); assert.equal(node.visibility, 'visible'); assert.ok(Number(node.opacity) > 0)
  }
  assert.ok(Array.isArray(sample.options) && sample.options.length > 0)
  exactSet(sample.options.map(option => { assert.equal(typeof option.value, 'string'); return option.value }), sample.options.map(option => option.value), 'popup option value')
  assert.ok(sample.options.some(option => option.disabled === false), 'Popup must have an enabled real option')
  return sample
}

function validatePopup(receipt) {
  nonempty(receipt.selector)
  assert.ok(['selection', 'preview'].includes(receipt.interactionMode), 'Popup interaction mode must be explicit')
  for (const key of ['escapeClosed', 'repeatClosed', 'focusReturned']) assert.equal(receipt[key], true, 'Actual popup interaction missing: ' + key)
  if (receipt.interactionMode === 'selection') {
    for (const key of ['pointerCommitted', 'keyboardCommitted']) assert.equal(receipt[key], true, 'Actual popup interaction missing: ' + key)
  } else {
    for (const key of ['pointerOpened', 'keyboardOpened']) assert.equal(receipt[key], true, 'Actual popup preview missing: ' + key)
    for (const key of ['pointerCommitted', 'keyboardCommitted']) assert.ok(receipt[key] === undefined || receipt[key] === false, 'A read-only preview must not claim a committed selection')
    assert.equal(receipt.afterValue, receipt.beforeValue, 'A read-only popup preview changed the selected value')
  }
  assert.equal(receipt.trustedPointer, true); assert.equal(receipt.trustedKeyboard, true)
  assert.equal(typeof receipt.beforeValue, 'string'); assert.equal(typeof receipt.afterValue, 'string')
  const capture = receipt.capture; assert.equal(capture?.complete, true)
  for (const side of ['before', 'after']) validateFullAppPopupObservation(capture[side])
  if (receipt.interactionMode === 'preview') assert.equal(capture.before.value, receipt.beforeValue, 'Preview screenshot must show the unchanged selected value')
  const key = sample => JSON.stringify([sample.inputId, sample.popup.listId, sample.popup.optionId, sample.value,
    sample.options.map(option => [option.value, option.disabled])])
  assert.equal(key(capture.before), key(capture.after), 'Popup ownership, selection, or options changed across the actual screenshot')
  assert.deepEqual(receipt.popup, capture.before.popup, 'Popup summary is not its actual before-capture observation')
  imageIdentity(receipt.image); sameImage(capture.image, receipt.image)
  assert.equal(capture.filename, receipt.image.filename)
}

export function validateFullAppUiEvidence(ui, ledger) {
  validateFullAppUiLedger(ledger)
  assert.equal(ui?.schemaVersion, 1); assert.equal(ui.scope, SCOPE); assert.equal(ui.complete, true)
  assert.ok(FULL_APP_GROUPS.includes(ui.group)); assert.deepEqual(ui.matrix, ledger.matrix)
  const routes = ledger.groups[ui.group].routes; assert.deepEqual(ui.routes, routes, 'Runtime report cannot redefine the reviewed route manifest')
  for (const key of ['externalRequests', 'forbiddenRequests', 'runtimeErrors']) assert.deepEqual(ui[key], [], key + ' must remain empty')
  assert.equal(ui.notesUnchanged, true); assert.equal(ui.syncSettingsUnchanged, true)
  assert.ok(Array.isArray(ui.setup?.noteIDs) && ui.setup.noteIDs.length > 0)
  assert.equal(new Set(ui.setup.noteIDs).size, ui.setup.noteIDs.length)
  const expected = routes.flatMap(route => route.requiredStates.flatMap(stateId => ledger.matrix.map(matrix => sceneKey({ routeId: route.id, stateId, ...matrix }))))
  assert.ok(Array.isArray(ui.scenes)); exactSet(ui.scenes.map(sceneKey), expected, 'route/state/native-size scene')
  const known = new Set(expected), imageOwners = new Map(), focusKeys = new Set(), popupKeys = new Set(), routeCoverage = new Set()
  const recordImage = (image, owner, sharedPopup = false) => {
    const prior = imageOwners.get(image.filename)
    if (prior) {
      assert.equal(sharedPopup, true, 'A screenshot cannot impersonate a different scene or popup')
      assert.equal(prior.owner, owner, 'A screenshot cannot be reused by another scene')
      sameImage(image, prior.image)
    } else imageOwners.set(image.filename, { owner, image })
  }
  assert.ok(Array.isArray(ui.focus)); assert.ok(Array.isArray(ui.popups))
  for (const sample of ui.focus) {
    assert.ok(known.has(sceneKey(sample)), 'Focus observation is detached from a declared scene')
    validateFocus(sample); focusKeys.add(routeMatrixKey(sample))
  }
  for (const receipt of ui.popups) {
    assert.ok(known.has(sceneKey(receipt)), 'Popup observation is detached from a declared scene')
    validatePopup(receipt); popupKeys.add(routeMatrixKey(receipt)); recordImage(receipt.image, sceneKey(receipt))
  }
  for (const scene of ui.scenes) {
    const route = routes.find(item => item.id === scene.routeId)
    assert.equal(scene.group, ui.group); assert.equal(scene.root, route.stateRoots?.[scene.stateId] ?? route.root); assert.equal(scene.complete, true)
    assert.ok(['route-controls', 'owned-popup'].includes(scene.coverageMode), 'Explicit actual scene coverage mode required')
    if (scene.coverageMode === 'route-controls') routeCoverage.add(routeMatrixKey(scene))
    else assert.ok(ui.popups.some(popup => sceneKey(popup) === sceneKey(scene)), 'Owned-popup scene requires its own capture receipt')
    assert.equal(scene.nativeWindow, true); assert.deepEqual(scene.requested, scene.viewport)
    extent(scene.viewport); assert.ok(ledger.matrix.some(item => matrixKey(item) === matrixKey(scene)))
    assert.ok(Number.isFinite(scene.devicePixelRatio) && scene.devicePixelRatio >= 0.5 && scene.devicePixelRatio <= 4)
    assert.equal(scene.geometry?.valid, true); assert.deepEqual(scene.geometry.failures, [])
    assert.ok(Array.isArray(scene.anchors) && scene.anchors.length > 0, 'A screenshot without actual reachable page anchors is insufficient')
    for (const anchor of scene.anchors) {
      nonempty(anchor.selector); positive(anchor.width); positive(anchor.height)
      for (const key of ['visible', 'inViewport', 'hit']) assert.equal(anchor[key], true, 'Page anchor is clipped or obscured: ' + anchor.selector)
    }
    assert.ok(Number.isFinite(scene.overflow?.document) && scene.overflow.document <= 1 && scene.overflow.document >= 0, 'Document horizontal overflow')
    assert.ok(Number.isFinite(scene.overflow?.root) && scene.overflow.root <= 1 && scene.overflow.root >= 0, 'Page root horizontal overflow')
    assert.ok(Array.isArray(scene.overflow.allowed))
    assert.ok(Array.isArray(scene.controls))
    assert.ok(Array.isArray(scene.rawSamples) && scene.rawSamples.length > 0, 'Actual pre/post capture page samples must be retained')
    const rendered = new Set(), scrollAreas = new Map()
    for (const sample of scene.rawSamples) {
      assert.equal(sample.root, scene.root, 'Raw page observation belongs to a different actual root')
      assert.deepEqual(sample.viewport, scene.viewport); assert.equal(sample.theme, scene.theme)
      assert.equal(sample.devicePixelRatio, scene.devicePixelRatio)
      assert.ok(Array.isArray(sample.controls)); assert.ok(Array.isArray(sample.scrollAreas))
      for (const control of sample.controls) if (scene.coverageMode === 'route-controls' || control.selectedForProbe) rendered.add(control.selector)
      for (const surface of sample.scrollAreas) scrollAreas.set(surface.selector, surface)
    }
    const coverage = scene.controlCoverage
    assert.ok(Number.isSafeInteger(coverage?.renderedCount) && coverage.renderedCount >= 0)
    assert.equal(coverage.observedCount, coverage.renderedCount, 'Some rendered controls were never observed in the viewport')
    assert.deepEqual(coverage.unobserved, [])
    assert.equal(new Set(scene.controls.map(control => control.selector)).size, coverage.observedCount, 'Coverage count must bind the actual distinct observed controls')
    exactSet([...rendered], [...new Set(scene.controls.map(control => control.selector))], 'raw rendered control observation')
    for (const control of scene.controls) {
      nonempty(control.selector); nonempty(control.kind); nonempty(control.classification)
      positive(control.width); positive(control.height)
      assert.equal(control.visible, true); assert.equal(control.inViewport, true)
      assert.equal(typeof control.disabled, 'boolean')
      if (!control.disabled) assert.equal(control.hit, true, 'Actual enabled control is obscured')
      const fixed = control.classification === 'shared' &&
        ((control.kind === 'button' && control.layout === 'action') || ['input', 'password', 'select'].includes(control.kind))
      if (fixed) {
        const height = { small: 28, middle: 40, large: 44 }[control.size]
        assert.ok(height, 'Actual official control size must be recorded')
        assert.equal(control.expectedHeight, height); assert.ok(Math.abs(control.height - height) <= 0.6, 'Official control height differs: ' + control.selector)
      }
      if (control.classification === 'shared' && control.kind === 'button' && control.layout === 'content') assert.ok(control.height >= 27.4, 'Content button lost its real minimum target height')
      if (control.classification === 'native') {
        assert.ok(['checkbox', 'radio', 'range', 'file', 'color', 'date', 'time', 'datetime-local', 'month', 'week'].includes(control.nativeType), 'Ordinary control cannot be relabeled as a native exception')
      } else if (control.classification === 'editor') {
        const exception = route.editorExceptions?.find(item => item.selector === control.semanticException?.selector)
        assert.ok(exception, 'Editor semantic exception must match the exact reviewed route declaration')
        assert.deepEqual(control.semanticException, exception)
      } else assert.equal(control.classification, 'shared', 'Unclassified ordinary control')
    }
    if (scene.controls.some(control => !control.disabled)) assert.ok(focusKeys.has(routeMatrixKey(scene)), 'No actual keyboard focus sample for ' + routeMatrixKey(scene))
    if (scene.controls.some(control => control.kind === 'select' && !control.disabled)) assert.ok(popupKeys.has(routeMatrixKey(scene)), 'No actual owned popup sample for ' + routeMatrixKey(scene))
    assert.ok(Array.isArray(scene.images) && scene.images.length > 0); sameImage(scene.image, scene.images[0])
    assert.equal(new Set(scene.images.map(image => image.filename)).size, scene.images.length)
    for (const target of [...scene.controls, ...scene.anchors]) assert.ok(scene.images.some(image => image.filename === target.image), 'Observed target is not bound to its actual PNG')
    for (const image of scene.images) {
      imageIdentity(image)
      const matchingPopup = scene.coverageMode === 'owned-popup' && ui.popups.some(popup => sceneKey(popup) === sceneKey(scene) && popup.image.filename === image.filename)
      recordImage(image, sceneKey(scene), matchingPopup)
      const pair = {}
      for (const phase of ['before-capture', 'after-capture']) {
        const samples = scene.rawSamples.filter(sample => sample.phase === phase && sample.image === image.filename)
        assert.equal(samples.length, 1, 'Every PNG needs one actual ' + phase + ' target sample')
        pair[phase] = samples[0]
        const bounds = samples[0].rootBounds
        positive(bounds?.width); positive(bounds?.height)
        assert.ok(bounds.right > 0 && bounds.left < scene.viewport.width && bounds.bottom > 0 && bounds.top < scene.viewport.height, 'PNG target root was outside the actual viewport')
      }
      for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(pair['before-capture'].rootBounds[key] - pair['after-capture'].rootBounds[key]) <= 0.6, 'PNG root geometry changed across its capture')
      for (const kind of ['controls', 'anchors']) for (const target of scene[kind].filter(item => item.image === image.filename)) {
        for (const phase of ['before-capture', 'after-capture']) {
          const matches = pair[phase][kind]?.filter(item => item.selector === target.selector)
          assert.equal(matches?.length, 1, 'PNG observation lost its exact declared target')
          const current = matches[0]
          assert.equal(current.visible, true); assert.equal(current.inViewport, true)
          if (!current.disabled) assert.equal(current.hit, true)
          if (kind === 'controls') for (const key of ['fieldSelector', 'kind', 'classification', 'size', 'layout', 'expectedHeight', 'disabled']) assert.deepEqual(current[key], target[key], 'PNG control identity changed at capture boundary')
          for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(current[key] - target[key]) <= 0.6, 'PNG target moved or scrolled before its image')
        }
      }
    }
    assert.ok(Array.isArray(scene.scrollCoverage))
    if (scene.coverageMode === 'route-controls') {
      exactSet(scene.scrollCoverage.map(surface => surface.selector), [...scrollAreas.keys()], 'observed long-page scroll surface')
      for (const surface of scene.scrollCoverage) {
        assert.equal(surface.complete, true); positive(surface.clientHeight)
        assert.ok(Number.isFinite(surface.scrollHeight) && surface.scrollHeight > surface.clientHeight)
        assert.ok(Number.isFinite(surface.rangeStart) && Number.isFinite(surface.rangeEnd) && surface.rangeStart >= 0 &&
          surface.rangeEnd >= surface.rangeStart && surface.rangeEnd <= surface.scrollHeight - surface.clientHeight + 1)
        assert.ok(Array.isArray(surface.positions) && surface.positions.length > 0)
        assert.ok(Math.abs(surface.positions[0].requested - surface.rangeStart) <= 1)
        assert.ok(Math.abs(surface.positions.at(-1).requested - surface.rangeEnd) <= 1, 'Long report was not photographed to its last declared scroll position')
        const maximumStep = Math.max(1, Math.floor(Math.min(surface.clientHeight, scene.viewport.height) * 0.75))
        for (const [index, position] of surface.positions.entries()) {
          assert.ok(Number.isFinite(position.requested) && Number.isFinite(position.actual) && Math.abs(position.requested - position.actual) <= 1)
          assert.ok(scene.images.some(image => image.filename === position.image), 'Scroll observation is not bound to a captured PNG')
          assert.ok(position.bounds?.bottom > 0 && position.bounds?.top < scene.viewport.height, 'Scroll surface was outside the actual screenshot')
          if (index > 0) {
            const gap = position.requested - surface.positions[index - 1].requested
            assert.ok(gap > 0 && gap <= maximumStep + 1, 'Long page has an unphotographed scroll gap')
          }
        }
        // Recompute covered content from the two raw reads surrounding each
        // actual PNG. Nominal client height and scroll positions alone cannot
        // prove coverage when an ancestor clips most of the scroll surface.
        const start = surface.requiredContentStart, end = surface.requiredContentEnd
        assert.ok(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= surface.scrollHeight)
        assert.equal(surface.contentStart, start); assert.equal(surface.contentEnd, end)
        const intervals = []
        for (const image of scene.images) {
          const pair = ['before-capture', 'after-capture'].map(phase => scene.rawSamples.find(sample => sample.phase === phase && sample.image === image.filename)
            ?.scrollAreas.filter(item => item.selector === surface.selector))
          if (pair.some(matches => !matches?.length)) continue
          pair.forEach(matches => assert.equal(matches.length, 1, 'Ambiguous actual scroll-surface owner at PNG boundary'))
          const [before, after] = pair.map(matches => matches[0])
          for (const actual of [before, after]) {
            assert.equal(actual.scrollHeight, surface.scrollHeight); assert.equal(actual.clientHeight, surface.clientHeight)
            assert.ok(Math.abs(actual.requiredContentStart - start) <= 1 && Math.abs(actual.requiredContentEnd - end) <= 1, 'Actual content extent changed across PNG captures')
            assert.ok(Number.isFinite(actual.visibleHeight) && actual.visibleHeight >= 0 && actual.visibleHeight <= Math.min(surface.clientHeight, scene.viewport.height) + 1)
            assert.ok(Number.isFinite(actual.visibleContentStart) && Number.isFinite(actual.visibleContentEnd) && actual.visibleContentStart >= 0 &&
              actual.visibleContentEnd >= actual.visibleContentStart && actual.visibleContentEnd <= surface.scrollHeight &&
              actual.visibleContentEnd - actual.visibleContentStart <= actual.visibleHeight + 1, 'Raw content interval exceeds its actual clipped viewport')
          }
          const from = Math.max(start, before.visibleContentStart, after.visibleContentStart), to = Math.min(end, before.visibleContentEnd, after.visibleContentEnd)
          if (to > from) intervals.push({ from, to, image: image.filename })
        }
        intervals.sort((a, b) => a.from - b.from || a.to - b.to)
        assert.deepEqual(surface.observedIntervals, intervals, 'Scroll coverage must bind the actual PNG before/after interval intersections')
        const gaps = []; let cursor = start
        for (const interval of intervals) {
          if (interval.from > cursor + 1) gaps.push({ from: cursor, to: interval.from })
          cursor = Math.max(cursor, interval.to)
        }
        if (cursor < end - 1) gaps.push({ from: cursor, to: end })
        assert.deepEqual(surface.gaps, gaps, 'Reported content gaps differ from raw PNG intervals')
        assert.ok(intervals.length > 0 && gaps.length === 0, 'Actual long-page content has an unphotographed interval')
      }
    }
  }
  for (const route of routes) for (const matrix of ledger.matrix) assert.ok(routeCoverage.has(routeMatrixKey({ routeId: route.id, ...matrix })), 'Route only has a popup screenshot; expanded page controls remain unobserved')
  if (routes.some(route => route.id === 'nav-sidebar')) for (const matrix of ledger.matrix) {
    const key = sceneKey({ routeId: 'nav-sidebar', stateId: 'collapsed', ...matrix })
    const focused = ui.focus.filter(sample => sceneKey(sample) === key && sample.selector === COLLAPSED_SIDEBAR_EXPAND)
    assert.equal(focused.length, 1, 'Collapsed sidebar needs its own exact expand-button focus proof for every native size and theme')
    validateCollapsedSidebarFocus(focused[0], matrix)
    const scene = ui.scenes.find(item => sceneKey(item) === key)
    assert.ok(scene, 'Missing the real collapsed sidebar scene')
    for (const image of scene.images) for (const phase of ['before-capture', 'after-capture']) {
      const samples = scene.rawSamples.filter(sample => sample.image === image.filename && sample.phase === phase)
      assert.equal(samples.length, 1, 'Collapsed sidebar PNG needs independent focus reads on both boundaries')
      validateCollapsedSidebarObservation(samples[0].sidebarFocus, matrix)
      sameSidebarGeometry(focused[0], samples[0].sidebarFocus)
    }
  }
  return ui
}

function verifyPng(image, out, viewport, dpr) {
  imageIdentity(image); const bytes = readFileSync(path.join(out, image.filename))
  assert.equal(bytes.length, image.bytes); assert.equal(sha(bytes), image.sha256)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR')
  assert.equal(bytes.readUInt32BE(16), Math.round(viewport.width * dpr), 'Screenshot width does not match the native viewport')
  assert.equal(bytes.readUInt32BE(20), Math.round(viewport.height * dpr), 'Screenshot height does not match the native viewport')
  return bytes
}

// The outside of a CSS outline can hit-test to a transparent sibling that is
// painted behind it. Its real captured pixels, rather than DOM hit ownership,
// decide whether the focus ring was actually visible over that background.
export function verifyCollapsedSidebarRaster(bytes, observation, dpr) {
  validateCollapsedSidebarObservation(observation, observation)
  assert.ok(Number.isFinite(dpr) && dpr >= 0.5 && dpr <= 4)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), type = bytes[25]
  assert.equal(width, Math.round(observation.viewport.width * dpr)); assert.equal(height, Math.round(observation.viewport.height * dpr))
  assert.ok(width <= 8192 && height <= 8192); assert.equal(bytes[24], 8); assert.ok(type === 2 || type === 6)
  for (const index of [26, 27, 28]) assert.equal(bytes[index], 0, 'Unsupported PNG compression/filter/interlace mode')
  const chunks = []
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 12 <= bytes.length)
    const length = bytes.readUInt32BE(offset); assert.ok(length <= bytes.length - offset - 12)
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const color = observation.sidebarIcon.outline.color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*1(?:\.0+)?)?\s*\)$/)
  assert.ok(color, 'The actual sidebar outline must have an opaque computed RGB color')
  const expected = color.slice(1, 4).map(Number); assert.ok(expected.every(value => value >= 0 && value <= 255))
  const points = observation.sidebarIcon.ringSamples.map(point => ({ side: point.side, fraction: point.fraction, x: Math.floor(point.x * dpr), y: Math.floor(point.y * dpr) }))
  for (const point of points) assert.ok(point.x >= 0 && point.x < width && point.y >= 0 && point.y < height)
  const bpp = type === 6 ? 4 : 3, stride = width * bpp
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height })
  assert.equal(raw.length, (stride + 1) * height)
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  let previous = Buffer.alloc(stride)
  const samples = []
  for (let y = 0; y <= Math.max(...points.map(point => point.y)); y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4)
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = previous[x], c = x >= bpp ? previous[x - bpp] : 0
      row[x] = (row[x] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c))) & 255
    }
    for (const point of points.filter(point => point.y === y)) {
      const rgb = [...row.subarray(point.x * bpp, point.x * bpp + 3)]
      assert.deepEqual(rgb, expected, 'Actual collapsed sidebar focus stroke is absent or covered in PNG: ' + point.side + '/' + point.fraction)
      if (bpp === 4) assert.equal(row[point.x * bpp + 3], 255)
      samples.push({ ...point, rgb })
    }
    previous = row
  }
  assert.equal(samples.length, 12)
  return { expectedRGB: expected, imageSHA256: sha(bytes), devicePixelRatio: dpr, samples }
}

export function verifyFullAppUiFiles(ui, out, ledger) {
  validateFullAppUiEvidence(ui, ledger)
  for (const scene of ui.scenes) for (const image of scene.images) {
    const bytes = verifyPng(image, out, scene.viewport, scene.devicePixelRatio)
    if (scene.routeId === 'nav-sidebar' && scene.stateId === 'collapsed') {
      for (const phase of ['before-capture', 'after-capture']) {
        const sample = scene.rawSamples.find(sample => sample.image === image.filename && sample.phase === phase)
        verifyCollapsedSidebarRaster(bytes, sample.sidebarFocus, scene.devicePixelRatio)
      }
    }
  }
  for (const popup of ui.popups) {
    const scene = ui.scenes.find(item => sceneKey(item) === sceneKey(popup))
    verifyPng(popup.image, out, popup.viewport, scene.devicePixelRatio)
  }
  return ui
}

export function validateNativeWindowResize(receipt, request) {
  assert.ok(Number.isSafeInteger(request.pid) && request.pid > 0 && request.pid <= 0xffffffff)
  assert.ok(Number.isSafeInteger(request.handle) && request.handle > 0)
  assert.ok(path.win32.isAbsolute(request.executable) && /^[a-z]:\\/i.test(request.executable))
  assert.ok(Number.isFinite(request.devicePixelRatio) && request.devicePixelRatio >= 0.5 && request.devicePixelRatio <= 4)
  assert.equal(receipt?.protocol, 1); assert.equal(receipt.operation, 'resize-owned-client'); assert.equal(receipt.complete, true)
  assert.equal(receipt.pid, request.pid); assert.equal(receipt.handle, request.handle)
  assert.deepEqual(receipt.requested, { width: request.width, height: request.height })
  assert.ok(FULL_APP_MATRIX.some(item => item.viewport.width === request.width && item.viewport.height === request.height))
  assert.equal(receipt.devicePixelRatio, request.devicePixelRatio)
  assert.deepEqual(receipt.physicalRequested, { width: Math.round(request.width * request.devicePixelRatio), height: Math.round(request.height * request.devicePixelRatio) })
  extent(request.beforeViewport); assert.deepEqual(receipt.beforeViewport, request.beforeViewport)
  for (const dimension of ['width', 'height']) {
    const inset = receipt.viewportInsets?.[dimension]
    assert.ok(Number.isSafeInteger(inset) && inset >= 0 && inset <= 256)
    assert.equal(inset, receipt.before.client[dimension] - Math.round(request.beforeViewport[dimension] * request.devicePixelRatio))
    assert.equal(receipt.nativeClientRequested?.[dimension], receipt.physicalRequested[dimension] + inset)
  }
  assert.ok(Array.isArray(receipt.attempts) && receipt.attempts.length > 0 && receipt.attempts.length <= 3)
  for (const observation of [receipt.before, ...receipt.attempts, receipt.after]) {
    assert.equal(observation.pid, request.pid); assert.equal(observation.handle, request.handle); assert.equal(observation.visible, true)
    assert.equal(observation.windowClass, 'Chrome_WidgetWin_1')
    assert.equal(path.win32.resolve(observation.image).toLowerCase(), path.win32.resolve(request.executable).toLowerCase())
    for (const rect of [observation.client, observation.outer]) { positive(rect.width); positive(rect.height) }
    assert.ok(observation.outer.width >= observation.client.width && observation.outer.height >= observation.client.height)
  }
  assert.deepEqual(receipt.after, receipt.attempts.at(-1))
  assert.equal(receipt.after.client.width, receipt.nativeClientRequested.width); assert.equal(receipt.after.client.height, receipt.nativeClientRequested.height)
  return receipt
}

export function validateFullAppFixtureFile({ name, bytes }) {
  assert.match(name || '', /^[a-z0-9][a-z0-9_.-]{0,100}\.(json|txt|md|png)$/)
  assert.ok(!name.includes('..'), 'Fixture names cannot contain traversal segments')
  assert.ok(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, 'Only explicit synthetic byte buffers may be written')
  assert.ok(bytes.byteLength <= 8 * 1024 * 1024, 'Synthetic input exceeds its fixed 8 MiB boundary')
  return true
}

export function validateFullAppPrerequisites({ pin, original, accepted, sourceProof, threeReport, threeAccepted, preparation,
  verifierCommit, runID, runAttempt, threeReportFingerprint }) {
  commit(pin.product); commit(verifierCommit); assert.equal(pin.current.version, '4.249.0')
  digest(pin.current.sha256); assert.ok(Number.isSafeInteger(pin.current.bytes) && pin.current.bytes > 0)
  for (const report of [original, accepted, sourceProof, threeReport, threeAccepted]) {
    assert.equal(report.productCommit, pin.product); assert.equal(report.verifierCommit, verifierCommit)
  }
  assert.equal(original.complete, true); assert.equal(original.cleanupComplete, true); assert.equal(original.forceTerminated, false)
  assert.equal(original.appExits?.length, 6); assert.equal(original.dataComparisons?.length, 6)
  assert.deepEqual(original.installers, { current: pin.current, previous: pin.previous })
  assert.equal(accepted.complete, true); assert.equal(accepted.screenshotsVerified, true); assert.deepEqual(accepted.installationChecks, original.checks)
  assert.deepEqual(accepted.installer, pin.current); assert.equal(sourceProof.productionModified, false)
  assert.equal(preparation.scope, 'installer-preparation-contracts-only'); assert.equal(preparation.nativeLifecycleExecuted, false)
  assert.equal(preparation.verifierCommit, verifierCommit); assert.equal(String(preparation.runID), String(runID))
  assert.equal(String(preparation.runAttempt), String(runAttempt)); assert.equal(preparation.job, 'install-upgrade-uninstall')
  assert.equal(preparation.platform, 'win32')
  assert.equal(threeReport.scope, 'installed-ui-screens'); assert.equal(threeReport.complete, true)
  assert.equal(threeReport.cleanupComplete, true); assert.equal(threeReport.forceTerminated, false)
  assert.equal(threeReport.dataIsolation?.defaultUnchanged, true); assert.equal(threeReport.originalInstallation?.reportsUnchanged, true)
  assert.equal(threeReport.bridgeOverridden, false); assert.equal(threeReport.emulatedViewport, false); assert.equal(threeReport.timerAccelerated, false)
  assert.equal(threeReport.realBackend, true); assert.equal(threeReport.syntheticData, true)
  assert.equal(threeReport.uiScreens?.complete, true); assert.equal(threeReport.uiScreens.scenes?.length, 12)
  assert.deepEqual(threeReport.runtimeErrors, []); assert.deepEqual(threeReport.installer, pin.current)
  assert.equal(threeAccepted.complete, true); assert.equal(threeAccepted.originalLifecyclePreserved, true)
  assert.equal(threeAccepted.sameOriginallyAcceptedInstalledBytes, true); assert.equal(threeAccepted.normalNativeExit, true)
  assert.equal(threeAccepted.cleanupComplete, true); assert.equal(threeAccepted.defaultDataUnchanged, true)
  assert.deepEqual(threeAccepted.currentInstaller, pin.current); assert.deepEqual(threeAccepted.report, threeReportFingerprint)
  for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) {
    digest(threeReport.app?.[key]); assert.equal(threeReport.app[key], original.localExportRun?.application?.[key])
  }
  return true
}

export function validateLocalSyncLabUi(ui, seed) {
  assert.equal(ui.group, 'local-sync-lab')
  const lab = ui.localSyncLab
  assert.equal(lab?.seedDigest, seed.seedDigest); assert.equal(lab.initialTheme, seed.settingsBefore.theme)
  for (const key of ['themeRestored', 'logicalSnapshotRequiredAfterNormalExit', 'noSyncExecution']) assert.equal(lab[key], true)
  assert.equal(ui.setup.notesBeforeSHA256, sha(JSON.stringify(seed.files)))
  assert.equal(ui.notesAfterSHA256, ui.setup.notesBeforeSHA256)
  assert.equal(ui.syncBeforeSHA256, sha(JSON.stringify(ui.setup.localSyncLab.settings)))
  assert.equal(ui.syncAfterSHA256, ui.syncBeforeSHA256)
  const settings = ui.setup.localSyncLab.settings
  assert.equal(settings.theme, seed.settingsBefore.theme); assert.equal(settings.sync_enabled, true)
  assert.equal(settings.sync_provider, 'local-lab'); assert.equal(settings.sync_auto_enabled, false)
  for (const key of ['sync_endpoint', 'sync_username', 'sync_password', 'sync_password_set']) assert.ok(!settings[key])
  const readPaths = new Set(['/api/settings', '/api/diagnostics', '/api/files', '/api/tags', '/api/folders',
    '/api/sync/status', '/api/sync/activity', '/api/sync/conflicts', '/api/sync/conflicts/history'])
  assert.ok(Array.isArray(lab.requests)); assert.ok(Array.isArray(lab.allowedPlanRequests))
  for (const request of lab.requests) {
    nonempty(request.requestId); nonempty(request.pathname); assert.equal(typeof request.search, 'string')
    if (request.kind === 'asset') {
      assert.equal(request.method, 'GET'); assert.ok(!request.pathname.startsWith('/api/'))
    } else if (request.kind === 'read') {
      assert.equal(request.method, 'GET'); assert.ok(readPaths.has(request.pathname) || /^\/api\/files\/[A-Za-z0-9_-]{1,128}$/.test(request.pathname), 'Unapproved local-lab read path')
    } else if (request.kind === 'theme') {
      assert.equal(request.method, 'PUT'); assert.equal(request.pathname, '/api/settings'); assert.equal(request.search, '')
      const body = JSON.parse(request.body); assert.deepEqual(Object.keys(body), ['theme']); assert.ok(['light', 'dark'].includes(body.theme))
    } else {
      assert.equal(request.kind, 'plan', 'Unapproved local-lab request kind')
      assert.equal(request.method, 'POST'); assert.equal(request.pathname, '/api/sync/plan'); assert.equal(request.search, '')
      assert.deepEqual(JSON.parse(request.body), {}, 'The only sync POST must be the exact read-only empty plan request')
    }
  }
  assert.equal(lab.allowedPlanRequests.length, FULL_APP_MATRIX.length)
  exactSet(lab.requests.filter(request => request.kind === 'plan').map(request => request.requestId), lab.allowedPlanRequests.map(request => request.requestId), 'actual local plan request')
  for (const plan of lab.allowedPlanRequests) {
    const request = lab.requests.find(item => item.requestId === plan.requestId)
    assert.deepEqual(request, plan, 'A plan response is detached from its actual renderer request')
    assert.equal(plan.complete, true); assert.equal(plan.error, undefined)
    const bytes = Buffer.from(plan.responseText, 'utf8')
    assert.equal(bytes.length, plan.responseBytes); assert.ok(bytes.length > 0 && bytes.length <= 1024 * 1024)
    assert.equal(sha(bytes), plan.responseSHA256, 'Actual local plan response bytes/hash differ')
    const envelope = JSON.parse(plan.responseText); assert.equal(envelope.code, 0); assert.deepEqual(envelope.data, plan.response)
    const data = plan.response, expectedCounts = { uploads: 21, downloads: 0, conflicts: 0, noops: 0 }
    for (const [key, value] of Object.entries(expectedCounts)) assert.equal(data[key], value)
    assert.equal(data.store_id, ''); assert.equal(data.revision, ''); assert.equal(data.generation, 0); assert.equal(data.needs_init, true)
    exactSet(data.items.map(item => item.id), seed.noteIDs, 'actual plan owned item')
    for (const item of data.items) {
      assert.equal(item.action, 'upload'); assert.equal(item.base_hash, ''); assert.equal(item.remote_hash, '')
      assert.equal(item.local_hash, seed.records.find(record => record.itemID === item.id).local)
    }
    const snapshot = plan.snapshot
    assert.equal(snapshot.source, 'preview'); assert.equal(snapshot.stale, false); assert.equal(snapshot.detailState, 'complete')
    assert.equal(snapshot.needsInit, true); assert.equal(snapshot.generation, 0); assert.deepEqual(snapshot.counts, expectedCounts)
    exactSet(snapshot.items.map(item => item.id), seed.noteIDs, 'displayed plan owned item')
    assert.ok(snapshot.items.every(item => item.action === 'upload'))
  }
  assert.ok(Array.isArray(lab.viewReceipts)); exactSet(lab.viewReceipts.map(matrixKey), FULL_APP_MATRIX.map(matrixKey), 'local-lab matrix view')
  exactSet(lab.viewReceipts.map(view => view.planRequestId), lab.allowedPlanRequests.map(plan => plan.requestId), 'matrix-bound plan response')
  for (const view of lab.viewReceipts) {
    for (const key of ['openConflictsUnchanged', 'previewOnly', 'choiceCancelled']) assert.equal(view[key], true)
    assert.equal(view.historyRead, 26); assert.equal(view.resolveCalled, false)
  }
  assert.ok(Array.isArray(ui.events))
  const previews = ui.events.filter(event => event.type === 'click' && event.buttonText === '预演同步')
  assert.equal(previews.length, FULL_APP_MATRIX.length); assert.deepEqual(lab.trustedPreviewClicks, previews)
  assert.ok(previews.every(event => event.trusted === true), 'Each real local plan requires its trusted UI click')
  assert.equal(ui.events.some(event => event.type === 'click' && ['执行同步', '确认处理此冲突', '检查连接', '重新绑定远端'].includes(event.buttonText)), false)
  return lab
}

export function validateLocalSyncLabBackendProcess(process, appPID, executable) {
  assert.equal(process?.source, 'Win32_Process')
  assert.ok(Number.isSafeInteger(process.pid) && process.pid > 0)
  assert.ok(Number.isSafeInteger(appPID) && appPID > 0)
  assert.equal(process.parentPid, appPID, 'The local-lab backend must be the actual App main process direct child')
  assert.notEqual(process.pid, appPID)
  assert.ok(path.win32.isAbsolute(process.executable) && path.win32.isAbsolute(executable))
  assert.equal(path.win32.resolve(process.executable).toLowerCase(), path.win32.resolve(executable).toLowerCase(),
    'The local-lab backend must be the exact current installed executable')
  assert.equal(typeof process.createdAt, 'string'); assert.ok(Number.isFinite(Date.parse(process.createdAt)))
  return process
}

export function validateLocalSyncLabBackendExit(exit, process) {
  assert.equal(exit?.source, 'Win32_Process'); assert.equal(exit.pid, process.pid)
  assert.deepEqual(exit.processes, [], 'A closed port alone cannot prove the owned backend PID exited')
  assert.equal(exit.portClosed, true); assert.equal(exit.complete, true)
  return exit
}

export function validateLocalSyncLabLifecycle(report) {
  assert.equal(report.group, 'local-sync-lab')
  const lab = report.localSyncLabLifecycle, seed = report.localSyncLabSeed
  assert.equal(lab?.schemaVersion, 1); assert.equal(lab.complete, true)
  assert.equal(lab.seededWhileStopped, true); assert.equal(lab.logicalUnchanged, true)
  assert.equal(seed?.schemaVersion, 1); assert.equal(seed.complete, true)
  assert.deepEqual(seed.expectedCounts, { notes: 21, open: 21, history: 26 })
  const expectedData = path.win32.join(report.dataIsolation.ownedRoot, 'data')
  const backendExecutable = path.win32.join(path.win32.dirname(report.app.executable), 'resources', 'bin', 'notepad-server.exe')
  assert.equal(report.dataIsolation.data, expectedData)
  for (const phase of [lab.bootstrap, lab.restarted]) {
    assert.ok(Number.isSafeInteger(phase?.pid) && phase.pid > 0)
    assert.equal(phase.dataDir, expectedData); assert.equal(phase.profile, report.dataIsolation.profile)
    assert.equal(phase.backendDataVerified, true); assert.deepEqual(phase.app, report.app, 'Local lab used a different installed application lifetime')
    validateLocalSyncLabBackendProcess(phase.backendProcess, phase.pid, backendExecutable)
  }
  assert.equal(lab.bootstrap.noteCount, 21); assert.equal(lab.restarted.pid, report.pid)
  const closed = lab.bootstrap.closed
  assert.equal(closed?.backendStopped, true); assert.equal(closed.portClosed, true)
  assert.equal(closed.appExit.pid, lab.bootstrap.pid); assert.equal(closed.appExit.nativeClose, true)
  assert.equal(closed.appExit.code, 0); assert.equal(closed.appExit.signal, null)
  assert.deepEqual(closed.backendProcess, lab.bootstrap.backendProcess)
  assert.equal(closed.backendProcessExited, true)
  validateLocalSyncLabBackendExit(closed.appExit.backendExit, lab.bootstrap.backendProcess)
  assert.deepEqual(seed.bootstrapClosed, closed, 'Seed is detached from the actual normal bootstrap shutdown')
  assert.deepEqual(lab.finalExit, report.exit, 'Local lab final shutdown differs from the real installed process exit')
  validateLocalSyncLabBackendExit(lab.finalExit.backendExit, lab.restarted.backendProcess)
  assert.equal(seed.noteIDs?.length, 21); assert.equal(new Set(seed.noteIDs).size, 21)
  exactSet(report.fullAppUi.setup.noteIDs, seed.noteIDs, 'seeded owned UI note')
  assert.deepEqual(seed.files?.map(file => file.id), seed.noteIDs)
  assert.deepEqual(seed.records?.map(record => record.itemID), seed.noteIDs)
  const table = (snapshot, name) => {
    const matches = snapshot.logical?.tables.filter(item => item.name === name)
    assert.equal(matches?.length, 1, 'Local lab logical table missing or ambiguous: ' + name)
    return matches[0]
  }
  for (const snapshot of [seed.before, seed.after, lab.after]) {
    assert.equal(snapshot?.schemaVersion, 14)
    assert.equal(snapshot.database, path.win32.join(expectedData, 'data.db'))
    assert.equal(snapshot.remote?.path, path.win32.join(expectedData, 'sync-lab-remote')); assert.equal(snapshot.remote.exists, false)
    assert.equal(table(snapshot, 'files').rows.length, 21)
    exactSet(table(snapshot, 'files').rows.map(file => file.id), seed.noteIDs, 'owned database note')
    assert.deepEqual(table(snapshot, 'schema_migrations').rows.map(row => row.version).sort((a, b) => Number(a.integer) - Number(b.integer)),
      Array.from({ length: 14 }, (_, index) => ({ integer: String(index + 1) })), 'The actual complete schema14 is required')
  }
  assert.equal(table(seed.before, 'sync_conflicts').rows.length, 0, 'Bootstrap must not import unrelated conflicts')
  const conflicts = table(seed.after, 'sync_conflicts').rows
  assert.equal(conflicts.length, 47); assert.equal(new Set(conflicts.map(row => row.id)).size, 47)
  exactSet(conflicts.filter(row => row.status === 'open').map(row => row.item_id), seed.noteIDs, 'one actual open conflict per owned note')
  assert.equal(conflicts.filter(row => ['resolved', 'superseded'].includes(row.status)).length, 26)
  for (const row of conflicts) {
    assert.ok(seed.noteIDs.includes(row.item_id)); assert.equal(row.base_hash, '')
    const record = seed.records.find(item => item.itemID === row.item_id)
    digest(record.local); digest(record.remote); assert.notEqual(record.local, record.remote)
    for (const side of ['local', 'remote']) {
      assert.equal(row[side + '_hash'], record[side]); assert.equal(sha(row[side + '_record']), record[side], 'Actual synthetic Record bytes do not match their declared hash')
      const value = JSON.parse(row[side + '_record'])
      assert.equal(value.format, 'local-notepad-sync-record'); assert.equal(value.version, 1)
      assert.equal(value.kind, 'file'); assert.equal(value.state, 'present'); assert.equal(value.id, row.item_id); assert.equal(value.file.id, row.item_id)
    }
  }
  const expected = clone(seed.before.logical), settings = expected.tables.find(item => item.name === 'settings')
  assert.equal(settings?.rows.length, 1); assert.deepEqual(seed.settingsBefore, settings.rows[0])
  for (const key of ['sync_enabled', 'sync_auto_enabled']) assert.ok(settings.rows[0][key] === null || settings.rows[0][key]?.integer === '0')
  for (const key of ['sync_provider', 'sync_endpoint', 'sync_username', 'sync_password']) assert.ok(settings.rows[0][key] === null || settings.rows[0][key] === '')
  Object.assign(settings.rows[0], { sync_enabled: { integer: '1' }, sync_provider: 'local-lab', sync_endpoint: '', sync_username: '', sync_password: '',
    sync_auto_enabled: { integer: '0' }, sync_interval_minutes: { integer: '5' } })
  expected.tables.find(item => item.name === 'sync_conflicts').rows = clone(conflicts)
  assert.deepEqual(seed.after.logical, expected, 'Local fixture seeding changed undeclared logical data or schema')
  assert.deepEqual(seed.after.uploads, seed.before.uploads)
  assert.equal(seed.seedDigest, sha(JSON.stringify({ after: seed.after, records: seed.records })), 'Seed logical/Record digest mismatch')
  assert.deepEqual(lab.after, seed.after, 'Real local-lab UI or app lifetimes changed the full protected logical snapshot')
  validateLocalSyncLabUi(report.fullAppUi, seed)
  return lab
}

export function validateFullAppInstalledReport(report, ledger) {
  assert.equal(report.schemaVersion, 1); assert.equal(report.scope, SCOPE + '-group')
  assert.equal(report.complete, true); assert.equal(report.cleanupComplete, true)
  assert.equal(report.version, '4.249.0'); commit(report.productCommit); commit(report.productTree); commit(report.verifierCommit)
  assert.equal(report.platform, 'win32'); assert.equal(report.runnerEnvironment, 'github-hosted')
  for (const key of ['syntheticData', 'realBackend', 'backendDataVerified', 'backendStopped', 'uninstalled']) assert.equal(report[key], true)
  for (const key of ['bridgeOverridden', 'timerAccelerated', 'emulatedViewport', 'forceTerminated']) assert.equal(report[key], false)
  assert.deepEqual(report.runtimeErrors, []); assert.equal(report.cleanupError, undefined)
  assert.equal(report.runner.group, report.group); assert.equal(report.fullAppUi.group, report.group)
  for (const key of ['runID', 'runAttempt', 'job']) nonempty(report.runner[key])
  assert.equal(report.runner.job, 'full-application-ui')
  assert.equal(report.dataIsolation.baselineScope, 'this-matrix-job-only')
  assert.equal(report.dataIsolation.baselineOwner, [report.runner.runID, report.runner.runAttempt, report.runner.job, report.group].join(':'))
  assert.equal(report.dataIsolation.defaultUnchanged, true); assert.deepEqual(report.dataIsolation.defaultBefore, report.dataIsolation.defaultAfter)
  assert.equal(report.fixtureInputsVerified, true); assert.ok(Array.isArray(report.fixtureInputs))
  assert.equal(new Set(report.fixtureInputs.map(file => file.name)).size, report.fixtureInputs.length)
  for (const file of report.fixtureInputs) {
    assert.match(file.name, /^[a-z0-9][a-z0-9_.-]{0,100}\.(json|txt|md|png)$/); assert.ok(!file.name.includes('..'))
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 8 * 1024 * 1024); digest(file.sha256)
    const relative = path.win32.relative(report.dataIsolation.ownedRoot, file.path)
    assert.equal(relative, 'fixture-inputs\\' + file.name, 'Synthetic file must belong only to this runner fixture directory')
  }
  assert.equal(report.originalInstallation.allOriginalGatesPassed, true); assert.equal(report.originalInstallation.reportsUnchanged, true)
  assert.equal(report.originalThreePages.complete, true); assert.equal(report.originalThreePages.reportsUnchanged, true)
  assert.equal(report.originalThreePages.sameProductAndInstalledBytes, true); assert.equal(report.originalThreePages.scenes, 12)
  for (const key of ['report', 'accepted', 'sourceProof']) fileIdentity(report.originalInstallation[key])
  for (const key of ['report', 'accepted']) fileIdentity(report.originalThreePages[key])
  fileIdentity(report.ledger)
  assert.equal(report.ledger.canonicalization, 'git-LF', 'Cross-platform ledger identity must use its checked Git source bytes')
  assert.equal(report.exit?.nativeClose, true); assert.equal(report.exit.pid, report.pid); assert.equal(report.exit.code, 0); assert.equal(report.exit.signal, null)
  assert.equal(report.windowHelper?.stoppedCleanly, true)
  assert.equal(report.app.packaged, true); assert.equal(report.app.version, report.version)
  for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) { digest(report.app[key]); assert.equal(report.app[key], report.originalInstallation.application[key]) }
  assert.deepEqual(report.commands.map(item => item.label), ['additional-ui-install', 'additional-ui-uninstall'])
  for (const command of report.commands) { assert.equal(command.code, 0); assert.equal(command.signal, null); assert.equal(command.timedOut, false) }
  assert.equal(report.windowSizes.length, FULL_APP_MATRIX.length + 1, 'One setup window and each matrix entry require actual owned HWND resize receipts')
  assert.equal(report.resizeCommands.length, FULL_APP_MATRIX.length + 1)
  for (const [index, window] of report.windowSizes.entries()) {
    const phase = index === 0 ? 'setup' : 'matrix'
    assert.equal(window.phase, phase); assert.equal(report.resizeCommands[index].phase, phase); assert.equal(report.resizeCommands[index].complete, true)
    assert.equal(window.nativeWindow, true); assert.deepEqual(window.viewport, index === 0 ? { width: 1280, height: 800 } : FULL_APP_MATRIX[index - 1].viewport)
    assert.deepEqual(window.requested, window.viewport)
    validateNativeWindowResize(window.native, { pid: report.pid, handle: window.handle, executable: report.app.executable,
      width: window.viewport.width, height: window.viewport.height, devicePixelRatio: window.devicePixelRatio,
      beforeViewport: window.native.beforeViewport })
  }
  commit(report.sourceFiles.productCommit); assert.equal(report.sourceFiles.productCommit, report.productCommit)
  assert.equal(report.sourceFiles.productTree, report.productTree)
  exactSet(Object.keys(report.sourceFiles.productPaths), ['src', 'electron', 'server', 'package.json', 'package-lock.json', 'vite.config.js'], 'immutable application tree/path')
  Object.values(report.sourceFiles.productPaths).forEach(commit)
  assert.equal(report.sourceFiles.verifierCommit, report.verifierCommit)
  for (const map of [report.sourceFiles.product, report.sourceFiles.verifier, report.sourceFiles.actualPages, report.sourceFiles.runtime]) {
    assert.ok(Object.keys(map).length > 0); Object.values(map).forEach(commit)
  }
  exactSet(Object.keys(report.sourceFiles.product), FULL_APP_PRODUCT_SOURCE_FILES, 'bound product helper')
  exactSet(Object.keys(report.sourceFiles.runtime), FULL_APP_RUNTIME_SOURCE_FILES, 'bound runtime product source')
  exactSet(Object.keys(report.sourceFiles.verifier), FULL_APP_VERIFIER_SOURCE_FILES, 'bound verifier source')
  exactSet(Object.keys(report.sourceFiles.actualPages), fullAppProductPageSources(ledger), 'bound actual page source')
  validateFullAppLedgerSourceIdentity(ledger, report.sourceFiles)
  if (report.group === 'local-sync-lab') validateLocalSyncLabLifecycle(report)
  else {
    assert.equal(report.localSyncLabLifecycle, undefined, 'Ordinary groups cannot claim local-lab preparation')
    assert.equal(report.localSyncLabSeed, undefined, 'Ordinary groups cannot receive seeded sync data')
  }
  validateFullAppUiEvidence(report.fullAppUi, ledger)
  return report
}

export function validateFullAppUiAggregate(reports, ledger) {
  validateFullAppUiLedger(ledger)
  assert.deepEqual(ledger.openCoverage, [], 'Unmapped actual pages prevent whole-application completion')
  exactSet(reports.map(report => report.group), FULL_APP_GROUPS, 'accepted group')
  for (const report of reports) validateFullAppInstalledReport(report, ledger)
  const first = reports[0]
  for (const report of reports.slice(1)) {
    for (const key of ['productCommit', 'productTree', 'verifierCommit', 'installer', 'ledger', 'sourceFiles']) assert.deepEqual(report[key], first[key], 'Group identity differs: ' + key)
    for (const key of ['runID', 'runAttempt', 'job']) assert.equal(report.runner[key], first.runner[key])
    for (const key of ['executableSHA256', 'asarSHA256', 'backendSHA256']) assert.equal(report.app[key], first.app[key])
    for (const key of ['report', 'accepted', 'sourceProof']) assert.deepEqual(report.originalInstallation[key], first.originalInstallation[key])
    for (const key of ['report', 'accepted']) assert.deepEqual(report.originalThreePages[key], first.originalThreePages[key])
  }
  assert.equal(new Set(reports.map(report => report.dataIsolation.baselineOwner)).size, FULL_APP_GROUPS.length,
    'Each matrix group must retain its own runner data baseline')
  return { schemaVersion: 1, scope: SCOPE, complete: true, productCommit: first.productCommit, productTree: first.productTree,
    verifierCommit: first.verifierCommit, installer: clone(first.installer), ledger: clone(first.ledger),
    originalLifecycleAndThreePagesPreserved: true, matrix: clone(FULL_APP_MATRIX),
    groups: reports.map(report => ({ group: report.group, scenes: report.fullAppUi.scenes.length,
      images: report.fullAppUi.scenes.reduce((count, scene) => count + scene.images.length, 0) + report.fullAppUi.popups.length,
      runnerBaselineOwner: report.dataIsolation.baselineOwner, normalNativeExit: true, cleanupComplete: true })),
    openCoverage: [] }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ['aggregate'], 'Only the fixed downloaded-group aggregation command is supported')
  const root = fileURLToPath(new URL('../', import.meta.url)), ledger = JSON.parse(readFileSync(path.join(root, 'scripts/full-app-ui-routes.json')))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000 }).trim()
  assert.equal(git('rev-parse', 'HEAD'), process.env.GITHUB_SHA)
  const ledgerBytes = Buffer.from(readFileSync(path.join(root, 'scripts/full-app-ui-routes.json'), 'utf8').replace(/\r\n/g, '\n'))
  const out = path.join(root, 'test-results/full-app-ui'), reports = FULL_APP_GROUPS.map(group => {
    const directory = path.join(out, group), reportFile = path.join(directory, 'full-app-ui-installed.json')
    const report = JSON.parse(readFileSync(reportFile)), accepted = JSON.parse(readFileSync(path.join(directory, 'full-app-ui-installed-accepted.json')))
    assert.equal(accepted.complete, true); assert.equal(accepted.group, group)
    const bytes = readFileSync(reportFile)
    assert.deepEqual(accepted.report, { filename: path.basename(reportFile), bytes: bytes.length, sha256: sha(bytes) })
    assert.equal(report.verifierCommit, process.env.GITHUB_SHA); assert.equal(report.runner.runID, process.env.GITHUB_RUN_ID)
    assert.equal(report.runner.runAttempt, process.env.GITHUB_RUN_ATTEMPT)
    assert.deepEqual(report.ledger, { filename: 'full-app-ui-routes.json', bytes: ledgerBytes.length, sha256: sha(ledgerBytes), canonicalization: 'git-LF' })
    for (const [file, expected] of Object.entries(report.sourceFiles.verifier)) assert.equal(expected, git('rev-parse', process.env.GITHUB_SHA + ':' + file))
    verifyFullAppUiFiles(report.fullAppUi, directory, ledger)
    return report
  })
  const accepted = validateFullAppUiAggregate(reports, ledger)
  writeFileSync(path.join(out, 'full-app-ui-accepted.json'), JSON.stringify(accepted, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ complete: true, groups: accepted.groups.map(group => group.group), scenes: accepted.groups.reduce((count, group) => count + group.scenes, 0) }))
}
