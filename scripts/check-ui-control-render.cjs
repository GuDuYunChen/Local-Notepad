// Native Electron regression for shared controls only. No backend or user data.
// Build first: node scripts/build-ui-control-render-fixture.mjs
// Run: npx --no-install electron scripts/check-ui-control-render.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { fileURLToPath } = require('node:url')
const HEIGHTS = Object.freeze({ ordinary: 40, compact: 28, large: 44 })
const KINDS = Object.freeze(['button', 'input', 'password', 'select'])
const VIEWPORTS = Object.freeze([[704, 455], [1280, 800], [1920, 1080]])
const BUDGET_MS = 90000
const TOLERANCE = 0.6
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

// Runs in the actual fixture page. Preserve the original toolbar geometry and
// additionally observe the precise painted targets at the PNG boundary.
function toolbarSnapshot() {
  const roots = document.querySelectorAll('#long-toolbar')
  if (roots.length !== 1) throw Error('Actual toolbar root missing or ambiguous')
  const root = roots[0], bounds = node => {
    const r = node.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
  }
  const observe = node => {
    const box = bounds(node)
    let visible = box.width > 0 && box.height > 0
    let inViewport = box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1
    for (let owner = node; owner; owner = owner.parentElement) {
      const css = getComputedStyle(owner), clip = bounds(owner)
      visible &&= css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0
      if (owner !== node && /hidden|auto|scroll|clip/.test(css.overflowY)) inViewport &&= box.top >= clip.top - 1 && box.bottom <= clip.bottom + 1
      if (owner !== node && /hidden|auto|scroll|clip/.test(css.overflowX)) inViewport &&= box.left >= clip.left - 1 && box.right <= clip.right + 1
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { ...box, owned: root.contains(node), visible, inViewport, hit: hit === node || node.contains(hit) }
  }
  const r = bounds(root)
  return { viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme,
    left: r.left, right: r.right, rootBounds: r,
    fields: ['long-input', 'long-select', 'long-clear'].map(id => {
      const field = document.getElementById(id)
      if (!field) throw Error('Actual toolbar control missing: ' + id)
      const control = field.closest('.ant-select') || field
      return { id, ...observe(control) }
    }),
    labels: [...root.querySelectorAll('label')].map((node, index) => ({ index, ...observe(node) })),
    overflow: document.documentElement.scrollWidth - innerWidth,
    longLabelLength: root.querySelector('label').textContent.trim().length }
}

function verifyToolbarSnapshot(sample, expected) {
  assert.deepEqual(sample?.viewport, expected.viewport, 'Toolbar capture viewport changed')
  assert.equal(sample.theme, expected.theme, 'Toolbar capture theme changed')
  assert.ok(sample.overflow <= 1 && sample.longLabelLength > 20)
  assert.deepEqual(sample.fields.map(field => field.id), ['long-input', 'long-select', 'long-clear'])
  assert.equal(sample.labels.length, 2, 'Both original long toolbar labels are required')
  for (const item of [...sample.fields, ...sample.labels]) {
    for (const key of ['owned', 'visible', 'inViewport', 'hit']) assert.equal(item[key], true, 'Toolbar PNG target must remain visible and unobscured: ' + key)
    assert.ok(item.width > 20 && item.height > 0)
    assert.ok(item.left >= -1 && item.top >= -1 && item.right <= expected.viewport.width + 1 && item.bottom <= expected.viewport.height + 1, 'Toolbar PNG target is outside viewport')
  }
  for (const field of sample.fields) assert.ok(Math.abs(field.height - 40) <= TOLERANCE, 'Toolbar PNG control height changed')
  return sample
}

function verifyToolbarContinuity(before, after, expected) {
  verifyToolbarSnapshot(before, expected); verifyToolbarSnapshot(after, expected)
  const previous = [before.rootBounds, ...before.fields, ...before.labels]
  const current = [after.rootBounds, ...after.fields, ...after.labels]
  for (let i = 0; i < previous.length; i++) for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
    assert.ok(Number.isFinite(current[i][key]) && Math.abs(current[i][key] - previous[i][key]) <= TOLERANCE, 'Toolbar target moved across PNG capture')
  }
}

async function captureToolbarEvidence({ record, read, capture, persist, expected }) {
  const proof = record.capture = { complete: false }; persist()
  proof.image = await capture(async () => {
    proof.before = await read(); persist()
    verifyToolbarContinuity(record, proof.before, expected)
  })
  assert.ok(proof.before, 'Toolbar PNG omitted its fresh pre-capture target guard')
  proof.after = await read(); persist()
  verifyToolbarContinuity(proof.before, proof.after, expected)
  proof.complete = true; persist(); return proof.image
}

