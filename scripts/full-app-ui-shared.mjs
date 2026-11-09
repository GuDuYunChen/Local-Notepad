import assert from 'node:assert/strict'
import { createNativeUiSelect } from './native-ui-select.mjs'
import controlEvidence from './check-ui-control-render.cjs'

const { hasVisibleBoxShadow, paintedPopupReader } = controlEvidence
const q = JSON.stringify
const heights = { small: 28, middle: 40, large: 44 }
const keyCodes = { Tab: 9, Enter: 13, Escape: 27, Backspace: 8, Delete: 46, Home: 36, End: 35,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32, a: 65 }
const slug = value => String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 90)

export function withinActualClientPort(rect, bounds, metrics, overflowX, overflowY, tolerance = 1) {
  for (const name of ['clientLeft', 'clientTop', 'clientWidth', 'clientHeight']) if (!Number.isFinite(metrics[name]) || metrics[name] < 0) throw Error('Actual client-port metrics are required')
  const left = bounds.left + metrics.clientLeft, top = bounds.top + metrics.clientTop
  return (!/hidden|auto|scroll|clip/.test(overflowX) || (rect.left >= left - tolerance && rect.right <= left + metrics.clientWidth + tolerance)) &&
    (!/hidden|auto|scroll|clip/.test(overflowY) || (rect.top >= top - tolerance && rect.bottom <= top + metrics.clientHeight + tolerance))
}

// CSS Overflow viewport propagation changes the used clipping owner, while
// getComputedStyle still reports the root/body declarations. Read that owner
// once per native observation; real nested client ports remain independent.
export function observeFullAppOverflowViewport() {
  const root = document.documentElement, body = document.body
  const read = node => {
    if (!node) return null
    const css = getComputedStyle(node), box = node.getBoundingClientRect()
    return { tag: node.tagName, namespace: node.namespaceURI, display: css.display,
      overflowX: css.overflowX, overflowY: css.overflowY, contain: css.contain, contentVisibility: css.contentVisibility,
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      clientLeft: node.clientLeft, clientTop: node.clientTop, clientWidth: node.clientWidth, clientHeight: node.clientHeight }
  }
  const rootStyle = read(root), bodyStyle = read(body)
  if (![root?.clientWidth, root?.clientHeight, innerWidth, innerHeight].every(value => Number.isFinite(value) && value > 0)) throw Error('Actual layout viewport metrics are required')
  const html = node => node?.namespaceURI === 'http://www.w3.org/1999/xhtml'
  const firstBody = [...root.children].find(node => html(node) && node.localName === 'body' && getComputedStyle(node).display !== 'none')
  const rootPropagates = Boolean(rootStyle.display && rootStyle.display !== 'none')
  const bodyPropagates = Boolean(rootPropagates && html(root) && root.localName === 'html' && body &&
    body === firstBody && body.parentElement === root && bodyStyle.display && bodyStyle.display !== 'none' &&
    rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible' &&
    rootStyle.contain === 'none' && bodyStyle.contain === 'none' &&
    rootStyle.contentVisibility === 'visible' && bodyStyle.contentVisibility === 'visible')
  const width = Math.min(innerWidth, root.clientWidth), height = Math.min(innerHeight, root.clientHeight)
  const bounds = { left: 0, top: 0, right: width, bottom: height, width, height }
  const propagated = node => (node === root && rootPropagates) || (node === body && bodyPropagates)
  const usedViewport = value => value === 'visible' ? 'auto' : value === 'clip' ? 'hidden' : value
  const source = bodyPropagates ? bodyStyle : rootStyle
  return { bounds, record: { bounds, root: rootStyle, body: bodyStyle, rootPropagates, bodyPropagates,
      viewportOverflowX: usedViewport(source.overflowX), viewportOverflowY: usedViewport(source.overflowY), compatMode: document.compatMode },
    propagated, isViewportScroller: node => rootPropagates && node === document.scrollingElement,
    viewportOverflowY: usedViewport(source.overflowY),
    local: (node, css) => propagated(node) ? { x: 'visible', y: 'visible', viewportApplied: true } : { x: css.overflowX, y: css.overflowY, viewportApplied: false } }
}

export function finiteOwnerMotionActive(sample) {
  if (!sample || typeof sample.root !== 'string' || !Array.isArray(sample.animations)) throw Error('Actual owner motion sample is required')
  return sample.animations.some(animation => {
    if (!animation.pending && animation.playState !== 'running') return false
    if ([animation.duration, animation.iterations, animation.endTime].includes('infinite')) return false
    if (![animation.duration, animation.iterations, animation.endTime].every(value => Number.isFinite(value) && value >= 0)) throw Error('Finite owner animation timing is unavailable')
    return true
  })
}

