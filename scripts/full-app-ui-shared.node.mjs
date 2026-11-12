// Pure verifier rejection/serialization contracts. No native app is launched
// and no object produced here is an acceptance report or installed-page proof.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import controlEvidence from './check-ui-control-render.cjs'
import { COLLAPSED_SIDEBAR_EXPAND, validateCollapsedSidebarObservation } from './full-app-ui-evidence.mjs'
import { observeFullAppPopup, captureActualFullAppPopup, validateFullAppCaptureContinuity, validateFullAppPageSample, measureFullAppScrollCoverage, collectFullAppScrollOwners, createFullAppUiShared, withinActualClientPort, finiteOwnerMotionActive, waitForFiniteOwnerMotion } from './full-app-ui-shared.mjs'
import { buildResearchImportFixtures, researchRoutes } from './full-app-ui-research.mjs'

const clone = value => structuredClone(value)
const hash = value => createHash('sha256').update(value).digest('hex')
const matrix = { theme: 'light', viewport: { width: 704, height: 455 } }
function pageSample() {
  const rect = { left: 20, top: 30, right: 180, bottom: 70, width: 160, height: 40, visible: true, inViewport: true, hit: true }
  return { root: '.actual-page', ...clone(matrix), rootBounds: { ...rect }, devicePixelRatio: 1, overflow: { document: 0, root: 0 },
    controls: [{ selector: '.actual-input', fieldSelector: '.actual-input', kind: 'input', layout: null, size: 'middle', expectedHeight: 40, disabled: false, classification: 'shared', ...rect }],
    anchors: [{ selector: '.actual-heading', ...rect }] }
}
function popupSample() {
  return { inputId: 'original-control', value: 'a', options: [{ id: 'option-a', value: 'a', disabled: false, selected: true }],
    popup: { listId: 'original-control_list', optionId: 'option-a', ready: true, paintFrames: 2 } }
}

test('capture continuity retains the exact real owner, control and anchor geometry', () => {
  const before = pageSample(), actual = clone(before)
  assert.equal(validateFullAppCaptureContinuity(before, actual, matrix).controls[0], actual.controls[0])
})
test('PNG boundary rejects a temporarily moved or hidden target even if another sample could recover', () => {
  for (const mutate of [
    value => { value.controls[0].left += 50 },
    value => { value.controls[0].visible = false },
    value => { value.controls[0].hit = false },
    value => { value.anchors[0].top += 50 },
    value => { value.anchors[0].inViewport = false },
    value => { value.rootBounds.top += 50 },
  ]) { const before = pageSample(), actual = clone(before); mutate(actual); assert.throws(() => validateFullAppCaptureContinuity(before, actual, matrix)) }
})
test('PNG boundary refuses lost controls, duplicate selectors and changed action state', () => {
  for (const mutate of [value => value.controls.pop(), value => value.controls.push(clone(value.controls[0])),
    value => { value.controls[0].disabled = true }, value => { value.controls[0].fieldSelector = '.other-input' },
    value => { value.anchors = [] }]) {
    const before = pageSample(), actual = clone(before); mutate(actual)
    assert.throws(() => validateFullAppCaptureContinuity(before, actual, matrix))
  }
})
test('popup capture stores independent immediate before and after reads around the actual image', async () => {
  const reads = [popupSample(), popupSample(), popupSample()], order = [], receipt = {}
  reads.forEach((value, index) => { value.observation = index })
  await captureActualFullAppPopup({ receipt, filename: 'owned.png', read: async () => { order.push('read'); return reads.shift() },
    capture: async (filename, guard) => { order.push('capture-enter'); await guard(); order.push('png'); return { filename, bytes: 1400, sha256: 'a'.repeat(64) } }, save() {} })
  assert.deepEqual(order, ['read', 'capture-enter', 'read', 'png', 'read'])
  assert.equal(receipt.capture.before.observation, 1); assert.equal(receipt.capture.after.observation, 2)
  assert.notEqual(receipt.capture.before, receipt.capture.after); assert.equal(receipt.capture.complete, true)
})
test('a DOM-only or wrong-owner popup never earns a completed PNG receipt', async () => {
  for (const mutate of [value => { value.popup.ready = false }, value => { value.popup.paintFrames = 0 },
    value => { value.popup.listId = 'unrelated-listbox' }]) {
    const initial = popupSample(), after = popupSample(), receipt = {}; mutate(after)
    const values = [initial, initial, after]
    await assert.rejects(captureActualFullAppPopup({ receipt, filename: 'owned.png', read: async () => values.shift(),
      capture: async (filename, guard) => { await guard(); return { filename, bytes: 1400, sha256: 'a'.repeat(64) } }, save() {} }))
    assert.equal(receipt.capture.complete, false); assert.equal(receipt.capture.after, after)
  }
})
test('a native PNG error is preserved and cannot become a successful popup capture', async () => {
  const failure = new Error('native capture refused'), receipt = {}
  await assert.rejects(captureActualFullAppPopup({ receipt, filename: 'owned.png', read: async () => popupSample(),
    capture: async (_filename, guard) => { await guard(); throw failure }, save() {} }), error => error === failure)
  assert.equal(receipt.capture.complete, false); assert.equal(receipt.image, undefined)
})
test('file input rejects an unowned or byte-mismatched fixture before any browser command', async () => {
  const calls = [], file = { path: 'C:\\owned\\source.json', name: 'source.json', bytes: 2, sha256: hash('{}') }
  const shared = createFullAppUiShared({ evaluate: async () => { calls.push('read') }, click: async () => calls.push('click'),
    cdp: { send: async () => calls.push('cdp') }, until: async fn => fn(), capture: async () => calls.push('png'), save() {},
    report: { fullAppUi: {}, fixtureInputs: [file] }, routes: [], matrix })
  await assert.rejects(shared.chooseFile('input[type=file]', { ...file, path: 'C:\\unowned\\source.json' }))
  await assert.rejects(shared.chooseFile('input[type=file]', { ...file, sha256: 'f'.repeat(64) }))
  assert.deepEqual(calls, [])
})
test('current App selection refuses the historical native-select compatibility path before input', async () => {
  const calls = []
  const shared = createFullAppUiShared({ evaluate: async () => { calls.push('read'); return { count: 1, kind: 'native' } },
    click: async () => calls.push('click'), cdp: { send: async () => calls.push('cdp') }, until: async fn => fn(), capture() {}, save() {},
    report: { fullAppUi: {} }, routes: [], matrix })
  await assert.rejects(shared.nativeSelect.choose('select', 'one'), /actual migrated shared Select/)
  assert.deepEqual(calls, ['read'])
})
test('viewport-fixed modal sweep excludes background scrollers but keeps genuine nested and contained scrolling', () => {
  const node = parentElement => ({ parentElement, querySelectorAll: () => [] })
  const viewport = node(null), background = node(viewport), overlay = node(background)
  const dialog = node(overlay), nestedScrollport = node(dialog), child = node(nestedScrollport)
  dialog.querySelectorAll = () => [nestedScrollport, child]
  const fixed = [...collectFullAppScrollOwners(dialog, () => overlay)]
  assert.deepEqual(fixed, [dialog, nestedScrollport, child, overlay])
  assert.ok(!fixed.includes(background) && !fixed.includes(viewport), 'Underlying app scroll panes cannot be claimed by a fixed dialog')
  assert.deepEqual([...collectFullAppScrollOwners(overlay, () => overlay)], [overlay], 'Fixed root must not sweep background')
  assert.deepEqual([...collectFullAppScrollOwners(dialog, () => null)],
    [dialog, nestedScrollport, child, overlay, background, viewport], 'Normal or transformed containing blocks retain real ancestor scrollers')
})

test('long-page coverage uses actual clipped image intervals, not nominal scroll step or screenshot counts', () => {
  const surface = { selector: '.scroll', clientHeight: 455, scrollHeight: 1100, requiredContentStart: 0, requiredContentEnd: 1100 }
  const fixture = ranges => {
    const images = ranges.map((_, index) => ({ filename: 'position-' + index + '.png' }))
    const samples = ranges.flatMap(([from, to], index) => ['before-capture', 'after-capture'].map(phase => ({ phase, image: images[index].filename,
      scrollAreas: [{ ...surface, visibleContentStart: from, visibleContentEnd: to }] })))
    return { images, samples }
  }
  const gap = fixture([[0, 100], [341, 441], [645, 745]])
  const refused = measureFullAppScrollCoverage(surface, gap.samples, gap.images)
  assert.equal(refused.complete, false); assert.ok(refused.gaps.some(item => item.from === 100 && item.to === 341))
  const covered = fixture([[0, 400], [300, 700], [600, 1000], [900, 1100]])
  assert.equal(measureFullAppScrollCoverage(surface, covered.samples, covered.images).complete, true)
  covered.samples.at(-1).scrollAreas[0].visibleContentEnd = 1000
  assert.equal(measureFullAppScrollCoverage(surface, covered.samples, covered.images).complete, false, 'The true before/after image intersection must reach the last content')
})

