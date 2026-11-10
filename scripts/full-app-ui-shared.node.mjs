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
import { captureActualFullAppPopup, validateFullAppCaptureContinuity, validateFullAppPageSample, measureFullAppScrollCoverage, createFullAppUiShared, withinActualClientPort, finiteOwnerMotionActive, waitForFiniteOwnerMotion } from './full-app-ui-shared.mjs'
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