function observeFullAppOwnerMotion(root) {
  const matches = [...document.querySelectorAll(root)].filter(node => node.getClientRects().length && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
  if (matches.length !== 1) throw Error('Actual motion owner missing or ambiguous: ' + root)
  const animations = [], owners = [], scalar = value => value === Infinity ? 'infinite' : value
  for (let node = matches[0]; node; node = node.parentElement) {
    if (owners.length >= 64) throw Error('Actual animation owner chain exceeds its bounded depth')
    const owner = { tag: node.tagName, id: node.id, className: String(node.className) }; owners.push(owner)
    // Only each owner itself. Descendant spinners and unrelated toast portals
    // are not a prerequisite for this page's real entrance geometry.
    for (const animation of node.getAnimations({ subtree: false })) {
      if (animations.length >= 128) throw Error('Actual owner animations exceed the bounded observation')
      const timing = animation.effect?.getComputedTiming()
      animations.push({ owner, playState: animation.playState, pending: animation.pending,
        animationName: animation.animationName || null, transitionProperty: animation.transitionProperty || null,
        duration: scalar(timing?.duration), iterations: scalar(timing?.iterations), endTime: scalar(timing?.endTime) })
    }
  }
  return { root, owners, animations }
}

export async function waitForFiniteOwnerMotion(read, until, receipt = {}) {
  Object.assign(receipt, { polls: 0, complete: false })
  receipt.settled = await until(async () => {
    const sample = await read(); receipt.polls++; receipt.first ||= sample; receipt.latest = sample
    if (sample.root !== receipt.first.root) throw Error('Actual animation owner changed while waiting')
    return !finiteOwnerMotionActive(sample) && sample
  }, 'Actual page entrance animation did not finish within the original readiness budget')
  receipt.complete = true; return receipt
}

// This runs in the real App renderer. It observes existing nodes and CSS; it
// does not mount a fixture, assign field values or alter application styling.
export function observeFullAppPage({ root, anchors = [], editorExceptions = [], onlySelectors = [] }, withinClientPort, readOverflowViewport) {
  const overflowViewport = readOverflowViewport(), viewport = overflowViewport.bounds
  const bounds = node => {
    const box = node.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
  }
  const painted = node => {
    for (let owner = node; owner; owner = owner.parentElement) {
      const css = getComputedStyle(owner)
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) <= 0) return false
    }
    return true
  }
  const rendered = node => {
    if (!node.isConnected) return false
    for (let owner = node; owner; owner = owner.parentElement) if (getComputedStyle(owner).display === 'none') return false
    const box = bounds(node)
    return box.width > 0 && box.height > 0
  }
  const visibleRoots = [...document.querySelectorAll(root)].filter(rendered)
  if (visibleRoots.length !== 1) throw Error('Expected one actual page root: ' + root + ' (' + visibleRoots.length + ')')
  const area = visibleRoots[0]
  const selector = node => {
    if (node === document.documentElement) return 'html'
    if (node.id && document.querySelectorAll('[id=' + JSON.stringify(node.id) + ']').length === 1) return '[id=' + JSON.stringify(node.id) + ']'
    const parts = []
    for (let owner = node; owner && owner !== document.documentElement; owner = owner.parentElement) {
      parts.unshift(owner.tagName.toLowerCase() + ':nth-child(' + ([...owner.parentElement.children].indexOf(owner) + 1) + ')')
      if (owner === area) return root + (parts.length > 1 ? ' > ' + parts.slice(1).join(' > ') : '')
    }
    return 'html > ' + parts.join(' > ')
  }
  const observe = node => {
    const box = bounds(node), visible = painted(node), clippingAncestors = []
    let inViewport = box.left >= -1 && box.top >= -1 && box.right <= viewport.right + 1 && box.bottom <= viewport.bottom + 1
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), clip = bounds(parent), applied = overflowViewport.local(parent, css)
      inViewport &&= withinClientPort(box, clip, parent, applied.x, applied.y)
      clippingAncestors.push({ tag: parent.tagName, id: parent.id, bounds: clip,
        clientPort: { left: clip.left + parent.clientLeft, top: clip.top + parent.clientTop, width: parent.clientWidth, height: parent.clientHeight },
        overflowX: css.overflowX, overflowY: css.overflowY, appliedOverflowX: applied.x, appliedOverflowY: applied.y, viewportApplied: applied.viewportApplied })
    }
    const hit = visible && inViewport ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null
    return { ...box, visible, inViewport, hit: Boolean(hit && (hit === node || node.contains(hit))), clippingAncestors: inViewport ? [] : clippingAncestors }
  }
  const controls = [], owners = new Set(), controlSelector = '[data-ui-control], button, input, select, textarea'
  const candidates = [...(area.matches(controlSelector) ? [area] : []), ...area.querySelectorAll(controlSelector)]
  for (const node of candidates) {
    const shared = node.closest('[data-ui-control]')
    if (shared && shared !== node) continue
    if (!shared && (node.type === 'hidden' || node.classList.contains('app-ui-validation-field'))) continue
    const kind = shared?.dataset.uiControl || node.tagName.toLowerCase()
    const field = kind === 'select' && shared ? node.querySelector('[role="combobox"]') : node.matches('input,textarea,button,select') ? node : node.querySelector('input,textarea,button,select')
    const visual = kind === 'select' && shared ? node.querySelector('.app-ui-select') : kind === 'password' ? field?.closest('.ant-input-affix-wrapper') || node : node
    if (!visual || owners.has(visual) || !rendered(visual)) continue
    owners.add(visual)
    const nativeType = shared ? null : node.type || node.tagName.toLowerCase()
    const exception = editorExceptions.find(item => node.matches(item.selector))
    const classification = shared ? 'shared' : exception ? 'editor' :
      ['checkbox', 'radio', 'range', 'file', 'color', 'date', 'time', 'datetime-local', 'month', 'week'].includes(nativeType) ? 'native' : 'ordinary-native-unmigrated'
    const classes = String(visual.className), size = /(?:^|\s)ant-[^\s]*-sm(?:\s|$)/.test(classes) ? 'small' : /(?:^|\s)ant-[^\s]*-lg(?:\s|$)/.test(classes) ? 'large' : 'middle'
    const layout = node.dataset.uiLayout || null
    const fixed = classification === 'shared' && ((kind === 'button' && layout === 'action') || ['input', 'password', 'select'].includes(kind))
    const item = { selector: selector(visual), fieldSelector: field ? selector(field) : selector(visual), kind, layout, size,
      expectedHeight: fixed ? { small: 28, middle: 40, large: 44 }[size] : null, nativeType, classification,
      disabled: Boolean(field?.matches(':disabled') || field?.getAttribute('aria-disabled') === 'true'),
      accessibleName: field?.getAttribute('aria-label') || node.getAttribute('aria-label') || node.textContent.trim().slice(0, 250),
      selectedForProbe: onlySelectors.some(target => node.matches(target) || visual.matches(target) || field?.matches(target)),
      ...observe(visual) }
    const css = getComputedStyle(visual)
    item.computed = { color: css.color, background: css.backgroundColor, border: css.borderTopColor, whiteSpace: css.whiteSpace,
      lineHeight: css.lineHeight, fontSize: css.fontSize, overflowX: css.overflowX, opacity: css.opacity }
    if (exception) item.semanticException = { selector: exception.selector, source: exception.source, reason: exception.reason }
    if (kind === 'password' && field) {
      const css = getComputedStyle(field)
      item.innerPadding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(name => Number.parseFloat(css[name]))
    }
    controls.push(item)
  }
  const measuredAnchors = anchors.map(target => {
    const matches = [...document.querySelectorAll(target)].filter(rendered)
    if (matches.length !== 1) throw Error('Expected one rendered anchor: ' + target + ' (' + matches.length + ')')
    return { selector: target, ...observe(matches[0]) }
  })
  const scrollOwners = new Set([area, ...area.querySelectorAll('*')])
  for (let owner = area.parentElement; owner; owner = owner.parentElement) scrollOwners.add(owner)
  const scrollAreas = []
  for (const owner of scrollOwners) {
    const css = getComputedStyle(owner), viewportScrollOwner = overflowViewport.isViewportScroller(owner)
    if (overflowViewport.propagated(owner) && !viewportScrollOwner) continue
    const overflowY = viewportScrollOwner ? overflowViewport.viewportOverflowY : css.overflowY
    const clientHeight = viewportScrollOwner ? viewport.height : owner.clientHeight
    if ((!viewportScrollOwner && !rendered(owner)) || !/auto|scroll/.test(overflowY) || owner.scrollHeight <= clientHeight + 1) continue
    const ownerBounds = bounds(owner), box = viewportScrollOwner ? viewport : ownerBounds, page = bounds(area), maximum = owner.scrollHeight - clientHeight
    const ancestor = owner !== area && owner.contains(area)
    const contentTop = viewportScrollOwner ? 0 : box.top + owner.clientTop
    const requiredContentStart = ancestor ? Math.max(0, Math.min(owner.scrollHeight, owner.scrollTop + page.top - contentTop)) : 0
    const requiredContentEnd = ancestor ? Math.max(requiredContentStart, Math.min(owner.scrollHeight, owner.scrollTop + page.bottom - contentTop)) : owner.scrollHeight
    const start = Math.max(0, Math.min(maximum, requiredContentStart))
    const end = Math.max(start, Math.min(maximum, requiredContentEnd - clientHeight))
    let visibleTop = Math.max(0, contentTop), visibleBottom = Math.min(viewport.bottom, contentTop + clientHeight)
    for (let parent = owner.parentElement; parent; parent = parent.parentElement) {
      const clipCss = getComputedStyle(parent), applied = overflowViewport.local(parent, clipCss)
      if (/hidden|auto|scroll|clip/.test(applied.y)) {
        const clip = bounds(parent), top = clip.top + parent.clientTop
        visibleTop = Math.max(visibleTop, top); visibleBottom = Math.min(visibleBottom, top + parent.clientHeight)
      }
    }
    const visibleHeight = painted(owner) ? Math.max(0, visibleBottom - visibleTop) : 0
    const visibleContentStart = Math.max(0, Math.min(owner.scrollHeight, owner.scrollTop + visibleTop - contentTop))
    const visibleContentEnd = Math.max(visibleContentStart, Math.min(owner.scrollHeight, visibleContentStart + visibleHeight))
    scrollAreas.push({ selector: selector(owner), clientHeight, scrollHeight: owner.scrollHeight, scrollTop: owner.scrollTop,
      rangeStart: start, rangeEnd: end, ancestor, bounds: box, requiredContentStart, requiredContentEnd,
      visibleHeight, visibleContentStart, visibleContentEnd, viewportScrollOwner, ownerBounds })
  }
  return { root, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, theme: document.documentElement.dataset.theme,
    rootBounds: bounds(area), controls, anchors: measuredAnchors, text: area.innerText, scrollAreas, overflowViewport: overflowViewport.record,
    overflow: { document: Math.max(0, document.documentElement.scrollWidth - innerWidth), root: Math.max(0, area.scrollWidth - area.clientWidth), allowed: [] } }
}