function verifyGeometry(sample) {
  assert.equal(sample.controls.length, 12, 'All four controls in all three densities are required')
  assert.ok(sample.overflow <= 1, 'Fixture must not overflow horizontally')
  const seen = new Set()
  for (const control of sample.controls) {
    const key = `${control.density}-${control.kind}`
    assert.ok(!seen.has(key) && HEIGHTS[control.density] && KINDS.includes(control.kind), 'Exact control matrix')
    seen.add(key)
    assert.ok(Number.isFinite(control.height) && Math.abs(control.height - HEIGHTS[control.density]) <= TOLERANCE,
      `${key}: expected ${HEIGHTS[control.density]}px, observed ${control.height}px`)
    assert.equal(control.context, control.density === 'compact' ? 'product-editor-toolbar' : 'standalone',
      `${key}: production editor toolbar context is required for compact controls`)
    assert.ok(control.width > 10 && control.left >= -1 && control.right <= sample.viewport.width + 1, `${key}: horizontal bounds`)
    if (control.kind === 'password') {
      assert.deepEqual(control.innerPadding, [0, 0, 0, 0], `${key}: affix child must not be padded twice`)
      assert.ok(control.innerHeight > 0 && control.innerHeight < control.height, `${key}: inner line is bounded by wrapper`)
    }
  }
  for (const density of Object.keys(HEIGHTS)) {
    const row = sample.controls.filter(control => control.density === density)
    assert.equal(row.length, 4)
    assert.ok(Math.max(...row.map(control => control.top)) - Math.min(...row.map(control => control.top)) <= TOLERANCE,
      `${density}: control tops must align`)
  }
}

function verifyFocus(sample) {
  assert.equal(sample.focused, true, `${sample.id}: native focus owner`)
  assert.equal(sample.focusVisible, true, `${sample.id}: keyboard focus must be visible`)
  assert.equal(sample.outlines.length, 1, `${sample.id}: exactly one focus outline`)
  assert.equal(sample.outlines[0].owner, 'root', `${sample.id}: outer control owns the outline`)
  assert.ok(sample.outlines[0].width >= 1.5, `${sample.id}: visible outline width`)
  assert.equal(sample.shadows.length, 0, `${sample.id}: duplicate focus glow refused`)
  assert.equal(sample.hit, true, `${sample.id}: focused control must be hit-testable`)
  assert.equal(sample.inViewport, true, `${sample.id}: focused control must be visible`)
}

function failureDetails(error) {
  const details = { name: String(error?.name || 'Error'), message: String(error?.message || error), stack: error?.stack || null }
  for (const key of ['actual', 'expected', 'operator']) if (error != null && key in Object(error)) {
    try { details[key] = JSON.parse(JSON.stringify(error[key])) }
    catch { details[key] = String(error[key]) }
  }
  return details
}

async function recordFocusEvidence(scene, sample, persist, captureFailure) {
  scene.focus.push(sample); persist()
  try { verifyFocus(sample) }
  catch (error) {
    scene.focusFailure = { id: sample.id, error: failureDetails(error) }; persist()
    try { scene.focusFailure.image = await captureFailure() }
    catch (captureError) { scene.focusFailure.captureError = failureDetails(captureError) }
    persist()
    throw error
  }
}

async function captureMatchedFocusStyles(debuggerSession, id, writeArtifact) {
  const result = { id, selector: '[id=' + JSON.stringify(id) + ']', nodeId: null, artifacts: {}, errors: [] }
  let command = 'DOM.enable'
  try {
    await debuggerSession.sendCommand(command)
    command = 'CSS.enable'; await debuggerSession.sendCommand(command)
    command = 'DOM.getDocument'; const { root } = await debuggerSession.sendCommand(command, { depth: 0 })
    command = 'DOM.querySelector'
    const { nodeId } = await debuggerSession.sendCommand(command, { nodeId: root.nodeId, selector: result.selector })
    if (!nodeId) throw Error('Original failing focus node is no longer present')
    result.nodeId = nodeId
  } catch (error) { result.errors.push({ command, ...failureDetails(error) }); return result }
  // One failing node only. Preserve the complete responses, including parsedOk,
  // shorthand, priority and inherited rules, without fetching whole stylesheets.
  for (const [kind, method] of [['matched', 'CSS.getMatchedStylesForNode'], ['computed', 'CSS.getComputedStyleForNode']]) {
    let stage = 'read'
    try {
      const response = await debuggerSession.sendCommand(method, { nodeId: result.nodeId })
      stage = 'write'
      result.artifacts[kind] = writeArtifact(kind, { id, nodeId: result.nodeId, method, response })
    } catch (error) { result.errors.push({ command: method, stage, ...failureDetails(error) }) }
  }
  return result
}

