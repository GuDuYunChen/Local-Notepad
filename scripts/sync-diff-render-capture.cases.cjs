const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { deflateSync } = require('node:zlib')
const { EventEmitter } = require('node:events')
const { JSDOM } = require('jsdom')
const { diffCSSReferences, validateCSSReferences, createDiffCaptureGate, verifyDiffRaster, verifyDiffCSSRaster,
  validateDiffCapture, captureDiffFrame, loadDiffWindow } = require('./sync-diff-render-capture.cjs')
const { createDiffFrameGate } = require('./sync-diff-render-frame.cjs')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function readArchivedDiffFiles(directory) {
  const provenance = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'))
  const files = {}
  for (const [filename, expected] of Object.entries(provenance.files)) {
    files[filename] = fs.readFileSync(path.join(directory, filename))
    assert.equal(files[filename].length, expected.bytes); assert.equal(hash(files[filename]), expected.sha256)
  }
  return files
}

// Exercise Git's actual checkout conversion in an owned, uncommitted repository.
// Neither the caller's repository/index/config nor the archived bytes are edited.
function archivedDiffCheckout(autocrlf, keepAttributes, inspect, fixtureName = 'sync-diff-capture-4a16a9a') {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-archive-checkout-'))
  try {
    const repository = path.join(scratch, 'repository'), checkout = path.join(scratch, 'checkout')
    const relative = 'scripts/fixtures/' + fixtureName
    const source = path.join(__dirname, 'fixtures', fixtureName)
    const provenance = JSON.parse(fs.readFileSync(path.join(source, 'provenance.json'), 'utf8'))
    const destination = path.join(repository, relative), emptyConfig = path.join(scratch, 'empty-config')
    fs.mkdirSync(destination, { recursive: true }); fs.mkdirSync(checkout); fs.writeFileSync(emptyConfig, '')
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig })
    const git = args => {
      const result = spawnSync('git', ['-c', 'core.attributesFile=' + emptyConfig, '-C', repository, ...args],
        { env, timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true })
      assert.ifError(result.error); assert.equal(result.signal, null)
      assert.equal(result.status, 0, 'Isolated Git command failed: ' + result.stderr.toString())
      return result.stdout
    }
    git(['init', '--quiet'])
    for (const filename of [...Object.keys(provenance.files), 'provenance.json']) {
      fs.copyFileSync(path.join(source, filename), path.join(destination, filename))
    }
    const attributes = path.join(source, '.gitattributes')
    const attributesCopied = keepAttributes && fs.existsSync(attributes)
    if (attributesCopied) fs.copyFileSync(attributes, path.join(destination, '.gitattributes'))
    fs.writeFileSync(path.join(repository, 'outside-evidence.txt'), 'unrelated\ntext\n')
    git(['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'add', '--', '.'])
    const objects = Object.entries(provenance.files).map(([filename, expected]) => {
      const object = git(['cat-file', 'blob', ':' + relative + '/' + filename])
      assert.equal(object.length, expected.bytes); assert.equal(hash(object), expected.sha256)
      assert.deepEqual(object, fs.readFileSync(path.join(source, filename)))
      return { filename, gitBlob: createHash('sha1').update('blob ' + object.length + '\0').update(object).digest('hex') }
    })
    git(['-c', 'core.autocrlf=' + autocrlf, '-c', 'core.eol=' + (autocrlf ? 'crlf' : 'lf'),
      'checkout-index', '--all', '--force', '--prefix=' + checkout.split(path.sep).join('/') + '/'])
    const directory = path.join(checkout, relative)
    const files = objects.map(object => {
      const bytes = fs.readFileSync(path.join(directory, object.filename))
      return { ...object, checkoutBytes: bytes.length, checkoutSHA256: hash(bytes) }
    })
    assert.equal(fs.readFileSync(path.join(checkout, 'outside-evidence.txt'), 'utf8'), autocrlf ? 'unrelated\r\ntext\r\n' : 'unrelated\ntext\n')
    const textAttribute = git(['check-attr', 'text', '--', relative + '/checks.json']).toString().trim()
    inspect(directory, { autocrlf, attributesRequested: keepAttributes, attributesCopied, textAttribute,
      files, unrelatedTextConversionPreserved: true })
  } finally { fs.rmSync(scratch, { recursive: true, force: true }) }
}