export function observeFullAppFocus(selector, visibleShadow, withinClientPort, readOverflowViewport) {
  const overflowViewport = readOverflowViewport(), viewport = overflowViewport.bounds
  const nodes = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0)
  if (nodes.length !== 1) throw Error('Expected one native focus target: ' + selector)
  const field = nodes[0], root = field.closest('.ant-input-affix-wrapper, .app-ui-select') || field
  const box = root.getBoundingClientRect(), outlines = [], shadows = []
  for (const [index, node] of [root, ...root.querySelectorAll('*')].entries()) {
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node)
    if (rect.width <= 0 || rect.height <= 0 || css.visibility !== 'visible' || Number(css.opacity) <= 0) continue
    if (css.outlineStyle !== 'none' && Number.parseFloat(css.outlineWidth) > 0 && visibleShadow('0 0 0 ' + css.outlineWidth + ' ' + css.outlineColor)) outlines.push({ owner: index ? node.tagName.toLowerCase() + ':' + index : 'root', width: Number.parseFloat(css.outlineWidth), color: css.outlineColor })
    if (visibleShadow(css.boxShadow)) shadows.push({ owner: index ? node.tagName.toLowerCase() + ':' + index : 'root', value: css.boxShadow })
  }
  const clippingAncestors = []
  let inViewport = box.left >= -1 && box.top >= -1 && box.right <= viewport.right + 1 && box.bottom <= viewport.bottom + 1
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent), clip = parent.getBoundingClientRect(), applied = overflowViewport.local(parent, css)
    inViewport &&= withinClientPort(box, clip, parent, applied.x, applied.y)
    clippingAncestors.push({ tag: parent.tagName, id: parent.id,
      bounds: { left: clip.left, top: clip.top, right: clip.right, bottom: clip.bottom, width: clip.width, height: clip.height },
      clientPort: { left: clip.left + parent.clientLeft, top: clip.top + parent.clientTop, width: parent.clientWidth, height: parent.clientHeight },
      overflowX: css.overflowX, overflowY: css.overflowY, appliedOverflowX: applied.x, appliedOverflowY: applied.y, viewportApplied: applied.viewportApplied })
  }
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return { selector, focused: document.activeElement === field, focusVisible: field.matches(':focus-visible'), inViewport,
    hit: Boolean(hit && (hit === root || root.contains(hit))), outlines, shadows, overflowViewport: overflowViewport.record, clippingAncestors }
}

export function ensureFullAppTargetVisible(selector, withinClientPort, readOverflowViewport) {
  const overflowViewport = readOverflowViewport(), viewport = overflowViewport.bounds
  const nodes = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
  if (nodes.length !== 1) throw Error('Missing or ambiguous actual scroll target')
  const node = nodes[0], box = node.getBoundingClientRect()
  let fits = box.left >= 0 && box.top >= 0 && box.right <= viewport.right && box.bottom <= viewport.bottom
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent), clip = parent.getBoundingClientRect(), applied = overflowViewport.local(parent, css)
    fits &&= withinClientPort(box, clip, parent, applied.x, applied.y, 0)
  }
  if (!fits) node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  return true
}

