// Contract fixtures only. No pin, native page, Windows acceptance or installer is
// produced by these tests. All records below are deliberately synthetic inputs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { FULL_APP_GROUPS, FULL_APP_MATRIX, FULL_APP_PRODUCT_SOURCE_FILES, FULL_APP_VERIFIER_SOURCE_FILES,
  validateFullAppUiLedger, validateFullAppUiEvidence, verifyFullAppUiFiles, validateNativeWindowResize,
  validateFullAppPrerequisites, validateFullAppInstalledReport, validateFullAppUiAggregate, validateFullAppFixtureFile } from './full-app-ui-evidence.mjs'

const clone = value => structuredClone(value)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fp = filename => ({ filename, bytes: 1600, sha256: '1'.repeat(64) })
const application = { executable: 'C:\\owned\\application\\记事本.exe', version: '4.249.0', packaged: true,
  executableSHA256: '2'.repeat(64), asarSHA256: '3'.repeat(64), backendSHA256: '4'.repeat(64) }
function ledgerFixture() {
  const routes = FULL_APP_GROUPS.map(group => ({ id: 'contract-' + group, title: 'Synthetic contract route',
    source: 'src/components/Contract' + group.replaceAll('-', '') + '.jsx', root: '.contract-' + group, requiredStates: ['ready', 'empty'] }))
  return { schemaVersion: 1, scope: 'installed-actual-app-page-matrix', matrix: clone(FULL_APP_MATRIX),
    groups: Object.fromEntries(FULL_APP_GROUPS.map((group, index) => [group, { routes: [routes[index]] }])),
    sourceCoverage: routes.map(route => ({ file: route.source, routeIds: [route.id], classification: 'actual-route', reason: 'Synthetic validator contract only' })),
    openCoverage: [] }
}
function popupObservation() {
  const rect = { left: 10, top: 40, right: 210, bottom: 120, width: 200, height: 80 }
  return { inputId: 'owned-select', expanded: true, optionsAvailable: true, value: 'a',
    options: [{ value: 'a', disabled: false }, { value: 'b', disabled: false }],
    popup: { listId: 'owned-select_list', optionId: 'owned-select_list_0', ready: true, visible: true, inViewport: true,
      ownedHit: true, paintFrames: 2, root: { ...rect }, content: { ...rect }, item: { ...rect, bottom: 80, height: 40 },
      ancestors: [{ display: 'block', visibility: 'visible', opacity: '1' }] } }
}
function uiFixture(group = 'projects', ledger = ledgerFixture()) {
  const route = ledger.groups[group].routes[0]
  const ui = { schemaVersion: 1, scope: ledger.scope, group, complete: true, matrix: clone(ledger.matrix), routes: clone(ledger.groups[group].routes),
    setup: { noteIDs: ['contract-protected-note'] }, scenes: [], focus: [], popups: [], externalRequests: [], forbiddenRequests: [], runtimeErrors: [], notesUnchanged: true, syncSettingsUnchanged: true }
  for (const matrix of FULL_APP_MATRIX) {
    const suffix = group + '-' + matrix.theme + '-' + matrix.viewport.width
    for (const stateId of route.requiredStates) {
      const image = fp(suffix + '-' + stateId + '.png')
      ui.scenes.push({ group, routeId: route.id, stateId, ...clone(matrix), requested: clone(matrix.viewport), nativeWindow: true,
        devicePixelRatio: 1, root: route.root, complete: true,
        coverageMode: 'route-controls', controlCoverage: { renderedCount: stateId === 'empty' ? 0 : 1, observedCount: stateId === 'empty' ? 0 : 1, unobserved: [] },
        controls: stateId === 'empty' ? [] : [{ selector: '#owned-select', kind: 'select', layout: 'action', size: 'middle',
          expectedHeight: 40, left: 10, top: 40, height: 40, width: 200, visible: true, inViewport: true, hit: true, disabled: false, nativeType: null, classification: 'shared', image: image.filename }],
        geometry: { valid: true, failures: [] }, anchors: [{ selector: 'h2', visible: true, inViewport: true, hit: true, left: 10, top: 5, width: 200, height: 30, image: image.filename }],
        overflow: { document: 0, root: 0, allowed: [] }, image, images: [clone(image)] })
      const scene = ui.scenes.at(-1)
      scene.scrollCoverage = []
      scene.rawSamples = ['before-capture', 'after-capture'].map(phase => ({ root: scene.root,
        rootBounds: { left: 0, top: 0, right: scene.viewport.width, bottom: 200, width: scene.viewport.width, height: 200 },
        viewport: clone(scene.viewport), theme: scene.theme, devicePixelRatio: 1, anchors: clone(scene.anchors),
        controls: scene.controls.map(control => ({ ...control, selectedForProbe: true })), scrollAreas: [], phase, image: image.filename }))
    }
    ui.focus.push({ routeId: route.id, stateId: 'ready', ...clone(matrix), selector: '#owned-select', focused: true,
      focusVisible: true, inViewport: true, hit: true, trustedTab: true, outlines: [{ owner: 'root', width: 2, color: 'rgb(112, 87, 217)' }], shadows: [] })
    const before = popupObservation(), image = fp(suffix + '-popup.png')
    ui.popups.push({ routeId: route.id, stateId: 'ready', ...clone(matrix), selector: '#owned-select', interactionMode: 'selection', beforeValue: 'a', afterValue: 'b',
      pointerCommitted: true, keyboardCommitted: true, escapeClosed: true, repeatClosed: true, focusReturned: true, trustedPointer: true, trustedKeyboard: true,
      popup: clone(before.popup), image, capture: { complete: true, filename: image.filename, before, after: clone(before), image: clone(image) } })
  }
  return ui
}
function resizeFixture(viewport = { width: 704, height: 455 }) {
  const request = { protocol: 1, operation: 'resize-owned-client', pid: 100, handle: 200, executable: application.executable,
    width: viewport.width, height: viewport.height, devicePixelRatio: 1, beforeViewport: clone(viewport) }
  const observation = { handle: request.handle, pid: request.pid, image: request.executable, visible: true, windowClass: 'Chrome_WidgetWin_1',
    client: { width: viewport.width, height: viewport.height }, outer: { width: viewport.width + 16, height: viewport.height + 65 } }
  return { request, receipt: { protocol: 1, operation: request.operation, complete: true, pid: request.pid, handle: request.handle,
    requested: clone(viewport), devicePixelRatio: 1, beforeViewport: clone(viewport), viewportInsets: { width: 0, height: 0 },
    physicalRequested: clone(viewport), nativeClientRequested: clone(viewport), before: clone(observation), attempts: [clone(observation)], after: clone(observation) } }
}
function installedFixture(group = 'projects', ledger = ledgerFixture()) {
  const runner = { runID: '1000', runAttempt: '1', job: 'full-application-ui', group, machine: 'SYNTHETIC-CONTRACT-MACHINE' }
  const defaultSnapshot = { exists: false, files: 0, bytes: 0, sha256: hash('[]') }
  return { schemaVersion: 1, scope: ledger.scope + '-group', group, version: '4.249.0', productCommit: 'a'.repeat(40), productTree: '9'.repeat(40), verifierCommit: 'b'.repeat(40),
    platform: 'win32', runnerEnvironment: 'github-hosted', complete: true, cleanupComplete: true, syntheticData: true, realBackend: true,
    backendDataVerified: true, backendStopped: true, uninstalled: true, bridgeOverridden: false, timerAccelerated: false, emulatedViewport: false, forceTerminated: false,
    runtimeErrors: [], pid: 100, runner, installer: { version: '4.249.0', bytes: 123, sha256: '5'.repeat(64) }, ledger: { ...fp('full-app-ui-routes.json'), canonicalization: 'git-LF' },
    dataIsolation: { ownedRoot: 'C:\\owned\\synthetic-job', baselineScope: 'this-matrix-job-only', baselineOwner: [runner.runID, runner.runAttempt, runner.job, group].join(':'),
      defaultBefore: clone(defaultSnapshot), defaultAfter: clone(defaultSnapshot), defaultUnchanged: true },
    originalInstallation: { allOriginalGatesPassed: true, reportsUnchanged: true, application: clone(application), report: fp('installation.json'),
      accepted: fp('reading-mode-installation-accepted.json'), sourceProof: fp('local-import-verifier-source.json') },
    originalThreePages: { complete: true, reportsUnchanged: true, sameProductAndInstalledBytes: true, scenes: 12,
      report: fp('ui-screens-installed.json'), accepted: fp('ui-screens-installed-accepted.json') },
    fixtureInputs: [], fixtureInputsVerified: true,
    app: clone(application), exit: { pid: 100, nativeClose: true, code: 0, signal: null }, windowHelper: { stoppedCleanly: true },
    commands: ['additional-ui-install', 'additional-ui-uninstall'].map(label => ({ label, code: 0, signal: null, timedOut: false })),
    windowSizes: [{ viewport: { width: 1280, height: 800 } }, ...FULL_APP_MATRIX].map(({ viewport }, index) => ({ requested: clone(viewport), viewport: clone(viewport), nativeWindow: true, devicePixelRatio: 1,
      phase: index === 0 ? 'setup' : 'matrix', pid: 100, handle: 200, native: resizeFixture(viewport).receipt })),
    resizeCommands: [{ complete: true, phase: 'setup' }, ...FULL_APP_MATRIX.map(() => ({ complete: true, phase: 'matrix' }))],
    sourceFiles: { productCommit: 'a'.repeat(40), productTree: '9'.repeat(40),
      productPaths: Object.fromEntries(['src', 'electron', 'server', 'package.json', 'package-lock.json', 'vite.config.js'].map(file => [file, '8'.repeat(40)])),
      verifierCommit: 'b'.repeat(40), product: Object.fromEntries(FULL_APP_PRODUCT_SOURCE_FILES.map(file => [file, 'c'.repeat(40)])),
      verifier: Object.fromEntries(FULL_APP_VERIFIER_SOURCE_FILES.map(file => [file, 'd'.repeat(40)])), actualPages: Object.fromEntries(ledger.sourceCoverage.map(entry => [entry.file, 'e'.repeat(40)])) },
    fullAppUi: uiFixture(group, ledger) }
}
function prerequisitesFixture() {
  const pin = { product: 'a'.repeat(40), current: { version: '4.249.0', bytes: 123, sha256: '5'.repeat(64) }, previous: { version: '4.232.0', bytes: 456, sha256: '6'.repeat(64) } }
  const identity = { productCommit: pin.product, verifierCommit: 'b'.repeat(40) }
  return { pin, verifierCommit: identity.verifierCommit, runID: '1000', runAttempt: '1',
    original: { ...identity, complete: true, cleanupComplete: true, forceTerminated: false, installers: { current: pin.current, previous: pin.previous },
      appExits: Array(6).fill({ code: 0 }), dataComparisons: Array(6).fill({ equal: true }), checks: ['synthetic-original-check'], localExportRun: { application } },
    accepted: { ...identity, complete: true, screenshotsVerified: true, installationChecks: ['synthetic-original-check'], installer: pin.current },
    sourceProof: { ...identity, productionModified: false },
    preparation: { scope: 'installer-preparation-contracts-only', nativeLifecycleExecuted: false, verifierCommit: identity.verifierCommit,
      runID: '1000', runAttempt: '1', job: 'install-upgrade-uninstall', platform: 'win32' },
    threeReport: { ...identity, scope: 'installed-ui-screens', complete: true, cleanupComplete: true, forceTerminated: false,
      dataIsolation: { defaultUnchanged: true }, originalInstallation: { reportsUnchanged: true }, bridgeOverridden: false, timerAccelerated: false,
      emulatedViewport: false, realBackend: true, syntheticData: true, runtimeErrors: [], installer: pin.current, app: clone(application), uiScreens: { complete: true, scenes: Array(12).fill({}) } },
    threeAccepted: { ...identity, complete: true, originalLifecyclePreserved: true, sameOriginallyAcceptedInstalledBytes: true,
      normalNativeExit: true, cleanupComplete: true, defaultDataUnchanged: true, currentInstaller: pin.current, report: fp('ui-screens-installed.json') },
    threeReportFingerprint: fp('ui-screens-installed.json') }
}

