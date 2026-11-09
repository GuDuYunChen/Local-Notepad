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
import { captureActualFullAppPopup, validateFullAppCaptureContinuity, measureFullAppScrollCoverage, createFullAppUiShared, withinActualClientPort, finiteOwnerMotionActive, waitForFiniteOwnerMotion } from './full-app-ui-shared.mjs'
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