export function observeFullAppPopup(selector) {
  const nodes = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0)
  if (nodes.length !== 1) throw Error('Expected one actual shared Select')
  const field = nodes[0], host = field.closest('[data-ui-control="select"]')
  const listId = field.getAttribute('aria-controls') || field.getAttribute('aria-owns'), list = listId && document.getElementById(listId)
  const outer = list?.getAttribute('role') === 'listbox' && list.closest('.ant-select-dropdown')
  const bounds = node => { const b = node.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height } }
  const options = list ? [...list.querySelectorAll('[role="option"]')].map(node => ({ id: node.id,
    value: node.querySelector('[data-ui-option-value]')?.getAttribute('data-ui-option-value'), disabled: node.getAttribute('aria-disabled') === 'true',
    selected: node.getAttribute('aria-selected') === 'true', text: node.innerText, rect: bounds(node) })) : []
  const state = { inputId: field.id, activeOptionId: field.getAttribute('aria-activedescendant'), value: host ? JSON.parse(host.dataset.uiValue) : null, focused: document.activeElement === field,
    expanded: field.getAttribute('aria-expanded') === 'true', optionsAvailable: options.length > 0, options, popup: null }
  if (!outer) return state
  // A long real list may scroll to its selected item. Require an actually
  // visible enabled option, not an offscreen first item or a different popup.
  for (const candidate of options.filter(option => !option.disabled && typeof option.value === 'string')) {
    const option = [...list.querySelectorAll('[role="option"]')].find(node => node.id === candidate.id)
    const item = bounds(option), content = bounds(list), root = bounds(outer), ancestors = []
    for (let node = option; node; node = node.parentElement) {
      const css = getComputedStyle(node)
      ancestors.push({ tag: node.tagName.toLowerCase(), id: node.id, class: node.getAttribute('class'), display: css.display, visibility: css.visibility, opacity: css.opacity, pointerEvents: css.pointerEvents })
    }
    const positive = rect => [rect.width, rect.height].every(value => Number.isFinite(value) && value > 0)
    const visible = option.isConnected && [root, content, item].every(positive) && ancestors.every(css => css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0)
    const inViewport = item.left >= 0 && item.top >= 0 && item.right <= innerWidth + 1 && item.bottom <= innerHeight + 1
    const point = { x: item.left + item.width / 2, y: item.top + item.height / 2 }, hit = visible && inViewport ? document.elementFromPoint(point.x, point.y) : null
    const ownedHit = Boolean(hit && (hit === option || option.contains(hit)))
    const popup = { listId, optionId: option.id, optionValue: candidate.value, root, content, item, ancestors, visible, inViewport, ownedHit, point,
      ready: state.expanded && state.optionsAvailable && visible && inViewport && ownedHit }
    if (!state.popup || popup.ready) state.popup = popup
    if (popup.ready) break
  }
  return state
}

export function validateFullAppPageSample(sample, expected, { requireControls = false } = {}) {
  assert.deepEqual(sample.viewport, expected.viewport, 'Actual renderer viewport changed')
  assert.equal(sample.theme, expected.theme, 'Actual page theme differs from matrix')
  assert.ok(sample.devicePixelRatio > 0)
  assert.ok(sample.overflow.document <= 1, 'Actual document has horizontal overflow')
  assert.ok(sample.overflow.root <= 1, 'Actual page root has horizontal overflow')
  if (requireControls) assert.ok(sample.controls.length, 'Expected actual page controls')
  for (const item of sample.controls) {
    assert.ok(item.visible && item.inViewport && (item.disabled || item.hit), 'Actual control is hidden, clipped or obscured: ' + item.selector)
    assert.ok(item.width > 0 && item.height > 0)
    assert.ok(['shared', 'native', 'editor', 'content'].includes(item.classification), 'Ordinary native control has no migration/exception proof: ' + item.selector)
    if (item.expectedHeight !== null) assert.ok(Math.abs(item.height - heights[item.size]) <= 0.6, 'Shared control height differs from production tokens: ' + item.selector)
    if (item.innerPadding) assert.deepEqual(item.innerPadding, [0, 0, 0, 0], 'Password inner field has duplicate padding')
  }
  for (const item of sample.anchors) assert.ok(item.visible && item.inViewport && item.hit && item.width > 0 && item.height > 0, 'Actual page anchor is clipped or obscured: ' + item.selector)
  return sample
}

export async function captureActualFullAppPopup({ receipt, read, capture, filename, save }) {
  const signature = sample => JSON.stringify([sample.inputId, sample.value, sample.popup?.listId, sample.popup?.optionId,
    sample.options.map(option => [option.id, option.value, option.disabled, option.selected])])
  const expected = await read()
  assert.ok(expected.popup?.ready && expected.popup.paintFrames === 2)
  receipt.capture = { complete: false, initialObservation: expected }; receipt.popup = expected.popup; save()
  const image = await capture(filename, async () => {
    const sample = await read()
    assert.ok(sample.popup?.ready && sample.popup.paintFrames === 2)
    assert.equal(signature(sample), signature(expected), 'Owned popup changed before capture')
    receipt.capture.before = sample; receipt.capture.preCaptureGuard = sample; receipt.popup = sample.popup; save(); return true
  })
  receipt.image = image; receipt.capture.image = image; receipt.capture.filename = image.filename
  receipt.capture.after = await read(); save()
  assert.ok(receipt.capture.after.popup?.ready && receipt.capture.after.popup.paintFrames === 2, 'Owned popup ceased to be visible after the actual PNG')
  assert.equal(signature(receipt.capture.after), signature(expected), 'Owned popup changed across the actual PNG')
  receipt.capture.complete = true; save()
  return receipt
}

export function validateFullAppCaptureContinuity(before, actual, matrix) {
  assert.equal(actual.root, before.root, 'Actual page root changed across the native PNG')
  assert.deepEqual(actual.viewport, before.viewport); assert.equal(actual.theme, before.theme)
  assert.ok(actual.rootBounds.width > 0 && actual.rootBounds.height > 0 && actual.rootBounds.right > 0 && actual.rootBounds.left < matrix.viewport.width && actual.rootBounds.bottom > 0 && actual.rootBounds.top < matrix.viewport.height, 'Actual page root is outside its native PNG')
  for (const name of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(actual.rootBounds[name] - before.rootBounds[name]) <= 0.6, 'Actual page root moved across the native PNG')
  const sameGeometry = (previous, current) => {
    assert.ok(current, 'Actual target disappeared across the native PNG: ' + previous.selector)
    for (const name of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(current[name] - previous[name]) <= 0.6, 'Actual target moved across the native PNG: ' + previous.selector)
    return current
  }
  const controls = before.controls.map(control => {
    const matches = actual.controls.filter(item => item.selector === control.selector)
    assert.equal(matches.length, 1, 'Actual control missing or ambiguous at PNG boundary')
    const current = sameGeometry(control, matches[0])
    for (const key of ['fieldSelector', 'kind', 'classification', 'size', 'layout', 'expectedHeight', 'disabled']) assert.deepEqual(current[key], control[key], 'Actual control identity or state changed at PNG boundary: ' + key)
    return current
  })
  const anchors = before.anchors.map(anchor => {
    const matches = actual.anchors.filter(item => item.selector === anchor.selector)
    assert.equal(matches.length, 1, 'Actual anchor missing or ambiguous at PNG boundary')
    return sameGeometry(anchor, matches[0])
  })
  return validateFullAppPageSample({ ...actual, controls, anchors }, matrix)
}

