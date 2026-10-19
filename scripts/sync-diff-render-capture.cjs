// Synthetic renderer evidence only. A settled DOM is not proof that the saved
// compositor image contains that layout. Keep source observations and PNG bytes
// together, and reject a stale image before the collector can claim completion.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { inflateSync } = require('node:zlib')
const { createDiffFrameGate } = require('./sync-diff-render-frame.cjs')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')

const signature = frame => JSON.stringify({ bounds: frame.bounds, viewport: frame.viewport, rows: frame.rows,
  bodyOverflow: frame.bodyOverflow, tableOverflow: frame.tableOverflow, colors: frame.colors, textChecks: frame.textChecks,
  theme: frame.theme, scroll: frame.scroll, tableText: frame.tableText, rasterProbes: frame.rasterProbes,
  capturePhase: frame.capturePhase, visibility: frame.visibility, windowVisible: frame.windowVisible })
const copy = value => structuredClone(value)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

// Bounded, non-interlaced RGB/RGBA PNG decoding for Electron's own PNGs and the
// archived regression images. No external image dependency or application run.
function pngPixels(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 45 && bytes.length <= 16 * 1024 * 1024)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR'); assert.equal(bytes.readUInt32BE(8), 13)
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), type = bytes[25]
  assert.ok(width >= 32 && width <= 4096 && height >= 4 && height <= 4096)
  assert.equal(bytes[24], 8); assert.ok(type === 2 || type === 6)
  assert.equal(bytes[26], 0); assert.equal(bytes[27], 0); assert.equal(bytes[28], 0)
  const compressed = []; let end = false
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(!end && offset + 12 <= bytes.length)
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8)
    assert.ok(length <= bytes.length - offset - 12)
    if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length))
    if (kind === 'IEND') { assert.equal(length, 0); end = true }
    offset += length + 12
  }
  assert.ok(end && compressed.length > 0)
  const bpp = type === 6 ? 4 : 3, stride = width * bpp
  const scanlines = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height })
  assert.equal(scanlines.length, (stride + 1) * height)
  const pixels = Buffer.alloc(stride * height)
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c }
  for (let y = 0; y < height; y++) {
    const filter = scanlines[y * (stride + 1)]; assert.ok(filter <= 4)
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x, left = x >= bpp ? pixels[offset - bpp] : 0
      const above = y ? pixels[offset - stride] : 0, upperLeft = y && x >= bpp ? pixels[offset - stride - bpp] : 0
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft)
      pixels[offset] = (scanlines[y * (stride + 1) + x + 1] + prediction) & 255
    }
  }
  return { width, height, pixel(x, y) {
    assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < width && y >= 0 && y < height)
    const offset = (y * width + x) * bpp
    return [...pixels.subarray(offset, offset + 3), bpp === 4 ? pixels[offset + 3] : 255]
  } }
}

function verifyDiffRaster(bytes, frame) {
  assert.equal(createDiffFrameGate().observe(frame).samples, 1, 'Invalid DOM observation cannot approve a screenshot')
  const image = pngPixels(bytes)
  assert.deepEqual({ width: image.width, height: image.height }, frame.viewport, 'PNG dimensions differ from the observed viewport')
  assert.deepEqual(frame.rasterProbes?.map(probe => [probe.kind, probe.position]),
    [['local', 'left'], ['local', 'right'], ['remote', 'left'], ['remote', 'right']], 'Missing exact semantic pixel probes')
  const probes = frame.rasterProbes.map(probe => {
    assert.equal(probe.exposed, true, 'The semantic pixel probe is covered by another element')
    assert.ok(probe.x > frame.bounds.left && probe.x < frame.bounds.right && probe.y > frame.bounds.top && probe.y < frame.bounds.bottom)
    const color = frame.colors.find(color => color.kind === probe.kind && color.selector === 'pre')
    const actual = image.pixel(probe.x, probe.y)
    assert.deepEqual(actual, [...color.background, 255], 'Saved PNG does not contain the measured ' + probe.kind + ' row at its observed coordinates')
    return { ...probe, rgb: actual.slice(0, 3) }
  })
  return { width: image.width, height: image.height, probes }
}

function validateDiffCapture(before, after, bytes, phase) {
  assert.ok(Number.isInteger(phase) && phase >= 1 && phase <= 4)
  for (const frame of [before, after]) {
    assert.equal(createDiffFrameGate().observe(frame).samples, 1)
    assert.equal(frame.capturePhase, phase); assert.equal(frame.visibility, 'visible'); assert.equal(frame.windowVisible, true)
    assert.ok(['light', 'dark'].includes(frame.theme))
    assert.equal(typeof frame.tableText, 'string'); assert.ok(frame.tableText.length > 0)
    assert.deepEqual(Object.keys(frame.scroll).sort(), ['tableLeft', 'tableTop', 'x', 'y'])
    for (const offset of Object.values(frame.scroll)) assert.ok(Number.isFinite(offset) && offset >= 0)
  }
  assert.equal(signature(before), signature(after), 'DOM layout, theme, scroll or text changed during PNG capture')
  const raster = verifyDiffRaster(bytes, before)
  // The existing fixture-only witness prevents an old theme/navigation image
  // with coincidentally matching row colors from satisfying the current phase.
  verifyRasterWitness(bytes, phase)
  return { complete: true, capturePhase: phase, beforeAfterEqual: true, rasterPhaseVerified: true,
    bytes: bytes.length, sha256: sha(bytes), ...raster }
}

async function captureDiffFrame({ inspect, capture, stableFrame, stableSamples, phase }) {
  const result = { complete: false, capturePhase: phase, stableSamples, before: null, after: null, png: null }
  try {
    assert.ok(Number.isInteger(stableSamples) && stableSamples >= 3, 'Three original stable frames are required before capture')
    const settled = signature(copy(stableFrame))
    result.before = copy(await inspect())
    assert.equal(signature(result.before), settled, 'The settled frame changed before PNG capture')
    result.png = await capture()
    result.after = copy(await inspect())
    result.receipt = validateDiffCapture(result.before, result.after, result.png, phase)
    result.complete = true
  } catch (error) { result.error = String(error.stack || error) }
  return result
}

// Subscribe before loadFile so a fast first paint cannot be missed. A hidden
// window's first capture must not be the operation that makes it paintable.
async function loadDiffWindow(win, filename, budget = 10000) {
  assert.ok(Number.isInteger(budget) && budget > 0 && budget <= 10000)
  let timer, ready, closed, crashed
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Diff first paint/load exceeded its deadline')), budget) })
  const firstPaint = new Promise((resolve, reject) => {
    ready = resolve; closed = () => reject(Error('Diff window closed before its first paint'))
    crashed = () => reject(Error('Diff renderer exited before its first paint'))
    win.once('ready-to-show', ready); win.once('closed', closed); win.webContents.once('render-process-gone', crashed)
  })
  try {
    await Promise.race([deadline, Promise.all([firstPaint, Promise.resolve().then(() => win.loadFile(filename))])])
    win.showInactive()
    assert.equal(win.isVisible(), true, 'Diff capture window did not become visible')
    assert.equal(win.isMinimized(), false, 'Diff capture window is minimized')
    return { firstPaintObserved: true, visible: true, focusedByHarness: false }
  } finally {
    clearTimeout(timer); win.removeListener('ready-to-show', ready); win.removeListener('closed', closed)
    win.webContents.removeListener('render-process-gone', crashed)
  }
}

module.exports = { verifyDiffRaster, validateDiffCapture, captureDiffFrame, loadDiffWindow }
