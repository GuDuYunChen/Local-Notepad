// Pure verifier contracts. These functions never start Electron, fake a page,
// modify a report, or treat a complete-looking JSON object as a native run.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FULL_APP_GROUPS = Object.freeze(['settings', 'projects', 'research', 'editor'])
export const FULL_APP_PRODUCT_SOURCE_FILES = Object.freeze([
  'scripts/native-ui-select.mjs', 'scripts/check-ui-control-render.cjs', 'scripts/desktop-save-fixture.mjs',
  'scripts/desktop-window-session.mjs', 'scripts/desktop-window-target.mjs', 'scripts/desktop-window-worker.ps1',
  'scripts/local-export-directory-session.mjs', 'scripts/local-export-directory-worker.ps1', 'scripts/installer-lifecycle-core.mjs',
])
export const FULL_APP_VERIFIER_SOURCE_FILES = Object.freeze([
  'scripts/run-full-app-ui-installed.mjs', 'scripts/check-full-app-ui-desktop.mjs', 'scripts/full-app-ui-shared.mjs', 'scripts/full-app-ui-shared.node.mjs',
  'scripts/full-app-ui-projects.mjs', 'scripts/full-app-ui-settings.mjs', 'scripts/full-app-ui-offline-settings.mjs', 'scripts/full-app-ui-research.mjs', 'scripts/full-app-ui-main-editor.mjs', 'scripts/full-app-ui-navigation.mjs',
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

export function validateFullAppUiLedger(ledger) {
  assert.equal(ledger?.schemaVersion, 1); assert.equal(ledger.scope, SCOPE)
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
    assert.ok(Array.isArray(entry.routeIds)); assert.equal(new Set(entry.routeIds).size, entry.routeIds.length)
    for (const id of entry.routeIds) assert.ok(allRoutes.some(route => route.id === id), 'Coverage refers to an undeclared route')
  }
  assert.equal(new Set(ledger.sourceCoverage.map(entry => entry.file)).size, ledger.sourceCoverage.length)
  for (const route of allRoutes) assert.ok(ledger.sourceCoverage.some(entry => entry.file === route.source && entry.routeIds.includes(route.id)), 'Route source is not independently mapped: ' + route.id)
  assert.ok(Array.isArray(ledger.openCoverage))
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
      }
    }
  }
  for (const route of routes) for (const matrix of ledger.matrix) assert.ok(routeCoverage.has(routeMatrixKey({ routeId: route.id, ...matrix })), 'Route only has a popup screenshot; expanded page controls remain unobserved')
  return ui
}

function verifyPng(image, out, viewport, dpr) {
  imageIdentity(image); const bytes = readFileSync(path.join(out, image.filename))
  assert.equal(bytes.length, image.bytes); assert.equal(sha(bytes), image.sha256)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(bytes.subarray(12, 16).toString(), 'IHDR')
  assert.equal(bytes.readUInt32BE(16), Math.round(viewport.width * dpr), 'Screenshot width does not match the native viewport')
  assert.equal(bytes.readUInt32BE(20), Math.round(viewport.height * dpr), 'Screenshot height does not match the native viewport')
}

export function verifyFullAppUiFiles(ui, out, ledger) {
  validateFullAppUiEvidence(ui, ledger)
  for (const scene of ui.scenes) for (const image of scene.images) verifyPng(image, out, scene.viewport, scene.devicePixelRatio)
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
  for (const map of [report.sourceFiles.product, report.sourceFiles.verifier, report.sourceFiles.actualPages]) {
    assert.ok(Object.keys(map).length > 0); Object.values(map).forEach(commit)
  }
  exactSet(Object.keys(report.sourceFiles.product), FULL_APP_PRODUCT_SOURCE_FILES, 'bound product helper')
  exactSet(Object.keys(report.sourceFiles.verifier), FULL_APP_VERIFIER_SOURCE_FILES, 'bound verifier source')
  exactSet(Object.keys(report.sourceFiles.actualPages), [...new Set(ledger.sourceCoverage.map(entry => entry.file)
    .concat(Object.values(ledger.groups).flatMap(group => group.routes.map(route => route.source))))], 'bound actual page source')
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
