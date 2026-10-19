const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { deflateSync } = require('node:zlib')
const { EventEmitter } = require('node:events')
const { verifyDiffRaster, validateDiffCapture, captureDiffFrame, loadDiffWindow } = require('./sync-diff-render-capture.cjs')
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
function archivedDiffCheckout(autocrlf, keepAttributes, inspect) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-archive-checkout-'))
  try {
    const repository = path.join(scratch, 'repository'), checkout = path.join(scratch, 'checkout')
    const relative = 'scripts/fixtures/sync-diff-capture-4a16a9a'
    const source = path.join(__dirname, 'fixtures', 'sync-diff-capture-4a16a9a')
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
    for (const filename of ['checks.json', 'light-1200.png', 'dark-1200.png', 'provenance.json']) {
      fs.copyFileSync(path.join(source, filename), path.join(destination, filename))
    }
    const attributes = path.join(source, '.gitattributes')
    const attributesCopied = keepAttributes && fs.existsSync(attributes)
    if (attributesCopied) fs.copyFileSync(attributes, path.join(destination, '.gitattributes'))
    fs.writeFileSync(path.join(repository, 'outside-evidence.txt'), 'unrelated\ntext\n')
    git(['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'add', '--', '.'])
    const provenance = JSON.parse(fs.readFileSync(path.join(source, 'provenance.json'), 'utf8'))
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
function syntheticPNG(frame, phase, corruptProbe = false) {
  const { width, height } = frame.viewport, stride = width * 4 + 1, raw = Buffer.alloc(stride * height)
  const pixel = (x, y, rgb) => { const offset = y * stride + 1 + x * 4; raw.set([...rgb, 255], offset) }
  for (const probe of frame.rasterProbes) pixel(probe.x, probe.y, corruptProbe ? [255, 255, 255] : frame.colors.find(color => color.kind === probe.kind).background)
  for (let bit = 0; bit < 8; bit++) for (let y = 0; y < 4; y++) for (let x = bit * 4; x < bit * 4 + 4; x++) pixel(x, y, (phase >>> bit) & 1 ? [221, 238, 255] : [17, 34, 51])
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
  const chunk = (type, bytes) => { const body = Buffer.concat([Buffer.from(type), bytes]), result = Buffer.alloc(bytes.length + 12); result.writeUInt32BE(bytes.length); body.copy(result, 4); result.writeUInt32BE(crc(body), result.length - 4); return result }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function registerDiffCaptureTests(test, originalFrame) {
  const frame = (phase = 1) => ({ ...originalFrame(), theme: 'dark', capturePhase: phase, visibility: 'visible', windowVisible: true,
    scroll: { x: 0, y: 400, tableLeft: 0, tableTop: 0 }, tableText: '本机行 远端行 对照文本 仅本机 仅远端',
    rasterProbes: ['local', 'remote'].flatMap((kind, index) => [
      { kind, position: 'left', x: 60, y: 240 + index * 60, exposed: true },
      { kind, position: 'right', x: 480, y: 240 + index * 60, exposed: true },
    ]) })
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
    for (const change of [value => { value.bounds.top++ }, value => { value.theme = 'light' }, value => { value.tableText += ' changed' },
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