// Structural/pixel contract fixture only; this is not a Chromium-render claim.
function syntheticPNG(frame, phase, corruptProbe = false, changes = {}) {
  const { width, height } = frame.viewport, stride = width * 4 + 1, raw = Buffer.alloc(stride * height)
  const pixel = (x, y, rgb) => { const offset = y * stride + 1 + x * 4; raw.set(rgb.length === 4 ? rgb : [...rgb, 255], offset) }
  for (const probe of frame.rasterProbes) pixel(probe.x, probe.y, corruptProbe ? [255, 255, 255] :
    changes.rowColors?.[probe.kind] || frame.colors.find(color => color.kind === probe.kind).background)
  for (const reference of frame.cssReferences?.references || []) pixel(reference.x, reference.y,
    changes.referenceColors?.[reference.kind] || frame.colors.find(color => color.kind === reference.kind).background)
  for (let bit = 0; bit < 8; bit++) for (let y = 0; y < 4; y++) for (let x = bit * 4; x < bit * 4 + 4; x++) pixel(x, y, (phase >>> bit) & 1 ? [221, 238, 255] : [17, 34, 51])
  for (const change of changes.pixels || []) pixel(change.x, change.y, change.rgba)
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
  const chunk = (type, bytes) => { const body = Buffer.concat([Buffer.from(type), bytes]), result = Buffer.alloc(bytes.length + 12); result.writeUInt32BE(bytes.length); body.copy(result, 4); result.writeUInt32BE(crc(body), result.length - 4); return result }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const referencePaint = (backgroundColor, position = 'absolute') => ({ backgroundColor, backgroundImage: 'none', opacity: '1',
  filter: 'none', transform: 'none', mixBlendMode: 'normal', visibility: 'visible', display: 'block', position, pointerEvents: 'auto',
  boxShadow: 'none', borderRadius: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
  transitionDuration: '0s', animationName: 'none' })
function syntheticReferences(frame) {
  return { schema: 'diff-css-reference-v1', source: 'root-semantic-tokens-and-cell-ancestor-backgrounds', phase: frame.capturePhase,
    theme: frame.theme, generation: 1, rootID: 'diff-css-references', rootBounds: { left: 40, top: 8, right: 80, bottom: 24 },
    rootStyle: referencePaint('rgba(0, 0, 0, 0)', 'fixed'), rootZIndex: '2147483646', identityValid: true, sourceStable: true,
    references: ['local', 'remote'].map((kind, index) => {
      const token = kind === 'local' ? '--danger-light' : '--success-light'
      const fill = 'rgb(' + frame.colors.find(color => color.kind === kind).background.join(', ') + ')'
      const bounds = { left: 40 + index * 24, top: 8, right: 56 + index * 24, bottom: 24 }
      const backgrounds = [{ path: 'html', tag: 'HTML', background: 'rgba(0, 0, 0, 0)' },
        { path: 'html>body:nth-child(2)', tag: 'BODY', background: 'rgb(255, 255, 255)' },
        { path: 'html>body:nth-child(2)>table:nth-child(1)>tbody:nth-child(1)>tr:nth-child(' + (index + 1) + ')', tag: 'TR', background: 'rgba(0, 0, 0, 0)' }]
      const layers = [{ source: 'opaque-white', background: 'rgb(255, 255, 255)' },
        ...backgrounds.map(layer => ({ source: layer.path, background: layer.background })), { source: 'root-token:' + token, background: fill }]
      return { kind, selector: '.sync-diff-' + kind + ' td:last-child', token, tokenOwner: 'document.documentElement',
        tokenValue: fill, paperValue: 'rgb(255, 255, 255)', selectedToken: token, fill, backgrounds,
        x: bounds.left + 8, y: 16, bounds, blockers: [], sourceIdentityValid: true, exposed: true,
        layers: layers.map(layer => ({ source: layer.source, kind, phase: frame.capturePhase, identityValid: true,
          specifiedBackground: layer.background, style: referencePaint(layer.background), bounds: { ...bounds } })) }
    }) }
}

// Real DOM/style preparation in an isolated JS realm. Geometry and hit testing
// are explicit Node fixtures, not a claim that JSDOM rendered a Chromium PNG.
function referenceDOM() {
  const dom = new JSDOM('<!doctype html><html data-theme="light"><head></head><body><main><table><tbody>' +
    '<tr class="sync-diff-local"><td><pre>local</pre></td></tr><tr class="sync-diff-remote"><td><pre>remote</pre></td></tr>' +
    '</tbody></table></main></body></html>', { runScripts: 'outside-only' })
  const { window } = dom, { document } = window
  const style = document.documentElement.style
  style.setProperty('--danger-light', 'rgba(200, 90, 90, 0.1)'); style.setProperty('--success-light', '#17382a'); style.setProperty('--paper', '#f6f6f8')
  document.body.style.backgroundColor = '#ffffff'; document.querySelector('main').style.backgroundColor = '#f6f6f8'
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'diff-css-references' || this.closest('#diff-css-references')) {
      let left = 0, top = 0
      for (let node = this; node; node = node.parentElement) { left += Number.parseFloat(node.style.left) || 0; top += Number.parseFloat(node.style.top) || 0 }
      return { left, top, right: left + Number.parseFloat(this.style.width), bottom: top + Number.parseFloat(this.style.height) }
    }
    return { left: 0, top: 0, right: 0, bottom: 0 }
  }
  document.elementFromPoint = (x, y) => [...document.querySelectorAll('#diff-css-references div')].reverse().find(node => {
    const rect = node.getBoundingClientRect(); return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
  }) || null
  const invoke = (action, phase = 1) => JSON.parse(JSON.stringify(window.eval('(' + diffCSSReferences.toString() + ')(' + JSON.stringify(action) + ',' + phase + ')')))
  return { window, document, invoke, close: () => window.close() }
}