// Exercise the real current product's parsers, rather than duplicating their
// accepted schemas in a verifier-only assertion. The bundle is a temporary
// pure-Node reader, never a renderer or replacement product module.
const productRoot = process.env.FULL_APP_CONTRACT_PRODUCT_ROOT || fileURLToPath(new URL('../', import.meta.url))
const temporary = mkdtempSync(path.join(tmpdir(), 'notepad-full-app-contract-'))
const bundled = await build({ stdin: { contents: [
  "export { collectionFixture, memoryStorage } from './src/test/collectionFixtures.js'",
  "export { createSearchPresetStore } from './src/services/searchPresets.js'",
  "export { parseSearchPresetBackup } from './src/services/searchPresetBackup.js'",
  "export { readSearchCollection } from './src/services/searchCollections.js'",
  "export { createCollectionStudyStore } from './src/services/collectionStudy.js'",
  "export { readCollectionPackage } from './src/services/collectionPackage.js'",
].join('\n'), resolveDir: productRoot, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
const readersPath = path.join(temporary, 'readers.mjs'); writeFileSync(readersPath, bundled.outputFiles[0].contents)
const readers = await import(pathToFileURL(readersPath).href)
process.on('exit', () => rmSync(temporary, { recursive: true, force: true }))

async function realStoredFixture() {
  const fixture = readers.collectionFixture(3)
  const studies = readers.createCollectionStudyStore({ storage: () => fixture.storage, locks: () => ({ request: async (_name, _options, callback) => callback() }) })
  for (const [index, status] of ['read', 'revisit'].entries()) await studies.saveNote(await studies.load(fixture.entry, fixture.store), 'n' + index, status, '保持原样的合成批注 ' + index, { sourceStore: fixture.store })
  const presetStorage = readers.memoryStorage(), presets = readers.createSearchPresetStore({ storage: () => presetStorage })
  for (const name of ['真实格式检索一', '真实格式检索二']) presets.save(name, { query: '合成', source: 'title', folderId: '', days: '0', pinned: false, matchCase: false, sort: 'relevance' })
  const snapshot = await studies.load(fixture.entry, fixture.store)
  return { values: { presets: presets.list().entries, collection: fixture.entry, study: { key: snapshot.key, raw: snapshot.raw } }, fixture, studies, snapshot }
}
test('all research import input files are accepted by the exact production readers without writes', async () => {
  const fixture = await realStoredFixture(), before = fixture.snapshot.raw
  const files = buildResearchImportFixtures(fixture.values, '2026-11-09T12:00:00.000Z')
  assert.equal(readers.parseSearchPresetBackup(files.presets).length, 2)
  assert.deepEqual(readers.readSearchCollection(files.collection), fixture.fixture.collection)
  assert.equal(fixture.studies.prepareImport(fixture.snapshot, files.study, fixture.fixture.store).data.records.length, 2)
  const pack = await readers.readCollectionPackage(files.package)
  assert.equal(pack.collection.id, fixture.fixture.collection.id); assert.equal(pack.study.records.length, 2)
  assert.equal(fixture.fixture.storage.getItem(fixture.snapshot.key), before)
})
test('research input builder refuses mismatched source identity, report hash or overlong names', async () => {
  const { values } = await realStoredFixture()
  for (const mutate of [
    value => { value.collection.key += '-other' },
    value => { const parsed = JSON.parse(value.study.raw); parsed.reportSHA256 = 'f'.repeat(64); value.study.raw = JSON.stringify(parsed) },
    value => { const parsed = JSON.parse(value.presets[0].raw); parsed.name = '界'.repeat(49); value.presets[0].raw = JSON.stringify(parsed) },
    value => { const parsed = JSON.parse(value.study.raw); parsed.records[0].id = 'not-in-source'; value.study.raw = JSON.stringify(parsed) },
  ]) { const value = clone(values); mutate(value); assert.throws(() => buildResearchImportFixtures(value, '2026-11-09T12:00:00.000Z')) }
})
test('production package reader independently rejects changed bytes despite an otherwise valid verifier input', async () => {
  const { values } = await realStoredFixture(), files = buildResearchImportFixtures(values, '2026-11-09T12:00:00.000Z')
  const altered = JSON.parse(files.package); altered.collection.name += '已改动'
  await assert.rejects(readers.readCollectionPackage(JSON.stringify(altered)), /校验不一致/)
  assert.throws(() => readers.parseSearchPresetBackup(files.invalid))
})
test('research routes declare every actual module once and retain the empty-selection and real undo states', () => {
  assert.equal(new Set(researchRoutes.map(route => route.id)).size, researchRoutes.length)
  assert.ok(researchRoutes.find(route => route.id === 'research-collections').requiredStates.includes('empty-selection'))
  assert.ok(researchRoutes.find(route => route.id === 'research-batch').requiredStates.includes('undone'))
  assert.ok(researchRoutes.find(route => route.id === 'research-reading').requiredStates.includes('annotation'))
})

test('a center-hit control clipped by a real client scrollbar cannot qualify as fully visible', () => {
  const parent = { left: 0, top: 0, right: 200, bottom: 120 }, metrics = { clientLeft: 1, clientTop: 1, clientWidth: 181, clientHeight: 101 }
  const clipped = { left: 100, right: 198, top: 10, bottom: 50 }
  assert.ok(clipped.right <= parent.right && (clipped.left + clipped.right) / 2 < metrics.clientWidth, 'Counterexample fits the old outer rectangle and center hit')
  assert.equal(withinActualClientPort(clipped, parent, metrics, 'auto', 'visible'), false)
  assert.equal(withinActualClientPort({ ...clipped, right: 181 }, parent, metrics, 'auto', 'visible'), true)
  assert.equal(withinActualClientPort({ left: 10, right: 100, top: 80, bottom: 119 }, parent, metrics, 'visible', 'auto'), false)
  assert.equal(withinActualClientPort(clipped, parent, metrics, 'visible', 'visible'), true)
  assert.throws(() => withinActualClientPort(clipped, parent, {}, 'auto', 'auto'), /client-port metrics/)
})

test('finite owner motion settles naturally under one original until call while infinite animation is ignored', async () => {
  const entrance = { root: '.actual-menu', animations: [{ playState: 'running', pending: false, duration: 150, iterations: 1, endTime: 150 }] }
  const settled = { root: '.actual-menu', animations: [{ playState: 'running', pending: false, duration: 1000, iterations: 'infinite', endTime: 'infinite' }] }
  const samples = [entrance, settled]; let untilCalls = 0
  const receipt = await waitForFiniteOwnerMotion(async () => samples.shift(), async check => {
    untilCalls++; assert.equal(await check(), false); return await check()
  })
  assert.equal(untilCalls, 1); assert.equal(receipt.polls, 2); assert.equal(receipt.first, entrance)
  assert.equal(receipt.settled, settled); assert.equal(receipt.complete, true)
  assert.equal(finiteOwnerMotionActive({ root: '.actual-menu', animations: [{ ...entrance.animations[0], playState: 'finished' }] }), false)
  assert.equal(finiteOwnerMotionActive({ root: '.actual-menu', animations: [{ ...entrance.animations[0], playState: 'paused' }] }), false)
  assert.equal(finiteOwnerMotionActive({ root: '.actual-menu', animations: [{ ...entrance.animations[0], playState: 'idle', pending: true }] }), true)
})

test('unfinished finite motion preserves the original deadline failure and cannot mark the image ready', async () => {
  const sample = { root: '.actual-menu', animations: [{ playState: 'running', pending: true, duration: 150, iterations: 1, endTime: 150 }] }
  const failure = new Error('original fifteen-second readiness deadline'), receipt = {}; let calls = 0
  await assert.rejects(waitForFiniteOwnerMotion(async () => sample, async check => { calls++; assert.equal(await check(), false); throw failure }, receipt), error => error === failure)
  assert.equal(calls, 1); assert.equal(receipt.complete, false); assert.equal(receipt.latest, sample)
  assert.throws(() => finiteOwnerMotionActive({ root: '.actual-menu', animations: [{ playState: 'running', pending: false, duration: null, iterations: 1, endTime: 150 }] }), /timing/)
})

// The following are serialized observer contracts with explicit DOM geometry,
// not a native rendering fixture or a claim that these objects were screenshots.
const { runInNewContext } = await import('node:vm')
const viewportObservers = await import('./full-app-ui-shared.mjs')
function overflowFixture() {
  const all = [], namespaceURI = 'http://www.w3.org/1999/xhtml'
  const rectangle = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })
  const make = (tag, id, box, parent = null) => {
    const node = { tagName: tag.toUpperCase(), localName: tag, namespaceURI, id, className: '', dataset: {}, parentElement: parent, children: [],
      isConnected: true, textContent: id, innerText: id, clientLeft: 0, clientTop: 0, clientWidth: box.width, clientHeight: box.height,
      scrollWidth: box.width, scrollHeight: box.height, scrollTop: 0, disabled: false, type: tag === 'input' ? 'text' : '', scrollCalls: [], box,
      css: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible',
        contain: 'none', contentVisibility: 'visible', outlineStyle: 'none', outlineWidth: '0px', boxShadow: 'none' },
      getBoundingClientRect() { return { ...this.box } }, getClientRects() { return [this.box] },
      getAttribute(name) { return name === 'id' ? this.id : name === 'aria-label' ? this.id : null },
      contains(other) { return other === this || this.children.some(child => child.contains(other)) },
      matches(selector) {
        return selector.split(',').some(value => {
          const part = value.trim()
          if (part === '*') return true
          if (part === ':disabled') return this.disabled
          if (part === ':focus-visible') return this === control
          if (part === '[data-ui-control]') return Boolean(this.dataset.uiControl)
          if (part.startsWith('#')) return this.id === part.slice(1)
          if (part.startsWith('[id=')) return this.id === JSON.parse(part.slice(4, -1))
          if (part.startsWith('.')) return this.className.split(' ').includes(part.slice(1))
          return this.localName === part
        })
      },
      closest(selector) { for (let item = this; item; item = item.parentElement) if (item.matches(selector)) return item; return null },
      querySelectorAll(selector) { return all.filter(item => item !== this && this.contains(item) && item.matches(selector)) },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
      scrollIntoView(options) { this.scrollCalls.push(options) }, classList: { contains() { return false } },
    }
    if (parent) parent.children.push(node)
    all.push(node); return node
  }
  const html = make('html', '', rectangle(0, -600, 704, 1200))
  html.clientHeight = 455; html.scrollHeight = 1200; html.scrollTop = 600; html.dataset.theme = 'light'
  const body = make('body', 'body', rectangle(0, -600, 704, 455), html)
  body.css.overflowX = 'auto'; body.css.overflowY = 'auto'; body.scrollHeight = 1200
  const page = make('section', 'page', rectangle(10, 20, 400, 200), body); page.className = 'actual-page'
  const control = make('input', 'control', rectangle(20, 40, 160, 40), page)
  control.className = 'ant-input app-ui-input'; control.dataset.uiControl = 'input'
  const document = { documentElement: html, body, scrollingElement: html, activeElement: control, compatMode: 'CSS1Compat',
    querySelectorAll(selector) { return all.filter(item => item.matches(selector)) },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
    elementFromPoint() { return control },
  }
  return { html, body, page, control, make, rectangle, document,
    globals: { document, innerWidth: 704, innerHeight: 455, devicePixelRatio: 1,
      getComputedStyle: node => node.css, requestAnimationFrame: callback => callback() } }
}
function serializedOverflowObservation(fixture, kind) {
  const helper = viewportObservers.observeFullAppOverflowViewport.toString(), port = withinActualClientPort.toString()
  const source = kind === 'page'
    ? `(${viewportObservers.observeFullAppPage.toString()})({root:'.actual-page',anchors:['#control']},${port},${helper})`
    : `(${viewportObservers.observeFullAppFocus.toString()})('#control',()=>false,${port},${helper})`
  return JSON.parse(JSON.stringify(runInNewContext(source, fixture.globals)))
}
async function serializedEnsureVisible(fixture) {
  const shared = createFullAppUiShared({ evaluate: async source => runInNewContext(source, fixture.globals), click() {},
    cdp: { send() {} }, until: async check => check(), capture() {}, save() {}, report: { fullAppUi: {} }, routes: [], matrix })
  await shared.ensureVisible('#control')
}

function affixInputFixture({ small = false, password = false } = {}) {
  const f = overflowFixture(), wrapper = f.make('span', 'official-affix', f.rectangle(20, 40, 200, small ? 28 : 40), f.page)
  wrapper.className = 'ant-input-affix-wrapper app-ui-input' + (small ? ' ant-input-affix-wrapper-sm' : '')
  // Locked rc-input keeps the data-ui-control attribute on this actual input.
  // Only the existing official affix owns its dimensions and size class.
  f.page.children = f.page.children.filter(node => node !== f.control)
  wrapper.children.push(f.control); f.control.parentElement = wrapper
  f.control.box = f.rectangle(42, small ? 43 : 49, 160, 22); f.control.clientHeight = 22
  if (password) { f.control.dataset.uiControl = 'password'; f.control.type = 'password' }
  for (const name of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) f.control.css[name] = '0px'
  return { ...f, wrapper }
}
test('serialized input and password measurements use their real affix but keep the actual inner field identity', () => {
  for (const password of [false, true]) for (const small of [false, true]) {
    const f = affixInputFixture({ password, small }), result = serializedOverflowObservation(f, 'page'), control = result.controls[0]
    assert.equal(result.controls.length, 1); assert.equal(control.selector, '[id="official-affix"]'); assert.equal(control.fieldSelector, '[id="control"]')
    assert.equal(control.kind, password ? 'password' : 'input'); assert.equal(control.classification, 'shared')
    assert.equal(control.height, small ? 28 : 40); assert.equal(control.size, small ? 'small' : 'middle')
    assert.equal(control.expectedHeight, small ? 28 : 40); assert.equal(f.control.getBoundingClientRect().height, 22)
    validateFullAppPageSample(result, matrix)
  }
})
test('transparent project checkbox keeps its native field and measures only the owned painted label', () => {
  const f = overflowFixture(), { rectangle } = f
  delete f.control.dataset.uiControl
  f.control.dataset.uiNative = 'checkbox'
  f.control.type = 'checkbox'
  f.control.checked = false
  f.control.css.opacity = '0'
  f.control.css.pointerEvents = 'none'
  f.control.box = rectangle(25, 45, 15, 15)
  const label = f.make('label', 'chapter-label', rectangle(18, 40, 30, 28), f.page)
  label.className = 'project-chapter-select'
  label.classList = { contains: name => name === 'project-chapter-select' }
  f.page.children = f.page.children.filter(node => node !== f.control)
  label.children.unshift(f.control)
  f.control.parentElement = label
  const mark = f.make('span', 'chapter-paint', rectangle(25, 45, 15, 15), label)
  mark.getAttribute = name => name === 'aria-hidden' ? 'true' : name === 'id' ? mark.id : null
  f.control.nextElementSibling = mark
  f.document.elementFromPoint = () => mark
  const observe = () => JSON.parse(JSON.stringify(runInNewContext(
    '(' + viewportObservers.observeFullAppPage.toString() + ')({root:".actual-page",anchors:[]},' +
      withinActualClientPort.toString() + ',' + viewportObservers.observeFullAppOverflowViewport.toString() + ')', f.globals)))
  const first = observe(), control = first.controls[0]
  assert.equal(first.controls.length, 1)
  assert.equal(control.kind, 'input')
  assert.equal(control.classification, 'native')
  assert.equal(control.nativeType, 'checkbox')
  assert.equal(control.selector, '[id="chapter-paint"]')
  assert.equal(control.fieldSelector, '[id="control"]')
  assert.equal(control.nativePresentation?.owner, 'project-chapter-select-label')
  assert.equal(control.nativePresentation.inputChecked, false)
  assert.equal(control.visible, true); assert.equal(control.hit, true)
  validateFullAppPageSample(first, matrix)
  f.control.checked = true
  const checked = observe()
  assert.equal(checked.controls[0].nativePresentation.inputChecked, true)
  validateFullAppCaptureContinuity(first, checked, matrix)
  mark.css.opacity = '0'
  assert.throws(() => validateFullAppPageSample(observe(), matrix), /hidden, clipped or obscured/)
  mark.css.opacity = '1'
  mark.getAttribute = name => name === 'id' ? mark.id : null
  const unowned = observe()
  assert.equal(unowned.controls[0].selector, '[id="control"]')
  assert.throws(() => validateFullAppPageSample(unowned, matrix), /hidden, clipped or obscured/)
})