export function measureFullAppScrollCoverage(surface, samples, images) {
  const start = surface.requiredContentStart, end = surface.requiredContentEnd
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start && end <= surface.scrollHeight)
  const intervals = []
  for (const image of images) {
    const pair = ['before-capture', 'after-capture'].map(phase => samples.find(sample => sample.phase === phase && sample.image === image.filename)?.scrollAreas.find(item => item.selector === surface.selector))
    if (pair.some(item => !item)) continue
    for (const actual of pair) {
      assert.equal(actual.scrollHeight, surface.scrollHeight); assert.equal(actual.clientHeight, surface.clientHeight)
      assert.ok(Math.abs(actual.requiredContentStart - start) <= 1 && Math.abs(actual.requiredContentEnd - end) <= 1, 'Actual long-page content range changed')
      assert.ok(Number.isFinite(actual.visibleContentStart) && Number.isFinite(actual.visibleContentEnd) && actual.visibleContentEnd >= actual.visibleContentStart)
    }
    const from = Math.max(start, pair[0].visibleContentStart, pair[1].visibleContentStart)
    const to = Math.min(end, pair[0].visibleContentEnd, pair[1].visibleContentEnd)
    if (to > from) intervals.push({ from, to, image: image.filename })
  }
  intervals.sort((a, b) => a.from - b.from || a.to - b.to)
  const gaps = []; let cursor = start
  for (const interval of intervals) {
    if (interval.from > cursor + 1) gaps.push({ from: cursor, to: interval.from })
    cursor = Math.max(cursor, interval.to)
  }
  if (cursor < end - 1) gaps.push({ from: cursor, to: end })
  return { contentStart: start, contentEnd: end, observedIntervals: intervals, gaps, complete: intervals.length > 0 && gaps.length === 0 }
}