test('complete declared group evidence is accepted without mutating its ledger or observations', () => {
  const ledger = ledgerFixture(), ui = uiFixture('projects', ledger), before = JSON.stringify({ ledger, ui })
  validateFullAppUiEvidence(ui, ledger); assert.equal(JSON.stringify({ ledger, ui }), before)
})
test('route, state, theme and all three exact native dimensions are independently required', () => {
  const mutations = [ui => ui.scenes.pop(), ui => { ui.scenes[1] = clone(ui.scenes[0]) }, ui => { ui.scenes[0].stateId = 'invented' },
    ui => { ui.scenes[0].viewport.width = 760; ui.scenes[0].requested.width = 760 }, ui => { ui.scenes[0].theme = 'system' },
    ui => { ui.routes[0].requiredStates.pop() }, ui => { ui.matrix.pop() }, ui => { ui.scenes[0].nativeWindow = false }]
  for (const mutate of mutations) { const ui = uiFixture(); mutate(ui); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture())) }
})
test('an empty or duplicate route ledger cannot accept a zero-page run', () => {
  for (const mutate of [l => { l.groups.projects.routes = [] }, l => { l.groups.settings.routes[0] = clone(l.groups.projects.routes[0]) },
    l => { l.sourceCoverage[1].routeIds = [] }, l => { l.matrix.pop() }]) {
    const ledger = ledgerFixture(); mutate(ledger); assert.throws(() => validateFullAppUiLedger(ledger))
  }
})
test('a portal state uses its exact reviewed root and cannot redefine the route at runtime', () => {
  const ledger = ledgerFixture(), route = ledger.groups.projects.routes[0]
  route.stateRoots = { empty: '.actual-confirmation-portal' }
  const ui = uiFixture('projects', ledger)
  for (const scene of ui.scenes) if (scene.stateId === 'empty') { scene.root = route.stateRoots.empty; for (const raw of scene.rawSamples) raw.root = scene.root }
  validateFullAppUiEvidence(ui, ledger)
  const changed = clone(ui); changed.scenes[1].root = '.unreviewed-overlay'
  assert.throws(() => validateFullAppUiEvidence(changed, ledger))
  for (const stateRoots of [{ undeclared: '.portal' }, { empty: '' }, [], null]) {
    const altered = clone(ledger); altered.groups.projects.routes[0].stateRoots = stateRoots
    assert.throws(() => validateFullAppUiLedger(altered))
  }
})
test('ordinary fields cannot impersonate an undeclared editor semantic exception', () => {
  const ledger = ledgerFixture(), route = ledger.groups.projects.routes[0]
  const exception = { selector: '.actual-editor-body', source: route.source, reason: 'The real editor owns this multiline serialized body surface' }
  route.editorExceptions = [exception]
  const ui = uiFixture('projects', ledger), control = ui.scenes[0].controls[0]
  Object.assign(control, { kind: 'textarea', nativeType: 'textarea', classification: 'editor', semanticException: clone(exception), expectedHeight: null, height: 160 })
  for (const sample of ui.scenes[0].rawSamples) Object.assign(sample.controls[0], control)
  validateFullAppUiEvidence(ui, ledger)
  for (const mutate of [c => { delete c.semanticException }, c => { c.semanticException.selector = '.ordinary-input' },
    c => { c.semanticException.source = 'src/components/Other.jsx' }, c => { c.semanticException.reason = 'unreviewed' },
    c => { c.classification = 'content' }]) {
    const changed = clone(ui); mutate(changed.scenes[0].controls[0]); assert.throws(() => validateFullAppUiEvidence(changed, ledger))
  }
  for (const entries of [['.actual-editor-body'], [{ selector: '.actual-editor-body', reason: 'no source' }], [exception, exception]]) {
    const changed = clone(ledger); changed.groups.projects.routes[0].editorExceptions = entries
    assert.throws(() => validateFullAppUiLedger(changed))
  }
})
test('visible actual geometry and current product token heights are mandatory', () => {
  for (const mutate of [c => { c.height = 32; c.expectedHeight = 32 }, c => { c.hit = false }, c => { c.inViewport = false },
    c => { c.width = 0 }, c => { c.classification = 'native'; c.nativeType = 'text' }, c => { c.size = 'unknown' }]) {
    const ui = uiFixture(); mutate(ui.scenes[0].controls[0]); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
  for (const height of [28, 40, 44]) {
    const ui = uiFixture(), control = ui.scenes[0].controls[0]
    control.size = ({ 28: 'small', 40: 'middle', 44: 'large' })[height]; control.height = height; control.expectedHeight = height
    for (const sample of ui.scenes[0].rawSamples) Object.assign(sample.controls[0], control)
    validateFullAppUiEvidence(ui, ledgerFixture())
  }
})
test('unreachable anchors, root overflow and missing screenshot records refuse acceptance', () => {
  for (const mutate of [s => { s.anchors = [] }, s => { s.anchors[0].hit = false }, s => { s.overflow.document = 5 },
    s => { s.overflow.root = 20 }, s => { s.images = [] }, s => { s.image.sha256 = 'f'.repeat(64) }]) {
    const ui = uiFixture(); mutate(ui.scenes[0]); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
})
test('real keyboard focus requires one root outline and no duplicate glow', () => {
  for (const mutate of [f => { f.focused = false }, f => { f.focusVisible = false }, f => { f.outlines = [] },
    f => { f.outlines.push(clone(f.outlines[0])) }, f => { f.outlines[0].owner = 'inner' }, f => { f.shadows = ['glow'] },
    f => { f.stateId = 'unrecorded' }, f => { f.trustedTab = false }]) {
    const ui = uiFixture(); mutate(ui.focus[0]); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
  const ui = uiFixture(); ui.focus.shift(); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
})
test('transparent, unpainted, foreign or changing popup samples cannot validate a screenshot', () => {
  for (const mutate of [p => { p.capture.before.popup.paintFrames = 0 }, p => { p.capture.before.popup.ancestors[0].opacity = '0' },
    p => { p.capture.after.inputId = 'foreign' }, p => { p.capture.after.value = 'b' }, p => { p.capture.after.options.pop() },
    p => { p.capture.before.popup.ownedHit = false }, p => { p.capture.complete = false }, p => { p.capture.image.sha256 = 'e'.repeat(64) }]) {
    const ui = uiFixture(); mutate(ui.popups[0]); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
})
test('pointer, repeated click, keyboard commitment and Escape remain distinct popup requirements', () => {
  for (const key of ['pointerCommitted', 'keyboardCommitted', 'escapeClosed', 'repeatClosed', 'focusReturned', 'trustedPointer', 'trustedKeyboard']) {
    const ui = uiFixture(); ui.popups[0][key] = false; assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
  const ui = uiFixture(); ui.popups.shift(); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
})
test('read-only popup previews require real opening and closing without committing or changing the displayed value', () => {
  const preview = () => {
    const ui = uiFixture()
    for (const popup of ui.popups) {
      popup.interactionMode = 'preview'; popup.afterValue = popup.beforeValue
      delete popup.pointerCommitted; delete popup.keyboardCommitted
      popup.pointerOpened = true; popup.keyboardOpened = true
    }
    return ui
  }
  validateFullAppUiEvidence(preview(), ledgerFixture())
  for (const mutate of [p => { p.interactionMode = 'unknown' }, p => { delete p.interactionMode },
    p => { p.pointerOpened = false }, p => { p.keyboardOpened = false }, p => { p.afterValue = 'changed' },
    p => { p.pointerCommitted = true }, p => { p.keyboardCommitted = true }, p => { p.repeatClosed = false },
    p => { p.escapeClosed = false }, p => { p.focusReturned = false }, p => { p.trustedPointer = false },
    p => { p.trustedKeyboard = false }, p => { p.capture.before.value = 'foreign'; p.capture.after.value = 'foreign' }]) {
    const ui = preview(); mutate(ui.popups[0]); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
  const selection = uiFixture(); selection.popups[0].interactionMode = 'preview'
  assert.throws(() => validateFullAppUiEvidence(selection, ledgerFixture()))
})
test('a popup-only screenshot cannot replace an expanded route and every rendered control must be observed', () => {
  for (const mutate of [s => { s.controlCoverage.renderedCount++ }, s => { s.controlCoverage.observedCount++ },
    s => { s.controlCoverage.unobserved = ['#offscreen'] }, s => { s.controls = [] }]) {
    const ui = uiFixture(); mutate(ui.scenes[0]); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
  const ui = uiFixture(); ui.scenes[0].coverageMode = 'owned-popup'; ui.scenes[1].coverageMode = 'owned-popup'
  assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  const shared = uiFixture(), first = shared.scenes[0]
  first.coverageMode = 'owned-popup'; first.image = clone(shared.popups[0].image); first.images = [clone(first.image)]
  for (const target of [...first.controls, ...first.anchors]) target.image = first.image.filename
  for (const sample of first.rawSamples) sample.image = first.image.filename
  validateFullAppUiEvidence(shared, ledgerFixture())
  shared.scenes[2].image = clone(first.image); shared.scenes[2].images = [clone(first.image)]
  assert.throws(() => validateFullAppUiEvidence(shared, ledgerFixture()))
})
test('a tall report must preserve its actual scroll samples and photograph the full interval without gaps', () => {
  const complete = () => {
    const ui = uiFixture(), scene = ui.scenes[0]
    const surface = { selector: '.actual-scroll-container', clientHeight: 300, scrollHeight: 1000, rangeStart: 0, rangeEnd: 700,
      complete: true, positions: [] }
    scene.images = [0, 225, 450, 675, 700].map((position, index) => {
      const image = fp('long-report-part-' + index + '.png')
      surface.positions.push({ requested: position, actual: position, bounds: { top: 50, bottom: 350 }, image: image.filename })
      return image
    })
    scene.image = clone(scene.images[0]); scene.scrollCoverage = [surface]
    for (const target of [...scene.controls, ...scene.anchors]) target.image = scene.image.filename
    const raw = clone(scene.rawSamples[0]); raw.scrollAreas = [{ ...surface, positions: undefined, complete: undefined }]
    scene.rawSamples = scene.images.flatMap(image => ['before-capture', 'after-capture'].map(phase => ({ ...clone(raw), phase, image: image.filename })))
    return ui
  }
  validateFullAppUiEvidence(complete(), ledgerFixture())
  for (const mutate of [s => { s.scrollCoverage = [] }, s => { s.scrollCoverage[0].positions.pop() },
    s => { s.scrollCoverage[0].positions.splice(1, 1) }, s => { s.scrollCoverage[0].positions[1].actual = 0 },
    s => { s.scrollCoverage[0].positions[1].image = 'not-captured.png' }, s => { s.rawSamples = [] }]) {
    const ui = complete(); mutate(ui.scenes[0]); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
})
test('a native PNG cannot use another root or a target that scrolled away at either capture boundary', () => {
  for (const mutate of [s => { delete s.controls[0].image }, s => { s.anchors[0].image = 'foreign.png' }, s => { s.rawSamples.shift() }, s => { s.rawSamples[0].root = '.unrelated-page' },
    s => { s.rawSamples[0].rootBounds.top = 700; s.rawSamples[0].rootBounds.bottom = 900 },
    s => { s.rawSamples[0].controls[0].top = 700 }, s => { s.rawSamples[0].controls[0].inViewport = false },
    s => { s.rawSamples[1].controls[0].hit = false }, s => { s.rawSamples[0].anchors[0].visible = false },
    s => { s.rawSamples[1].anchors = [] }]) {
    const ui = uiFixture(); mutate(ui.scenes[0]); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
})
test('network, runtime or protected-data changes cannot be hidden by complete scenes', () => {
  for (const mutate of [u => { u.externalRequests.push('https://synthetic.invalid') }, u => { u.forbiddenRequests.push('probe') },
    u => { u.runtimeErrors.push('uncaught') }, u => { u.notesUnchanged = false }, u => { u.syncSettingsUnchanged = false }]) {
    const ui = uiFixture(); mutate(ui); assert.throws(() => validateFullAppUiEvidence(ui, ledgerFixture()))
  }
})
test('native resize proof binds the actual owned PID, HWND, image, DPI and un-clamped client size', () => {
  const valid = resizeFixture(); validateNativeWindowResize(valid.receipt, valid.request)
  for (const mutate of [r => { r.after.pid++ }, r => { r.after.handle++ }, r => { r.after.image = 'C:\\foreign.exe' },
    r => { r.after.client.width-- }, r => { r.after.visible = false }, r => { r.physicalRequested.height++ },
    r => { r.devicePixelRatio = 2 }, r => { r.attempts = [] }, r => { r.viewportInsets.height = 26 },
    r => { r.beforeViewport.height-- }]) {
    const { receipt, request } = resizeFixture(); mutate(receipt); assert.throws(() => validateNativeWindowResize(receipt, request))
  }
})
test('synthetic file inputs cannot write arbitrary paths, alternate streams, executable formats or unbounded payloads', () => {
  validateFullAppFixtureFile({ name: 'empty-error.json', bytes: Buffer.alloc(0) })
  for (const name of ['../profile.json', 'C:\\app\\data.json', 'input.json:stream', 'input.exe', 'input..json', 'sub/file.json']) {
    assert.throws(() => validateFullAppFixtureFile({ name, bytes: Buffer.from('{}') }))
  }
  assert.throws(() => validateFullAppFixtureFile({ name: 'oversize.json', bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }))
  assert.throws(() => validateFullAppFixtureFile({ name: 'implicit.json', bytes: '{}' }))
  const ledger = ledgerFixture(), report = installedFixture('projects', ledger)
  report.fixtureInputs.push({ name: 'synthetic.json', path: 'C:\\owned\\synthetic-job\\fixture-inputs\\synthetic.json', bytes: 2, sha256: hash('{}') })
  validateFullAppInstalledReport(report, ledger)
  report.fixtureInputs[0].path = 'C:\\owned\\synthetic-job\\profile\\synthetic.json'
  assert.throws(() => validateFullAppInstalledReport(report, ledger))
})
test('original lifecycle and retained three-page acceptance must bind the current product and same workflow run', () => {
  validateFullAppPrerequisites(prerequisitesFixture())
  for (const mutate of [p => { p.original.appExits.pop() }, p => { p.threeReport.complete = false }, p => { p.preparation.runID = 'old' },
    p => { p.preparation.runAttempt = 'old' }, p => { p.threeAccepted.productCommit = 'c'.repeat(40) },
    p => { p.threeReport.app.asarSHA256 = '7'.repeat(64) }, p => { p.threeAccepted.report.sha256 = '8'.repeat(64) },
    p => { p.sourceProof.productionModified = true }]) {
    const prerequisites = prerequisitesFixture(); mutate(prerequisites); assert.throws(() => validateFullAppPrerequisites(prerequisites))
  }
})
test('each new runner has its own baseline and must quit and uninstall normally', () => {
  const ledger = ledgerFixture(); validateFullAppInstalledReport(installedFixture('projects', ledger), ledger)
  for (const mutate of [r => { r.dataIsolation.baselineOwner = 'original-runner' }, r => { r.dataIsolation.defaultAfter.files++ },
    r => { r.exit.nativeClose = false }, r => { r.forceTerminated = true }, r => { r.commands[1].timedOut = true },
    r => { r.windowHelper.stoppedCleanly = false }, r => { r.backendStopped = false }, r => { r.windowSizes.pop() },
    r => { delete r.sourceFiles.actualPages['src/components/Contractsettings.jsx'] }]) {
    const report = installedFixture('projects', ledger); mutate(report); assert.throws(() => validateFullAppInstalledReport(report, ledger))
  }
})
test('whole-app completion requires all four groups and no open source coverage', () => {
  const ledger = ledgerFixture(), reports = FULL_APP_GROUPS.map(group => installedFixture(group, ledger))
  const accepted = validateFullAppUiAggregate(reports, ledger); assert.equal(accepted.complete, true)
  assert.throws(() => validateFullAppUiAggregate(reports.slice(1), ledger))
  const open = clone(ledger); open.openCoverage.push({ file: 'src/components/Unmapped.jsx', reason: 'not visited' })
  validateFullAppInstalledReport(reports[0], open)
  assert.throws(() => validateFullAppUiAggregate(reports, open), /Unmapped actual pages/)
})
test('aggregation refuses a different product, binary, prior acceptance or verifier source', () => {
  for (const mutate of [r => { r.productCommit = 'f'.repeat(40); r.sourceFiles.productCommit = r.productCommit },
    r => { r.installer.sha256 = '7'.repeat(64) }, r => { r.sourceFiles.verifier[FULL_APP_VERIFIER_SOURCE_FILES[0]] = 'e'.repeat(40) },
    r => { r.originalThreePages.report.sha256 = '8'.repeat(64) }, r => { r.runner.runID = '1001'; r.dataIsolation.baselineOwner = ['1001', '1', r.runner.job, r.group].join(':') }]) {
    const ledger = ledgerFixture(), reports = FULL_APP_GROUPS.map(group => installedFixture(group, ledger)); mutate(reports[1])
    assert.throws(() => validateFullAppUiAggregate(reports, ledger))
  }
})

// A real encoded synthetic PNG is only a file-integrity contract. It is never
// stored with an installed acceptance result or treated as an application image.
function png(width, height) {
  const crc = bytes => { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0) }; return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, bytes) => { const head = Buffer.from(type), length = Buffer.alloc(4), tail = Buffer.alloc(4); length.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(Buffer.concat([head, bytes]))); return Buffer.concat([length, head, bytes, tail]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) { const at = row * (width * 3 + 1) + 1 + col * 3; raw[at] = col % 256; raw[at + 1] = row % 256; raw[at + 2] = (row + col) % 256 }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
test('actual PNG bytes, digest and native viewport dimensions are verified, including scrolled image segments', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'full-app-evidence-contract-')), ledger = ledgerFixture(), ui = uiFixture()
  try {
    const buffers = new Map()
    const store = (image, viewport) => {
      const key = viewport.width + ':' + viewport.height
      if (!buffers.has(key)) buffers.set(key, png(viewport.width, viewport.height))
      const bytes = buffers.get(key); Object.assign(image, { bytes: bytes.length, sha256: hash(bytes) }); writeFileSync(path.join(directory, image.filename), bytes)
    }
    for (const scene of ui.scenes) { store(scene.image, scene.viewport); scene.images = [clone(scene.image)] }
    for (const popup of ui.popups) { store(popup.image, popup.viewport); popup.capture.image = clone(popup.image) }
    verifyFullAppUiFiles(ui, directory, ledger)
    const file = path.join(directory, ui.scenes[0].image.filename), bytes = readFileSync(file); bytes[100] ^= 1; writeFileSync(file, bytes)
    assert.throws(() => verifyFullAppUiFiles(ui, directory, ledger))
    const changed = clone(ui); changed.scenes[0].devicePixelRatio = 2
    for (const sample of changed.scenes[0].rawSamples) sample.devicePixelRatio = 2
    writeFileSync(file, buffers.get('704:455')); assert.throws(() => verifyFullAppUiFiles(changed, directory, ledger), /Screenshot width/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
