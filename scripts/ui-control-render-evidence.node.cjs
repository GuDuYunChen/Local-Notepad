const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { verifyGeometry, verifyFocus, verifyScenes, hasVisibleBoxShadow, HEIGHTS } = require('./check-ui-control-render.cjs')

function geometry() {
  return { viewport: { width: 704, height: 455 }, overflow: 0,
    controls: Object.entries(HEIGHTS).flatMap(([density, height], row) =>
      ['button', 'input', 'password', 'select'].map((kind, column) => ({ density, kind,
        context: density === 'compact' ? 'product-editor-toolbar' : 'standalone',
        height, width: 150, left: 16 + column * 166, right: 166 + column * 166, top: 40 + row * 90,
        ...(kind === 'password' ? { innerPadding: [0, 0, 0, 0], innerHeight: 22 } : {}) }))) }
}
function focus() {
  return { id: 'ordinary-password', focused: true, focusVisible: true,
    outlines: [{ owner: 'root', width: 2, color: 'rgb(80, 60, 160)' }], shadows: [], hit: true, inViewport: true }
}
test('accepts a complete aligned three-density measurement without mutating it', () => {
  const sample = geometry(), original = JSON.stringify(sample)
  verifyGeometry(sample); assert.equal(JSON.stringify(sample), original)
})
test('rejects the old second padding layer even if the outer height happens to match', () => {
  const sample = geometry(); sample.controls.find(control => control.kind === 'password').innerPadding = [9, 10, 9, 10]
  assert.throws(() => verifyGeometry(sample), /padded twice/)
})
test('rejects compact controls forced to the old toolbar or ordinary height', () => {
  for (const height of [32, 40]) {
    const sample = geometry(); sample.controls.find(control => control.density === 'compact' && control.kind === 'input').height = height
    assert.throws(() => verifyGeometry(sample), /expected 28px/)
  }
})
test('requires compact geometry to come from actual production editor toolbar descendants', () => {
  const sample = geometry(); sample.controls.find(control => control.density === 'compact').context = 'standalone'
  assert.throws(() => verifyGeometry(sample), /production editor toolbar context/)
})
test('rejects a missing control and duplicated control identities', () => {
  const missing = geometry(); missing.controls.pop(); assert.throws(() => verifyGeometry(missing))
  const duplicate = geometry(); duplicate.controls[3] = { ...duplicate.controls[0] }; assert.throws(() => verifyGeometry(duplicate), /Exact control matrix/)
})
test('rejects misalignment, horizontal clipping and nonfinite measurements', () => {
  for (const mutate of [sample => { sample.controls[0].top += 3 }, sample => { sample.controls[0].right = 900 }, sample => { sample.controls[0].height = NaN }]) {
    const sample = geometry(); mutate(sample); assert.throws(() => verifyGeometry(sample))
  }
})
test('accepts one visible root cue and rejects duplicate inner outlines or glow', () => {
  verifyFocus(focus())
  const duplicate = focus(); duplicate.outlines.push({ owner: 'input:1', width: 2 }); assert.throws(() => verifyFocus(duplicate), /exactly one/)
  const glow = focus(); glow.shadows.push({ owner: 'root', value: '0 0 0 2px blue' }); assert.throws(() => verifyFocus(glow), /duplicate focus glow/)
})
test('ignores only unpainted zero-extent or transparent shadows using the serialized page classifier', () => {
  const pageClassifier = vm.runInNewContext(`(${hasVisibleBoxShadow.toString()})`)
  for (const value of ['none', 'rgb(80, 60, 160) 0px 0px 0px 0px', '0 0 0 0px rgba(80, 60, 160, 0.5)',
    'rgba(80, 60, 160, 0) 0px 0px 0px 2px', '0px 1px 4px rgb(80 60 160 / 0%)',
    '0 0 2px 3px transparent', '0 0 2px #1230', '0 0 0 2px color(srgb 0.2 0.3 0.4 / 0)']) {
    assert.equal(hasVisibleBoxShadow(value), false, value)
    assert.equal(pageClassifier(value), false, value)
  }
})
test('still refuses nonzero offset, blur or spread and visible layers after transparent layers', () => {
  const pageClassifier = vm.runInNewContext(`(${hasVisibleBoxShadow.toString()})`)
  for (const value of ['0 0 0 2px blue', 'rgb(80, 60, 160) 0px 0px 0px 2px',
    '1px 0px rgb(80 60 160 / 1)', '0px -1px rgba(80, 60, 160, 0.01)', 'inset 0 0 2px black',
    '0 0 0 -2px black', 'rgba(0, 0, 0, 0) 0 0 0 2px, rgb(80, 60, 160) 0 0 0 2px',
    'rgb(80, 60, 160) 0 0 0 0, 0 0 2px #123f', 'unrecognized-shadow']) {
    assert.equal(hasVisibleBoxShadow(value), true, value)
    assert.equal(pageClassifier(value), true, value)
    const sample = focus(); sample.shadows.push({ owner: 'root', value })
    assert.throws(() => verifyFocus(sample), /duplicate focus glow/)
  }
})
test('refuses a focused but hidden, obscured or unpainted control', () => {
  for (const key of ['focused', 'focusVisible', 'hit', 'inViewport']) {
    const sample = focus(); sample[key] = false; assert.throws(() => verifyFocus(sample))
  }
  const sample = focus(); sample.outlines = []; assert.throws(() => verifyFocus(sample))
})
test('cannot report a partial scene list as successful native evidence', () => {
  assert.throws(() => verifyScenes([]), /every viewport/)
})

