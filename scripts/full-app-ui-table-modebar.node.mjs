// Pure DOM/capture protocol models. These tests do not execute Windows, create
// native evidence, or add missing observations to an earlier failed artifact.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import * as sharedDriver from './full-app-ui-shared.mjs'

const clone = value => structuredClone(value)
const hash = value => createHash('sha256').update(value).digest('hex')
const matrix = { theme: 'light', viewport: { width: 704, height: 455 } }
const modebarRoot = '.table-selection-modebar'
// Geometry comes from run 45967037432, artifact 15183752645, SHA256
// 1feb17d5c9d29197cbcd0763dc31d810f4e287dbb361e3a9d6da6ed7e3b0acfb.
// The artifact has no new DOM-owner witness. Only this explicit DOM model can
// produce one; the original six samples continue to fail the old range gate.
const controls = [
  ['复制', 117, 255.96875, 44], ['粘贴', 165, 255.96875, 44], ['浅黄', 213, 255.96875, 44],
  ['清底色', 261, 255.96875, 58], ['左对齐', 323, 255.96875, 58], ['居中', 385, 255.96875, 44],
  ['右对齐', 433, 255.96875, 58], ['垂直居中', 495, 255.96875, 72], ['合并', 571, 255.96875, 44],
  ['拆分', 619, 255.96875, 44], ['清空', 571, 287.96875, 44], ['完成', 619, 287.96875, 44],
]
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })

function fixture(t, options = {}) {
  const viewport = clone(options.viewport || matrix.viewport), modelMatrix = { theme: 'light', viewport }
  const ownerWidth = viewport.width - 52, ownerHeight = viewport.height - 198.578125
  const clientWidth = ownerWidth - 8, clientHeight = Math.floor(ownerHeight), modebarWidth = options.horizontalTransform ? 880 : 612
  const modebarLeft = options.horizontalTransform ? 52 + clientWidth / 2 - modebarWidth / 2 : 60
  const dom = new JSDOM(`<!doctype html><html data-theme="light"><head><style>
    * { opacity:1; visibility:visible; overflow:visible; contain:none; content-visibility:visible;
      transform:none; perspective:none; filter:none; backdrop-filter:none; margin:0; border:0; padding:0 }
    html,body { display:block } html { overflow:hidden }
    .editor-container { position:relative; overflow-y:auto }
    .table-selection-overlay { position:absolute; inset:0; top:0px; left:0px; right:0px; bottom:0px; pointer-events:none }
    .table-selection-modebar { position:absolute; top:10px; left:8px; pointer-events:auto }
  </style></head><body><button class="workspace-title-button">owned table</button><div class="editor-shell">
    <div class="editor-container"><div class="editor-input" contenteditable="true"><table><tbody><tr><td>table cell</td></tr></tbody></table><p>after table</p></div>
      <div class="table-selection-overlay"><div class="table-selection-modebar" style="top:10px" aria-busy="false">
        <div class="table-selection-modebar-copy"><strong>单元格多选</strong><span>拖动鼠标框选连续单元格</span></div>
        <div class="table-selection-modebar-actions">${controls.map(([name], index) => `<button type="button" data-ui-control="button" data-ui-layout="action" class="ant-btn ant-btn-sm ${index === 11 ? 'primary' : ''}" ${index === 11 ? '' : 'disabled'}>${name}</button>`).join('')}</div>
      </div></div>
    </div></div></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const { window } = dom, { document } = window
  const owner = document.querySelector('.editor-container'), overlay = document.querySelector('.table-selection-overlay')
  const modebar = document.querySelector(modebarRoot), editor = document.querySelector('.editor-input')
  const buttons = [...modebar.querySelectorAll('button')]
  const state = { scrollTop: options.offset || 0, rootShift: 0, ownerShift: 0, reads: 0, requests: [], captured: [], nativeSamples: [] }
  const metrics = (node, values) => {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(node, key, { configurable: true, get: typeof value === 'function' ? value : () => value })
  }
  const box = (node, read) => {
    node.getBoundingClientRect = read
    node.getClientRects = () => [read()]
    node.getAnimations = () => []
    node.scrollIntoView = () => {}
    if (!Object.hasOwn(node, 'innerText')) Object.defineProperty(node, 'innerText', { configurable: true, get: () => node.textContent })
  }
  for (const node of document.querySelectorAll('*')) {
    box(node, () => rect(0, 0, viewport.width, viewport.height))
    metrics(node, { clientTop: 0, clientLeft: 0, clientWidth: viewport.width, clientHeight: viewport.height, scrollWidth: viewport.width, scrollHeight: viewport.height })
  }
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height })
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
  metrics(owner, { clientWidth, clientHeight, scrollWidth: clientWidth, scrollHeight: clientHeight + 38 + (options.offset || 0), scrollLeft: 0 })
  Object.defineProperty(owner, 'scrollTop', { configurable: true, get: () => state.scrollTop, set: value => { state.scrollTop = value } })
  owner.scrollTo = ({ top }) => {
    state.requests.push(top); state.scrollTop = top
    window.requestAnimationFrame(() => { modebar.style.top = state.scrollTop + 10 + 'px' })
  }
  modebar.style.top = state.scrollTop + 10 + 'px'
  if (options.horizontalTransform) { modebar.style.left = '50%'; modebar.style.transform = `matrix(1,0,0,1,${-modebarWidth / 2},0)` }
  box(owner, () => rect(52, 198.578125 + state.ownerShift, ownerWidth, ownerHeight))
  box(overlay, () => rect(52, 198.578125 + state.ownerShift - state.scrollTop, clientWidth, ownerHeight))
  box(editor, () => rect(52, 198.578125 + state.ownerShift - state.scrollTop, clientWidth, clientHeight + 38))
  box(modebar, () => rect(modebarLeft, 208.578125 + state.rootShift, modebarWidth, 115.390625))
  metrics(overlay, { clientWidth, clientHeight, scrollWidth: clientWidth, scrollHeight: clientHeight, offsetParent: () => owner })
  metrics(modebar, { clientWidth: modebarWidth - 2, clientHeight: 113, scrollWidth: modebarWidth - 2, scrollHeight: 113, offsetParent: () => overlay })
  for (const [index, button] of buttons.entries()) {
    const [, x, y, width] = controls[index]
    box(button, () => rect(x + modebarLeft - 60, y + state.rootShift, width, 28))
    metrics(button, { clientWidth: width, clientHeight: 28, scrollWidth: width, scrollHeight: 28 })
  }
  for (const node of modebar.querySelectorAll('div,strong,span')) {
    box(node, () => modebar.getBoundingClientRect())
    metrics(node, { clientWidth: modebarWidth - 2, clientHeight: 113, scrollWidth: modebarWidth - 2, scrollHeight: 113 })
  }
  document.elementFromPoint = (x, y) => buttons.find(button => {
    const b = button.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
  }) || modebar
  editor.__lexicalEditor = { getRootElement: () => editor, isEditable: () => true }
  const copyGeometry = (from, to) => {
    for (const key of ['getBoundingClientRect', 'getClientRects', 'getAnimations', 'scrollIntoView', 'innerText',
      'clientTop', 'clientLeft', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'offsetParent']) {
      const descriptor = Object.getOwnPropertyDescriptor(from, key)
      if (descriptor) Object.defineProperty(to, key, descriptor)
    }
  }
  const replaceModebarWithIdenticalDOM = () => {
    const replacement = modebar.cloneNode(true), oldNodes = [modebar, ...modebar.querySelectorAll('*')], newNodes = [replacement, ...replacement.querySelectorAll('*')]
    oldNodes.forEach((node, index) => copyGeometry(node, newNodes[index]))
    modebar.replaceWith(replacement)
    document.elementFromPoint = (x, y) => [...replacement.querySelectorAll('button')].find(button => {
      const b = button.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
    }) || replacement
    return replacement
  }
  const report = { fullAppUi: { group: 'editor', scenes: [], focus: [], popups: [] } }
  const ctx = {
    matrix: clone(modelMatrix), report,
    routes: [{ id: 'editor-table-actions', root: '.table-action-menu', stateRoots: { 'selection-mode': modebarRoot }, requiredStates: ['selection-mode'] }],
    windowReceipt: { nativeWindow: true, viewport: clone(viewport), requested: clone(viewport) },
    save() { options.onSave?.(report) }, click() { assert.fail('Capture protocol must not add a click') },
    cdp: { send() { assert.fail('Capture protocol must not add native keyboard input') } },
    async evaluate(expression) {
      options.beforeEvaluate?.(expression, report)
      if (expression.startsWith('(()=>{const collectFullAppScrollOwners=')) { state.reads++; options.beforeRead?.({ window, document, owner, overlay, modebar, editor, state, metrics, copyGeometry, replaceModebarWithIdenticalDOM }) }
      const value = await window.eval(expression)
      const result = value === undefined ? undefined : JSON.parse(JSON.stringify(value))
      if (expression.startsWith('(()=>{const collectFullAppScrollOwners=')) {
        options.mutateSample?.(result, state.reads)
        state.nativeSamples.push(clone(result))
      }
      return result
    },
    async until(check) { const result = await check(); assert.ok(result, 'Model has no pending animation or asynchronous application request'); return result },
    async capture(filename, guard) {
      if (guard) { assert.ok(await guard()); state.captured.push(filename) }
      return { filename, bytes: 2000, sha256: '1'.repeat(64), fixtureOnly: true }
    },
    evidenceStore: { appendRaw(scene, sample) { scene.rawSamples.push(clone(sample)) }, sealScene(scene) { assert.equal(scene.complete, true) } },
  }
  const shared = sharedDriver.createFullAppUiShared(ctx)
  return { window, document, owner, overlay, modebar, editor, state, report, ctx, shared, metrics, copyGeometry,
    run: () => shared.captureState({ routeId: 'editor-table-actions', stateId: 'selection-mode', anchors: [modebarRoot + ' .primary'] }) }
}

const centralSource = readFileSync(new URL('./full-app-ui-evidence.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const centralStart = '        const start = surface.requiredContentStart, end = surface.requiredContentEnd\n'
const centralEnd = "        assert.ok(intervals.length > 0 && gaps.length === 0, 'Actual long-page content has an unphotographed interval')"
const centralFrom = centralSource.indexOf(centralStart), centralTo = centralSource.indexOf(centralEnd, centralFrom)
assert.ok(centralFrom >= 0 && centralTo > centralFrom)
const centralBlock = centralSource.slice(centralFrom, centralTo + centralEnd.length)
assert.equal(hash(centralBlock), '5dadeeda9e7233591239f390dd0e9b4621f8ab47c1857625e485f64c208812ca')
const centralCoverage = new Function('scene', 'surface', 'assert', centralBlock)

test('current product modebar capture retains the original two PNGs and six samples across native ancestor scroll', async t => {
  const f = fixture(t), scene = await f.run()
  assert.equal(scene.complete, true)
  assert.deepEqual(f.state.requests, [10])
  assert.equal(scene.images.length, 2); assert.equal(scene.rawSamples.length, 6)
  assert.equal(scene.scrollCoverage.length, 1)
  assert.equal(scene.controls.length, 12)
  centralCoverage(scene, scene.scrollCoverage[0], assert)
  assert.equal(f.state.reads, 9, 'No additional polling or capture was added')
  assert.equal(scene.tableModebarPinnedOwner.complete, true)
  assert.equal(scene.tableModebarPinnedOwner.disposed, true)
  assert.equal(scene.tableModebarPinnedOwner.disposal.identityRetained, true)
  assert.equal(scene.tableModebarPinnedOwner.disposal.observations, 9)
  assert.equal(Object.hasOwn(f.window, '__fullAppTableModebarPinnedOwner'), false)
  const nativeIndexes = [0, 1, 2, 6, 7, 8]
  scene.rawSamples.forEach((raw, index) => {
    const native = clone(f.state.nativeSamples[nativeIndexes[index]]), restored = clone(raw)
    delete restored.phase; delete restored.image; delete restored.text; delete native.text
    for (const area of restored.scrollAreas) if (area.nativeCoordinates) {
      assert.deepEqual(Object.keys(area.nativeCoordinates).sort(), ['requiredContentStart', 'requiredContentEnd', 'visibleContentStart', 'visibleContentEnd'].sort())
      assert.deepEqual(area.coordinateFrame, { baselineScrollTop: 0, delta: 10 })
      Object.assign(area, area.nativeCoordinates); delete area.nativeCoordinates; delete area.coordinateFrame
    }
    assert.deepEqual(restored, native, 'Retain every original native coordinate and DOM observation')
    assert.equal(raw.scrollAreas[0].requiredContentStart, 10)
    assert.equal(raw.scrollAreas[0].requiredContentEnd, 125.390625)
    assert.equal(raw.scrollAreas[0].visibleContentStart, 0)
    assert.equal(raw.scrollAreas[0].visibleContentEnd, 256)
  })
})

test('a nonzero native scroll origin uses its own first actual sample frame', async t => {
  const f = fixture(t, { offset: 73 }), scene = await f.run()
  assert.deepEqual(f.state.requests, [83])
  assert.equal(scene.images.length, 2); assert.equal(scene.rawSamples.length, 6)
  for (const sample of scene.rawSamples) {
    assert.equal(sample.scrollAreas[0].requiredContentStart, 83)
    assert.equal(sample.scrollAreas[0].requiredContentEnd, 198.390625)
    assert.equal(sample.scrollAreas[0].visibleContentStart, 73)
    assert.equal(sample.scrollAreas[0].visibleContentEnd, 329)
  }
  centralCoverage(scene, scene.scrollCoverage[0], assert)
})

test('the wide viewport horizontal translateX keeps the actual two-axis bounds and original coverage', async t => {
  const f = fixture(t, { viewport: { width: 1280, height: 800 }, horizontalTransform: true }), scene = await f.run()
  assert.equal(scene.complete, true); assert.deepEqual(f.state.requests, [10])
  assert.equal(scene.images.length, 2); assert.equal(scene.rawSamples.length, 6)
  for (const sample of scene.rawSamples) {
    assert.equal(sample.tableModebarOwner.horizontalTransform, -440)
    assert.deepEqual(sample.rootBounds, rect(222, 208.578125, 880, 115.390625))
  }
  centralCoverage(scene, scene.scrollCoverage[0], assert)
})

test('the same capture driver disposes identities and starts a new frame for the next real matrix', async t => {
  const f = fixture(t), first = await f.run()
  f.ctx.matrix.theme = 'dark'; f.document.documentElement.dataset.theme = 'dark'
  f.owner.scrollTop = 20; f.modebar.style.top = '30px'
  const second = await f.run()
  assert.equal(first.complete, true); assert.equal(second.complete, true)
  assert.notEqual(first.tableModebarPinnedOwner.ownerToken, second.tableModebarPinnedOwner.ownerToken)
  assert.equal(second.rawSamples[0].scrollAreas[0].requiredContentStart, 30)
  assert.equal(second.rawSamples[0].scrollAreas[0].nativeCoordinates, undefined)
  assert.deepEqual(f.state.requests, [10, 30])
  assert.equal(Object.hasOwn(f.window, '__fullAppTableModebarPinnedOwner'), false)
  centralCoverage(first, first.scrollCoverage[0], assert); centralCoverage(second, second.scrollCoverage[0], assert)
})

test('old route-content observations without a real new owner witness still fail the unchanged range assertion', async t => {
  const f = fixture(t)
  const observe = () => f.ctx.evaluate(`(()=>{const collectFullAppScrollOwners=${sharedDriver.collectFullAppScrollOwners.toString()};return (${sharedDriver.observeFullAppPage.toString()})({root:'.table-selection-modebar',anchors:[]},${sharedDriver.withinActualClientPort.toString()},${sharedDriver.observeFullAppOverflowViewport.toString()},${sharedDriver.viewportFixedClipBoundary.toString()});})()`)
  const before = await observe(); f.owner.scrollTop = 10; f.modebar.style.top = '20px'; const after = await observe()
  assert.equal(before.scrollAreas[0].contentTarget.kind, 'route-content')
  assert.equal(after.tableModebarOwner, undefined)
  assert.deepEqual([before.scrollAreas[0].requiredContentStart, after.scrollAreas[0].requiredContentStart], [10, 20])
  const images = [{ filename: 'before.png' }, { filename: 'after.png' }]
  const samples = [before, after].flatMap((page, index) => ['before-capture', 'after-capture'].map(phase => ({ ...clone(page), phase, image: images[index].filename })))
  assert.throws(() => sharedDriver.measureFullAppScrollCoverage(before.scrollAreas[0], samples, images), /Actual long-page content range changed/)
})

const domFaults = [
  ['identical modebar replacement', f => f.replaceModebarWithIdenticalDOM(), /DOM identity changed/],
  ['identical table replacement', f => { const table = f.editor.querySelector('table'); table.replaceWith(table.cloneNode(true)) }, /DOM identity changed/],
  ['identical title replacement', f => { const title = f.document.querySelector('.workspace-title-button'); title.replaceWith(title.cloneNode(true)) }, /DOM identity changed/],
  ['modebar offset parent changes', f => f.metrics(f.modebar, { offsetParent: () => f.owner }), /offset-parent chain/],
  ['overlay offset parent changes', f => f.metrics(f.overlay, { offsetParent: () => f.document.body }), /offset-parent chain/],
  ['modebar positioning changes', f => { f.modebar.style.position = 'fixed' }, /positioning model/],
  ['overlay positioning changes', f => { f.overlay.style.position = 'relative' }, /positioning model/],
  ['owner positioning changes', f => { f.owner.style.position = 'static' }, /positioning model/],
  ['owner no longer scrolls', f => { f.owner.style.overflowY = 'hidden' }, /scrolling owner/],
  ['modebar inline top ignores actual scrolling', f => { f.modebar.style.top = '10px' }, /inline top/],
  ['modebar root truly moves two pixels', f => { f.state.rootShift = 2 }, /pinned in the actual viewport/],
  ['owner and root both truly move two pixels', f => { f.state.ownerShift = 2; f.state.rootShift = 2 }, /screen geometry changed/],
  ['modebar content exceeds its own port', f => f.metrics(f.modebar, { scrollHeight: 200 }), /own client port/],
  ['modebar is partially clipped by the owner', f => { f.metrics(f.owner, { clientHeight: 80 }); f.overlay.getBoundingClientRect = () => rect(52, 198.578125 - f.state.scrollTop, 644, 80) }, /fully in its real viewport/],
  ['modebar becomes unpainted', f => { f.modebar.style.visibility = 'hidden' }, /unpainted owner/],
  ['owner has a real transform', f => { f.owner.style.transform = 'translateY(2px)' }, /transformed owner/],
  ['overlay has a real transform', f => { f.overlay.style.transform = 'matrix(1,0,0,1,0,2)' }, /transformed owner/],
  ['modebar has a scale transform', f => { f.modebar.style.transform = 'matrix(2,0,0,1,0,0)' }, /non-horizontal modebar transform/],
  ['modebar has a vertical transform', f => { f.modebar.style.transform = 'matrix(1,0,0,1,0,2)' }, /non-horizontal modebar transform/],
]
for (const [name, change, expected] of domFaults) test('actual DOM witness refuses ' + name, async t => {
  let changed = false
  const f = fixture(t, { beforeRead: state => { if (state.state.scrollTop === 10 && !changed) { changed = true; change(state) } } })
  await assert.rejects(f.run(), expected)
  assert.equal(changed, true)
  assert.equal(f.report.fullAppUi.scenes[0].complete, false)
  assert.equal(f.report.fullAppUi.scenes[0].tableModebarPinnedOwner.disposed, true)
  assert.equal(Object.hasOwn(f.window, '__fullAppTableModebarPinnedOwner'), false)
})

const sampleFaults = [
  ['missing witness', page => { delete page.tableModebarOwner }],
  ['different scene token', page => { page.tableModebarOwner.ownerToken = 'different-owner' }],
  ['unproven DOM identity', page => { page.tableModebarOwner.identityRetained = false }],
  ['different content kind', page => { page.scrollAreas[0].contentTarget.kind = 'route-content' }],
  ['different root selector', page => { page.root = '.other-root' }],
  ['different actual root box', page => { page.rootBounds.top += 2; page.rootBounds.bottom += 2 }],
  ['different owner selector', page => { page.tableModebarOwner.ownerSelector = '.other-owner' }],
  ['missing owner surface', page => { page.scrollAreas = [] }],
  ['duplicate owner surface', page => { page.scrollAreas.push(clone(page.scrollAreas[0])) }],
  ['different fixed extent', page => { page.scrollAreas[0].scrollHeight += 2 }],
  ['different native client height', page => { page.scrollAreas[0].clientHeight -= 2 }],
  ['different native scroll position', page => { page.scrollAreas[0].scrollTop += 2 }],
  ['real required start drift', page => { page.scrollAreas[0].requiredContentStart += 2 }],
  ['real required end drift', page => { page.scrollAreas[0].requiredContentEnd += 2 }],
  ['visible start drift', page => { page.scrollAreas[0].visibleContentStart += 2 }],
  ['visible end drift', page => { page.scrollAreas[0].visibleContentEnd -= 2 }],
  ['shorter painted client port', page => { page.scrollAreas[0].visibleHeight -= 2 }],
  ['four equally forged endpoints', page => { for (const key of ['requiredContentStart', 'requiredContentEnd', 'visibleContentStart', 'visibleContentEnd']) page.scrollAreas[0][key] += 2 }],
  ['missing exact surface witness', page => { delete page.scrollAreas[0].tableModebarOwner }],
  ['already normalized native payload', page => { page.scrollAreas[0].nativeCoordinates = {} }],
]
for (const [name, change] of sampleFaults) test('capture refuses ' + name + ' before accepting new coordinate evidence', async t => {
  let changed = false
  const f = fixture(t, { mutateSample: page => { if (page.scrollAreas[0]?.scrollTop === 10) { change(page); changed = true } } })
  await assert.rejects(f.run(), /Table modebar|Native scroll coordinates are already normalized/)
  assert.equal(changed, true)
  assert.equal(f.report.fullAppUi.scenes[0].complete, false)
  assert.equal(Object.hasOwn(f.window, '__fullAppTableModebarPinnedOwner'), false)
})

test('failure cleanup cannot replace an earlier capture error even if disposal and diagnostic saving also fail', async t => {
  let disposalAttempts = 0, diagnosticSaves = 0
  const f = fixture(t, {
    beforeRead: state => { if (state.state.scrollTop === 10) state.state.rootShift = 2 },
    beforeEvaluate: expression => { if (expression.startsWith('(function observeTableModebarPinnedOwner(') && expression.endsWith(",'dispose')")) { disposalAttempts++; throw new Error('owned disposal failed') } },
    onSave: report => { if (report.fullAppUi.scenes[0]?.tableModebarPinnedOwner?.cleanupError) { diagnosticSaves++; throw new Error('cleanup diagnostic save failed') } },
  })
  await assert.rejects(f.run(), /modebar was not pinned in the actual viewport/)
  const owner = f.report.fullAppUi.scenes[0].tableModebarPinnedOwner
  assert.equal(owner.complete, false); assert.equal(owner.disposed, false)
  assert.equal(owner.cleanupError.message, 'owned disposal failed')
  assert.equal(owner.cleanupSaveError.message, 'cleanup diagnostic save failed')
  assert.equal(disposalAttempts, 1); assert.equal(diagnosticSaves, 1)
})

test('an install-time native ownership getter failure leaves no renderer owner behind', async t => {
  const f = fixture(t)
  f.metrics(f.modebar, { offsetParent: () => { throw new Error('native offsetParent unavailable') } })
  await assert.rejects(f.run(), /native offsetParent unavailable/)
  const owner = f.report.fullAppUi.scenes[0].tableModebarPinnedOwner
  assert.equal(owner.installed, false); assert.equal(owner.disposed, true); assert.equal(owner.complete, false)
  assert.equal(owner.disposal.absent, true)
  assert.equal(Object.hasOwn(f.window, '__fullAppTableModebarPinnedOwner'), false)
})

test('a later native metric getter failure disposes its installed real DOM references', async t => {
  const f = fixture(t, { beforeRead: ({ modebar, state, metrics }) => {
    if (state.scrollTop === 10) metrics(modebar, { scrollHeight: () => { throw new Error('native metric unavailable') } })
  } })
  await assert.rejects(f.run(), /native metric unavailable/)
  const owner = f.report.fullAppUi.scenes[0].tableModebarPinnedOwner
  assert.equal(owner.installed, true); assert.equal(owner.disposed, true); assert.equal(owner.complete, false)
  assert.equal(Object.hasOwn(f.window, '__fullAppTableModebarPinnedOwner'), false)
})

test('a failed evidence save after actual disposal and its failed diagnostic still preserve the capture error', async t => {
  let cleanupSaves = 0, diagnosticSaves = 0
  const f = fixture(t, {
    beforeRead: state => { if (state.state.scrollTop === 10) state.state.rootShift = 2 },
    onSave: report => {
      const owner = report.fullAppUi.scenes[0]?.tableModebarPinnedOwner
      if (owner?.cleanupError) { diagnosticSaves++; throw new Error('diagnostic persistence failed') }
      if (owner?.disposed) { cleanupSaves++; throw new Error('disposal persistence failed') }
    },
  })
  await assert.rejects(f.run(), /modebar was not pinned in the actual viewport/)
  const owner = f.report.fullAppUi.scenes[0].tableModebarPinnedOwner
  assert.equal(owner.disposed, true); assert.equal(owner.complete, false)
  assert.equal(owner.cleanupError.message, 'disposal persistence failed')
  assert.equal(owner.cleanupSaveError.message, 'diagnostic persistence failed')
  assert.equal(cleanupSaves, 1); assert.equal(diagnosticSaves, 1)
  assert.equal(Object.hasOwn(f.window, '__fullAppTableModebarPinnedOwner'), false)
})

test('a cleanup failure on an otherwise successful capture cannot be reported as accepted', async t => {
  let attempts = 0
  const f = fixture(t, { beforeEvaluate: expression => {
    if (expression.startsWith('(function observeTableModebarPinnedOwner(') && expression.endsWith(",'dispose')")) { attempts++; throw new Error('native owner disposal failed') }
  } })
  await assert.rejects(f.run(), /native owner disposal failed/)
  assert.equal(attempts, 1)
  assert.equal(f.report.fullAppUi.scenes[0].complete, false)
  assert.equal(f.report.fullAppUi.scenes[0].tableModebarPinnedOwner.complete, false)
})

test('a fresh scene refuses a stale actual renderer owner instead of replacing its references', async t => {
  const f = fixture(t)
  const stale = { ownerToken: 'another-scene' }
  f.window.__fullAppTableModebarPinnedOwner = stale
  await assert.rejects(f.run(), /previous scene was not disposed/)
  assert.equal(f.window.__fullAppTableModebarPinnedOwner, stale)
  assert.match(f.report.fullAppUi.scenes[0].tableModebarPinnedOwner.cleanupError.message, /token changed before disposal/)
})