// Replay ONLY the observed Windows transition-duration cascade. JSDOM drops
// this longhand's !important priority and does not render media queries/PNGs;
// its computed style cannot prove Chromium behavior. Keep real DOM preparation,
// record the inline declarations, and select between the actual product rule
// and the archived computed value. Other properties use the existing fixture.
function reducedMotionReplay() {
  const dom = referenceDOM(), declarations = new WeakMap()
  const css = fs.readFileSync(path.join(__dirname, '../src/styles/redesign.css'), 'utf8')
  const rule = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{([^}]+)\}/.exec(css)
  assert.ok(rule, 'The actual universal reduced-motion rule is required by this replay')
  const duration = /transition-duration:\s*([\d.]+)ms\s*!important\s*;/.exec(rule[1])
  assert.ok(duration, 'The production transition-duration rule must retain its important priority')
  const files = readArchivedDiffFiles(path.join(__dirname, 'fixtures/sync-diff-capture-b65a489'))
  const archivedDuration = JSON.parse(files['checks.json']).reports[0].cssReferences.rootStyle.transitionDuration
  assert.equal(Number(archivedDuration.slice(0, -1)), Number(duration[1]) / 1000)
  const createElement = dom.document.createElement.bind(dom.document)
  dom.document.createElement = (...args) => {
    const node = createElement(...args), setProperty = node.style?.setProperty.bind(node.style)
    if (setProperty) node.style.setProperty = (name, value, priority) => {
      if (name === 'transition-duration') declarations.set(node.style, { value, priority })
      return setProperty(name, value, priority)
    }
    return node
  }
  let reduced = false
  const computed = dom.window.getComputedStyle.bind(dom.window)
  dom.window.getComputedStyle = node => {
    const style = computed(node)
    if (!reduced || !(node.id === 'diff-css-references' || node.closest('#diff-css-references'))) return style
    const inline = declarations.get(node.style)
    return new Proxy(style, { get: (target, key) => key === 'transitionDuration'
      ? inline?.priority === 'important' ? inline.value : archivedDuration : Reflect.get(target, key, target) })
  }
  return { ...dom, setReduced: value => { reduced = value }, archivedDuration }
}