function focusAnimationSnapshot(id) {
  const element = document.getElementById(id)
  if (!element) throw Error('Original failing focus node is no longer present')
  const css = getComputedStyle(element)
  return { id, activeElement: document.activeElement?.id, sampledAt: performance.now(),
    computed: Object.fromEntries(['outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
      'transition-property', 'transition-duration', 'transition-delay', 'transition-timing-function',
      'animation-name', 'animation-duration', 'animation-delay', 'animation-fill-mode', 'animation-play-state'].map(name => [name, css.getPropertyValue(name)])),
    animations: element.getAnimations().map(animation => ({ type: animation.constructor.name, id: animation.id,
      playState: animation.playState, pending: animation.pending, currentTime: animation.currentTime, startTime: animation.startTime,
      playbackRate: animation.playbackRate, transitionProperty: animation.transitionProperty, animationName: animation.animationName,
      timing: animation.effect?.getComputedTiming(), keyframes: animation.effect?.getKeyframes() })) }
}

// Computed CSS can retain a colored zero-size shadow when an official token
// disables its outline. Ignore only definitely unpainted layers; unknown or
// nonzero geometry remains evidence, so a real second cue cannot pass silently.
// Keep this function self-contained: the same source runs in Electron's page.
function hasVisibleBoxShadow(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text || text === 'none') return false
  const layers = []
  let depth = 0, start = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '(') depth++
    else if (text[index] === ')') depth--
    else if (text[index] === ',' && depth === 0) { layers.push(text.slice(start, index)); start = index + 1 }
  }
  layers.push(text.slice(start))
  return layers.some(layer => {
    if (/\btransparent\b/.test(layer)) return false
    const color = layer.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)/)
    if (color) {
      const channels = color[1]
      const alpha = channels.includes('/') ? channels.split('/').at(-1).trim()
        : /^rgba?\(|^hsla?\(/.test(color[0]) && channels.split(',').length === 4 ? channels.split(',').at(-1).trim() : null
      if (alpha !== null && /^[-+]?(?:\d*\.)?\d+%?$/.test(alpha) && parseFloat(alpha) <= 0) return false
      layer = layer.replace(color[0], '')
    } else {
      const hex = layer.match(/#[\da-f]+\b/)?.[0]
      if ((hex?.length === 5 && hex.endsWith('0')) || (hex?.length === 9 && hex.endsWith('00'))) return false
    }
    const lengths = layer.trim().split(/\s+/)
      .filter(token => /^[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?(?:px)?$/.test(token)).map(parseFloat)
    if (lengths.length < 2 || lengths.length > 4) return true
    return lengths.some(length => length !== 0)
  })
}

function verifyScenes(scenes) {
  assert.equal(scenes.length, 6, 'Both themes and every viewport must complete')
  const names = new Set()
  for (const scene of scenes) {
    assert.ok(!names.has(scene.name)); names.add(scene.name)
    assert.ok(['light', 'dark'].includes(scene.theme))
    assert.ok(VIEWPORTS.some(size => size[0] === scene.requested[0] && size[1] === scene.requested[1]))
    assert.deepEqual(scene.viewport, { width: scene.requested[0], height: scene.requested[1] }, 'Actual viewport must match requested size')
    verifyGeometry(scene.geometry)
    assert.equal(scene.focus.length, 12)
    assert.equal(new Set(scene.focus.map(sample => sample.id)).size, 12)
    scene.focus.forEach(verifyFocus)
    assert.equal(scene.interaction.complete, true)
    assert.equal(scene.form.complete, true)
    assert.equal(scene.modal.complete, true)
    assert.equal(scene.toolbar.complete, true)
    assert.equal(scene.toolbar.capture?.complete, true, 'Toolbar PNG requires fresh target proof')
    verifyToolbarContinuity(scene.toolbar, scene.toolbar.capture.before, scene)
    verifyToolbarContinuity(scene.toolbar.capture.before, scene.toolbar.capture.after, scene)
    assert.deepEqual(scene.toolbar.capture.image, scene.images.find(image => image.name === scene.name + '-toolbar.png'))
    assert.equal(scene.images.length, 7)
    for (const image of scene.images) {
      assert.ok(image.bytes > 100 && /^[a-f0-9]{64}$/.test(image.sha256))
      assert.ok(image.width > 0 && image.height > 0)
    }
    assert.equal(scene.errors.length, 0)
    assert.ok(scene.events.some(event => event.type === 'click' && event.trusted), 'Trusted pointer activation required')
    for (const key of ['Tab', 'ArrowDown', 'Enter', 'Escape']) {
      assert.ok(scene.events.some(event => event.type === 'keydown' && event.key === key && event.trusted), 'Trusted native key required: ' + key)
    }
    assert.equal(scene.complete, true)
  }
  for (const theme of ['light', 'dark']) for (const [width, height] of VIEWPORTS) {
    assert.ok(names.has(`${theme}-${width}x${height}`), 'Missing scene')
  }
}

function geometrySnapshot() {
  const controls = []
  for (const row of document.querySelectorAll('[data-density]')) for (const holder of row.querySelectorAll('[data-probe]')) {
    const kind = holder.dataset.kind
    const control = holder.querySelector(kind === 'select' ? '.ant-select' : kind === 'password' ? '.ant-input-affix-wrapper' : kind === 'button' ? 'button' : 'input')
    if (!control) throw new Error('Missing real control ' + holder.dataset.probe)
    const rect = control.getBoundingClientRect()
    const item = { density: row.dataset.density, kind, left: rect.left, right: rect.right,
      top: rect.top, width: rect.width, height: rect.height,
      context: control.closest('.product-editor-toolbar') ? 'product-editor-toolbar' : 'standalone' }
    if (kind === 'password') {
      const inner = control.querySelector('input'), css = getComputedStyle(inner)
      item.innerPadding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(key => parseFloat(css[key]))
      item.innerHeight = inner.getBoundingClientRect().height
    }
    controls.push(item)
  }
  return { controls, viewport: { width: innerWidth, height: innerHeight },
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth }
}

function focusSnapshot(id, shadowIsVisible) {
  const element = document.getElementById(id)
  if (!element) throw new Error('Missing focus control ' + id)
  const root = element.closest('.ant-input-affix-wrapper, .ant-select') || element
  const rect = root.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  const outlines = [], shadows = [], shadowStyles = [], nodes = []
  const identity = node => node ? { tag: node.tagName.toLowerCase(), id: node.id,
    class: node.getAttribute('class'), style: node.getAttribute('style'),
    control: node.getAttribute('data-ui-control'), layout: node.getAttribute('data-ui-layout') } : null
  for (const [index, node] of [root, ...root.querySelectorAll('*')].entries()) {
    const bounds = node.getBoundingClientRect(), css = getComputedStyle(node)
    nodes.push({ owner: index === 0 ? 'root' : node.tagName.toLowerCase() + ':' + index, ...identity(node),
      focused: document.activeElement === node, focusVisible: node.matches(':focus-visible'), focusWithin: node.matches(':focus-within'),
      rect: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height },
      clientRects: [...node.getClientRects()].map(box => ({ left: box.left, top: box.top, width: box.width, height: box.height })),
      excluded: [bounds.width <= 0 && 'nonpositive-width', bounds.height <= 0 && 'nonpositive-height',
        css.visibility === 'hidden' && 'hidden', css.opacity === '0' && 'zero-opacity'].filter(Boolean),
      computed: Object.fromEntries(['outline', 'outline-style', 'outline-width', 'outline-color', 'outline-offset',
        'box-shadow', 'display', 'visibility', 'opacity', 'appearance', 'color', 'background-color',
        'border-top-width', 'border-top-color', '--clay', '--ant-line-width-focus', '--ant-color-primary-border',
        '--ant-color-primary', '--ant-control-outline', '--ant-control-outline-width'].map(name => [name, css.getPropertyValue(name)])) })
    if (bounds.width <= 0 || bounds.height <= 0 || css.visibility === 'hidden' || css.opacity === '0') continue
    const owner = index === 0 ? 'root' : node.tagName.toLowerCase() + ':' + index
    if (css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0) outlines.push({ owner, width: parseFloat(css.outlineWidth), color: css.outlineColor })
    if (css.boxShadow !== 'none') {
      const sample = { owner, value: css.boxShadow, visible: shadowIsVisible(css.boxShadow) }
      shadowStyles.push(sample)
      if (sample.visible) shadows.push(sample)
    }
  }
  return { id, focused: document.activeElement === element, focusVisible: element.matches(':focus-visible'), outlines, shadows, shadowStyles,
    diagnostics: { activeElement: identity(document.activeElement), documentHasFocus: document.hasFocus(),
      visibilityState: document.visibilityState, nodes },
    hit: hit === root || root.contains(hit),
    inViewport: rect.top >= -1 && rect.left >= -1 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1 }
}