// Startup contracts only. These load the actual checker source with an inert
// Electron boundary; they do not create a native window or claim UI acceptance.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const checkerFile = require.resolve('./check-ui-control-render.cjs')
const checkerSource = fs.readFileSync(checkerFile, 'utf8')

function loadCheckerEntry(processOverrides = {}, cjsMain = false) {
  const timers = [], reports = [], exits = [], paths = [], errors = []
  let electronLoads = 0, readyCalls = 0
  const manifest = { schema: 1, scope: 'shared-controls-only', sources: {}, artifacts: {},
    version: 'startup-contract', commit: 'startup-contract', dependencies: { electron: '31.7.7' } }
  const app = {
    setPath: (name, value) => paths.push({ name, value }), on() {}, once() {},
    whenReady() { readyCalls++; return new Promise(() => {}) },
    exit: code => exits.push(code),
  }
  const module = { exports: {} }
  const load = name => {
    if (name === 'electron') {
      electronLoads++
      return { app, BrowserWindow: class { constructor() { throw Error('Startup contract must never create a native window') } } }
    }
    if (name === 'node:fs') return {
      mkdirSync() {}, existsSync: () => false,
      mkdtempSync: prefix => prefix + 'startup-contract',
      readFileSync: () => JSON.stringify(manifest),
      writeFileSync: (_filename, value) => reports.push(JSON.parse(value)),
    }
    if (name === 'node:child_process') return { execFileSync: () => manifest.commit }
    return require(name)
  }
  load.main = cjsMain ? module : undefined
  const process = { argv: ['electron', checkerFile], defaultApp: true, type: 'browser',
    versions: { electron: '31.7.7', chrome: 'startup-contract' }, platform: 'win32', env: {}, ...processOverrides }
  const context = { process, console: { error: error => errors.push(String(error)) },
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer }, clearTimeout() {} }
  const wrapper = vm.runInNewContext(`(function (exports, require, module, __filename, __dirname) {\n${checkerSource}\n})`, context)
  wrapper(module.exports, load, module, checkerFile, path.dirname(checkerFile))
  return { timers, reports, exits, paths, errors, electronLoads, readyCalls }
}