function registerDiffCaptureTests(test, originalFrame) {
  const frame = (phase = 1) => {
    const value = { ...originalFrame(), theme: phase === 1 ? 'light' : 'dark', capturePhase: phase, visibility: 'visible', windowVisible: true,
    scroll: { x: 0, y: 400, tableLeft: 0, tableTop: 0 }, tableText: '本机行 远端行 对照文本 仅本机 仅远端',
    rasterProbes: ['local', 'remote'].flatMap((kind, index) => [
      { kind, position: 'left', x: 60, y: 240 + index * 60, exposed: true },
      { kind, position: 'right', x: 480, y: 240 + index * 60, exposed: true },
    ]) }
    value.cssReferences = syntheticReferences(value); return value
  }
  test('archived diff evidence survives both Git checkout newline policies without changing unrelated text', t => {
    for (const autocrlf of [false, true]) archivedDiffCheckout(autocrlf, true, (directory, evidence) => {
      t.diagnostic(JSON.stringify(evidence))
      readArchivedDiffFiles(directory)
    })
  })
  test('the original archived-byte gate refuses the exact CRLF checkout counterexample', t => {
    archivedDiffCheckout(true, false, (directory, evidence) => {
      t.diagnostic(JSON.stringify(evidence))
      const original = fs.readFileSync(path.join(__dirname, 'fixtures', 'sync-diff-capture-4a16a9a', 'checks.json'))
      const converted = fs.readFileSync(path.join(directory, 'checks.json'))
      assert.equal(original.length, 29143)
      assert.equal(converted.length, 30517)
      assert.deepEqual(converted, Buffer.from(original.toString('utf8').replace(/\n/g, '\r\n')))
      assert.equal(hash(converted), '5161cda1528db6d6d56c975404379525129713e5094ecd554ce2ca61a476cbfa')
      assert.throws(() => readArchivedDiffFiles(directory), { code: 'ERR_ASSERTION', actual: 30517, expected: 29143 })
      for (const filename of ['light-1200.png', 'dark-1200.png']) {
        assert.deepEqual(fs.readFileSync(path.join(directory, filename)),
          fs.readFileSync(path.join(__dirname, 'fixtures', 'sync-diff-capture-4a16a9a', filename)))
      }
    })
  })
  test('the same pixel gate rejects the exact archived unscrolled light PNG and accepts its scrolled dark control', () => {
    const directory = path.join(__dirname, 'fixtures', 'sync-diff-capture-4a16a9a')
    const provenance = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'))
    const files = {}
    for (const [filename, expected] of Object.entries(provenance.files)) {
      files[filename] = fs.readFileSync(path.join(directory, filename))
      assert.equal(files[filename].length, expected.bytes); assert.equal(hash(files[filename]), expected.sha256)
    }
    const reports = JSON.parse(files['checks.json']).reports
    const light = reports.find(report => report.name === 'light-1200'), dark = reports.find(report => report.name === 'dark-1200')
    assert.deepEqual(light.bounds, dark.bounds); assert.equal(light.visible, true); assert.equal(light.stableSamples, 3)
    // Audit-selected paired coordinates are explicit fixture preconditions, not
    // invented fields in the historical DOM reports (see provenance.json).
    assert.throws(() => verifyDiffRaster(files['light-1200.png'], { ...light, rasterProbes: provenance.comparisonProbes }), /Saved PNG does not contain the measured local row/)
    assert.equal(verifyDiffRaster(files['dark-1200.png'], { ...dark, rasterProbes: provenance.comparisonProbes }).probes.length, 4)
  })
  test('the original exact Canvas assertion still rejects the unchanged bed Windows PNG by its observed blue channel', () => {
    const directory = path.join(__dirname, 'fixtures', 'sync-diff-capture-bed26f7'), files = readArchivedDiffFiles(directory)
    const report = JSON.parse(files['checks.json'])
    assert.equal(report.commit, 'bed26f73d02e3feebcb14d56488cceb40bafe240'); assert.equal(report.complete, false)
    const { before, after } = report.reports[0].capture
    assert.deepEqual(before, after); assert.equal(before.capturePhase, 1); assert.equal(before.theme, 'light')
    assert.throws(() => verifyDiffRaster(files['light-1200.png'], before), error => {
      assert.deepEqual(error.actual, [242, 230, 232, 255]); assert.deepEqual(error.expected, [242, 230, 231, 255])
      assert.match(error.message, /Saved PNG does not contain the measured local row/); return true
    })
    assert.throws(() => validateDiffCapture(before, after, files['light-1200.png'], 1), /require independent CSS references/)
  })
  test('the new exact bed archive survives LF and CRLF checkouts and rejects conversion without its own attribute', t => {
    for (const autocrlf of [false, true]) archivedDiffCheckout(autocrlf, true, (directory, evidence) => {
      t.diagnostic(JSON.stringify(evidence)); readArchivedDiffFiles(directory)
    }, 'sync-diff-capture-bed26f7')
    archivedDiffCheckout(true, false, (directory, evidence) => {
      t.diagnostic(JSON.stringify(evidence))
      assert.throws(() => readArchivedDiffFiles(directory))
      assert.deepEqual(fs.readFileSync(path.join(directory, 'light-1200.png')),
        fs.readFileSync(path.join(__dirname, 'fixtures/sync-diff-capture-bed26f7/light-1200.png')))
    }, 'sync-diff-capture-bed26f7')
  })
  test('the unchanged b65 Windows frame retains its exact reduced-motion rejection and failed capture', () => {
    const files = readArchivedDiffFiles(path.join(__dirname, 'fixtures/sync-diff-capture-b65a489'))
    const report = JSON.parse(files['checks.json']), observed = report.reports[0]
    assert.equal(report.commit, 'b65a489cd625e2793c01c64e9c9b014341099c64'); assert.equal(report.complete, false)
    assert.equal(observed.stableSamples, 0); assert.equal(observed.capture.complete, false)
    assert.equal(observed.capture.before, null); assert.equal(observed.capture.after, null)
    assert.match(observed.capture.error, /Three original stable frames are required/)
    const original = createDiffFrameGate(), capture = createDiffCaptureGate()
    for (let samples = 1; samples <= 3; samples++) {
      // Repetitions of one archived frame test predicates, not historical stability.
      assert.deepEqual(original.observe(observed), { ready: samples === 3, samples })
      assert.deepEqual(capture.observe(observed), { ready: false, samples: 0 })
    }
    const styles = [observed.cssReferences.rootStyle, ...observed.cssReferences.references.flatMap(entry => entry.layers.map(layer => layer.style))]
    assert.equal(styles.length, 29); assert.ok(styles.every(style => style.transitionDuration === '1e-05s'))
    assert.throws(() => validateCSSReferences(observed), error => {
      assert.equal(error.actual.transitionDuration, '1e-05s'); assert.equal(error.expected.transitionDuration, '0s')
      assert.deepEqual({ ...error.actual, transitionDuration: '0s' }, error.expected); return true
    })
    assert.throws(() => verifyDiffCSSRaster(files['light-1200.png'], observed), /CSS reference paint style changed/)
    assert.equal(verifyRasterWitness(files['light-1200.png'], 1), true)
    assert.throws(() => verifyRasterWitness(files['light-1200.png'], 2), /raster phase marker/)
  })
  test('the b65 archive keeps original bytes under LF and CRLF and rejects a checkout without its own attribute', t => {
    for (const autocrlf of [false, true]) archivedDiffCheckout(autocrlf, true, (directory, evidence) => {
      t.diagnostic(JSON.stringify(evidence)); readArchivedDiffFiles(directory)
    }, 'sync-diff-capture-b65a489')
    archivedDiffCheckout(true, false, (directory, evidence) => {
      t.diagnostic(JSON.stringify(evidence)); assert.throws(() => readArchivedDiffFiles(directory))
      assert.deepEqual(fs.readFileSync(path.join(directory, 'light-1200.png')),
        fs.readFileSync(path.join(__dirname, 'fixtures/sync-diff-capture-b65a489/light-1200.png')))
    }, 'sync-diff-capture-b65a489')
  })
  test('serialized references retain exact zero-duration paint in every phase of the archived reduced-motion cascade replay', () => {
    const dom = reducedMotionReplay()
    try {
      const product = [...dom.document.querySelectorAll('html,body,main,table,tr,td,pre')]
      const productStyles = product.map(node => node.getAttribute('style'))
      const productText = dom.document.querySelector('table').textContent
      for (const reduced of [false, true]) for (const phase of [1, 2, 3, 4]) {
        dom.setReduced(reduced); dom.document.documentElement.dataset.theme = phase === 1 ? 'light' : 'dark'
        const references = dom.invoke('prepare', phase), observed = { ...frame(phase), cssReferences: references }
        observed.viewport.width = phase <= 2 ? 1200 : 560
        validateCSSReferences(observed)
        const gate = createDiffCaptureGate()
        for (let samples = 1; samples <= 3; samples++) assert.deepEqual(gate.observe(observed), { ready: samples === 3, samples })
        assert.deepEqual(dom.invoke('inspect', phase), references)
        assert.equal(dom.document.querySelector('#diff-css-references').getAttribute('aria-hidden'), 'true')
      }
      assert.deepEqual(product.map(node => node.getAttribute('style')), productStyles)
      assert.equal(dom.document.querySelector('table').textContent, productText)
    } finally { dom.close() }
  })
  test('removing inline priority restores the archived reduced-motion rejection and requires three fresh stable frames', () => {
    const dom = reducedMotionReplay()
    try {
      dom.setReduced(true); dom.invoke('prepare')
      const observed = () => ({ ...frame(), cssReferences: dom.invoke('inspect') }), gate = createDiffCaptureGate()
      for (let samples = 1; samples <= 3; samples++) assert.deepEqual(gate.observe(observed()), { ready: samples === 3, samples })
      for (const selector of ['#diff-css-references', '[data-kind="local"]', '[data-kind="remote"]']) {
        const node = dom.document.querySelector(selector)
        node.style.setProperty('transition-duration', '0s', '')
        assert.equal(dom.window.getComputedStyle(node).transitionDuration, dom.archivedDuration)
        assert.throws(() => validateCSSReferences(observed()), /CSS reference paint style changed/)
        assert.deepEqual(gate.observe(observed()), { ready: false, samples: 0 })
        node.style.setProperty('transition-duration', '0s', 'important')
        for (let samples = 1; samples <= 3; samples++) assert.deepEqual(gate.observe(observed()), { ready: samples === 3, samples })
      }
    } finally { dom.close() }
  })
  test('serialized CSS preparation uses independent root tokens and ancestor layers without a Node closure', () => {
    const dom = referenceDOM()
    try {
      const before = dom.invoke('prepare'); validateCSSReferences({ ...frame(), cssReferences: before })
      const local = before.references[0]
      assert.equal(local.tokenValue, 'rgba(200, 90, 90, 0.1)'); assert.equal(local.fill, 'rgba(200, 90, 90, 0.1)')
      assert.ok(local.backgrounds.some(layer => layer.background === 'rgb(246, 246, 248)'))
      for (const cell of dom.document.querySelectorAll('td,pre')) cell.style.backgroundColor = '#010203'
      const after = dom.invoke('prepare')
      assert.deepEqual(after, before, 'The independent reference copied an actual td/pre fill')
      assert.equal(dom.document.querySelectorAll('#diff-css-references').length, 1)
      assert.equal(dom.document.querySelectorAll('canvas').length, 0)
      assert.deepEqual(dom.invoke('inspect'), after, 'Inspection changed the prepared reference')
    } finally { dom.close() }
  })
  test('root fallback tokens are resolved independently and invalid colors cannot create a reference', () => {
    const dom = referenceDOM()
    try {
      dom.document.documentElement.style.removeProperty('--success-light')
      const prepared = dom.invoke('prepare'); validateCSSReferences({ ...frame(), cssReferences: prepared })
      assert.equal(prepared.references[1].selectedToken, '--paper'); assert.equal(prepared.references[1].fill, 'rgb(246, 246, 248)')
      dom.document.documentElement.style.setProperty('--danger-light', 'unresolved-color')
      assert.throws(() => dom.invoke('prepare'), /resolved root color token/)
    } finally { dom.close() }
  })
  test('source changes are rejected during inspection and refreshed only before three new stable frames', () => {
    const dom = referenceDOM()
    try {
      const gate = createDiffCaptureGate(), observed = () => ({ ...frame(), cssReferences: dom.invoke('inspect') })
      dom.invoke('prepare')
      for (let i = 1; i <= 3; i++) assert.equal(gate.observe(observed()).ready, i === 3)
      dom.document.querySelector('main').style.backgroundColor = '#f5f5f5'
      assert.equal(dom.invoke('inspect').sourceStable, false)
      assert.deepEqual(gate.observe(observed()), { ready: false, samples: 0 })
      assert.throws(() => validateCSSReferences(observed()))
      const prepared = dom.invoke('prepare'); assert.equal(prepared.generation, 2)
      for (let i = 1; i <= 3; i++) assert.deepEqual(gate.observe(observed()), { ready: i === 3, samples: i })
      assert.equal(dom.invoke('prepare').generation, 2, 'An unchanged source unnecessarily restarted stabilization')
    } finally { dom.close() }
  })
  test('replacing a source node with identical CSS cannot reuse its original reference identity', () => {
    const dom = referenceDOM()
    try {
      dom.invoke('prepare')
      const cell = dom.document.querySelector('.sync-diff-local td'); cell.replaceWith(cell.cloneNode(true))
      const inspected = dom.invoke('inspect'); assert.equal(inspected.references[0].sourceIdentityValid, false)
      assert.throws(() => validateCSSReferences({ ...frame(), cssReferences: inspected }))
      const refreshed = dom.invoke('prepare'); assert.equal(refreshed.generation, 2)
      validateCSSReferences({ ...frame(), cssReferences: refreshed })
    } finally { dom.close() }
  })
  test('real DOM reference style changes and pointer-transparent painted occluders cannot pass exposure', () => {
    for (const change of [dom => { dom.document.querySelector('#diff-css-references div').style.backgroundColor = '#123456' },
      dom => { dom.document.querySelector('#diff-css-references').remove() },
      dom => {
        const overlay = dom.document.createElement('div'); overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;visibility:visible;display:block'
        overlay.getBoundingClientRect = () => ({ left: 40, top: 8, right: 56, bottom: 24 }); dom.document.body.append(overlay)
      }]) {
      const dom = referenceDOM()
      try {
        dom.invoke('prepare'); change(dom)
        assert.throws(() => validateCSSReferences({ ...frame(), cssReferences: dom.invoke('inspect') }))
      } finally { dom.close() }
    }
  })
  test('reference provenance, kind, phase, styles, geometry, opaque base and exposure are mandatory', () => {
    const changes = [value => { delete value.cssReferences }, value => { value.cssReferences.schema = 'legacy' },
      value => { value.cssReferences.source = 'observed-cell-fill' }, value => { value.cssReferences.identityValid = false },
      value => { value.cssReferences.sourceStable = false }, value => { value.cssReferences.generation = 0 },
      value => { value.cssReferences.references.reverse() }, value => { value.cssReferences.references.pop() },
      value => { value.cssReferences.references[0].selector = '.sync-diff-remote td:last-child' },
      value => { value.cssReferences.references[0].tokenOwner = 'actual-cell' },
      value => { value.cssReferences.references[0].tokenValue = '#010203' },
      value => { value.cssReferences.references[0].backgrounds.at(-1).tag = 'TD' },
      value => { value.cssReferences.references[0].layers.at(-1).source = 'actual-cell-fill' },
      value => { value.cssReferences.references[0].layers[0].style.backgroundColor = 'rgba(255, 255, 255, 0)' },
      value => { value.cssReferences.references[0].layers[0].style.opacity = '0.5' },
      value => { value.cssReferences.references[0].layers[0].specifiedBackground = 'rgb(0, 0, 0)' },
      value => { value.cssReferences.references[0].layers[0].identityValid = false },
      value => { value.cssReferences.references[0].layers[0].phase = 2 },
      value => { value.cssReferences.references[0].sourceIdentityValid = false },
      value => { value.cssReferences.references[0].exposed = false }, value => { value.cssReferences.references[0].blockers.push('overlay') },
      value => { value.cssReferences.references[0].x++ }, value => { value.cssReferences.references[0].bounds.left++ },
      value => { value.cssReferences.rootBounds.left++ }, value => { value.cssReferences.rootStyle.transform = 'matrix(1,0,0,1,0,1)' },
      value => { value.cssReferences.rootZIndex = '0' }]
    for (const change of changes) {
      const before = frame(), png = syntheticPNG(before, 1); change(before)
      assert.throws(() => validateDiffCapture(before, before, png, 1))
    }
  })
  test('equal colors cannot substitute a wrong reference theme or phase', () => {
    for (const change of [value => { value.cssReferences.phase = 2 }, value => { value.cssReferences.theme = 'dark' },
      value => { value.theme = value.cssReferences.theme = 'dark' }]) {
      const before = frame(), png = syntheticPNG(before, 1); change(before)
      assert.throws(() => validateDiffCapture(before, before, png, 1))
    }
  })
  test('all four row RGBA probes use exact same-image CSS references even when Canvas predicts another value', () => {
    const before = frame(), canvasRGB = [242, 230, 231], cssRGBA = [242, 230, 232, 255]
    for (const color of before.colors) if (color.kind === 'local') color.background = canvasRGB
    const local = before.cssReferences.references[0]
    local.tokenValue = local.fill = 'rgba(200, 90, 90, 0.1)'
    local.backgrounds[1].background = 'rgb(246, 246, 248)'
    local.layers[2].specifiedBackground = local.backgrounds[1].background
    local.layers[2].style = referencePaint(local.backgrounds[1].background)
    local.layers.at(-1).specifiedBackground = local.fill; local.layers.at(-1).style = referencePaint(local.fill)
    // Synthetic pixels exercise the new contract, not a replacement or edit of
    // the archived failed Windows PNG, which has no CSS references at all.
    const changes = { rowColors: { local: cssRGBA }, referenceColors: { local: cssRGBA } }
    const png = syntheticPNG(before, 1, false, changes)
    assert.throws(() => verifyDiffRaster(png, before), /Saved PNG does not contain/)
    const result = validateDiffCapture(before, before, png, 1)
    assert.equal(result.referenceSchema, 'diff-css-reference-v1'); assert.equal(result.probes.length, 4)
    for (const probe of result.probes.filter(probe => probe.kind === 'local')) assert.deepEqual(probe.rgba, cssRGBA)
    for (const probe of before.rasterProbes) for (let channel = 0; channel < 4; channel++) {
      const rgba = probe.kind === 'local' ? [...cssRGBA] : [...before.colors.find(color => color.kind === probe.kind).background, 255]
      rgba[channel] += rgba[channel] === 255 ? -1 : 1
      assert.throws(() => verifyDiffCSSRaster(syntheticPNG(before, 1, false, { ...changes, pixels: [{ ...probe, rgba }] }), before), /does not match the independent CSS/)
    }
    const reference = before.cssReferences.references[0]
    assert.throws(() => verifyDiffCSSRaster(syntheticPNG(before, 1, false, { ...changes, pixels: [{ ...reference, rgba: [242, 230, 231, 255] }] }), before), /does not match the independent CSS/)
  })
  test('reference-only changes restart the original three-frame gate and are retained as failed captures', async () => {
    for (const change of [value => { value.cssReferences.generation++ }, value => { value.cssReferences.references[0].tokenValue = '#17382a' }]) {
      const gate = createDiffCaptureGate(), before = frame()
      for (let i = 0; i < 3; i++) gate.observe(before)
      const changed = structuredClone(before); change(changed)
      assert.equal(gate.observe(changed).ready, false)
      const shared = frame(), png = syntheticPNG(shared, 1)
      const result = await captureDiffFrame({ stableFrame: shared, stableSamples: 3, phase: 1,
        inspect: async () => shared, capture: async () => { change(shared); return png } })
      assert.equal(result.complete, false); assert.equal(result.png, png); assert.equal(result.receipt, undefined)
      assert.deepEqual(result.before, before); assert.match(result.error, /changed during PNG capture/)
    }
  })
  test('capture approval binds unchanged observations, viewport pixels and the current raster phase', () => {
    const before = frame(), after = structuredClone(before), png = syntheticPNG(before, 1)
    const copy = structuredClone(before), result = validateDiffCapture(before, after, png, 1)
    assert.equal(result.complete, true); assert.equal(result.beforeAfterEqual, true); assert.equal(result.rasterPhaseVerified, true)
    assert.equal(result.sha256, hash(png)); assert.deepEqual(before, copy); assert.deepEqual(after, copy)
  })
  test('a stale navigation image with the same semantic row colors is rejected by its raster phase', () => {
    const before = frame(2)
    assert.throws(() => validateDiffCapture(before, before, syntheticPNG(before, 1), 2), /raster phase marker/)
  })
  test('missing, offscreen or occluded semantic probes and wrong pixels cannot approve a PNG', () => {
    for (const change of [value => value.rasterProbes.pop(), value => { value.rasterProbes[0].exposed = false },
      value => { value.rasterProbes[0].x = 0 }, value => { value.rasterProbes[0].y = 901 }]) {
      const before = frame(), png = syntheticPNG(before, 1); change(before)
      assert.throws(() => verifyDiffRaster(png, before))
    }
    const before = frame()
    assert.throws(() => verifyDiffRaster(syntheticPNG(before, 1, true), before), /Saved PNG does not contain/)
  })
  test('truncated PNGs and captured dimensions that disagree with the observed viewport are refused', () => {
    const before = frame(), png = syntheticPNG(before, 1)
    for (const bad of [png.subarray(0, 20), png.subarray(0, png.length - 8), Buffer.from('not a png')]) assert.throws(() => verifyDiffRaster(bad, before))
    assert.throws(() => verifyDiffRaster(syntheticPNG({ ...before, viewport: { width: 559, height: 900 } }, 1), before), /PNG dimensions/)
  })
  test('every original contrast, geometry and no-write predicate remains required at capture', () => {
    for (const change of [value => { value.colors[0].ratio = 4.4999 }, value => { value.textChecks[0].finalForeground = false },
      value => { value.tableOverflow = 2 }, value => { value.rows = 65 }, value => { value.writes = 1 }, value => { value.activeContent = 1 }]) {
      const before = frame(), png = syntheticPNG(before, 1); change(before)
      assert.throws(() => validateDiffCapture(before, before, png, 1))
    }
  })
  test('the capture transaction measures before and after the actual PNG operation in order', async () => {
    const before = frame(), png = syntheticPNG(before, 1), order = []
    const result = await captureDiffFrame({ stableFrame: before, stableSamples: 3, phase: 1,
      inspect: async () => { order.push('observe'); return before }, capture: async () => { order.push('capture'); return png } })
    assert.deepEqual(order, ['observe', 'capture', 'observe']); assert.equal(result.complete, true); assert.equal(result.png, png)
  })
  test('capture cannot reuse a changed pre-capture observation or fewer than the original three stable frames', async () => {
    for (const samples of [0, 1, 2]) {
      const result = await captureDiffFrame({ stableFrame: frame(), stableSamples: samples, phase: 1,
        inspect: async () => assert.fail('must not observe'), capture: async () => assert.fail('must not capture') })
      assert.equal(result.complete, false); assert.equal(result.png, null); assert.match(result.error, /Three original stable frames/)
    }
    const before = frame(), moved = structuredClone(before); moved.scroll.y++
    const result = await captureDiffFrame({ stableFrame: before, stableSamples: 3, phase: 1,
      inspect: async () => moved, capture: async () => assert.fail('must not capture a changed settled frame') })
    assert.equal(result.complete, false); assert.equal(result.png, null); assert.match(result.error, /settled frame changed/)
  })
  test('layout, theme, text, scroll, phase and visibility changes during capture retain a failed PNG', async () => {
    for (const change of [value => { value.bounds.top++ }, value => { value.theme = value.theme === 'light' ? 'dark' : 'light' }, value => { value.tableText += ' changed' },
      value => { value.scroll.y++ }, value => { value.rasterProbes[0].x++ }, value => { value.capturePhase++ },
      value => { value.visibility = 'hidden' }, value => { value.windowVisible = false }]) {
      const shared = frame(), png = syntheticPNG(shared, 1)
      const result = await captureDiffFrame({ stableFrame: shared, stableSamples: 3, phase: 1,
        inspect: async () => shared, capture: async () => { change(shared); return png } })
      assert.equal(result.complete, false); assert.equal(result.png, png); assert.ok(result.error)
      assert.deepEqual(result.before, frame(), 'The pre-capture observation was not retained independently')
    }
  })
  test('a post-capture observer failure retains the exact PNG and failure reason without a success receipt', async () => {
    const before = frame(), png = syntheticPNG(before, 1); let observations = 0
    const result = await captureDiffFrame({ stableFrame: before, stableSamples: 3, phase: 1,
      inspect: async () => { if (observations++) throw Error('renderer closed after snapshot'); return before }, capture: async () => png })
    assert.equal(result.complete, false); assert.equal(result.png, png); assert.match(result.error, /renderer closed after snapshot/)
    assert.equal(result.receipt, undefined); assert.equal(result.after, null)
  })
  test('capture failure never fabricates an image or reports completion', async () => {
    const before = frame(), result = await captureDiffFrame({ stableFrame: before, stableSamples: 3, phase: 1,
      inspect: async () => before, capture: async () => { throw Error('capture failed') } })
    assert.equal(result.complete, false); assert.equal(result.png, null); assert.match(result.error, /capture failed/)
  })
  const window = action => {
    const win = new EventEmitter(); win.webContents = new EventEmitter(); win.visible = false
    win.isVisible = () => win.visible; win.isMinimized = () => false; win.showInactive = () => { win.visible = true }
    win.loadFile = () => action(win)
    return win
  }
  const detached = win => {
    assert.equal(win.listenerCount('ready-to-show'), 0); assert.equal(win.listenerCount('closed'), 0)
    assert.equal(win.webContents.listenerCount('render-process-gone'), 0)
  }
  test('paint listeners attach before a fast load and the window is made visible without requesting focus', async () => {
    const win = window(value => { assert.equal(value.listenerCount('ready-to-show'), 1); value.emit('ready-to-show') })
    assert.deepEqual(await loadDiffWindow(win, 'fixture.html'), { firstPaintObserved: true, visible: true, focusedByHarness: false })
    assert.equal(win.visible, true); detached(win)
  })
  test('closed, crashed, load-failed or still hidden windows cannot become capture-ready', async () => {
    for (const action of [win => win.emit('closed'), win => win.webContents.emit('render-process-gone'), () => Promise.reject(Error('load failed')),
      win => { win.showInactive = () => {}; win.emit('ready-to-show') }]) {
      const win = window(action); await assert.rejects(loadDiffWindow(win, 'fixture.html', 100)); detached(win)
    }
  })
  test('both a missing first paint and a load that hangs after first paint have an enforced deadline', async () => {
    for (const action of [() => {}, win => { win.emit('ready-to-show'); return new Promise(() => {}) }]) {
      const win = window(action); await assert.rejects(loadDiffWindow(win, 'fixture.html', 15), /deadline/)
      assert.equal(win.visible, false); detached(win)
    }
  })
}

module.exports = { registerDiffCaptureTests }