test('ordinary shared input without an affix keeps its own geometry despite an unrelated affix sibling', () => {
  const f = overflowFixture(), unrelated = f.make('span', 'unrelated-affix', f.rectangle(200, 80, 190, 28), f.page)
  unrelated.className = 'ant-input-affix-wrapper ant-input-affix-wrapper-sm'
  const result = serializedOverflowObservation(f, 'page'), control = result.controls[0]
  assert.equal(result.controls.length, 1); assert.equal(control.selector, '[id="control"]'); assert.equal(control.fieldSelector, '[id="control"]')
  assert.equal(control.height, 40); assert.equal(control.size, 'middle'); validateFullAppPageSample(result, matrix)
})
test('affix observation still rejects a malformed official height and swapped inner input identity at capture', () => {
  const f = affixInputFixture(), before = serializedOverflowObservation(f, 'page')
  f.wrapper.box.height = 36; f.wrapper.box.bottom -= 4
  assert.throws(() => validateFullAppPageSample(serializedOverflowObservation(f, 'page'), matrix), /height differs/)
  const swapped = clone(before); swapped.controls[0].fieldSelector = '[id="foreign-input"]'
  assert.throws(() => validateFullAppCaptureContinuity(before, swapped, matrix), /fieldSelector/)
})

function collapsedSidebarFixture() {
  const f = overflowFixture(), { rectangle } = f
  f.html.box = rectangle(0, 0, 704, 455); f.html.scrollHeight = 455; f.html.scrollTop = 0
  f.body.box = rectangle(0, 0, 704, 455); f.body.scrollHeight = 455; f.body.css.overflowX = 'visible'; f.body.css.overflowY = 'visible'
  f.page.box = rectangle(0, 0, 52, 455); f.page.clientWidth = 52; f.page.clientHeight = 455
  f.page.className = 'workspace-sidebar collapsed'; f.page.tagName = 'ASIDE'; f.page.localName = 'aside'
  Object.assign(f.control, { box: rectangle(6, 400, 40, 40), tagName: 'BUTTON', localName: 'button', type: 'button', className: 'app-ui-button ant-btn', clientWidth: 40, clientHeight: 40 })
  f.control.dataset.uiControl = 'button'; f.control.dataset.uiLayout = 'icon'
  const icon = f.make('span', 'icon', rectangle(22, 410, 8, 20), f.control); icon.className = 'ant-btn-icon'
  const glyph = f.make('span', 'glyph', rectangle(22, 410, 8, 20), icon); glyph.textContent = '›'; icon.textContent = '›'
  const initialize = node => {
    node.scrollLeft = 0; node.childNodes = node.children
    node.classList = { contains: value => node.className.split(' ').includes(value) }
    Object.assign(node.css, { outlineOffset: '0px', fontSize: '16px', color: 'rgb(112, 87, 217)', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', pointerEvents: 'auto',
      borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px' })
    return node
  }
  for (const node of f.document.querySelectorAll('*')) initialize(node)
  Object.assign(f.control.css, { outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '2px', outlineColor: 'rgb(112, 87, 217)' })
  const query = f.document.querySelectorAll.bind(f.document)
  f.document.querySelectorAll = selector => selector === COLLAPSED_SIDEBAR_EXPAND ? [f.control] : query(selector)
  f.document.elementFromPoint = (x, y) => x >= 6 && x <= 46 && y >= 400 && y <= 440 ? f.control : f.page
  return { ...f, icon, glyph, initialize }
}
function serializedSidebarObservation(f) {
  const code = `(${viewportObservers.observeCollapsedSidebarFocus.toString()})(${JSON.stringify(COLLAPSED_SIDEBAR_EXPAND)},${viewportObservers.observeFullAppFocus.toString()},${controlEvidence.hasVisibleBoxShadow.toString()},${withinActualClientPort.toString()},${viewportObservers.observeFullAppOverflowViewport.toString()})`
  return JSON.parse(JSON.stringify(runInNewContext(code, f.globals)))
}

test('serialized sidebar focus measures the actual outer ring and accepts its own parent hit outside the button', () => {
  const f = collapsedSidebarFixture(), result = serializedSidebarObservation(f)
  assert.equal(validateCollapsedSidebarObservation(result, matrix), result)
  assert.deepEqual(result.sidebarIcon.controlBounds, { left: 6, top: 400, right: 46, bottom: 440, width: 40, height: 40 })
  assert.deepEqual(result.sidebarIcon.outlineBounds, { left: 2, top: 396, right: 50, bottom: 444, width: 48, height: 48 })
  assert.equal(result.sidebarIcon.ringSamples.length, 12)
  assert.ok(result.sidebarIcon.ringSamples.every(point => point.topElement.relation === 'ancestor' && point.hitWithinOwner))
  assert.equal(f.control.scrollCalls.length, 0, 'The observer must not scroll the clipped target into place')
})
test('a failed at-rest collapsed focus observation is saved before any input or screenshot can hide it', async () => {
  const f = collapsedSidebarFixture(), report = { fullAppUi: { group: 'editor', focus: [] } }, saved = [], actions = []
  for (const node of f.document.querySelectorAll('*')) node.getAnimations = () => []
  f.control.box = f.rectangle(-1, 400, 40, 40)
  const shared = createFullAppUiShared({ evaluate: async source => JSON.parse(JSON.stringify(runInNewContext(source, f.globals))),
    click: async () => actions.push('click'), cdp: { send: async () => actions.push('key') },
    until: async check => check(), capture: async () => actions.push('PNG'), save: () => saved.push(clone(report)),
    report, routes: [{ id: 'nav-sidebar' }], matrix })
  await assert.rejects(shared.focus(COLLAPSED_SIDEBAR_EXPAND, { routeId: 'nav-sidebar', stateId: 'collapsed' }), /button leaves the actual viewport/)
  assert.equal(report.fullAppUi.focus.length, 1)
  assert.equal(saved.at(-1).fullAppUi.focus[0].beforeTab.sidebarIcon.controlBounds.left, -1)
  assert.equal(saved.at(-1).fullAppUi.focus[0].motion.complete, true)
  assert.deepEqual(actions, []); assert.equal(f.control.scrollCalls.length, 0)
})
test('serialized sidebar observation exposes outer clipping even when the button border box remains visible', () => {
  const f = collapsedSidebarFixture()
  f.page.css.overflowX = 'hidden'; f.page.clientLeft = 4; f.page.clientWidth = 44
  const result = serializedSidebarObservation(f)
  assert.equal(result.inViewport, true)
  assert.throws(() => validateCollapsedSidebarObservation(result, matrix), /focus ring is clipped horizontally/)
  assert.equal(f.control.scrollCalls.length, 0)
})
test('serialized sidebar observation records foreign outer-ring hits for the bound raster decision', () => {
  const f = collapsedSidebarFixture(), cover = f.initialize(f.make('div', 'cover', f.rectangle(0, 396, 5, 48), f.body))
  const hit = f.document.elementFromPoint
  f.document.elementFromPoint = (x, y) => x < 5 ? cover : hit(x, y)
  const result = serializedSidebarObservation(f)
  assert.equal(result.hit, true)
  assert.equal(result.sidebarIcon.ringSamples[0].topElement.relation, 'foreign')
  assert.equal(result.sidebarIcon.ringSamples[0].hitWithinOwner, false)
  assert.equal(validateCollapsedSidebarObservation(result, matrix), result)
})
test('serialized sidebar observation detects painted pointer-transparent overlays missed by center hit-testing', () => {
  const f = collapsedSidebarFixture(), cover = f.initialize(f.make('div', 'toast', f.rectangle(0, 396, 5, 48), f.body))
  cover.css.pointerEvents = 'none'; cover.css.backgroundColor = 'rgb(0, 0, 0)'
  const result = serializedSidebarObservation(f)
  assert.equal(result.hit, true)
  assert.ok(result.sidebarIcon.ringSamples.every(point => point.hitWithinOwner))
  assert.equal(result.sidebarIcon.pointerTransparentOverlaps.length, 1)
  assert.equal(result.sidebarIcon.pointerTransparentOverlaps[0].element.id, 'toast')
  assert.equal(validateCollapsedSidebarObservation(result, matrix), result)
})

test('serialized page, focus and actual ensureVisible do not clip against a body overflow propagated to the viewport', async () => {
  for (const overflow of ['auto', 'scroll', 'hidden', 'clip']) {
    const fixture = overflowFixture(); fixture.body.css.overflowX = overflow; fixture.body.css.overflowY = overflow
    const page = serializedOverflowObservation(fixture, 'page'), focus = serializedOverflowObservation(fixture, 'focus')
    assert.equal(page.controls[0].inViewport, true); assert.equal(page.controls[0].hit, true)
    assert.equal(page.overflowViewport.bodyPropagates, true)
    assert.equal(page.anchors[0].inViewport, true); assert.equal(focus.inViewport, true); assert.equal(focus.hit, true)
    await serializedEnsureVisible(fixture); assert.equal(fixture.control.scrollCalls.length, 0)
  }
})

test('serialized root clipping remains at the client viewport even with root containment, while body clipping stays local', async () => {
  const fixture = overflowFixture()
  fixture.html.css.overflowX = 'auto'; fixture.html.css.overflowY = 'auto'; fixture.html.css.contain = 'paint'
  fixture.body.css.overflowX = 'visible'; fixture.body.css.overflowY = 'visible'
  assert.equal(serializedOverflowObservation(fixture, 'page').controls[0].inViewport, true)
  assert.equal(serializedOverflowObservation(fixture, 'focus').inViewport, true)
  await serializedEnsureVisible(fixture); assert.equal(fixture.control.scrollCalls.length, 0)
  fixture.body.css.overflowY = 'hidden'
  const clipped = serializedOverflowObservation(fixture, 'page')
  assert.equal(clipped.overflowViewport.bodyPropagates, false); assert.equal(clipped.controls[0].inViewport, false)
  assert.equal(serializedOverflowObservation(fixture, 'focus').inViewport, false)
  await serializedEnsureVisible(fixture); assert.equal(fixture.control.scrollCalls.length, 1)
})

test('serialized observers refuse body propagation under containment, content visibility, wrong HTML ownership or unknown values', async () => {
  const cases = [
    f => { f.html.css.contain = 'layout' }, f => { f.body.css.contain = 'paint' }, f => { f.body.css.contain = '' },
    f => { f.html.css.contentVisibility = 'auto' }, f => { f.body.css.contentVisibility = 'hidden' },
    f => { f.body.css.contentVisibility = undefined }, f => { f.html.namespaceURI = 'urn:other' },
    f => { f.body.namespaceURI = 'urn:other' },
    f => { const first = f.make('body', 'earlier-body', f.rectangle(0, 0, 704, 455), f.html); f.html.children.splice(0, 0, f.html.children.pop()); assert.equal(f.html.children[0], first) },
  ]
  for (const change of cases) {
    const fixture = overflowFixture(); change(fixture)
    const page = serializedOverflowObservation(fixture, 'page')
    assert.equal(page.overflowViewport.bodyPropagates, false); assert.equal(page.controls[0].inViewport, false)
    assert.equal(serializedOverflowObservation(fixture, 'focus').inViewport, false)
    await serializedEnsureVisible(fixture); assert.equal(fixture.control.scrollCalls.length, 1)
  }
})

test('serialized observers still reject true nested client-port clipping, viewport scrollbars, hidden or covered controls', async () => {
  const fixture = overflowFixture()
  fixture.page.box = fixture.rectangle(0, 0, 200, 120); fixture.page.clientLeft = 1; fixture.page.clientTop = 1
  fixture.page.clientWidth = 181; fixture.page.clientHeight = 101; fixture.page.css.overflowX = 'auto'
  fixture.control.box = fixture.rectangle(100, 10, 98, 40)
  assert.equal(serializedOverflowObservation(fixture, 'page').controls[0].inViewport, false)
  assert.equal(serializedOverflowObservation(fixture, 'focus').inViewport, false)
  await serializedEnsureVisible(fixture); assert.equal(fixture.control.scrollCalls.length, 1)
  const scrollbar = overflowFixture(); scrollbar.html.clientWidth = 688; scrollbar.control.box = scrollbar.rectangle(680, 40, 21, 40)
  assert.equal(serializedOverflowObservation(scrollbar, 'page').controls[0].inViewport, false)
  assert.equal(serializedOverflowObservation(scrollbar, 'focus').inViewport, false)
  const hidden = overflowFixture(); hidden.page.css.visibility = 'hidden'
  assert.equal(serializedOverflowObservation(hidden, 'page').controls[0].visible, false)
  const covered = overflowFixture(); covered.document.elementFromPoint = () => covered.body
  assert.equal(serializedOverflowObservation(covered, 'page').controls[0].hit, false)
  assert.equal(serializedOverflowObservation(covered, 'focus').hit, false)
})

test('serialized scroll coverage uses the actual viewport scroller once and retains genuine nested/body client-port clipping', () => {
  const fixture = overflowFixture(); fixture.page.css.overflowY = 'auto'; fixture.page.scrollHeight = 600
  const page = serializedOverflowObservation(fixture, 'page'), surface = page.scrollAreas.find(item => item.selector === 'html')
  assert.equal(surface.viewportScrollOwner, true); assert.equal(surface.bounds.top, 0); assert.equal(surface.clientHeight, 455)
  assert.equal(surface.ownerBounds.top, -600); assert.equal(surface.visibleHeight, 455)
  assert.equal(surface.visibleContentStart, 600); assert.equal(surface.visibleContentEnd, 1055)
  assert.equal(page.scrollAreas.some(item => item.selector === '[id="body"]'), false)
  assert.equal(page.scrollAreas.find(item => item.selector === '[id="page"]').visibleHeight, 200)
  fixture.body.css.contain = 'layout'; fixture.body.box = fixture.rectangle(0, 0, 704, 90); fixture.body.clientHeight = 90
  const nested = serializedOverflowObservation(fixture, 'page')
  assert.equal(nested.scrollAreas.find(item => item.selector === '[id="body"]').viewportScrollOwner, false)
  assert.equal(nested.scrollAreas.find(item => item.selector === '[id="page"]').visibleHeight, 70)
})

function nativeDetailsFixture() {
  const f = overflowFixture(), { rectangle } = f
  const move = (node, parent) => {
    node.parentElement.children = node.parentElement.children.filter(item => item !== node)
    parent.children.push(node); node.parentElement = parent
  }
  const details = f.make('details', 'native-details', rectangle(20, 30, 300, 40), f.page)
  details.open = false
  const summary = f.make('summary', 'details-summary', rectangle(20, 30, 300, 40), details)
  const summaryControl = f.make('button', 'summary-control', rectangle(24, 36, 28, 28), summary)
  summaryControl.dataset.uiControl = 'button'; summaryControl.dataset.uiLayout = 'icon'
  const summaryLabel = f.make('span', 'summary-label', rectangle(64, 40, 120, 20), summary)
  // The failed native reports retained nonzero, display:block boxes for closed
  // contents. Deliberately retain these boxes instead of mocking them to zero.
  const content = f.make('div', 'details-content', rectangle(20, 80, 300, 140), details)
  move(f.control, content); f.control.box = rectangle(30, 90, 160, 40)
  let paintedTargets = [summaryControl, summaryLabel, summary]
  const setPaintedTargets = targets => { paintedTargets = targets }
  f.document.elementFromPoint = (x, y) => paintedTargets.find(node => {
    const box = node.getBoundingClientRect()
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
  }) || f.page
  const open = () => {
    details.open = true; details.box = rectangle(20, 30, 300, 190); details.clientHeight = 190; details.scrollHeight = 190
    setPaintedTargets([summaryControl, summaryLabel, summary, f.control])
  }
  return { ...f, details, summary, summaryControl, summaryLabel, content, move, open, setPaintedTargets }
}
function serializedDetailsPage(f, anchors = ['#details-summary']) {
  const code = `(${viewportObservers.observeFullAppPage.toString()})(${JSON.stringify({ root: '.actual-page', anchors })},${withinActualClientPort.toString()},${viewportObservers.observeFullAppOverflowViewport.toString()})`
  return JSON.parse(JSON.stringify(runInNewContext(code, f.globals)))
}

test('serialized native details: closed body boxes do not become rendered controls or scroll surfaces', () => {
  const f = nativeDetailsFixture()
  f.content.css.overflowY = 'auto'; f.content.scrollHeight = 400
  assert.equal(f.control.css.display, 'block'); assert.equal(f.control.getBoundingClientRect().height, 40)
  const sample = serializedDetailsPage(f)
  assert.deepEqual(sample.controls.map(item => item.selector), ['[id="summary-control"]'])
  assert.equal(sample.scrollAreas.some(item => item.selector === '[id="details-content"]'), false)
  assert.equal(sample.anchors[0].hit, true); validateFullAppPageSample(sample, matrix)
})

test('serialized native details: only the first direct summary and its subtree remain visible when closed', () => {
  const f = nativeDetailsFixture()
  // The first summary need not be the first element child, and a later direct
  // summary is part of the closed content rather than another visible header.
  f.details.children = [f.content, f.summary]
  const later = f.make('summary', 'later-summary', f.rectangle(20, 150, 300, 40), f.details)
  const laterButton = f.make('button', 'later-summary-control', f.rectangle(24, 154, 28, 28), later)
  laterButton.dataset.uiControl = 'button'; laterButton.dataset.uiLayout = 'icon'
  const sample = serializedDetailsPage(f, ['#details-summary', '#summary-label'])
  assert.deepEqual(sample.controls.map(item => item.selector), ['[id="summary-control"]'])
  assert.equal(sample.anchors.length, 2); assert.ok(sample.anchors.every(item => item.visible && item.inViewport && item.hit))
  validateFullAppPageSample(sample, matrix)
  assert.throws(() => serializedDetailsPage(f, ['#later-summary']), /Expected one rendered anchor/)
})

test('serialized native details: open content retains real control identity and strict capture geometry', () => {
  const f = nativeDetailsFixture(); f.open()
  const before = serializedDetailsPage(f, ['#control'])
  assert.deepEqual(new Set(before.controls.map(item => item.selector)), new Set(['[id="control"]', '[id="summary-control"]']))
  const input = before.controls.find(item => item.selector === '[id="control"]')
  assert.equal(input.fieldSelector, '[id="control"]'); assert.equal(input.height, 40); assert.equal(input.expectedHeight, 40)
  validateFullAppPageSample(before, matrix)
  validateFullAppCaptureContinuity(before, serializedDetailsPage(f, ['#control']), matrix)
  f.control.box.left += 2; f.control.box.right += 2
  assert.throws(() => validateFullAppCaptureContinuity(before, serializedDetailsPage(f, ['#control']), matrix), /Actual target moved/)
  f.control.box.height = 36; f.control.box.bottom -= 4
  assert.throws(() => validateFullAppPageSample(serializedDetailsPage(f, ['#control']), matrix), /height differs/)
})

test('serialized native details: any closed ancestor hides nested content even when the inner details is open', () => {
  const f = nativeDetailsFixture()
  const inner = f.make('details', 'inner-details', f.rectangle(30, 80, 250, 100), f.content); inner.open = true
  const innerSummary = f.make('summary', 'inner-summary', f.rectangle(30, 80, 250, 30), inner)
  const innerContent = f.make('div', 'inner-content', f.rectangle(30, 110, 250, 70), inner)
  f.move(f.control, innerContent); f.control.box = f.rectangle(40, 120, 160, 40)
  assert.deepEqual(serializedDetailsPage(f).controls.map(item => item.selector), ['[id="summary-control"]'])
  f.open(); inner.open = false
  f.setPaintedTargets([f.summaryControl, f.summaryLabel, f.summary, innerSummary])
  const collapsedInner = serializedDetailsPage(f, ['#inner-summary'])
  assert.deepEqual(collapsedInner.controls.map(item => item.selector), ['[id="summary-control"]'])
  validateFullAppPageSample(collapsedInner, matrix)
  inner.open = true; f.setPaintedTargets([f.summaryControl, f.summaryLabel, f.summary, innerSummary, f.control])
  const expanded = serializedDetailsPage(f, ['#control'])
  assert.ok(expanded.controls.some(item => item.selector === '[id="control"]'))
  validateFullAppPageSample(expanded, matrix)
})

test('serialized native details: an explicitly requested closed-content anchor is rejected rather than dropped', () => {
  const f = nativeDetailsFixture()
  assert.throws(() => serializedDetailsPage(f, ['#details-summary', '#control']), /Expected one rendered anchor: #control \(0\)/)
  assert.equal(f.details.open, false); assert.equal(f.control.scrollCalls.length, 0)
})

test('serialized native details: genuinely clipped or obscured open controls remain mandatory failures', () => {
  const f = nativeDetailsFixture(); f.open()
  f.content.css.overflowX = 'auto'; f.content.clientWidth = 100
  const clipped = serializedDetailsPage(f, ['#control'])
  assert.equal(clipped.controls.find(item => item.selector === '[id="control"]').inViewport, false)
  assert.equal(clipped.anchors.length, 1); assert.equal(clipped.anchors[0].inViewport, false)
  assert.throws(() => validateFullAppPageSample(clipped, matrix), /hidden, clipped or obscured/)
  f.content.css.overflowX = 'visible'; f.content.clientWidth = 300
  f.setPaintedTargets([f.summaryControl, f.summaryLabel, f.summary])
  const covered = serializedDetailsPage(f, ['#control'])
  assert.equal(covered.controls.find(item => item.selector === '[id="control"]').hit, false)
  assert.throws(() => validateFullAppPageSample(covered, matrix), /hidden, clipped or obscured/)
})

// Reconstructed regression contracts: these execute the serialized production
// observer. They are synthetic geometry inputs, never installed-page evidence.
function nestedScrollFixture() {
  const f = overflowFixture(), { rectangle } = f
  f.html.box = rectangle(0, 0, 704, 455); f.html.scrollHeight = 455; f.html.scrollTop = 0
  f.body.box = rectangle(0, 0, 704, 455); f.body.scrollHeight = 455
  f.body.css.overflowX = 'visible'; f.body.css.overflowY = 'visible'
  const outer = f.make('div', 'outer-scroll', rectangle(40, 10, 550, 437), f.body)
  outer.css.overflowY = 'auto'; outer.scrollHeight = 978
  const inner = f.make('div', 'inner-scroll', rectangle(50, 188.59375, 500, 218), outer)
  inner.css.overflowY = 'auto'; inner.scrollHeight = 569
  f.page.parentElement.children = f.page.parentElement.children.filter(node => node !== f.page)
  inner.children.push(f.page); f.page.parentElement = inner
  f.page.clientHeight = 380; f.page.scrollHeight = 380
  const setOffsets = (innerOffset, outerOffset = 160) => {
    outer.scrollTop = outerOffset; inner.scrollTop = innerOffset
    inner.box = rectangle(50, 10 + 338.59375 - outerOffset, 500, 218)
    f.page.box = rectangle(60, inner.box.top + 180.765625 - innerOffset, 450, 380.078125)
    f.control.box = rectangle(70, f.page.box.top + 4, 160, 40)
  }
  setOffsets(155)
  return { ...f, outer, inner, setOffsets }
}

function measuredImages(samples) {
  const images = samples.map((_, index) => ({ filename: 'serialized-scroll-' + index + '.png' }))
  return { images, samples: samples.flatMap((sample, index) => ['before-capture', 'after-capture'].map(phase =>
    ({ ...clone(sample), phase, image: images[index].filename }))) }
}

test('serialized nested scroll coverage binds ancestor extent to its independently swept client port', () => {
  const f = nestedScrollFixture(), observations = [155, 351, 180, 342].map(offset => {
    f.setOffsets(offset); return serializedOverflowObservation(f, 'page')
  })
  for (const sample of observations) {
    const outer = sample.scrollAreas.find(surface => surface.selector === '[id="outer-scroll"]')
    const inner = sample.scrollAreas.find(surface => surface.selector === '[id="inner-scroll"]')
    assert.deepEqual([outer.requiredContentStart, outer.requiredContentEnd], [338.59375, 556.59375])
    assert.deepEqual(outer.contentTarget, { selector: '[id="inner-scroll"]', kind: 'nested-scroll-client-port' })
    assert.deepEqual([inner.requiredContentStart, inner.requiredContentEnd], [180.765625, 560.84375])
    assert.deepEqual(inner.contentTarget, { selector: '[id="page"]', kind: 'route-content' })
  }
  assert.notEqual(observations[0].rootBounds.top, observations[1].rootBounds.top, 'The real route still moves inside its inner scroller')
})

test('serialized nested image intervals cover both surfaces and still reject a two-pixel content drift', () => {
  const f = nestedScrollFixture(), observations = [155, 351, 180, 342].map(offset => {
    f.setOffsets(offset); return serializedOverflowObservation(f, 'page')
  })
  const receipts = measuredImages(observations)
  for (const surface of observations[0].scrollAreas) {
    assert.equal(measureFullAppScrollCoverage(surface, receipts.samples, receipts.images).complete, true)
  }
  const altered = clone(receipts.samples)
  altered.at(-1).scrollAreas.find(surface => surface.selector === '[id="outer-scroll"]').requiredContentEnd += 2
  const outer = observations[0].scrollAreas.find(surface => surface.selector === '[id="outer-scroll"]')
  assert.throws(() => measureFullAppScrollCoverage(outer, altered, receipts.images), /content range changed/)
})

test('hidden, clipped or non-scrolling nested owners cannot replace the full route interval', () => {
  for (const overflowY of ['hidden', 'clip', 'visible']) {
    const f = nestedScrollFixture(); f.inner.css.overflowY = overflowY
    const first = serializedOverflowObservation(f, 'page'), outer = first.scrollAreas.find(surface => surface.selector === '[id="outer-scroll"]')
    assert.deepEqual(outer.contentTarget, { selector: '[id="page"]', kind: 'route-content' })
    assert.equal(first.scrollAreas.some(surface => surface.selector === '[id="inner-scroll"]'), false)
    f.setOffsets(351)
    const after = serializedOverflowObservation(f, 'page')
    const receipts = measuredImages([first, after])
    assert.throws(() => measureFullAppScrollCoverage(outer, receipts.samples, receipts.images), /content range changed/)
  }
  const f = nestedScrollFixture(); f.inner.scrollHeight = f.inner.clientHeight + 1
  const sample = serializedOverflowObservation(f, 'page')
  assert.deepEqual(sample.scrollAreas.find(surface => surface.selector === '[id="outer-scroll"]').contentTarget,
    { selector: '[id="page"]', kind: 'route-content' })
})

test('a scrollable route retains its full content while each outer ancestor measures the outermost tracked port', () => {
  const f = nestedScrollFixture()
  f.page.css.overflowY = 'auto'; f.page.clientHeight = 200; f.page.scrollHeight = 800
  f.page.box.height = 204; f.page.box.bottom = f.page.box.top + 204; f.page.clientTop = 2
  const sample = serializedOverflowObservation(f, 'page')
  const route = sample.scrollAreas.find(surface => surface.selector === '[id="page"]')
  const inner = sample.scrollAreas.find(surface => surface.selector === '[id="inner-scroll"]')
  const outer = sample.scrollAreas.find(surface => surface.selector === '[id="outer-scroll"]')
  assert.equal(route.ancestor, false); assert.deepEqual([route.requiredContentStart, route.requiredContentEnd], [0, 800])
  assert.deepEqual([inner.requiredContentStart, inner.requiredContentEnd], [182.765625, 382.765625])
  assert.deepEqual(inner.contentTarget, { selector: '[id="page"]', kind: 'nested-scroll-client-port' })
  assert.deepEqual([outer.requiredContentStart, outer.requiredContentEnd], [338.59375, 556.59375])
  assert.deepEqual(outer.contentTarget, { selector: '[id="inner-scroll"]', kind: 'nested-scroll-client-port' })
})

function fractionalScrollFixture({ top = 67.1875, clientHeight = 388, scrollHeight = 9000,
  requiredStart = 7450.671875, requiredEnd = 8113.96875 } = {}) {
  const f = overflowFixture(), { rectangle } = f
  f.html.box = rectangle(0, 0, 704, 455); f.html.scrollHeight = 455; f.html.scrollTop = 0
  f.body.box = rectangle(0, 0, 704, 455); f.body.scrollHeight = 455
  f.body.css.overflowX = 'visible'; f.body.css.overflowY = 'visible'
  const owner = f.make('div', 'fractional-scroll', rectangle(10, top, 600, clientHeight), f.body)
  owner.css.overflowY = 'auto'; owner.scrollHeight = scrollHeight
  f.page.parentElement.children = f.page.parentElement.children.filter(node => node !== f.page)
  owner.children.push(f.page); f.page.parentElement = owner
  f.page.clientHeight = Math.round(requiredEnd - requiredStart); f.page.scrollHeight = f.page.clientHeight
  const setOffset = value => {
    owner.scrollTop = value
    f.page.box = rectangle(20, top + requiredStart - value, 500, requiredEnd - requiredStart)
    f.control.box = rectangle(30, f.page.box.top + 4, 160, 40)
  }
  setOffset(Math.floor(requiredStart))
  return { ...f, owner, setOffset }
}

test('fractional viewport endpoints retain the original one-pixel gap rejection and request outward integer positions', () => {
  const f = fractionalScrollFixture(), first = serializedOverflowObservation(f, 'page')
  const surface = first.scrollAreas.find(item => item.selector === '[id="fractional-scroll"]')
  assert.equal(surface.clientHeight, 388); assert.equal(surface.visibleHeight, 387.8125)
  assert.deepEqual([surface.rangeStart, surface.rangeEnd], [7450, 7727])
  f.setOffset(7725)
  const old = measuredImages([first, serializedOverflowObservation(f, 'page')])
  const refused = measureFullAppScrollCoverage(surface, old.samples, old.images)
  assert.equal(refused.complete, false)
  assert.deepEqual(refused.gaps, [{ from: 8112.8125, to: 8113.96875 }])
  assert.equal(refused.gaps[0].to - refused.gaps[0].from, 1.15625)
  f.setOffset(surface.rangeEnd)
  const fixed = measuredImages([first, serializedOverflowObservation(f, 'page')])
  assert.equal(measureFullAppScrollCoverage(surface, fixed.samples, fixed.images).complete, true)
})

test('fractional ranges account for top clipping and remain clamped to native scroll bounds', () => {
  const partial = fractionalScrollFixture({ top: -50.5, clientHeight: 388, scrollHeight: 2000, requiredStart: 300.25, requiredEnd: 900.75 })
  const surface = serializedOverflowObservation(partial, 'page').scrollAreas.find(item => item.selector === '[id="fractional-scroll"]')
  assert.equal(surface.visibleHeight, 337.5)
  assert.deepEqual([surface.rangeStart, surface.rangeEnd], [249, 513])
  const clamped = fractionalScrollFixture({ top: -50.5, clientHeight: 388, scrollHeight: 1000, requiredStart: 20.25, requiredEnd: 999.75 })
  const edge = serializedOverflowObservation(clamped, 'page').scrollAreas.find(item => item.selector === '[id="fractional-scroll"]')
  assert.equal(edge.rangeStart, 0); assert.equal(edge.rangeEnd, 612)
  assert.equal(edge.rangeEnd, edge.scrollHeight - edge.clientHeight)
})

function fixedModalOverflowFixture() {
  const f = overflowFixture(), { rectangle } = f
  f.html.box = rectangle(0, 0, 704, 455); f.html.clientHeight = 455; f.html.scrollHeight = 455; f.html.scrollTop = 0
  f.body.box = rectangle(0, 0, 704, 455); f.body.scrollHeight = 455
  f.page.className = 'workspace-sidebar'; f.page.box = rectangle(0, 0, 220, 455)
  f.page.clientWidth = 220; f.page.clientHeight = 455; f.page.css.overflowX = 'hidden'
  const overlay = f.make('div', 'modal-overlay', rectangle(0, 0, 704, 455), f.page)
  overlay.css.position = 'fixed'
  const dialog = f.make('section', 'modal-surface', rectangle(16, 20, 672, 415), overlay)
  dialog.className = 'actual-page'; dialog.css.overflowX = 'auto'; dialog.css.overflowY = 'auto'
  f.page.children = f.page.children.filter(node => node !== f.control)
  dialog.children.push(f.control); f.control.parentElement = dialog
  f.control.box = rectangle(610, 40, 48, 40); f.control.clientWidth = 48; f.control.clientHeight = 40
  f.control.css.outlineStyle = 'solid'; f.control.css.outlineWidth = '2px'
  f.control.css.outlineColor = 'rgb(112, 87, 217)'
  f.document.elementFromPoint = () => f.control
  return { ...f, overlay, dialog }
}
function observeFixedModal(f, kind) {
  const port = withinActualClientPort.toString(), overflow = viewportObservers.observeFullAppOverflowViewport.toString()
  const fixed = viewportObservers.viewportFixedClipBoundary.toString()
  const code = kind === 'page'
    ? `(${viewportObservers.observeFullAppPage.toString()})({root:'.actual-page',anchors:['#control']},${port},${overflow},${fixed})`
    : `(${viewportObservers.observeFullAppFocus.toString()})('#control',()=>true,${port},${overflow},${fixed})`
  return JSON.parse(JSON.stringify(runInNewContext(code, f.globals)))
}
test('fixed native template modal escapes sidebar overflow but retains focus, viewport, scroll and hit proof', async () => {
  const f = fixedModalOverflowFixture()
  const page = observeFixedModal(f, 'page'), focus = observeFixedModal(f, 'focus')
  assert.equal(page.controls[0].inViewport, true)
  assert.equal(page.anchors[0].hit, true)
  assert.equal(focus.inViewport, true); assert.equal(focus.hit, true)
  assert.equal(focus.focused, true); assert.equal(focus.focusVisible, true)
  assert.equal(focus.outlines.length, 1)
  validateFullAppPageSample(page, matrix)
  await serializedEnsureVisible(f)
  assert.equal(f.control.scrollCalls.length, 0)
})
test('fixed modal still rejects containing-block overflow, inner clipping, offscreen and obscured controls', () => {
  for (const change of [
    f => { f.page.css.transform = 'translateZ(0)' },
    f => { f.page.css.filter = 'blur(0px)' },
    f => { f.page.css.contain = 'paint' },
    f => { f.overlay.css.position = 'absolute' },
    f => { f.dialog.clientWidth = 200; f.dialog.css.overflowX = 'hidden' },
    f => { f.control.box = f.rectangle(692, 40, 48, 40) },
  ]) {
    const f = fixedModalOverflowFixture(); change(f)
    assert.equal(observeFixedModal(f, 'page').controls[0].inViewport, false)
    assert.equal(observeFixedModal(f, 'focus').inViewport, false)
  }
  const covered = fixedModalOverflowFixture()
  covered.document.elementFromPoint = () => covered.page
  assert.equal(observeFixedModal(covered, 'page').controls[0].hit, false)
  assert.equal(observeFixedModal(covered, 'focus').hit, false)
})

test('owned native popup sees a Select wrapper and its actual input but rejects obscured or ambiguous owners', () => {
  const rectangle = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
  const host = { dataset: { uiValue: '"all"' } }, box = rectangle(30, 20, 180, 40)
  const field = { id: 'owned-input', matches: selector => selector === '[role="combobox"]', getBoundingClientRect: () => box,
    getAttribute: name => ({ 'aria-controls': 'owned-list', 'aria-expanded': 'true', 'aria-activedescendant': 'owned-option' })[name] ?? null,
    closest: selector => selector === '[data-ui-control="select"]' ? host : null }
  const option = { tagName: 'DIV', id: 'owned-option', isConnected: true, innerText: '全部对象', getBoundingClientRect: () => rectangle(30, 76, 180, 30),
    getAttribute: name => ({ 'aria-disabled': 'false', 'aria-selected': 'true' })[name] ?? null,
    querySelector: selector => selector === '[data-ui-option-value]' ? { getAttribute: () => 'all' } : null }
  const dropdown = { tagName: 'DIV', id: 'owned-dropdown', getAttribute: name => name === 'class' ? 'ant-select-dropdown' : null,
    getBoundingClientRect: () => rectangle(28, 73, 186, 90), parentElement: null }
  const list = { tagName: 'DIV', id: 'owned-list', parentElement: dropdown, getBoundingClientRect: () => rectangle(28, 73, 186, 90),
    getAttribute: name => name === 'role' ? 'listbox' : null,
    closest: selector => selector === '.ant-select-dropdown' ? dropdown : null,
    querySelectorAll: selector => selector === '[role="option"]' ? [option] : [] }
  option.parentElement = list
  const wrapper = { matches: () => false, getBoundingClientRect: () => box,
    querySelectorAll: selector => selector === '[role="combobox"]' ? [field] : [] }
  const document = { activeElement: field,
    querySelectorAll: selector => selector === '.shared-wrapper' ? [wrapper] : selector === '.shared-input' ? [field] : [],
    getElementById: id => id === 'owned-list' ? list : null, elementFromPoint: () => option }
  const globals = { document, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' }),
    innerWidth: 704, innerHeight: 455 }
  const run = selector => runInNewContext('(' + observeFullAppPopup.toString() + ')(' + JSON.stringify(selector) + ')', globals)
  assert.equal(run('.shared-wrapper').popup.ready, true)
  assert.equal(run('.shared-input').popup.ready, true)
  assert.equal(run('.shared-wrapper').popup.optionValue, 'all')
  option.isConnected = false
  assert.equal(run('.shared-wrapper').popup.ready, false, 'A detached option must never count as a painted popup')
  option.isConnected = true
  document.elementFromPoint = () => null
  assert.equal(run('.shared-wrapper').popup.ready, false, 'A real popup blocked by another element must fail')
  document.elementFromPoint = () => option
  wrapper.querySelectorAll = () => []
  assert.throws(() => run('.shared-wrapper'), /one actual shared Select combobox/)
  wrapper.querySelectorAll = () => [field, field]
  assert.throws(() => run('.shared-wrapper'), /one actual shared Select combobox/)
})

const { verifyResearchShellReachability } = await import('./full-app-ui-research.mjs')
function researchShellFixture() {
  const f = overflowFixture(), { rectangle } = f
  f.html.box = rectangle(0, 0, 704, 455); f.html.clientHeight = 455; f.html.scrollHeight = 455; f.html.scrollTop = 0
  f.body.box = rectangle(0, 0, 704, 455); f.body.scrollHeight = 455
  f.body.css.overflowX = 'visible'; f.body.css.overflowY = 'visible'
  f.page.className = 'global-search-panel'; f.page.box = rectangle(8, 8, 688, 439)
  f.page.clientWidth = 688; f.page.clientHeight = 439; f.page.scrollWidth = 688; f.page.scrollHeight = 560; f.page.scrollTop = 54
  f.page.css.overflowX = 'hidden'; f.page.css.overflowY = 'auto'
  const header = f.make('header', 'shell-header', rectangle(24, -30, 658, 80), f.page)
  header.className = 'global-search-header'
  const title = f.make('h2', 'global-search-title', rectangle(24, -30, 160, 31), header)
  title.textContent = '全局检索'; title.innerText = '全局检索'
  f.page.children = f.page.children.filter(node => node !== f.control)
  header.children.push(f.control); f.control.parentElement = header
  f.control.tagName = 'BUTTON'; f.control.localName = 'button'; f.control.type = 'button'
  f.control.className = 'ant-btn app-ui-button'; f.control.dataset = { uiControl: 'button', uiLayout: 'action' }
  f.control.clientWidth = 36; f.control.clientHeight = 40; f.control.scrollWidth = 36
  f.control.getAttribute = name => name === 'aria-label' ? '关闭全局检索' : name === 'id' ? f.control.id : null
  const matches = f.control.matches.bind(f.control)
  f.control.matches = selector => selector === '[aria-label="关闭全局检索"]' || matches(selector)
  const input = f.make('input', 'original-research-input', rectangle(30, 200, 180, 40), f.page)
  f.document.activeElement = input; f.globals.window = { __fullAppUiEvents: [] }
  const draw = () => {
    const top = 24 - f.page.scrollTop
    header.box = rectangle(24, top, 658, 80)
    title.box = rectangle(24, top, 160, f.zeroTitle ? 0 : 31)
    f.control.box = rectangle(646, top, 36, 40)
  }
  for (let node = header; node; node = node.parentElement) {
    node.scrollLeft = 0
    node.scrollTo = function ({ top, left }) {
      if (this === f.page && (f.lockScroll || (f.failRestore && top === 54))) return
      this.scrollTop = top; this.scrollLeft = left; draw()
    }
  }
  header.scrollIntoView = () => f.page.scrollTo({ top: 0, left: 0 })
  f.document.elementFromPoint = (x, y) => {
    if (f.obscured) return f.page
    for (const node of [f.control, title]) {
      const r = node.box
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return node
    }
    return header
  }
  draw()
  let nativeCalls = 0
  const native = () => { nativeCalls++; throw Error('Shell evidence must not add native input or a scene capture') }
  const context = { evaluate: async source => JSON.parse(JSON.stringify(await runInNewContext(source, f.globals))),
    click: native, cdp: { send: native }, until: async check => check(), capture: native, save() {},
    report: { fullAppUi: {} }, routes: [], matrix }
  context.shared = createFullAppUiShared(context)
  return { f, header, title, input, context, nativeCalls: () => nativeCalls }
}

test('research shell scroll evidence restores the original clipped view without native input or replacing a scene', async () => {
  const f = researchShellFixture(), receipt = {}
  assert.ok(f.title.box.top < 0, 'The fixture begins at the real reported type of scrolled position')
  await verifyResearchShellReachability(f.context, receipt)
  assert.equal(receipt.complete, true); assert.equal(receipt.restored, true); assert.equal(receipt.observationOnly, true)
  assert.equal(receipt.visible.anchors.length, 2)
  assert.ok(receipt.visible.anchors.every(item => item.inViewport && item.hit))
  assert.ok(receipt.afterPaint.anchors.every(item => item.inViewport && item.hit))
  assert.equal(f.f.page.scrollTop, 54); assert.ok(f.title.box.top < 0)
  assert.equal(f.f.document.activeElement, f.input); assert.equal(f.nativeCalls(), 0)
  assert.deepEqual(receipt.afterRestore, receipt.before)
})

test('research shell evidence rejects an unscrollable clipped header, inner clip, foreign hit and collapsed title', async () => {
  for (const mutate of [
    f => { f.f.lockScroll = true },
    f => { f.f.page.clientHeight = 40 },
    f => { f.f.obscured = true },
    f => { f.f.zeroTitle = true },
  ]) {
    const f = researchShellFixture(), receipt = {}; mutate(f)
    await assert.rejects(verifyResearchShellReachability(f.context, receipt), /clipped|obscured|rendered anchor/)
    assert.equal(receipt.complete, false); assert.equal(receipt.restored, true); assert.ok(receipt.error)
    assert.equal(f.f.page.scrollTop, 54); assert.equal(f.nativeCalls(), 0)
  }
})

test('research shell evidence refuses success when the original scroll position cannot be restored', async () => {
  const f = researchShellFixture(), receipt = {}; f.f.failRestore = true
  await assert.rejects(verifyResearchShellReachability(f.context, receipt), /restore the original scroll/)
  assert.equal(receipt.complete, false); assert.equal(receipt.restored, false); assert.ok(receipt.restorationError)
  assert.equal(f.nativeCalls(), 0)
})

test('research shell evidence refuses a changed focus or added input even if all geometry is visible', async () => {
  for (const change of [
    f => { f.f.document.activeElement = f.f.control },
    f => { f.f.globals.window.__fullAppUiEvents.push({ type: 'keydown', key: 'Tab', trusted: true }) },
  ]) {
    const f = researchShellFixture(), receipt = {}, frame = f.context.shared.frame
    f.context.shared.frame = async () => { await frame(); change(f) }
    await assert.rejects(verifyResearchShellReachability(f.context, receipt), /original focus|added native input/)
    assert.equal(receipt.complete, false); assert.equal(receipt.restored, false); assert.ok(receipt.restorationError)
    assert.equal(f.nativeCalls(), 0)
  }
})

test('research shell failure preserves the original geometry error when restoration also fails', async () => {
  const f = researchShellFixture(), receipt = {}; f.f.obscured = true; f.f.failRestore = true
  await assert.rejects(verifyResearchShellReachability(f.context, receipt), /clipped or obscured/)
  assert.ok(receipt.error.includes('clipped or obscured'))
  assert.ok(receipt.restorationError.includes('restore the original scroll'))
  assert.equal(receipt.complete, false); assert.equal(receipt.restored, false)
})

// These are setup-driver contracts, not installed-app or trusted-input evidence.
// Run the real DOM inspector/choice driver and the runner's unchanged until body
// with a monotonic fixture clock, preserving its full 15000 ms / 100 ms budget.
const { chooseProjectSetupAlias, prepareEvidenceReviewFocusOrigin } = await import('./full-app-ui-projects.mjs')
const { createNativeUiSelect } = await import('./native-ui-select.mjs')
const { JSDOM: ProjectSetupDOM } = await import('jsdom')
const { readFileSync: readProjectSetupSource } = await import('node:fs')
const { parse: parseProjectSetupSource } = await import('acorn')
const projectSetupRunnerSource = readProjectSetupSource(new URL('./run-full-app-ui-installed.mjs', import.meta.url), 'utf8')
const projectSetupUntilNode = parseProjectSetupSource(projectSetupRunnerSource, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .find(node => node.type === 'FunctionDeclaration' && node.id?.name === 'until')
assert.ok(projectSetupUntilNode)
const projectSetupUntilSource = projectSetupRunnerSource.slice(projectSetupUntilNode.start, projectSetupUntilNode.end)
const projectSetupRequested = 'index:project-setup-fixture-note'
const projectSetupTarget = { id: 'project-alias-target', value: projectSetupRequested, disabled: false }

function projectSetupAliasFixture(t, { appearAt = 0, choices = [projectSetupTarget], removeBeforeChoose = false,
  clickFailure = null, truncateOnFailure = false } = {}) {
  const dom = new ProjectSetupDOM('<div data-ui-control="select" data-ui-value=\'""\'><input id="project-alias-input" role="combobox" aria-label="选择实体别名对象" aria-expanded="false"></div>', { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const { document } = dom.window, field = document.querySelector('input'), host = field.parentElement
  const selector = '[aria-label="选择实体别名对象"]', popupId = field.id + '_list'
  const report = { fullAppUi: {} }, saved = [], keys = [], clicks = [], chooseCalls = [], waits = [], sleeps = []
  let clock = 0, available = choices, popup
  dom.window.__fullAppUiEvents = []; dom.window.__fullAppUiTraceTruncated = false
  const renderOptions = () => {
    if (!popup) return
    popup.replaceChildren()
    for (const option of [{ id: popupId + '_empty', value: '', disabled: false }, ...(clock >= appearAt ? available : [])]) {
      const node = document.createElement('div'), label = document.createElement('span')
      node.id = option.id; node.setAttribute('role', 'option')
      node.setAttribute('aria-disabled', String(option.disabled)); node.setAttribute('aria-selected', String(option.value === ''))
      label.setAttribute('data-ui-option-value', option.value); node.append(label); popup.append(node)
    }
  }
  const actualUntil = runInNewContext(projectSetupUntilSource + '; until', {
    performance: { now: () => clock },
    sleep: async milliseconds => { assert.equal(milliseconds, 100); sleeps.push(milliseconds); clock += milliseconds; renderOptions() },
  })
  const until = async (...args) => {
    const wait = { label: args[1], argumentCount: args.length, startedAt: clock, checks: 0 }; waits.push(wait)
    try { return await actualUntil(async () => { wait.checks++; return args[0]() }, ...args.slice(1)) }
    catch (error) { wait.failure = error; throw error }
    finally { wait.finishedAt = clock }
  }
  const evaluate = async expression => JSON.parse(JSON.stringify(dom.window.eval(expression)))
  const nativeSelect = createNativeUiSelect({ evaluate, until,
    cdp: { send: () => assert.fail('The shared setup Select must not add compatibility key input') },
    click: async target => {
      clicks.push(target)
      const matches = [...document.querySelectorAll(target)]; assert.equal(matches.length, 1)
      const option = matches[0]; assert.equal(option.getAttribute('role'), 'option')
      assert.equal(option.closest('[role="listbox"]')?.id, popupId)
      const value = option.querySelector('[data-ui-option-value]').getAttribute('data-ui-option-value')
      dom.window.__fullAppUiEvents.push({ type: 'click', trusted: true, option: { listboxId: popupId, value } })
      if (clickFailure) { dom.window.__fullAppUiTraceTruncated = truncateOnFailure; throw clickFailure }
      host.setAttribute('data-ui-value', JSON.stringify(value)); field.setAttribute('aria-expanded', 'false')
      field.removeAttribute('aria-controls'); popup.remove(); popup = null
    },
  })
  const context = { evaluate, until, report,
    save: () => saved.push(clone(report.fullAppUi.setupInteractions?.[0] ?? null)),
    shared: {
      ensureVisible: async target => assert.equal(target, selector),
      key: async key => {
        keys.push(key); assert.equal(key, 'ArrowDown'); assert.equal(document.activeElement, field)
        field.setAttribute('aria-expanded', 'true'); field.setAttribute('aria-controls', popupId)
        popup = document.createElement('div'); popup.id = popupId; popup.setAttribute('role', 'listbox'); document.body.append(popup)
        renderOptions()
        dom.window.__fullAppUiEvents.push({ type: 'keydown', key, trusted: true, id: field.id, role: 'combobox' })
      },
      nativeSelect: { ...nativeSelect, choose: async (...args) => {
        chooseCalls.push({ args, at: clock })
        if (removeBeforeChoose) { available = []; renderOptions() }
        return nativeSelect.choose(...args)
      } },
    },
  }
  return { context, saved, keys, clicks, chooseCalls, waits, sleeps, dom, selector, popupId,
    elapsed: () => clock, receipt: () => report.fullAppUi.setupInteractions[0] }
}

function assertProjectSetupFailureTrace(f, failure, truncated = false) {
  const receipt = f.receipt()
  assert.equal(receipt.complete, false); assert.equal(receipt.stage, 'failed')
  assert.deepEqual(receipt.error, { name: failure.name, message: failure.message, stack: failure.stack })
  assert.deepEqual(receipt.events, clone(f.dom.window.__fullAppUiEvents)); assert.equal(receipt.traceTruncated, truncated)
  assert.equal(receipt.committed, undefined); assert.deepEqual(f.keys, ['ArrowDown'])
  assert.ok(f.saved.some(item => item?.stage === 'failed' && item.error?.message === failure.message))
  assert.ok(f.waits.every(wait => wait.argumentCount === 2), 'The setup driver must leave every original wait budget unchanged')
}

test('project setup waits for a delayed own target before one original option choice', async t => {
  const f = projectSetupAliasFixture(t, { appearAt: 200 })
  const committed = await chooseProjectSetupAlias(f.context, projectSetupRequested), receipt = f.receipt()
  assert.equal(committed.value, projectSetupRequested); assert.equal(committed.expanded, false)
  assert.equal(receipt.complete, true); assert.equal(receipt.stage, 'complete')
  assert.equal(receipt.opened.popupId, f.popupId); assert.equal(receipt.trustedOpeningKey, true); assert.equal(receipt.trustedOwnOptionClick, true)
  assert.ok(f.saved.some(item => item?.latestOpening?.popupReady && item.latestOpening.options.length === 1 && item.latestOpening.options[0].value === ''))
  assert.ok(receipt.opened.options.some(option => option.value === projectSetupRequested))
  assert.deepEqual(f.keys, ['ArrowDown']); assert.equal(f.clicks.length, 1)
  assert.deepEqual(f.chooseCalls, [{ args: [f.selector, projectSetupRequested], at: 200 }])
  assert.deepEqual(f.sleeps, [100, 100]); assert.equal(f.waits[0].checks, 3); assert.equal(f.elapsed(), 200)
  assert.ok(f.waits.every(wait => wait.argumentCount === 2))
  assert.equal(receipt.events.length, 2); assert.equal(receipt.traceTruncated, false)
})

test('project setup permanently missing target expires the original default budget without another input', async t => {
  const f = projectSetupAliasFixture(t, { appearAt: Infinity }); let failure
  await assert.rejects(chooseProjectSetupAlias(f.context, projectSetupRequested), error => { failure = error; return true })
  assert.equal(failure.message, 'Actual project setup combobox did not open its own popup')
  assert.equal(f.waits.length, 1); assert.equal(failure, f.waits[0].failure)
  assert.equal(f.elapsed(), 15000); assert.equal(f.waits[0].checks, 150)
  assert.equal(f.sleeps.length, 150); assert.ok(f.sleeps.every(milliseconds => milliseconds === 100))
  assert.equal(f.chooseCalls.length, 0); assert.equal(f.clicks.length, 0)
  assert.equal(f.receipt().latestOpening.popupReady, true)
  assert.deepEqual(f.receipt().latestOpening.options.map(option => option.value), [''])
  assertProjectSetupFailureTrace(f, failure)
})

test('project setup hands duplicate target options directly to the original ambiguous-choice refusal', async t => {
  const f = projectSetupAliasFixture(t, { choices: [projectSetupTarget, { ...projectSetupTarget, id: 'project-alias-duplicate' }] }); let failure
  await assert.rejects(chooseProjectSetupAlias(f.context, projectSetupRequested), error => {
    failure = error; return /Requested popup choice missing or ambiguous/.test(error.message)
  })
  assert.equal(failure.actual, 2); assert.equal(failure.expected, 1); assert.match(failure.stack, /native-ui-select\.mjs/)
  assert.equal(f.chooseCalls.length, 1); assert.equal(f.clicks.length, 0); assert.deepEqual(f.sleeps, [])
  assert.equal(f.waits[0].checks, 1); assert.equal(f.elapsed(), 0)
  assertProjectSetupFailureTrace(f, failure)
})

test('project setup hands a disabled target directly to the original disabled-choice refusal', async t => {
  const f = projectSetupAliasFixture(t, { choices: [{ ...projectSetupTarget, disabled: true }] }); let failure
  await assert.rejects(chooseProjectSetupAlias(f.context, projectSetupRequested), error => {
    failure = error; return /Requested popup choice is disabled/.test(error.message)
  })
  assert.equal(failure.actual, true); assert.equal(failure.expected, false); assert.match(failure.stack, /native-ui-select\.mjs/)
  assert.equal(f.chooseCalls.length, 1); assert.equal(f.clicks.length, 0); assert.deepEqual(f.sleeps, [])
  assert.equal(f.waits[0].checks, 1); assert.equal(f.elapsed(), 0)
  assertProjectSetupFailureTrace(f, failure)
})

test('project setup preserves the original missing-choice refusal if a ready target disappears', async t => {
  const f = projectSetupAliasFixture(t, { removeBeforeChoose: true }); let failure
  await assert.rejects(chooseProjectSetupAlias(f.context, projectSetupRequested), error => {
    failure = error; return /Requested popup choice missing or ambiguous/.test(error.message)
  })
  assert.equal(failure.actual, 0); assert.equal(failure.expected, 1); assert.match(failure.stack, /native-ui-select\.mjs/)
  assert.ok(f.receipt().opened.options.some(option => option.value === projectSetupRequested))
  assert.equal(f.chooseCalls.length, 1); assert.equal(f.clicks.length, 0); assert.deepEqual(f.sleeps, [])
  assertProjectSetupFailureTrace(f, failure)
})

test('project setup retains an uncertain original click failure and its trace without replay even when trace validation fails', async t => {
  for (const truncated of [false, true]) {
    const failure = new Error('Original option click outcome is uncertain')
    const f = projectSetupAliasFixture(t, { clickFailure: failure, truncateOnFailure: truncated })
    await assert.rejects(chooseProjectSetupAlias(f.context, projectSetupRequested), error => error === failure)
    assert.equal(f.chooseCalls.length, 1); assert.equal(f.clicks.length, 1); assert.deepEqual(f.sleeps, [])
    assertProjectSetupFailureTrace(f, failure, truncated)
    assert.equal(f.receipt().events.length, 2)
    if (truncated) assert.match(f.receipt().traceError.message, /trace was truncated/)
    else assert.equal(f.receipt().traceError, undefined)
  }
})

// Synthetic DOM/CDP protocol contracts for failed-focus serialization. These
// records are not trusted native input or evidence from the earlier failed run.
function focusFailureFixture({ reachAt = Infinity, traceLimit = Infinity, diagnosticFailure = null,
  traceAvailable = true, saveFailure = null } = {}) {
  const f = overflowFixture(), selector = '#control', meta = { routeId: 'nav-trash', stateId: 'cancel-confirm' }
  Object.assign(f.control, { tagName: 'BUTTON', localName: 'button', type: 'button' })
  Object.assign(f.control.css, { outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'rgb(112, 87, 217)' })
  const outside = f.make('div', 'background-editor', f.rectangle(440, 40, 200, 200), f.body)
  outside.getAttribute = name => ({ id: outside.id, role: 'textbox', contenteditable: 'true' })[name] ?? null
  for (const name of ['value', 'textContent', 'innerText']) Object.defineProperty(outside, name, {
    get() { throw Error('Failure observation must not read note or field content') },
  })
  f.document.activeElement = outside
  f.globals.window = { __fullAppUiEvents: [{ type: 'click', id: 'previous-control', trusted: true }], __fullAppUiTraceTruncated: false }
  const priorFocus = { selector: '#previous-control', fixtureOnly: true }
  const report = { fullAppUi: { group: 'editor', focus: [priorFocus] } }, commands = [], saved = []
  let forwardTabs = 0, boundaryChecks = 0, diagnosticReads = 0, frames = 0
  f.globals.requestAnimationFrame = callback => { frames++; callback() }
  const context = { report, matrix, routes: [{ id: meta.routeId }],
    evaluate: async source => {
      if (source.startsWith('document.activeElement===document.querySelector(')) boundaryChecks++
      else if (boundaryChecks === 256) {
        diagnosticReads++
        if (diagnosticFailure) throw diagnosticFailure
        if (!traceAvailable) delete f.globals.window.__fullAppUiTraceTruncated
      }
      return JSON.parse(JSON.stringify(await runInNewContext(source, f.globals)))
    },
    cdp: { send: async (method, params) => {
      assert.equal(method, 'Input.dispatchKeyEvent'); assert.equal(params.key, 'Tab')
      commands.push({ method, ...params })
      if (params.type !== 'rawKeyDown') return
      if (params.modifiers === 0) forwardTabs++
      f.document.activeElement = forwardTabs === reachAt ? f.control : outside
      const trace = f.globals.window.__fullAppUiEvents
      if (trace.length >= traceLimit) f.globals.window.__fullAppUiTraceTruncated = true
      else trace.push({ type: 'keydown', key: 'Tab', trusted: true, tag: f.document.activeElement.tagName, id: f.document.activeElement.id })
    } },
    click: () => assert.fail('Button focus failure observation must not click'),
    capture: () => assert.fail('Focus failure observation must not capture a replacement scene'),
    until: () => assert.fail('Focus failure observation must not add a wait or retry'),
    save: () => { saved.push(clone(report)); if (saveFailure) throw saveFailure },
  }
  return { f, shared: createFullAppUiShared(context), selector, meta, priorFocus, report, commands, saved,
    stats: () => ({ forwardTabs, boundaryChecks, diagnosticReads, frames }) }
}

async function assertOriginalFocusTraversalFailure(f) {
  let failure
  await assert.rejects(f.shared.focus(f.selector, f.meta), error => {
    failure = error
    assert.equal(error.code, 'ERR_ASSERTION'); assert.equal(error.name, 'AssertionError')
    assert.match(error.message, /^Actual Tab order never reached control: #control/)
    assert.equal(error.actual, false); assert.equal(error.expected, true); assert.equal(error.operator, 'strictEqual')
    return true
  })
  assert.equal(f.commands.length, 514, 'Keep the original reverse Tab and all 256 forward Tabs, each down/up')
  for (const [index, command] of f.commands.entries()) {
    assert.equal(command.type, index % 2 ? 'keyUp' : 'rawKeyDown')
    assert.equal(command.modifiers, index < 2 ? 8 : 0)
  }
  assert.equal(f.stats().forwardTabs, 256); assert.equal(f.stats().boundaryChecks, 256)
  assert.equal(f.stats().frames, 2, 'Only the original ensureVisible paint boundary may run')
  assert.deepEqual(f.report.fullAppUi.focus, [f.priorFocus], 'A failed target must not earn or replace a successful focus receipt')
  return failure
}

test('exhausted Tab traversal saves its bound failure, actual input counts and safe last element before the original assertion', async () => {
  const f = focusFailureFixture()
  await assertOriginalFocusTraversalFailure(f)
  assert.equal(f.report.fullAppUi.focusFailures?.length, 1, 'The exhausted traversal needs its own failed receipt')
  const receipt = f.report.fullAppUi.focusFailures[0]
  assert.deepEqual({ group: receipt.group, routeId: receipt.routeId, stateId: receipt.stateId, theme: receipt.theme, viewport: receipt.viewport, selector: receipt.selector },
    { group: 'editor', ...f.meta, ...matrix, selector: f.selector })
  assert.equal(receipt.complete, false); assert.equal(receipt.reached, false); assert.equal(receipt.reason, 'tab-order-exhausted')
  assert.equal(receipt.diagnosticComplete, true)
  assert.deepEqual(receipt.attempts, { reverseTabs: 1, forwardTabs: 256, totalTabs: 257 })
  assert.deepEqual(receipt.activeElement, { tag: 'DIV', id: 'background-editor', role: 'textbox', type: null, contentEditable: 'true' })
  assert.equal(receipt.eventStart, 1); assert.equal(receipt.eventEnd, 258)
  assert.deepEqual(receipt.events, clone(f.f.globals.window.__fullAppUiEvents.slice(1)))
  assert.equal(receipt.traceTruncated, false); assert.equal(receipt.events.length, 257)
  assert.equal(f.stats().diagnosticReads, 1); assert.equal(f.saved.length, 1)
  assert.deepEqual(f.saved[0].fullAppUi.focusFailures[0], receipt)
})

test('a truncated focus event segment stays explicitly truncated without fabricating the missing key events', async () => {
  const f = focusFailureFixture({ traceLimit: 4 })
  await assertOriginalFocusTraversalFailure(f)
  assert.equal(f.report.fullAppUi.focusFailures?.length, 1)
  const receipt = f.report.fullAppUi.focusFailures[0]
  assert.equal(receipt.traceTruncated, true); assert.equal(receipt.eventStart, 1); assert.equal(receipt.eventEnd, 4)
  assert.equal(receipt.events.length, 3); assert.equal(receipt.attempts.totalTabs, 257)
  assert.deepEqual(receipt.events, clone(f.f.globals.window.__fullAppUiEvents.slice(1)))
  assert.equal(receipt.complete, false); assert.equal(receipt.diagnosticComplete, true)
  assert.deepEqual(f.saved[0].fullAppUi.focusFailures[0], receipt)
})

test('failed diagnostic reading is saved as unavailable and cannot replace the original Tab assertion', async () => {
  const diagnosticFailure = new Error('Diagnostic renderer read was disconnected'), f = focusFailureFixture({ diagnosticFailure })
  const original = await assertOriginalFocusTraversalFailure(f)
  assert.notEqual(original, diagnosticFailure); assert.equal(f.report.fullAppUi.focusFailures?.length, 1)
  const receipt = f.report.fullAppUi.focusFailures[0]
  assert.equal(receipt.diagnosticComplete, false); assert.equal(receipt.activeElement, null)
  assert.equal(receipt.events, null); assert.equal(receipt.traceTruncated, null)
  assert.deepEqual(receipt.diagnosticError, { name: diagnosticFailure.name, message: diagnosticFailure.message, stack: diagnosticFailure.stack })
  assert.deepEqual(receipt.attempts, { reverseTabs: 1, forwardTabs: 256, totalTabs: 257 })
  assert.deepEqual(f.saved[0].fullAppUi.focusFailures[0], receipt)
})

test('missing trace metadata cannot be recorded as an untruncated successful diagnostic', async () => {
  const f = focusFailureFixture({ traceAvailable: false })
  await assertOriginalFocusTraversalFailure(f)
  assert.equal(f.report.fullAppUi.focusFailures?.length, 1)
  const receipt = f.report.fullAppUi.focusFailures[0]
  assert.equal(receipt.diagnosticComplete, false); assert.equal(receipt.traceTruncated, null); assert.equal(receipt.events, null)
  assert.match(receipt.diagnosticError.message, /Actual focus failure trace is unavailable/)
  assert.deepEqual(f.saved[0].fullAppUi.focusFailures[0], receipt)
})

test('failure-receipt persistence errors remain secondary to the original Tab assertion', async () => {
  const saveFailure = new Error('Diagnostic checkpoint write was refused'), f = focusFailureFixture({ saveFailure })
  const original = await assertOriginalFocusTraversalFailure(f)
  assert.notEqual(original, saveFailure); assert.equal(f.report.fullAppUi.focusFailures?.length, 1)
  const receipt = f.report.fullAppUi.focusFailures[0]
  assert.equal(receipt.complete, false); assert.equal(receipt.diagnosticComplete, true)
  assert.deepEqual(receipt.diagnosticSaveError, { name: saveFailure.name, message: saveFailure.message, stack: saveFailure.stack })
  assert.equal(f.saved.length, 1, 'Do not replay a failed diagnostic save or any native input')
})

test('successful Tab focus keeps its original receipt and adds no failure observation or input', async () => {
  const f = focusFailureFixture({ reachAt: 2 }), receipt = await f.shared.focus(f.selector, f.meta)
  assert.equal(f.report.fullAppUi.focusFailures, undefined); assert.equal(f.report.fullAppUi.focus.length, 2)
  assert.equal(f.report.fullAppUi.focus[0], f.priorFocus); assert.equal(f.report.fullAppUi.focus[1], receipt)
  assert.ok(receipt.focused && receipt.focusVisible && receipt.inViewport && receipt.hit && receipt.trustedTab)
  assert.equal(receipt.outlines.length, 1); assert.deepEqual(receipt.shadows, [])
  assert.equal(receipt.events.length, 3); assert.deepEqual(receipt.events, clone(f.f.globals.window.__fullAppUiEvents.slice(1)))
  assert.equal(f.commands.length, 6); assert.deepEqual(f.commands.map(command => command.modifiers), [8, 8, 0, 0, 0, 0])
  assert.deepEqual(f.stats(), { forwardTabs: 2, boundaryChecks: 2, diagnosticReads: 0, frames: 2 })
  assert.equal(f.saved.length, 1); assert.deepEqual(f.saved[0].fullAppUi.focus, clone(f.report.fullAppUi.focus))
})

test('review toolbar origin keeps the editor mounted and requires an enabled preceding control', async t => {
  const dom = new ProjectSetupDOM('<div class="editor-input" role="textbox" contenteditable="true" tabindex="0">source</div><section class="evidence-review-bar"><div class="evidence-review-actions"><button>previous</button><button aria-pressed="false">mark</button><button class="evidence-review-return">return</button></div></section>', { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const editor = dom.window.document.querySelector('[role="textbox"]')
  editor.focus(); assert.equal(dom.window.document.activeElement, editor)
  const result = await prepareEvidenceReviewFocusOrigin(source => JSON.parse(JSON.stringify(dom.window.eval(source))))
  assert.deepEqual(result, { method: 'bounded-review-toolbar-origin', focused: true, editorRetained: true, targetAvailable: true })
  assert.equal(dom.window.document.activeElement, dom.window.document.querySelector('[aria-pressed]'))
  assert.equal(editor.isConnected, true)
})

test('review toolbar origin refuses missing, disabled, and reordered targets without changing the assertion', async t => {
  const html = '<div class="editor-input" role="textbox" contenteditable="true"></div><section class="evidence-review-bar"><div class="evidence-review-actions"><button aria-pressed="false">mark</button><button class="evidence-review-return">return</button></div></section>'
  for (const mutate of [
    doc => doc.querySelector('[aria-pressed]').disabled = true,
    doc => doc.querySelector('.evidence-review-return').disabled = true,
    doc => doc.querySelector('.evidence-review-return').remove(),
    doc => doc.querySelector('.editor-input').remove(),
    doc => doc.querySelector('.evidence-review-actions').prepend(doc.querySelector('.evidence-review-return')),
  ]) {
    const dom = new ProjectSetupDOM(html, { runScripts: 'outside-only' })
    t.after(() => dom.window.close())
    mutate(dom.window.document)
    await assert.rejects(() => prepareEvidenceReviewFocusOrigin(source => dom.window.eval(source)), /Review focus origin/)
  }
})
