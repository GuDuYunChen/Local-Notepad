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
  cssReferences: frame.cssReferences, capturePhase: frame.capturePhase, visibility: frame.visibility, windowVisible: frame.windowVisible })
const copy = value => structuredClone(value)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

// This entire function is serialized into Chromium. Its expected colors come
// from root semantic tokens and the backgrounds OUTSIDE the cell, never the
// measured td/pre fill, Canvas pixels, or the screenshot being tested.
function diffCSSReferences(action, phase) {
  if (!['prepare', 'inspect'].includes(action) || !Number.isInteger(phase) || phase < 1 || phase > 4) throw Error('Invalid CSS reference operation')
  const rootID = 'diff-css-references', theme = document.documentElement.dataset.theme
  const pathOf = node => {
    const path = []
    for (; node; node = node.parentElement) path.unshift(node.tagName.toLowerCase() +
      (node.parentElement ? ':nth-child(' + ([...node.parentElement.children].indexOf(node) + 1) + ')' : ''))
    return path.join('>')
  }
  const rectOf = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } }
  const normalize = value => {
    const element = document.createElement('div'); element.style.backgroundColor = value
    const color = element.style.backgroundColor
    if (!/^(?:rgb|rgba)\(/.test(color)) throw Error('A CSS reference requires a resolved root color token')
    return color
  }
  const paintStyle = node => {
    const style = getComputedStyle(node)
    return Object.fromEntries(['backgroundColor', 'backgroundImage', 'opacity', 'filter', 'transform', 'mixBlendMode',
      'visibility', 'display', 'position', 'pointerEvents', 'boxShadow', 'borderRadius', 'borderTopWidth',
      'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'transitionDuration', 'animationName'].map(key => [key, style[key]]))
  }
  const rootStyle = getComputedStyle(document.documentElement)
  const sources = ['local', 'remote'].map(kind => {
    const selector = '.sync-diff-' + kind + ' td:last-child', cell = document.querySelector(selector)
    if (!cell || cell.tagName !== 'TD') throw Error('Missing CSS reference source cell')
    const ancestors = []; for (let node = cell.parentElement; node; node = node.parentElement) ancestors.unshift(node)
    const token = kind === 'local' ? '--danger-light' : '--success-light'
    const tokenValue = rootStyle.getPropertyValue(token).trim(), paperValue = rootStyle.getPropertyValue('--paper').trim()
    const backgrounds = ancestors.map(node => ({ path: pathOf(node), tag: node.tagName, background: getComputedStyle(node).backgroundColor }))
    return { cell, ancestors, expected: { kind, selector, token, tokenOwner: 'document.documentElement', tokenValue, paperValue,
      selectedToken: tokenValue ? token : '--paper', fill: normalize(tokenValue || paperValue), backgrounds } }
  })
  const sourceSignature = JSON.stringify({ phase, theme, sources: sources.map(source => source.expected) })
  let state = window.__diffCSSReferenceState
  const sameNodes = state && sources.every((source, index) => source.cell === state.sources[index].cell &&
    source.ancestors.length === state.sources[index].ancestors.length && source.ancestors.every((node, i) => node === state.sources[index].ancestors[i]))
  if (action === 'prepare' && (!state || state.sourceSignature !== sourceSignature || !sameNodes || document.getElementById(rootID) !== state.root)) {
    const generation = (state?.generation || 0) + 1
    document.getElementById(rootID)?.remove()
    const root = document.createElement('div'); root.id = rootID; root.setAttribute('aria-hidden', 'true')
    root.dataset.phase = String(phase); root.dataset.theme = theme; root.dataset.generation = String(generation)
    const cleanStyle = { all: 'initial', display: 'block', position: 'absolute', top: '0px', left: '0px',
      width: '16px', height: '16px', margin: '0px', padding: '0px', border: '0px', borderRadius: '0px',
      opacity: '1', filter: 'none', transform: 'none', mixBlendMode: 'normal', boxShadow: 'none',
      backgroundImage: 'none', transitionProperty: 'none', transitionDuration: '0s', transitionDelay: '0s',
      animationName: 'none', pointerEvents: 'auto', visibility: 'visible' }
    Object.assign(root.style, cleanStyle, { position: 'fixed', left: '40px', top: '8px', width: '40px',
      backgroundColor: 'transparent', zIndex: '2147483646', isolation: 'isolate' })
    const entries = sources.map((source, index) => {
      const spec = source.expected
      const definitions = [{ source: 'opaque-white', background: 'rgb(255, 255, 255)' },
        ...spec.backgrounds.map(layer => ({ source: layer.path, background: layer.background })),
        { source: 'root-token:' + spec.selectedToken, background: spec.fill }]
      let parent = root
      const layers = definitions.map((definition, ordinal) => {
        const node = document.createElement('div')
        node.dataset.kind = spec.kind; node.dataset.source = definition.source; node.dataset.phase = String(phase)
        Object.assign(node.style, cleanStyle, { left: ordinal === 0 ? index * 24 + 'px' : '0px', backgroundColor: definition.background })
        parent.append(node); parent = node; return node
      })
      return { layers }
    })
    document.body.append(root)
    state = window.__diffCSSReferenceState = { root, sources, entries, phase, theme, generation, sourceSignature }
  }
  if (!state) return null
  const root = state.root
  const entries = sources.map((source, index) => {
    const layers = state.entries[index].layers, leaf = layers.at(-1), bounds = rectOf(layers[0])
    const x = Math.floor((bounds.left + bounds.right) / 2), y = Math.floor((bounds.top + bounds.bottom) / 2)
    const points = [[x, y], [bounds.left + 2, bounds.top + 2], [bounds.right - 2, bounds.top + 2],
      [bounds.left + 2, bounds.bottom - 2], [bounds.right - 2, bounds.bottom - 2]]
    // Include painted high-layer overlays even when pointer-events:none would
    // hide them from elementFromPoint. The witness occupies a separate region.
    const blockers = [...document.querySelectorAll('body *')].filter(node => {
      if (root.contains(node) || node.contains(root)) return false
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility === 'visible' &&
        (Number(style.zIndex) >= 2147483646 || node.matches('dialog[open]')) &&
        points.some(([x, y]) => x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom)
    }).map(pathOf)
    return { ...source.expected, x, y, bounds, blockers,
      sourceIdentityValid: source.cell === state.sources[index].cell && source.ancestors.length === state.sources[index].ancestors.length &&
        source.ancestors.every((node, i) => node === state.sources[index].ancestors[i]),
      exposed: blockers.length === 0 && points.every(([x, y]) => document.elementFromPoint(x, y) === leaf),
      layers: layers.map((node, ordinal) => ({ source: node.dataset.source, kind: node.dataset.kind, phase: Number(node.dataset.phase),
        identityValid: node.isConnected && node.parentElement === (ordinal === 0 ? root : layers[ordinal - 1]) &&
          node.children.length === (ordinal === layers.length - 1 ? 0 : 1),
        specifiedBackground: node.style.backgroundColor, style: paintStyle(node), bounds: rectOf(node) })) }
  })
  return { schema: 'diff-css-reference-v1', source: 'root-semantic-tokens-and-cell-ancestor-backgrounds',
    phase: Number(root.dataset.phase), theme: root.dataset.theme, generation: Number(root.dataset.generation),
    rootID, rootBounds: rectOf(root), rootStyle: paintStyle(root), rootZIndex: getComputedStyle(root).zIndex,
    identityValid: document.getElementById(rootID) === root && root.parentElement === document.body && root.children.length === 2 &&
      state.phase === phase && state.theme === theme && state.generation === Number(root.dataset.generation),
    sourceStable: state.sourceSignature === sourceSignature, references: entries }
}

function validateCSSReferences(frame) {
  const reference = frame.cssReferences
  assert.equal(reference?.schema, 'diff-css-reference-v1', 'Current captures require independent CSS references')
  assert.equal(reference.source, 'root-semantic-tokens-and-cell-ancestor-backgrounds')
  assert.ok(Number.isInteger(frame.capturePhase) && frame.capturePhase >= 1 && frame.capturePhase <= 4)
  assert.equal(frame.theme, frame.capturePhase === 1 ? 'light' : 'dark', 'The theme does not match the capture phase')
  assert.equal(reference.phase, frame.capturePhase); assert.equal(reference.theme, frame.theme)
  assert.ok(Number.isSafeInteger(reference.generation) && reference.generation > 0)
  assert.equal(reference.identityValid, true); assert.equal(reference.sourceStable, true)
  assert.equal(reference.rootID, 'diff-css-references'); assert.equal(reference.rootZIndex, '2147483646')
  assert.deepEqual(reference.rootBounds, { left: 40, top: 8, right: 80, bottom: 24 })
  assert.ok(frame.viewport.width >= 80 && frame.viewport.height >= 24)
  const paint = (style, position, background) => {
    assert.deepEqual(style, { backgroundColor: background, backgroundImage: 'none', opacity: '1', filter: 'none', transform: 'none',
      mixBlendMode: 'normal', visibility: 'visible', display: 'block', position, pointerEvents: 'auto', boxShadow: 'none',
      borderRadius: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
      transitionDuration: '0s', animationName: 'none' }, 'CSS reference paint style changed')
  }
  paint(reference.rootStyle, 'fixed', 'rgba(0, 0, 0, 0)')
  assert.deepEqual(reference.references?.map(entry => entry.kind), ['local', 'remote'])
  for (const [index, entry] of reference.references.entries()) {
    const token = entry.kind === 'local' ? '--danger-light' : '--success-light'
    assert.equal(entry.selector, '.sync-diff-' + entry.kind + ' td:last-child')
    assert.equal(entry.tokenOwner, 'document.documentElement'); assert.equal(entry.token, token)
    assert.equal(typeof entry.tokenValue, 'string'); assert.equal(typeof entry.paperValue, 'string')
    assert.ok(entry.tokenValue || entry.paperValue); assert.equal(entry.selectedToken, entry.tokenValue ? token : '--paper')
    const raw = (entry.tokenValue || entry.paperValue).trim()
    let normalized
    if (/^#[\da-f]{6}$/i.test(raw)) normalized = 'rgb(' + [1, 3, 5].map(offset => parseInt(raw.slice(offset, offset + 2), 16)).join(', ') + ')'
    else {
      const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$/.exec(raw)
      assert.ok(match, 'Unsupported or unresolved root semantic color token')
      const rgb = match.slice(1, 4).map(Number); assert.ok(rgb.every(channel => channel >= 0 && channel <= 255))
      const alpha = match[4] === undefined ? 1 : Number(match[4]); assert.ok(alpha >= 0 && alpha <= 1)
      normalized = alpha === 1 ? 'rgb(' + rgb.join(', ') + ')' : 'rgba(' + [...rgb, alpha].join(', ') + ')'
    }
    assert.equal(entry.fill, normalized, 'The CSS reference fill was not derived from its root semantic token')
    assert.ok(entry.backgrounds.length >= 3 && entry.backgrounds.length <= 32)
    assert.equal(entry.backgrounds[0].tag, 'HTML'); assert.equal(entry.backgrounds[1].tag, 'BODY')
    assert.equal(entry.backgrounds.at(-1).tag, 'TR')
    assert.equal(new Set(entry.backgrounds.map(layer => layer.path)).size, entry.backgrounds.length)
    for (const layer of entry.backgrounds) {
      assert.match(layer.path, /^html(?:>[a-z][a-z\d-]*:nth-child\(\d+\))*$/)
      assert.ok(!['TD', 'PRE'].includes(layer.tag), 'Actual cell/text fills cannot be CSS reference sources')
      assert.match(layer.background, /^rgba?\([\d., ]+\)$/)
    }
    const expectedLayers = [{ source: 'opaque-white', background: 'rgb(255, 255, 255)' },
      ...entry.backgrounds.map(layer => ({ source: layer.path, background: layer.background })),
      { source: 'root-token:' + entry.selectedToken, background: entry.fill }]
    assert.equal(entry.layers.length, expectedLayers.length)
    assert.equal(entry.sourceIdentityValid, true); assert.equal(entry.exposed, true, 'The CSS reference is occluded')
    assert.deepEqual(entry.blockers, [])
    const bounds = { left: 40 + index * 24, top: 8, right: 56 + index * 24, bottom: 24 }
    assert.deepEqual(entry.bounds, bounds); assert.equal(entry.x, bounds.left + 8); assert.equal(entry.y, 16)
    assert.ok(bounds.right <= frame.bounds.left || bounds.left >= frame.bounds.right || bounds.bottom <= frame.bounds.top || bounds.top >= frame.bounds.bottom,
      'CSS references must not cover the observed product table')
    for (const [ordinal, layer] of entry.layers.entries()) {
      assert.equal(layer.source, expectedLayers[ordinal].source); assert.equal(layer.kind, entry.kind); assert.equal(layer.phase, frame.capturePhase)
      assert.equal(layer.identityValid, true); assert.deepEqual(layer.bounds, bounds)
      assert.equal(layer.specifiedBackground, expectedLayers[ordinal].background)
      paint(layer.style, 'absolute', expectedLayers[ordinal].background)
    }
  }
  return reference
}

// Preserve the original DOM gate and additionally require three identical
// reference/source observations. Refreshing a reference restarts this count.
function createDiffCaptureGate() {
  const original = createDiffFrameGate(); let previous = '', samples = 0
  return Object.freeze({ observe(frame) {
    const observed = original.observe(frame)
    try { assert.ok(observed.samples > 0); validateCSSReferences(frame) }
    catch { previous = ''; samples = 0; return Object.freeze({ ready: false, samples }) }
    const current = signature(frame); samples = current === previous ? samples + 1 : 1; previous = current
    return Object.freeze({ ready: observed.ready && samples >= 3, samples })
  } })
}

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

function verifyDiffCSSRaster(bytes, frame) {
  assert.equal(createDiffFrameGate().observe(frame).samples, 1, 'Invalid DOM observation cannot approve a screenshot')
  const reference = validateCSSReferences(frame), image = pngPixels(bytes)
  assert.deepEqual({ width: image.width, height: image.height }, frame.viewport, 'PNG dimensions differ from the observed viewport')
  assert.deepEqual(frame.rasterProbes?.map(probe => [probe.kind, probe.position]),
    [['local', 'left'], ['local', 'right'], ['remote', 'left'], ['remote', 'right']], 'Missing exact semantic pixel probes')
  const references = reference.references.map(entry => ({ kind: entry.kind, x: entry.x, y: entry.y, rgba: image.pixel(entry.x, entry.y) }))
  for (const entry of references) assert.equal(entry.rgba[3], 255, 'The independent CSS reference must have an opaque base')
  const probes = frame.rasterProbes.map(probe => {
    assert.equal(probe.exposed, true, 'The semantic pixel probe is covered by another element')
    assert.ok(probe.x > frame.bounds.left && probe.x < frame.bounds.right && probe.y > frame.bounds.top && probe.y < frame.bounds.bottom)
    const expected = references.find(reference => reference.kind === probe.kind), actual = image.pixel(probe.x, probe.y)
    assert.deepEqual(actual, expected.rgba, 'Saved PNG does not match the independent CSS ' + probe.kind + ' reference at its observed row coordinates')
    return { ...probe, rgb: actual.slice(0, 3), rgba: actual, reference: { x: expected.x, y: expected.y } }
  })
  return { width: image.width, height: image.height, referenceSchema: reference.schema, references, probes }
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
  const raster = verifyDiffCSSRaster(bytes, before)
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

module.exports = { diffCSSReferences, validateCSSReferences, createDiffCaptureGate, verifyDiffRaster, verifyDiffCSSRaster,
  validateDiffCapture, captureDiffFrame, loadDiffWindow }