export function createFullAppUiShared(ctx) {
  const { evaluate, click, cdp, until, capture, report, save } = ctx
  const ui = report.fullAppUi
  const frame = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
  const originalSelect = createNativeUiSelect({ evaluate, click, cdp, until })
  const nativeSelect = { inspect: originalSelect.inspect, value: originalSelect.value, choose: async (selector, value) => {
    assert.equal((await originalSelect.inspect(selector)).kind, 'shared', 'Current App acceptance requires the actual migrated shared Select')
    return originalSelect.choose(selector, value)
  } }
  const events = from => evaluate(`window.__fullAppUiEvents.slice(${Number(from)})`)
  const eventCount = () => evaluate('window.__fullAppUiEvents.length')
  const binding = ({ routeId, stateId }) => ({ group: ui.group, routeId, stateId, theme: ctx.matrix.theme, viewport: { ...ctx.matrix.viewport } })
  const routeFor = routeId => { const route = ctx.routes.find(route => route.id === routeId); assert.ok(route, 'Unregistered actual route: ' + routeId); return route }
  const key = async (name, modifiers = 0) => {
    const code = keyCodes[name] ?? (name.length === 1 ? name.toUpperCase().charCodeAt(0) : undefined)
    assert.ok(code, 'Unsupported native key: ' + name)
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
  }
  const ensureVisible = async selector => {
    await evaluate(`(${ensureFullAppTargetVisible.toString()})(${q(selector)},${withinActualClientPort.toString()},${observeFullAppOverflowViewport.toString()})`)
    await frame()
  }
  const text = async (selector, value) => {
    await ensureVisible(selector); await click(selector); await key('a', 2)
    if (String(value)) await cdp.send('Input.insertText', { text: String(value) }); else await key('Backspace')
    await until(() => evaluate(`document.querySelector(${q(selector)})?.value===${q(String(value))}`), 'Actual text input did not settle')
  }
  const hover = async selector => {
    await ensureVisible(selector)
    const point = await evaluate(`(() => {const nodes=[...document.querySelectorAll(${q(selector)})].filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0);if(nodes.length!==1)throw Error('Missing or ambiguous native hover target');const box=nodes[0].getBoundingClientRect();return {x:box.left+box.width/2,y:box.top+box.height/2}})()`)
    assert.ok(point.x >= 0 && point.y >= 0 && point.x <= ctx.matrix.viewport.width && point.y <= ctx.matrix.viewport.height)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, buttons: 0 })
    await frame(); return point
  }
  const chooseFile = async (selector, fixture) => {
    const owned = report.fixtureInputs?.find(item => item.path === fixture.path && item.name === fixture.name && item.bytes === fixture.bytes && item.sha256 === fixture.sha256)
    assert.ok(owned, 'Only an exact runner-owned synthetic input file may be selected')
    const input = await evaluate(`(() => {const nodes=[...document.querySelectorAll(${q(selector)})];if(nodes.length!==1)throw Error('Missing or ambiguous native file input');const node=nodes[0];return {tag:node.tagName,type:node.type,disabled:node.matches(':disabled')}})()`)
    assert.equal(input.tag, 'INPUT'); assert.equal(input.type, 'file'); assert.equal(input.disabled, false)
    const first = await eventCount()
    await cdp.send('DOM.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    assert.ok(nodeId)
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: [fixture.path] })
    const observed = await until(async () => {
      const samples = await events(first)
      return samples.some(event => event.type === 'change' && event.tag === 'INPUT' && event.trusted && event.fileCount === 1) && samples
    }, 'Actual browser file input did not emit its trusted change')
    const receipt = { selector, file: { ...owned }, input, events: observed, nativeInput: 'DOM.setFileInputFiles', complete: true }
    ;(ui.fileInputs ||= []).push(receipt); save(); return receipt
  }
  const nameFor = (meta, suffix) => `${slug(meta.group)}-${slug(meta.theme)}-${meta.viewport.width}x${meta.viewport.height}-${slug(meta.routeId)}-${slug(meta.stateId)}-${suffix}.png`
  const samplePage = (route, root, anchors, onlySelectors = []) => evaluate(`(${observeFullAppPage.toString()})(${q({ root, anchors, onlySelectors, editorExceptions: route.editorExceptions || [] })},${withinActualClientPort.toString()},${observeFullAppOverflowViewport.toString()})`)
  const captureState = async ({ routeId, stateId, root, anchors = [], requiredText = [], allowHorizontalScroll = [], coverageMode = 'route-controls', onlySelectors = [] }) => {
    const route = routeFor(routeId), registeredRoot = route.stateRoots?.[stateId] || route.root
    root ||= registeredRoot
    assert.ok(route.requiredStates.includes(stateId), 'Unregistered actual route state: ' + routeId + '/' + stateId)
    assert.equal(root, registeredRoot, 'An actual page state must use its independently registered root')
    const meta = binding({ routeId, stateId })
    assert.equal(ui.scenes.some(scene => scene.routeId === routeId && scene.stateId === stateId && scene.theme === meta.theme && scene.viewport.width === meta.viewport.width && scene.viewport.height === meta.viewport.height), false, 'Duplicate actual page scene')
    assert.equal(ctx.windowReceipt?.nativeWindow, true, 'Actual owned native window receipt is required before a scene')
    assert.deepEqual(ctx.windowReceipt.viewport, ctx.matrix.viewport)
    const scene = { ...meta, requested: { ...ctx.windowReceipt.requested }, nativeWindow: ctx.windowReceipt.nativeWindow, root, coverageMode, complete: false,
      controls: [], anchors: [], images: [], geometry: { valid: false, failures: [] }, rawSamples: [], scrollCoverage: [], disclosures: [], motionReadiness: [] }
    ui.scenes.push(scene); save()
    const seen = new Map(), wanted = new Map(), capturedAnchors = new Map()
    let index = 0
    const snap = async targetAnchors => {
      const motion = { complete: false }; scene.motionReadiness.push(motion)
      await waitForFiniteOwnerMotion(() => evaluate(`(${observeFullAppOwnerMotion.toString()})(${q(root)})`), until, motion)
      const before = await samplePage(route, root, targetAnchors, onlySelectors)
      assert.deepEqual(before.viewport, meta.viewport); assert.equal(before.theme, meta.theme)
      for (const text of requiredText) assert.ok(before.text.includes(text), 'Actual visible page text missing: ' + text)
      const considered = coverageMode === 'owned-popup' ? before.controls.filter(control => control.selectedForProbe) : before.controls
      if (coverageMode === 'owned-popup') assert.equal(considered.length, 1, 'Owned popup scene must measure its actual single trigger')
      for (const item of considered) wanted.set(item.selector, item)
      const controls = considered.filter(item => item.visible && item.inViewport)
      const measured = { ...before, controls, overflow: { ...before.overflow, allowed: allowHorizontalScroll } }
      scene.rawSamples.push({ ...before, text: undefined }); save()
      let afterCapture
      const filename = nameFor(meta, 'part-' + (++index))
      motion.image = filename
      const image = await capture(filename, async () => {
        const fresh = await samplePage(route, root, targetAnchors, onlySelectors)
        scene.rawSamples.push({ ...fresh, text: undefined, phase: 'before-capture', image: filename }); save()
        validateFullAppCaptureContinuity(measured, fresh, ctx.matrix)
        return true
      })
      scene.images.push(image); scene.image ||= image; scene.devicePixelRatio = before.devicePixelRatio
      for (const item of controls) seen.set(item.selector, { ...item, image: image.filename })
      for (const item of before.anchors) capturedAnchors.set(item.selector, { ...item, image: image.filename })
      scene.controls = [...seen.values()]; scene.anchors = [...capturedAnchors.values()]; scene.overflow = measured.overflow; save()
      validateFullAppPageSample(measured, ctx.matrix)
      afterCapture = await samplePage(route, root, targetAnchors, onlySelectors)
      scene.rawSamples.push({ ...afterCapture, text: undefined, phase: 'after-capture', image: image.filename }); save()
      validateFullAppCaptureContinuity(measured, afterCapture, ctx.matrix)
      return image
    }
    try {
      if (anchors.length) { await ensureVisible(anchors[0]); await snap([anchors[0]]) }
      else {
        const initial = await samplePage(route, root, [])
        const first = initial.controls.find(control => control.width <= meta.viewport.width && control.height <= meta.viewport.height)
        assert.ok(first, 'A page state needs a real small visible anchor, even when it has no controls')
        await ensureVisible(first.selector); await snap([first.selector])
      }
      for (const anchor of anchors.slice(1)) { await ensureVisible(anchor); await snap([anchor]) }
      if (coverageMode === 'route-controls') {
        while ([...wanted.keys()].some(selector => !seen.has(selector))) {
          assert.ok(index < 64, 'Actual page did not fit the bounded native scroll sweep')
          const pending = [...wanted.values()].find(item => !seen.has(item.selector))
          await ensureVisible(pending.selector); const beforeCount = seen.size
          if (!pending.visible) {
            const start = await eventCount(), point = await hover(pending.selector)
            const fresh = await until(async () => {
              const sample = await samplePage(route, root, [])
              const item = sample.controls.find(item => item.selector === pending.selector)
              return item?.visible && item.inViewport && (item.disabled || item.hit) && item
            }, 'Actual hover did not reveal the existing control')
            scene.disclosures.push({ selector: pending.selector, action: 'native-pointer-hover', point, before: pending, after: fresh, events: await events(start) }); save()
          }
          await snap([pending.selector])
          assert.ok(seen.size > beforeCount, 'Rendered control cannot be made reachable without changing layout: ' + pending.selector)
        }
        // Controls alone do not cover a long report. Sweep actual existing
        // scroll surfaces over the route's full vertical extent, preserving
        // native layout and recording every real scroll position and PNG.
        const surfaces = (await samplePage(route, root, [])).scrollAreas
        for (const surface of surfaces) {
          const covered = { ...surface, positions: [], complete: false }; scene.scrollCoverage.push(covered); save()
          if (!surface.ancestor) {
            await evaluate(`(() => {const node=document.querySelector(${q(surface.selector)});if(!node)throw Error('Actual scroll surface disappeared');node.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});return true})()`)
            await frame()
          }
          const visible = (await samplePage(route, root, [])).scrollAreas.find(item => item.selector === surface.selector)
          assert.ok(visible?.visibleHeight > 0, 'Actual long-text scroll surface has no painted viewport')
          const step = Math.max(1, Math.floor(visible.visibleHeight * 0.75))
          covered.step = step
          const positions = []
          for (let value = surface.rangeStart; value < surface.rangeEnd; value += step) positions.push(value)
          positions.push(surface.rangeEnd)
          for (const position of positions) {
            assert.ok(index < 64, 'Long page exceeds the bounded native image sweep')
            const actual = await evaluate(`(() => {const node=document.querySelector(${q(surface.selector)});if(!node)throw Error('Actual scroll surface disappeared');node.scrollTo({top:${Number(position)},behavior:'instant'});return node.scrollTop})()`)
            await frame()
            assert.ok(Math.abs(actual - position) <= 1, 'Native scroll surface did not reach its requested actual position')
            const sample = await samplePage(route, root, [])
            assert.ok(sample.rootBounds.bottom > 0 && sample.rootBounds.top < meta.viewport.height, 'Actual route is outside the screenshot')
            const visibleSurface = sample.scrollAreas.find(item => item.selector === surface.selector)
            assert.ok(visibleSurface && visibleSurface.bounds.bottom > 0 && visibleSurface.bounds.top < meta.viewport.height, 'Actual long-text surface is outside the screenshot')
            const image = await snap([])
            covered.positions.push({ requested: position, actual, bounds: visibleSurface.bounds, image: image.filename }); save()
          }
          save()
        }
        for (const surface of scene.scrollCoverage) {
          Object.assign(surface, measureFullAppScrollCoverage(surface, scene.rawSamples, scene.images)); save()
          assert.equal(surface.complete, true, 'Actual long-page content contains an unphotographed interval: ' + surface.selector)
        }
      }
      scene.controlCoverage = { renderedCount: wanted.size, observedCount: seen.size, unobserved: [...wanted.keys()].filter(selector => !seen.has(selector)) }
      assert.deepEqual(scene.controlCoverage.unobserved, [])
      scene.geometry = { valid: true, failures: [] }; scene.complete = true; save(); return scene
    } catch (error) {
      scene.geometry.failures.push({ message: String(error.message), actual: error.actual, expected: error.expected, operator: error.operator }); save()
      try { scene.failureImage = await capture(nameFor(meta, 'failure')); save() }
      catch (diagnostic) { scene.failureImageError = String(diagnostic.message); save() }
      throw error
    }
  }
  const focus = async (selector, meta) => {
    routeFor(meta.routeId); await ensureVisible(selector)
    const first = await eventCount(), field = await evaluate(`(()=>{const n=document.querySelector(${q(selector)});return {tag:n?.tagName,type:n?.type}})()`)
    if (field.tag === 'TEXTAREA' || (field.tag === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(field.type))) {
      const select = await nativeSelect.inspect(selector)
      if (select.kind === 'shared') {
        if (!select.expanded) await click('[data-ui-control="select"]:has([role="combobox"][id=' + q(select.inputId) + '])')
        await until(async () => (await nativeSelect.inspect(selector)).expanded, 'Actual focus Select did not open')
        await key('Escape')
        await until(async () => !(await nativeSelect.inspect(selector)).expanded, 'Actual focus Select did not close')
      } else await click(selector)
    }
    await key('Tab', 8)
    let reached = false
    for (let index = 0; index < 256; index++) {
      await key('Tab')
      if (await evaluate(`document.activeElement===document.querySelector(${q(selector)})`)) { reached = true; break }
    }
    assert.equal(reached, true, 'Actual Tab order never reached control: ' + selector)
    const sample = { ...binding(meta), ...await evaluate(`(${observeFullAppFocus.toString()})(${q(selector)},${hasVisibleBoxShadow.toString()},${withinActualClientPort.toString()},${observeFullAppOverflowViewport.toString()})`) }
    sample.events = await events(first); sample.trustedTab = sample.events.some(event => event.type === 'keydown' && event.key === 'Tab' && event.trusted)
    ui.focus.push(sample); save()
    assert.ok(sample.trustedTab && sample.focused && sample.focusVisible && sample.inViewport && sample.hit, 'Actual keyboard focus was not visible and reachable')
    assert.equal(sample.outlines.length, 1, 'Actual control has no single focus outline'); assert.deepEqual(sample.shadows, [], 'Actual control has duplicate focus glow')
    return sample
  }
  const select = async (selector, { routeId, stateId, value, restore = true, captureScene = true }) => {
    const route = routeFor(routeId), meta = binding({ routeId, stateId }), first = await eventCount()
    await ensureVisible(selector)
    const before = await nativeSelect.inspect(selector)
    assert.equal(before.kind, 'shared'); assert.equal(before.disabled, false); assert.equal(before.multiple, false)
    const trigger = '[data-ui-control="select"]:has([role="combobox"][id=' + q(before.inputId) + '])'
    const opened = async () => {
      const read = paintedPopupReader(() => evaluate(`(${observeFullAppPopup.toString()})(${q(selector)})`), frame)
      await until(async () => { const state = await read(); return state.popup?.ready && state.popup.paintFrames === 2 && state }, 'Actual owned popup never painted')
      return read
    }
    if (!before.expanded) await click(trigger)
    const read = await opened(), receipt = { ...meta, selector, interactionMode: 'selection', beforeValue: before.value, complete: false }
    ui.popups.push(receipt); save()
    await captureActualFullAppPopup({ receipt, read, capture, filename: nameFor(meta, 'popup-' + ui.popups.length), save })
    if (captureScene) await captureState({ routeId, stateId, anchors: [trigger], coverageMode: 'owned-popup', onlySelectors: [selector, trigger] })
    await click(trigger)
    await until(async () => !(await nativeSelect.inspect(selector)).expanded, 'Repeated actual trigger did not close'); receipt.repeatClosed = true
    await key('ArrowDown'); await opened(); await key('Escape')
    await until(async () => !(await nativeSelect.inspect(selector)).expanded, 'Escape did not close actual popup'); receipt.escapeClosed = true
    assert.equal((await nativeSelect.inspect(selector)).value, before.value, 'Escape changed the actual selected value')
    await click(trigger); await opened(); const choices = (await nativeSelect.inspect(selector)).options.filter(option => !option.disabled)
    const requested = value === undefined ? choices.find(option => option.value !== before.value)?.value ?? before.value : value
    assert.equal(typeof requested, 'string'); assert.ok(choices.some(option => option.value === requested))
    await nativeSelect.choose(selector, requested); receipt.pointerCommitted = (await nativeSelect.inspect(selector)).value === requested
    await key('ArrowDown'); await opened(); await key('ArrowDown')
    const keyboardTarget = await until(async () => {
      const state = await evaluate(`(${observeFullAppPopup.toString()})(${q(selector)})`)
      return state.options.find(option => option.id === state.activeOptionId && !option.disabled)
    }, 'Actual keyboard active option is not owned by this popup')
    await key('Enter')
    await until(async () => !(await nativeSelect.inspect(selector)).expanded, 'Keyboard did not commit the actual popup')
    receipt.keyboardValue = (await nativeSelect.inspect(selector)).value
    assert.equal(receipt.keyboardValue, keyboardTarget.value, 'ArrowDown/Enter did not select the actual active option'); receipt.keyboardCommitted = true
    if (restore) { await click(trigger); await opened(); await nativeSelect.choose(selector, before.value) }
    const after = await nativeSelect.inspect(selector); receipt.afterValue = after.value; receipt.focusReturned = after.focused
    if (restore) assert.equal(after.value, before.value)
    receipt.events = await events(first); receipt.trustedPointer = receipt.events.some(event => event.type === 'click' && event.trusted)
    receipt.trustedKeyboard = ['ArrowDown', 'Enter', 'Escape'].every(key => receipt.events.some(event => event.type === 'keydown' && event.key === key && event.trusted))
    receipt.complete = true; save(); assert.ok(receipt.pointerCommitted && receipt.keyboardCommitted && receipt.focusReturned && receipt.trustedPointer && receipt.trustedKeyboard)
    return receipt
  }
  const selectPreview = async (selector, { routeId, stateId, captureScene = true }) => {
    const route = routeFor(routeId), meta = binding({ routeId, stateId }), first = await eventCount()
    await ensureVisible(selector)
    const before = await nativeSelect.inspect(selector)
    assert.equal(before.kind, 'shared'); assert.equal(before.disabled, false); assert.equal(before.multiple, false)
    const trigger = '[data-ui-control="select"]:has([role="combobox"][id=' + q(before.inputId) + '])'
    const opened = async () => {
      const read = paintedPopupReader(() => evaluate(`(${observeFullAppPopup.toString()})(${q(selector)})`), frame)
      await until(async () => { const sample = await read(); return sample.popup?.ready && sample.popup.paintFrames === 2 && sample }, 'Actual preview popup never painted')
      return read
    }
    if (!before.expanded) await click(trigger)
    const read = await opened(), receipt = { ...meta, selector, interactionMode: 'preview', beforeValue: before.value, pointerOpened: true, complete: false }
    ui.popups.push(receipt); save()
    await captureActualFullAppPopup({ receipt, read, capture, filename: nameFor(meta, 'popup-' + ui.popups.length), save })
    if (captureScene) await captureState({ routeId, stateId, anchors: [trigger], coverageMode: 'owned-popup', onlySelectors: [selector, trigger] })
    await click(trigger)
    await until(async () => !(await nativeSelect.inspect(selector)).expanded, 'Repeated pointer did not close the preview popup'); receipt.repeatClosed = true
    await key('ArrowDown'); await opened(); receipt.keyboardOpened = true
    await key('Escape'); await until(async () => !(await nativeSelect.inspect(selector)).expanded, 'Escape did not close preview popup')
    const after = await nativeSelect.inspect(selector)
    receipt.afterValue = after.value; receipt.escapeClosed = true; receipt.focusReturned = after.focused
    receipt.events = await events(first); receipt.trustedPointer = receipt.events.some(event => event.type === 'click' && event.trusted)
    receipt.trustedKeyboard = ['ArrowDown', 'Escape'].every(key => receipt.events.some(event => event.type === 'keydown' && event.key === key && event.trusted))
    assert.equal(after.value, before.value, 'Preview-only popup changed the actual value')
    assert.equal(receipt.events.some(event => event.type === 'keydown' && event.key === 'Enter'), false, 'Preview-only gate must not commit a format')
    assert.ok(receipt.focusReturned && receipt.trustedPointer && receipt.trustedKeyboard)
    receipt.complete = true; save(); return receipt
  }
  const collapseSidebar = async () => {
    const state = await evaluate(`(() => {const side=document.querySelector('.workspace-sidebar'); const button=side?.querySelector('[aria-label="折叠侧边栏"]'); return {narrow:innerWidth<=820,expanded:Boolean(button&&button.getBoundingClientRect().width>0)} })()`)
    if (state.narrow && state.expanded) { await click('.workspace-sidebar [aria-label="折叠侧边栏"]'); await until(() => evaluate('!document.querySelector(' + q('.workspace-sidebar [aria-label="折叠侧边栏"]') + ')'), 'Actual sidebar did not collapse') }
  }
  const openSettings = async () => {
    if (await evaluate('Boolean(document.querySelector(".settings-panel"))')) return
    await collapseSidebar(); await click('[aria-label="更多功能"]'); await click({ selector: '.workspace-sidebar-more-menu [role="menuitem"]', text: '设置' })
    await until(() => evaluate('Boolean(document.querySelector(".settings-panel"))'), 'Actual Settings entry did not mount')
  }
  const closeSettings = async () => { if (await evaluate('Boolean(document.querySelector(".settings-panel"))')) { await click('.settings-panel [aria-label="返回笔记"]'); await until(() => evaluate('!document.querySelector(".settings-panel")'), 'Actual Settings entry did not close') } }
  const openSearch = async () => { await closeSettings(); await collapseSidebar(); if (!(await evaluate('Boolean(document.querySelector(".global-search-panel"))'))) { await click('[aria-label="搜索笔记"]'); await until(() => evaluate('Boolean(document.querySelector(".global-search-panel"))'), 'Actual Search entry did not mount') } }
  const closeSearch = async () => { if (await evaluate('Boolean(document.querySelector(".global-search-panel"))')) { await click('[aria-label="关闭全局检索"]'); await until(() => evaluate('!document.querySelector(".global-search-panel")'), 'Actual Search entry did not close') } }
  const enterWorkspace = async (ariaLabel, root) => { await closeSearch(); await closeSettings(); await collapseSidebar(); await click('[aria-label=' + q(ariaLabel) + ']'); await until(() => evaluate('Boolean(document.querySelector(' + q(root) + '))'), 'Actual workspace did not mount: ' + root) }
  return { frame, key, text, ensureVisible, hover, chooseFile, nativeSelect, focus, select, selectPreview, captureState, openSettings, closeSettings, openSearch, closeSearch, enterWorkspace, collapseSidebar }
}