test('Node ESM dynamic import keeps the actual checker lazy with a false CommonJS main guard', () => {
  const source = `
    import Module, { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const filename = ${JSON.stringify(checkerFile)};
    const original = Module._load;
    Module._load = function (name, ...args) {
      if (name === 'electron') throw Error('A Node helper import must not start Electron');
      return original.call(this, name, ...args);
    };
    const require = createRequire(import.meta.url);
    const imported = await import(pathToFileURL(filename).href);
    console.log(JSON.stringify({ main: require.main?.filename ?? null,
      guard: require.main === require.cache[filename], budget: imported.default.BUDGET_MS }));
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8', timeout: 5000 })
  assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout), { main: null, guard: false, budget: 90000 })
})

test('Electron default_app dynamic loading starts the unchanged watchdog before readiness', () => {
  for (const entry of [checkerFile, path.relative(process.cwd(), checkerFile)]) {
    const loaded = loadCheckerEntry({ argv: ['electron', entry] })
    assert.equal(loaded.electronLoads, 1); assert.equal(loaded.readyCalls, 1)
    assert.deepEqual(loaded.errors, []); assert.deepEqual(loaded.exits, [])
    assert.deepEqual(loaded.paths.map(item => item.name), ['userData', 'sessionData'])
    assert.equal(loaded.paths[0].value, loaded.paths[1].value)
    assert.equal(loaded.timers.length, 1); assert.equal(loaded.timers[0].ms, 90000)
    assert.equal(loaded.reports[0].status, 'starting'); assert.equal(loaded.reports[0].complete, false)
    loaded.timers[0].callback()
    assert.equal(loaded.reports.at(-1).status, 'timeout')
    assert.equal(loaded.reports.at(-1).complete, false); assert.equal(loaded.reports.at(-1).cleanQuit, false)
    assert.deepEqual(loaded.exits, [1])
  }
})

test('helper imports in Node, another Electron entry or a renderer remain inert', () => {
  for (const overrides of [{ versions: {} }, { defaultApp: false }, { type: 'renderer' },
    { argv: ['electron', path.join(path.dirname(checkerFile), 'another-entry.cjs')] },
    { argv: ['electron', path.dirname(checkerFile)] }, { argv: ['electron'] }]) {
    const loaded = loadCheckerEntry(overrides)
    assert.equal(loaded.electronLoads, 0); assert.equal(loaded.readyCalls, 0)
    assert.deepEqual(loaded.timers, []); assert.deepEqual(loaded.reports, []); assert.deepEqual(loaded.exits, [])
  }
  const main = loadCheckerEntry({ defaultApp: false, argv: ['electron', 'ordinary-cjs-entry'] }, true)
  assert.equal(main.electronLoads, 1); assert.equal(main.readyCalls, 1); assert.equal(main.timers[0].ms, 90000)
})

const { failureDetails, recordFocusEvidence } = require('./check-ui-control-render.cjs')
test('persists the original failed focus sample before capture and still rejects after a valid later observation', async () => {
  const sample = focus(); sample.outlines = []
  const scene = { complete: false, focus: [], images: [] }, writes = [], order = []
  const persist = () => { order.push('persist'); writes.push(JSON.parse(JSON.stringify(scene))) }
  await assert.rejects(recordFocusEvidence(scene, sample, persist, async () => {
    order.push('capture')
    assert.equal(writes[0].focus[0].outlines.length, 0)
    assert.equal(writes.at(-1).focusFailure.error.actual, 0)
    assert.equal(writes.at(-1).focusFailure.error.expected, 1)
    scene.focusFailure.afterCapture = focus()
    return { name: 'focus-failure.png', bytes: 200, sha256: 'a'.repeat(64) }
  }), error => error.actual === 0 && error.expected === 1 && /exactly one/.test(error.message))
  assert.equal(scene.focus[0], sample); assert.equal(scene.focus[0].outlines.length, 0)
  assert.equal(scene.focusFailure.afterCapture.outlines.length, 1)
  assert.equal(scene.complete, false); assert.deepEqual(scene.images, [])
  assert.equal(writes.at(-1).focusFailure.image.name, 'focus-failure.png')
  assert.deepEqual(order, ['persist', 'persist', 'capture', 'persist'])
})

test('capture failure cannot mask the original assertion or discard its actual and expected values', async () => {
  const sample = focus(); sample.outlines.push({ owner: 'span:1', width: 2 })
  const scene = { complete: false, focus: [], images: [] }, writes = []
  await assert.rejects(recordFocusEvidence(scene, sample, () => writes.push(JSON.parse(JSON.stringify(scene))),
    async () => { throw Error('Native capture unavailable') }),
  error => error.name === 'AssertionError' && error.actual === 2 && error.expected === 1 && error.operator === 'strictEqual')
  assert.equal(writes[0].focus[0].outlines.length, 2)
  assert.equal(scene.focusFailure.error.actual, 2); assert.equal(scene.focusFailure.error.expected, 1)
  assert.equal(scene.focusFailure.error.operator, 'strictEqual'); assert.match(scene.focusFailure.error.stack, /AssertionError/)
  assert.equal(scene.focusFailure.captureError.message, 'Native capture unavailable')
  assert.equal(scene.complete, false); assert.deepEqual(scene.images, [])
  const plain = failureDetails(Error('An ordinary runtime error'))
  assert.equal(plain.name, 'Error'); assert.equal(plain.message, 'An ordinary runtime error'); assert.equal('actual' in plain, false)
})

test('successful focus recording preserves the sample and adds no failure screenshot', async () => {
  const sample = focus(), scene = { complete: false, focus: [], images: [] }
  let writes = 0, captures = 0
  await recordFocusEvidence(scene, sample, () => writes++, async () => { captures++; return {} })
  assert.equal(scene.focus[0], sample); assert.equal(writes, 1); assert.equal(captures, 0)
  assert.equal('focusFailure' in scene, false); assert.deepEqual(scene.images, [])
})

const { captureMatchedFocusStyles } = require('./check-ui-control-render.cjs')
test('queries only the failing node through the existing debugger and preserves complete CSS responses', async () => {
  const calls = [], saved = []
  const matched = { matchedCSSRules: [{ matchingSelectors: [0], rule: { origin: 'regular', selectorList: { text: '.button:focus-visible' },
    style: { cssProperties: [{ name: 'outline', value: 'var(--focus)', parsedOk: false, important: true, disabled: false, implicit: false },
      { name: 'color', value: 'red' }], shorthandEntries: [{ name: 'outline', value: 'var(--focus)' }] }, layers: [{ text: 'controls' }] } }],
    inherited: [{ matchedCSSRules: [], inlineStyle: { cssProperties: [{ name: '--focus', value: '3px solid red' }] } }] }
  const computed = { computedStyle: [{ name: 'outline-width', value: '0px' }, { name: 'transition-duration', value: '0s' }] }
  const session = { async sendCommand(method, parameters) {
    calls.push({ method, parameters })
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
    if (method === 'DOM.querySelector') return { nodeId: 7 }
    return method === 'CSS.getMatchedStylesForNode' ? matched : method === 'CSS.getComputedStyleForNode' ? computed : {}
  } }
  const result = await captureMatchedFocusStyles(session, 'ordinary-button', (kind, value) => { saved.push({ kind, value }); return { name: kind + '.json' } })
  assert.deepEqual(calls, [{ method: 'DOM.enable', parameters: undefined }, { method: 'CSS.enable', parameters: undefined },
    { method: 'DOM.getDocument', parameters: { depth: 0 } }, { method: 'DOM.querySelector', parameters: { nodeId: 1, selector: '[id="ordinary-button"]' } },
    { method: 'CSS.getMatchedStylesForNode', parameters: { nodeId: 7 } }, { method: 'CSS.getComputedStyleForNode', parameters: { nodeId: 7 } }])
  assert.equal(saved[0].value.response, matched); assert.equal(saved[1].value.response, computed)
  assert.equal(result.nodeId, 7); assert.deepEqual(result.errors, [])
  assert.deepEqual(Object.keys(result.artifacts), ['matched', 'computed'])
})

test('a failed CSS diagnostic preserves the original focus assertion and still retains the independent computed response', async () => {
  const sample = focus(); sample.outlines = []
  const scene = { complete: false, focus: [], images: [] }, calls = []
  const session = { async sendCommand(method) {
    calls.push(method)
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
    if (method === 'DOM.querySelector') return { nodeId: 7 }
    if (method === 'CSS.getMatchedStylesForNode') throw Error('CSS diagnostic unavailable')
    return { computedStyle: [] }
  } }
  await assert.rejects(recordFocusEvidence(scene, sample, () => {}, async () => {
    scene.focusFailure.styles = await captureMatchedFocusStyles(session, sample.id, kind => ({ name: kind + '.json' }))
    return { name: 'original-failure.png' }
  }), error => error.actual === 0 && error.expected === 1 && /exactly one/.test(error.message))
  assert.equal(calls.at(-1), 'CSS.getComputedStyleForNode')
  assert.equal(scene.focusFailure.styles.errors[0].command, 'CSS.getMatchedStylesForNode')
  assert.equal(scene.focusFailure.styles.errors[0].message, 'CSS diagnostic unavailable')
  assert.equal(scene.focusFailure.styles.artifacts.computed.name, 'computed.json')
  assert.equal(scene.focusFailure.image.name, 'original-failure.png'); assert.equal(scene.complete, false)
})

test('missing focus nodes or artifact write failures remain separate diagnostics with no CSS mutation', async () => {
  const calls = []
  const missing = await captureMatchedFocusStyles({ async sendCommand(method) {
    calls.push(method); return method === 'DOM.getDocument' ? { root: { nodeId: 1 } } : { nodeId: 0 }
  } }, 'ordinary-button', () => { throw Error('Must not write for a missing node') })
  assert.equal(calls.at(-1), 'DOM.querySelector'); assert.deepEqual(missing.artifacts, {})
  assert.match(missing.errors[0].message, /no longer present/)
  const failedWrite = await captureMatchedFocusStyles({ async sendCommand(method) {
    return method === 'DOM.getDocument' ? { root: { nodeId: 1 } } : { nodeId: 7 }
  } }, 'ordinary-button', () => { throw Error('Diagnostic write failed') })
  assert.deepEqual(failedWrite.errors.map(error => error.stage), ['write', 'write'])
  assert.deepEqual(failedWrite.artifacts, {})
})

const { selectStateSnapshot, paintedPopupReader } = require('./check-ui-control-render.cjs')
// Inert DOM boundary for the exact function serialized into Electron. Geometry
// and computed styles are explicit observations, not native rendering evidence.
function popupPage() {
  const nodes = new Map(), queries = []
  const element = (tag, id, parent = null, attributes = {}) => {
    const node = { tagName: tag.toUpperCase(), id, attributes: { id, ...attributes }, parentElement: parent,
      children: [], dataset: {}, isConnected: true,
      rect: { left: 200, top: 100, right: 380, bottom: 228, width: 180, height: 128 },
      css: { display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' },
      getAttribute(name) { return this.attributes[name] ?? null },
      getBoundingClientRect() { return this.rect },
      contains(other) { for (let current = other; current; current = current.parentElement) if (current === this) return true; return false },
      closest(selector) {
        for (let current = this; current; current = current.parentElement) {
          if (selector === '[data-ui-control="select"]' && current.attributes['data-ui-control'] === 'select') return current
          if (selector === '.ant-select-dropdown' && String(current.attributes.class).split(/\s+/).includes('ant-select-dropdown')) return current
        }
        return null
      },
      querySelectorAll(selector) {
        const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')])
        return descendants.filter(child => selector === '*' || selector === '[role="option"]' && child.attributes.role === 'option' ||
          selector === '[data-ui-option-value]' && Object.hasOwn(child.attributes, 'data-ui-option-value'))
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
    }
    parent?.children.push(node); nodes.set(id, node); return node
  }
  const html = element('html', 'html'), body = element('body', 'body', html)
  const host = element('span', 'host', body, { 'data-ui-control': 'select' }); host.dataset.uiValue = '"alpha"'
  const trigger = element('input', 'ordinary-select', host, { 'aria-controls': 'owned-list', 'aria-expanded': 'true' })
  const popup = element('div', 'popup', body, { class: 'ant-select-dropdown' })
  const list = element('div', 'owned-list', popup, { role: 'listbox' })
  const option = element('div', 'alpha-option', list, { role: 'option', 'aria-disabled': 'false' })
  option.rect = { left: 204, top: 104, right: 376, bottom: 136, width: 172, height: 32 }
  const marker = element('span', 'alpha-marker', option, { 'data-ui-option-value': 'alpha' })
  const page = { html, body, host, trigger, popup, list, option, marker, hit: marker, queries }
  const document = { activeElement: trigger,
    getElementById(id) { queries.push(id); return nodes.get(id) || null },
    elementFromPoint() { return page.hit },
    querySelector() { throw Error('A global popup query cannot establish ownership') },
  }
  page.observe = () => vm.runInNewContext(`(${selectStateSnapshot.toString()})('ordinary-select')`,
    { document, getComputedStyle: node => node.css, innerWidth: 704, innerHeight: 455 })
  return page
}

test('serialized popup observation follows its real aria owner and records an enabled option hit', () => {
  const page = popupPage(), sample = page.observe()
  assert.equal(sample.expanded, true); assert.equal(sample.optionsAvailable, true)
  assert.equal(sample.value, 'alpha'); assert.equal(sample.focused, true)
  assert.equal(sample.popup.ready, true); assert.equal(sample.popup.ownedHit, true)
  assert.equal(sample.popup.listId, 'owned-list'); assert.equal(sample.popup.optionValue, 'alpha')
  assert.equal(sample.popup.item.height, 32); assert.equal(sample.popup.ancestors.at(-1).tag, 'html')
  assert.deepEqual(page.queries, ['ordinary-select', 'owned-list'])
  page.trigger.attributes['aria-controls'] = 'unrelated-list'
  assert.equal(page.observe().popup, null, 'A different visible popup must not substitute for the aria owner')
})

test('expanded DOM and option markers cannot qualify a hidden, zero-size, clipped or covered popup', () => {
  const cases = [
    page => { page.popup.css.opacity = '0' },
    page => { page.body.css.opacity = '0' },
    page => { page.list.css.display = 'none' },
    page => { page.option.css.visibility = 'hidden' },
    page => { page.popup.rect.height = 0; page.popup.rect.bottom = page.popup.rect.top },
    page => { page.list.rect.width = 0; page.list.rect.right = page.list.rect.left },
    page => { page.option.rect.left = 700; page.option.rect.right = 872 },
    page => { page.hit = page.body },
  ]
  for (const mutate of cases) {
    const page = popupPage(); mutate(page); const sample = page.observe()
    assert.equal(sample.expanded, true); assert.equal(sample.optionsAvailable, true)
    assert.equal(sample.popup.ready, false)
  }
})

test('popup readiness refuses disabled-only options, a missing popup owner, wrong roles and detached content', () => {
  for (const mutate of [page => { page.option.attributes['aria-disabled'] = 'true' },
    page => { page.popup.attributes.class = 'unrelated-overlay' }, page => { page.list.attributes.role = 'presentation' },
    page => { page.option.isConnected = false }]) {
    const page = popupPage(); mutate(page)
    assert.notEqual(page.observe().popup?.ready, true)
  }
})

test('paint readiness requires a completed frame boundary and a fresh visible observation after it', async () => {
  const page = popupPage(), frames = []
  const read = paintedPopupReader(() => page.observe(), () => new Promise(resolve => frames.push(resolve)))
  assert.equal((await read()).popup.paintFrames, 0)
  assert.equal((await read()).popup.paintFrames, 0); assert.equal(frames.length, 1)
  // Losing visibility invalidates the old cycle, even if that pending frame later completes.
  page.popup.css.opacity = '0'; assert.equal((await read()).popup.ready, false)
  frames[0](); await new Promise(resolve => setImmediate(resolve))
  page.popup.css.opacity = '1'; assert.equal((await read()).popup.paintFrames, 0)
  assert.equal(frames.length, 2); assert.equal((await read()).popup.paintFrames, 0)
  frames[1](); await new Promise(resolve => setImmediate(resolve))
  page.hit = page.body; assert.equal((await read()).popup.ready, false, 'A previously painted but now covered popup cannot pass')
  page.hit = page.marker; assert.equal((await read()).popup.paintFrames, 0)
  frames[2](); await new Promise(resolve => setImmediate(resolve))
  const sample = await read(); assert.equal(sample.popup.ready, true); assert.equal(sample.popup.paintFrames, 2)
})

test('a pending renderer frame does not block the existing polling deadline and frame errors remain failures', async () => {
  const page = popupPage(), neverPainted = paintedPopupReader(() => page.observe(), () => new Promise(() => {}))
  let observed = false
  const pending = neverPainted().then(sample => { observed = true; return sample })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(observed, true); assert.equal((await pending).popup.paintFrames, 0)
  assert.equal((await neverPainted()).popup.paintFrames, 0)
  const failure = Error('Renderer paint unavailable')
  const failed = paintedPopupReader(() => page.observe(), async () => { throw failure })
  assert.equal((await failed()).popup.paintFrames, 0)
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(failed, error => error === failure)
})

test('a paint completed during an in-flight DOM read cannot certify that earlier sample', async () => {
  const page = popupPage()
  let finishPaint, deliverRead, delayRead = false
  const read = paintedPopupReader(() => {
    const sample = page.observe()
    return delayRead ? new Promise(resolve => { deliverRead = () => resolve(sample) }) : sample
  }, () => new Promise(resolve => { finishPaint = resolve }))
  assert.equal((await read()).popup.paintFrames, 0)
  delayRead = true
  const earlierSample = read()
  finishPaint(); await new Promise(resolve => setImmediate(resolve)); deliverRead()
  assert.equal((await earlierSample).popup.paintFrames, 0)
  delayRead = false
  assert.equal((await read()).popup.paintFrames, 2)
})

const { verifyToolbarSnapshot, verifyToolbarContinuity, captureToolbarEvidence } = require('./check-ui-control-render.cjs')
function visibleToolbar() {
  const box = (top, height) => ({ left: 16, right: 684, top, bottom: top + height, width: 668, height, owned: true, visible: true, inViewport: true, hit: true })
  return { viewport: { width: 704, height: 455 }, theme: 'dark', overflow: 0, longLabelLength: 45,
    rootBounds: box(30, 210), fields: ['long-input', 'long-select', 'long-clear'].map((id, index) => ({ id, ...box(70 + index * 70, 40) })),
    labels: [0, 1].map(index => ({ index, ...box(40 + index * 70, 65) })) }
}
const toolbarImage = { name: 'dark-704x455-toolbar.png', bytes: 1200, sha256: 'a'.repeat(64), width: 704, height: 455 }

test('toolbar PNG targets require all original controls and both complete visible labels', () => {
  const expected = { viewport: { width: 704, height: 455 }, theme: 'dark' }
  verifyToolbarSnapshot(visibleToolbar(), expected)
  for (const mutate of [s => { s.fields[0].inViewport = false }, s => { s.fields[1].hit = false },
    s => { s.fields[2].owned = false }, s => { s.labels[0].visible = false }, s => { s.labels.pop() },
    s => { s.fields[0].top = -20 }, s => { s.theme = 'light' }, s => { s.fields[0].height = 28 }]) {
    const sample = visibleToolbar(); mutate(sample); assert.throws(() => verifyToolbarSnapshot(sample, expected))
  }
})

test('toolbar evidence rejects target movement across the actual capture boundary', () => {
  for (const owner of ['fields', 'labels']) {
    const before = visibleToolbar(), after = structuredClone(before)
    after[owner][0].left += 3; after[owner][0].right += 3
    assert.throws(() => verifyToolbarContinuity(before, after, before), /moved/)
  }
})

test('toolbar capture reads after the runner paint wait and independently after the PNG', async () => {
  const record = visibleToolbar(), order = [], expected = structuredClone(record)
  const image = await captureToolbarEvidence({ record, expected, persist() {},
    read: async () => { order.push('read'); return structuredClone(expected) },
    capture: async guard => { order.push('paint'); await guard(); order.push('png'); return toolbarImage } })
  assert.deepEqual(order, ['paint', 'read', 'png', 'read'])
  assert.deepEqual(image, toolbarImage); assert.equal(record.capture.complete, true)
  assert.deepEqual(record.capture.before, expected); assert.deepEqual(record.capture.after, expected)
})

test('toolbar capture refuses disappearing targets before or after a real image', async () => {
  for (const phase of ['before', 'after']) {
    const record = visibleToolbar(), expected = structuredClone(record); let current = structuredClone(record), captures = 0
    await assert.rejects(() => captureToolbarEvidence({ record, expected, persist() {}, read: async () => structuredClone(current),
      capture: async guard => {
        if (phase === 'before') current.fields[0].inViewport = false
        await guard(); captures++
        if (phase === 'after') current.fields[0].visible = false
        return toolbarImage
      } }), /target.*visible/)
    assert.equal(captures, phase === 'before' ? 0 : 1); assert.equal(record.capture.complete, false)
    if (phase === 'after') assert.deepEqual(record.capture.image, toolbarImage)
  }
})

test('toolbar capture refuses an omitted guard and preserves original native capture failures', async () => {
  let record = visibleToolbar(), expected = structuredClone(record)
  await assert.rejects(() => captureToolbarEvidence({ record, expected, persist() {}, read: async () => expected,
    capture: async () => toolbarImage }), /omitted.*guard/)
  assert.equal(record.capture.complete, false)
  record = visibleToolbar(); expected = structuredClone(record); const failure = Error('native PNG failed')
  await assert.rejects(() => captureToolbarEvidence({ record, expected, persist() {}, read: async () => expected,
    capture: async guard => { await guard(); throw failure } }), error => error === failure)
  assert.equal(record.capture.complete, false); assert.equal(record.capture.after, undefined)
})

// Execute the exact page observer after serialization. These DOM-shaped inputs
// model documented CSS viewport propagation; they do not claim native layout.
const { toolbarSnapshot } = require('./check-ui-control-render.cjs')
function serializedToolbarPage() {
  const nodes = new Map(), rectangle = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })
  const element = (tag, id, parent, rect, css = {}) => {
    const node = { tagName: tag.toUpperCase(), localName: tag, namespaceURI: 'http://www.w3.org/1999/xhtml',
      id, parentElement: parent, children: [], rect, clientLeft: 0, clientTop: 0, clientWidth: rect.width, clientHeight: rect.height,
      css: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', contain: 'none', contentVisibility: 'visible', ...css },
      getBoundingClientRect() { return this.rect },
      contains(target) { for (let current = target; current; current = current.parentElement) if (current === this) return true; return false },
      closest(selector) { for (let current = this; current; current = current.parentElement) if (selector === '.ant-select' && current.isSelect) return current; return null },
    }
    parent?.children.push(node); nodes.set(id, node); return node
  }
  // Reuse the five actual 704x455 target bounds with a synthetic scrolled
  // 100%-height body box. The failed native receipt did not record body bounds;
  // this fixture exercises the exact source's documented overflow semantics.
  const html = element('html', 'html', null, rectangle(0, -420, 696, 455))
  html.clientWidth = 696; html.clientHeight = 455; html.scrollWidth = 696; html.dataset = { theme: 'light' }
  const body = element('body', 'body', html, rectangle(0, -420, 696, 455), { overflowX: 'auto', overflowY: 'auto' })
  const wrapper = element('div', 'root', body, rectangle(0, -420, 696, 1200))
  const toolbar = element('div', 'long-toolbar', wrapper, rectangle(16, 57.3125, 664, 190.375))
  const labels = [element('label', 'label-one', toolbar, rectangle(16, 57.3125, 664, 65.1875)),
    element('label', 'label-two', toolbar, rectangle(16, 132.5, 664, 65.1875))]
  labels[0].textContent = '很长的检索标签，需要在窄窗口完整换行且不挤压相邻控件'
  const input = element('input', 'long-input', labels[0], rectangle(16, 82.5, 664, 40))
  const select = element('div', 'select-owner', labels[1], rectangle(16, 157.6875, 664, 40)); select.isSelect = true
  element('input', 'long-select', select, rectangle(28, 159.6875, 640, 36))
  const button = element('button', 'long-clear', toolbar, rectangle(16, 207.6875, 664, 40))
  toolbar.querySelectorAll = selector => selector === 'label' ? labels : []
  toolbar.querySelector = selector => toolbar.querySelectorAll(selector)[0] || null
  const page = { html, body, wrapper, toolbar, labels, input, select, button, forceHit: undefined }
  const document = { documentElement: html, body, getElementById: id => nodes.get(id),
    querySelectorAll: selector => selector === '#long-toolbar' ? [toolbar] : [],
    elementFromPoint(x, y) {
      if (page.forceHit !== undefined) return page.forceHit
      return [input, select, button, ...labels].find(node => x >= node.rect.left && x <= node.rect.right && y >= node.rect.top && y <= node.rect.bottom) || null
    } }
  page.observe = () => JSON.parse(JSON.stringify(vm.runInNewContext(`(${toolbarSnapshot.toString()})()`,
    { document, getComputedStyle: node => node.css, innerWidth: 704, innerHeight: 455 })))
  page.rectangle = rectangle
  return page
}

test('serialized toolbar observation clips propagated HTML body overflow at the viewport after scroll', () => {
  const page = serializedToolbarPage(), sample = page.observe()
  verifyToolbarSnapshot(sample, { viewport: { width: 704, height: 455 }, theme: 'light' })
  assert.ok(page.body.rect.bottom < sample.fields[0].top)
  assert.equal(sample.viewportOverflow.bodyPropagated, true); assert.equal(sample.viewportOverflow.owner.tag, 'body')
  const body = sample.fields[0].ancestors.find(item => item.tag === 'body')
  assert.equal(body.computed.overflowY, 'auto'); assert.equal(body.rect.top, -420)
  assert.equal(body.appliedClipY, false); assert.equal(body.viewportOverflow, true)
  assert.deepEqual(sample.fields.map(item => [item.top, item.bottom]), [[82.5, 122.5], [157.6875, 197.6875], [207.6875, 247.6875]])
})

test('serialized toolbar observation applies root overflow to the viewport rather than its scrolled box', () => {
  const page = serializedToolbarPage()
  Object.assign(page.html.css, { overflowX: 'auto', overflowY: 'auto' })
  Object.assign(page.body.css, { overflowX: 'visible', overflowY: 'visible' })
  const sample = page.observe()
  verifyToolbarSnapshot(sample, { viewport: { width: 704, height: 455 }, theme: 'light' })
  assert.equal(sample.viewportOverflow.bodyPropagated, false); assert.equal(sample.viewportOverflow.owner.tag, 'html')
  const html = sample.fields[0].ancestors.find(item => item.tag === 'html')
  assert.equal(html.appliedClipY, false); assert.ok(html.rect.bottom < sample.fields[0].top)
})

test('serialized toolbar observation keeps non-propagated or contained body overflow as its own clip', () => {
  for (const change of [page => { page.html.css.overflowX = 'auto'; page.html.css.overflowY = 'hidden' }, page => { page.html.css.contain = 'layout' },
    page => { page.body.css.contain = 'paint' }, page => { page.html.css.contentVisibility = 'auto' },
    page => { page.body.css.contentVisibility = 'hidden' }, page => { delete page.html.css.contentVisibility },
    page => { delete page.body.css.contain }]) {
    const page = serializedToolbarPage(); change(page)
    const sample = page.observe()
    assert.equal(sample.fields[0].inViewport, false)
    assert.throws(() => verifyToolbarSnapshot(sample, { viewport: { width: 704, height: 455 }, theme: 'light' }), /inViewport/)
  }
})

test('serialized toolbar observation preserves real nested client clipping including scrollbar and border insets', () => {
  for (const change of [page => { page.wrapper.css.overflowX = 'auto'; page.wrapper.css.overflowY = 'auto'; page.wrapper.clientWidth = 650 },
    page => { page.wrapper.css.overflowX = 'hidden'; page.wrapper.css.overflowY = 'auto'; page.wrapper.clientLeft = 24; page.wrapper.clientWidth = 660 },
    page => { page.wrapper.css.overflowX = 'auto'; page.wrapper.css.overflowY = 'auto'; page.wrapper.clientHeight = 200 }]) {
    const page = serializedToolbarPage()
    page.body.rect = page.rectangle(0, 0, 696, 455)
    page.wrapper.rect = page.rectangle(0, 0, 696, 455); page.wrapper.clientWidth = 696; page.wrapper.clientHeight = 455
    change(page); const sample = page.observe()
    assert.equal(sample.fields.every(item => item.inViewport), false)
    assert.throws(() => verifyToolbarSnapshot(sample, { viewport: { width: 704, height: 455 }, theme: 'light' }), /inViewport/)
    const nested = sample.fields[2].ancestors.find(item => item.id === 'root')
    assert.ok(nested.appliedClipX || nested.appliedClipY)
  }
})

test('serialized toolbar observation still requires viewport client bounds, ancestor visibility and actual hits', () => {
  for (const change of [page => { page.html.clientWidth = 660 }, page => { page.wrapper.css.opacity = '0' },
    page => { page.html.css.display = 'none' }, page => { page.forceHit = null }]) {
    const page = serializedToolbarPage(); change(page)
    assert.throws(() => verifyToolbarSnapshot(page.observe(), { viewport: { width: 704, height: 455 }, theme: 'light' }))
  }
})