function selectStateSnapshot(id) {
  const node = document.getElementById(id), owner = node.closest('[data-ui-control="select"]')
  const listId = node.getAttribute('aria-controls') || node.getAttribute('aria-owns'), list = listId && document.getElementById(listId)
  const state = { expanded: node.getAttribute('aria-expanded') === 'true', optionsAvailable: !!list?.querySelector('[data-ui-option-value]'),
    value: JSON.parse(owner.dataset.uiValue), focused: document.activeElement === node, popup: null }
  // virtual=false binds aria-controls to the actual option list, including in dialogs.
  const popup = list?.getAttribute('role') === 'listbox' && list.closest('.ant-select-dropdown')
  const option = popup && [...list.querySelectorAll('[role="option"]')].find(item =>
    item.getAttribute('aria-disabled') !== 'true' && item.querySelector('[data-ui-option-value]'))
  if (!popup || !option) return state
  const bounds = element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
  }
  const root = bounds(popup), content = bounds(list), item = bounds(option), ancestors = []
  for (let element = option; element; element = element.parentElement) {
    const css = getComputedStyle(element)
    ancestors.push({ tag: element.tagName.toLowerCase(), id: element.id, class: element.getAttribute('class'),
      display: css.display, visibility: css.visibility, opacity: css.opacity, pointerEvents: css.pointerEvents })
  }
  const positive = rect => Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0 &&
    rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight
  const visible = option.isConnected && [root, content, item].every(positive) &&
    ancestors.every(css => css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0)
  const inViewport = item.left >= 0 && item.top >= 0 && item.right <= innerWidth + 1 && item.bottom <= innerHeight + 1
  const point = { x: item.left + item.width / 2, y: item.top + item.height / 2 }
  const hit = visible && inViewport ? document.elementFromPoint(point.x, point.y) : null
  const ownedHit = !!hit && (hit === option || option.contains(hit))
  state.popup = { listId, class: popup.getAttribute('class'), optionId: option.id,
    optionValue: option.querySelector('[data-ui-option-value]').getAttribute('data-ui-option-value'),
    root, content, item, ancestors, visible, inViewport, point, ownedHit,
    hit: hit ? { tag: hit.tagName.toLowerCase(), id: hit.id, class: hit.getAttribute('class') } : null,
    ready: state.expanded && state.optionsAvailable && visible && inViewport && ownedHit }
  return state
}

function paintedPopupReader(read, paint) {
  let pending = null
  return async () => {
    const previous = pending, paintedBeforeRead = previous?.complete === true
    const sample = await read()
    if (!sample.expanded || !sample.optionsAvailable || !sample.popup?.ready) { pending = null; return sample }
    if (!pending) {
      const cycle = { complete: false }; pending = cycle
      // Do not await a renderer frame here: the original until deadline must keep advancing.
      Promise.resolve().then(paint).then(() => { cycle.complete = true }, error => { cycle.error = error })
    }
    if ('error' in pending) throw pending.error
    return { ...sample, popup: { ...sample.popup, paintFrames: pending === previous && paintedBeforeRead ? 2 : 0 } }
  }
}

async function main() {
  const { app, BrowserWindow, nativeImage } = require('electron')
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results/ui-controls-render')
  const fixture = path.join(output, 'fixture'), reportFile = path.join(output, 'checks.json')
  fs.mkdirSync(output, { recursive: true })
  if (fs.existsSync(reportFile)) throw new Error('Refusing to overwrite previous native control evidence')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-ui-controls-'))
  app.setPath('userData', profile); app.setPath('sessionData', profile)
  const started = Date.now()
  const report = { schema: 1, scope: 'shared-controls-only', complete: false, status: 'starting',
    platform: process.platform, electron: process.versions.electron, chromium: process.versions.chrome,
    nativeInput: 'Electron sendInputEvent and Input.dispatchKeyEvent', backendExercised: false,
    syntheticRecords: true, isolatedProfile: true, cleanQuit: false, budgetMs: BUDGET_MS,
    runId: process.env.GITHUB_RUN_ID || null, attempt: process.env.GITHUB_RUN_ATTEMPT || null, scenes: [] }
  let win, quitting = false, verified = false
  const persist = () => fs.writeFileSync(reportFile, JSON.stringify({ ...report, elapsedMs: Date.now() - started }, null, 2))
  const fail = error => {
    if (quitting) return
    quitting = true; report.status = 'failed'; report.error = String(error.message || error)
    report.errorDetails = failureDetails(error); persist()
    // Failure is never reported as a clean successful lifecycle.
    app.exit(1)
  }
  const watchdog = setTimeout(() => {
    report.status = 'timeout'; report.complete = false; report.cleanQuit = false; persist()
    app.exit(1)
  }, BUDGET_MS)
  app.on('window-all-closed', () => {})
  app.once('quit', (_event, exitCode) => {
    clearTimeout(watchdog)
    report.cleanQuit = verified && quitting && exitCode === 0
    report.complete = verified && exitCode === 0
    report.status = report.complete ? 'passed' : report.status === 'starting' ? 'incomplete' : report.status
    persist()
    if (!report.complete) process.exitCode = 1
  })
  persist()
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'))
    assert.equal(manifest.schema, 1); assert.equal(manifest.scope, report.scope)
    const verifyFiles = (base, files) => {
      for (const [name, digest] of Object.entries(files)) {
        const filename = path.resolve(base, name)
        assert.ok(filename.startsWith(base + path.sep), 'Manifest path must remain inside its source root')
        assert.equal(hash(fs.readFileSync(filename)), digest, 'Stale fixture source or bundle: ' + name)
      }
    }
    verifyFiles(root, manifest.sources); verifyFiles(fixture, manifest.artifacts)
    report.version = manifest.version; report.identity = manifest
    report.manifestSha256 = hash(fs.readFileSync(path.join(fixture, 'manifest.json')))
    report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    assert.equal(report.commit, manifest.commit, 'Build and native execution must use the same commit')
    assert.equal(process.versions.electron, manifest.dependencies.electron, 'Use the committed Electron runtime')
    persist()
    await app.whenReady()
    win = new BrowserWindow({ width: 704, height: 455, useContentSize: true, show: false,
      autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false, partition: 'ui-controls-' + process.pid } })
    win.setMenu(null)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      let allowed = details.url.startsWith('data:')
      try { allowed ||= details.url.startsWith('file:') && path.resolve(fileURLToPath(details.url)).startsWith(fixture + path.sep) } catch {}
      callback({ cancel: !allowed })
    })
    win.webContents.on('render-process-gone', () => fail(Error('Renderer process ended before evidence completed')))
    win.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame) fail(Error('Fixture main-frame load failed: ' + code))
    })
    win.webContents.debugger.attach('1.3')
    const evaluate = (fn, value) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(value) ?? ''})`)
    const readFocus = id => win.webContents.executeJavaScript(`(${focusSnapshot.toString()})(${JSON.stringify(id)}, ${hasVisibleBoxShadow.toString()})`)
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (read, accept, label) => {
      const deadline = Date.now() + 2500
      do { if (quitting) throw Error('Native run already failed'); const value = await read(); if (accept(value)) return value; await pause(25) } while (Date.now() < deadline)
      throw Error('Timed out waiting for ' + label)
    }
    const events = () => evaluate(() => window.__uiControlEvents || [])
    const inputKey = async (key, modifiers = 0) => {
      const definitions = { Tab: ['Tab', 9], Enter: ['Enter', 13], Escape: ['Escape', 27],
        ArrowDown: ['ArrowDown', 40], a: ['KeyA', 65] }
      const [code, virtual] = definitions[key], before = (await events()).length
      const event = { key, code, modifiers, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual }
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...event,
        ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) })
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
      await until(events, list => list.slice(before).some(item => item.type === 'keydown' && item.key === key && item.trusted), 'trusted ' + key)
    }
    const click = async (selector, disabled = false) => {
      await evaluate(selector => {
        let node = document.querySelector(selector); if (!node) throw Error('Missing ' + selector)
        if (node.matches('[role="combobox"]')) node = node.closest('.ant-select').querySelector('.ant-select-content') || node.closest('.ant-select')
        node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      }, selector)
      const point = await evaluate(selector => {
        let node = document.querySelector(selector)
        if (node.matches('[role="combobox"]')) node = node.closest('.ant-select').querySelector('.ant-select-content') || node.closest('.ant-select')
        const rect = node.getBoundingClientRect()
        const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2), hit = document.elementFromPoint(x, y)
        return { x, y, visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1,
          hit: hit === node || node.contains(hit) }
      }, selector)
      assert.ok(point.visible && point.hit, 'Pointer target must be visible and unobscured: ' + selector)
      const before = (await events()).length
      win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
      win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      if (!disabled) await until(events, list => list.slice(before).some(item => item.type === 'click' && item.trusted), 'trusted pointer click')
      else await pause(40)
    }
    const selectState = id => evaluate(selectStateSnapshot, id)
    const opened = async id => {
      const receipt = { id, complete: false }; report.scenes.at(-1).popups.push(receipt)
      const read = paintedPopupReader(() => selectState(id), () => evaluate(() =>
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))))
      const state = await until(async () => { receipt.sample = await read(); return receipt.sample },
        sample => sample.expanded && sample.optionsAvailable && sample.popup?.ready && sample.popup.paintFrames === 2, id + ' rendered popup')
      receipt.complete = true; persist(); return state
    }
    const closed = id => until(() => selectState(id), state => !state.expanded, id + ' collapsed')
    const choose = async (id, value) => {
      await click('#' + id + ''); await opened(id)
      const selector = await evaluate(({ id, value }) => {
        const node = document.getElementById(id), listId = node.getAttribute('aria-controls') || node.getAttribute('aria-owns')
        if (!listId || !document.getElementById(listId)) throw Error('Select must own its real listbox')
        return '#' + CSS.escape(listId) + ' [data-ui-option-value="' + value + '"]'
      }, { id, value })
      await click(selector)
      await until(() => selectState(id), state => !state.expanded && state.value === value, id + ' selected value')
    }
    const capture = async (scene, suffix, diagnostic = false, beforeCapture) => {
      await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
      if (beforeCapture) await beforeCapture()
      const image = await win.capturePage(), bytes = image.toPNG(), decoded = nativeImage.createFromBuffer(bytes)
      assert.ok(!decoded.isEmpty() && bytes.length > 100, 'Native PNG required')
      const name = scene.name + '-' + suffix + '.png'
      fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' })
      const receipt = { name, bytes: bytes.length, sha256: hash(bytes), ...decoded.getSize() }
      if (!diagnostic) scene.images.push(receipt)
      persist(); return receipt
    }
    for (const theme of ['light', 'dark']) for (const [width, height] of VIEWPORTS) {
      const scene = { name: `${theme}-${width}x${height}`, theme, requested: [width, height], complete: false,
        focus: [], images: [], popups: [], interaction: {}, form: {}, modal: {}, toolbar: {}, errors: [] }
      report.scenes.push(scene); report.status = 'running'; persist()
      win.setContentSize(width, height)
      await win.loadFile(path.join(fixture, 'fixture.html'), { query: { theme } })
      win.show(); win.focus(); win.webContents.focus()
      await until(() => evaluate(() => document.documentElement.dataset.uiControlReady), value => value === 'true', 'real components mounted')
      await evaluate(() => document.fonts.ready.then(() => true))
      await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
      scene.geometry = await evaluate(geometrySnapshot); scene.viewport = scene.geometry.viewport
      assert.deepEqual(scene.viewport, { width, height }, 'Requested native viewport was clamped')
      verifyGeometry(scene.geometry); persist()
      await click('#focus-start')
      for (const density of Object.keys(HEIGHTS)) {
        for (const kind of KINDS) {
          await inputKey('Tab')
          // The real Password includes its own keyboard-accessible eye button.
          // Traverse it normally instead of changing the component's tab order.
          const passwordIcon = await evaluate(() => document.activeElement?.matches('.ant-input-password-icon'))
          if (passwordIcon) { assert.equal(kind, 'select'); await inputKey('Tab') }
          const id = `${density}-${kind}`
          const focused = await until(() => readFocus(id), sample => sample.focused && sample.focusVisible, id + ' keyboard focus')
          await recordFocusEvidence(scene, focused, persist, async () => {
            scene.focusFailure.styles = await captureMatchedFocusStyles(win.webContents.debugger, id, (kind, response) => {
              const name = `${scene.name}-${id}-focus-${kind}.json`, bytes = Buffer.from(JSON.stringify(response))
              fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' })
              return { name, bytes: bytes.length, sha256: hash(bytes) }
            }); persist()
            try { scene.focusFailure.animations = await evaluate(focusAnimationSnapshot, id) }
            catch (error) { scene.focusFailure.animationError = failureDetails(error) }
            persist()
            const image = await capture(scene, id + '-focus-failure', true)
            // A later paint observation is diagnostic only. The first sample
            // and its failed assertion remain authoritative and still throw.
            try { scene.focusFailure.afterCapture = await readFocus(id) }
            catch (error) { scene.focusFailure.afterCaptureError = failureDetails(error) }
            return image
          })
        }
        await capture(scene, density + '-focus')
      }

      await choose('ordinary-select', 'beta')
      const selected = await evaluate(() => JSON.parse(document.getElementById('selection-output').textContent))
      assert.equal(selected.values.ordinary, 'beta'); assert.equal(selected.changes.ordinary, 1)
      await click('#ordinary-select'); await opened('ordinary-select'); await capture(scene, 'popup')
      await click('#ordinary-select'); await closed('ordinary-select')
      await inputKey('ArrowDown'); await opened('ordinary-select')
      await inputKey('Escape'); const escaped = await closed('ordinary-select')
      assert.equal(escaped.value, 'beta'); assert.equal(escaped.focused, true)
      await inputKey('ArrowDown'); await opened('ordinary-select'); await inputKey('ArrowDown'); await inputKey('Enter')
      const keyboardChoice = await closed('ordinary-select')
      assert.equal(keyboardChoice.value, 'gamma'); assert.equal(keyboardChoice.focused, true)
      const committed = await evaluate(() => JSON.parse(document.getElementById('selection-output').textContent))
      assert.equal(committed.changes.ordinary, 2, 'One change per real selection')
      scene.interaction = { complete: true, pointerValue: 'beta', keyboardValue: keyboardChoice.value,
        repeatedPointerClosed: true, escapePreservedValueAndFocus: true, changes: committed.changes.ordinary }

      await click('#long-clear')
      await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))
      scene.toolbar = await evaluate(toolbarSnapshot)
      assert.ok(scene.toolbar.overflow <= 1 && scene.toolbar.longLabelLength > 20)
      for (const field of scene.toolbar.fields) assert.ok(Math.abs(field.height - 40) <= TOLERANCE && field.left >= 0 && field.right <= width + 1, 'Toolbar height and bounds')
      const tops = scene.toolbar.fields.map(field => field.top)
      if (width === 704) assert.ok(Math.max(...tops) - Math.min(...tops) > 40, 'Narrow toolbar must wrap complete controls')
      else assert.ok(Math.max(...scene.toolbar.fields.map(field => field.bottom)) - Math.min(...scene.toolbar.fields.map(field => field.bottom)) <= TOLERANCE, 'Wide toolbar must align bottoms')
      scene.toolbar.complete = true
      await captureToolbarEvidence({ record: scene.toolbar, read: () => evaluate(toolbarSnapshot),
        capture: guard => capture(scene, 'toolbar', false, guard), persist, expected: scene })

      await click('#native-title'); await inputKey('a', 2)
      await win.webContents.debugger.sendCommand('Input.insertText', { text: 'edited' })
      await choose('native-mode', 'beta'); await choose('legend-mode', 'gamma')
      const disabled = await evaluate(() => ({ input: document.getElementById('blocked-title').matches(':disabled'),
        select: document.getElementById('blocked-mode').disabled, button: document.getElementById('blocked-submit').matches(':disabled'),
        legend: document.getElementById('legend-mode').disabled }))
      assert.deepEqual(disabled, { input: true, select: true, button: true, legend: false })
      await click('#blocked-submit', true)
      assert.equal(await evaluate(() => JSON.parse(document.getElementById('form-output').textContent).submissions.length), 0)
      await click('#native-submit')
      const form = await until(() => evaluate(() => JSON.parse(document.getElementById('form-output').textContent)), value => value.submissions.length === 1, 'real form submit')
      assert.deepEqual(form.submissions[0], { title: 'edited', mode: 'beta', legendMode: 'gamma' })
      await click('#native-reset')
      await until(() => selectState('native-mode'), value => value.value === 'alpha', 'native form reset')
      assert.equal(await evaluate(() => document.getElementById('native-title').value), 'original')
      await click('#native-submit')
      const reset = await until(() => evaluate(() => JSON.parse(document.getElementById('form-output').textContent)), value => value.submissions.length === 2, 'submit after reset')
      assert.deepEqual(reset.submissions[1], { title: 'original', mode: 'alpha', legendMode: 'alpha' }); assert.equal(reset.resets, 1)
      const colors = await evaluate(() => ({ normal: getComputedStyle(document.getElementById('native-title')).borderTopColor,
        input: getComputedStyle(document.getElementById('error-input')).borderTopColor,
        select: getComputedStyle(document.getElementById('error-select').closest('.ant-select')).borderTopColor }))
      assert.notEqual(colors.input, colors.normal); assert.equal(colors.input, colors.select)
      scene.form = { complete: true, disabled, colors, ...reset }; await capture(scene, 'form')

      await click('#open-modal')
      await until(() => evaluate(() => !!document.getElementById('probe-modal')), Boolean, 'real focus hook dialog')
      await click('#modal-select'); await opened('modal-select'); await capture(scene, 'modal-popup')
      await inputKey('Escape'); await closed('modal-select')
      assert.equal(await evaluate(() => !!document.getElementById('probe-modal')), true, 'First Escape belongs to expanded Select')
      await inputKey('Escape')
      await until(() => evaluate(() => !document.getElementById('probe-modal')), Boolean, 'second Escape closes dialog')
      assert.equal(await evaluate(() => document.activeElement?.id), 'open-modal', 'Native modal cleanup returns trigger focus')
      assert.equal(await evaluate(() => Number(document.getElementById('modal-output').textContent)), 1)
      scene.modal = { complete: true, firstEscapeKeptDialog: true, secondEscapeClosed: true, focusReturned: true, closeCount: 1 }
      scene.events = await events(); scene.errors = await evaluate(() => window.__uiControlErrors)
      assert.equal(scene.errors.length, 0)
      scene.complete = true; persist()
    }
    verifyScenes(report.scenes)
    verified = true; quitting = true; report.status = 'quitting'; persist()
    win.webContents.debugger.detach()
    app.quit()
  } catch (error) { fail(error) }
}

module.exports = { verifyGeometry, verifyFocus, verifyScenes, hasVisibleBoxShadow, HEIGHTS, VIEWPORTS, BUDGET_MS, failureDetails, recordFocusEvidence, captureMatchedFocusStyles, selectStateSnapshot, paintedPopupReader, toolbarSnapshot, verifyToolbarSnapshot, verifyToolbarContinuity, captureToolbarEvidence }
// Electron 31's ESM default_app imports the CLI file, so require.main does not
// identify it. Only the actual browser-process CLI entry may start this runner;
// importing the exported evidence helpers must remain side-effect free.
const electronEntry = process.versions.electron && process.type === 'browser' && process.defaultApp === true &&
  process.argv[1] && path.resolve(process.argv[1]) === __filename
if (require.main === module || electronEntry) main().catch(error => {
  console.error(error)
  if (process.versions.electron) require('electron').app.exit(1)
  else process.exitCode = 1
})
