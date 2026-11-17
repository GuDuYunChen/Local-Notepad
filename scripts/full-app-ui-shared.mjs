import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createNativeUiSelect } from './native-ui-select.mjs'
import controlEvidence from './check-ui-control-render.cjs'
import { COLLAPSED_SIDEBAR_EXPAND, validateCollapsedSidebarObservation, validateCollapsedSidebarFocus } from './full-app-ui-evidence.mjs'
import { decoratorKeyboardKind, traverseDecoratorWithNativeKeys } from './full-app-ui-decorator-keyboard.mjs'

const { hasVisibleBoxShadow, paintedPopupReader } = controlEvidence
const q = JSON.stringify
const heights = { small: 28, middle: 40, large: 44 }
const keyCodes = { Tab: 9, Enter: 13, Escape: 27, Backspace: 8, Delete: 46, Home: 36, End: 35,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, F6: 117, F10: 121, ' ': 32, a: 65 }
const slug = value => String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 90)

export function withinActualClientPort(rect, bounds, metrics, overflowX, overflowY, tolerance = 1) {
  for (const name of ['clientLeft', 'clientTop', 'clientWidth', 'clientHeight']) if (!Number.isFinite(metrics[name]) || metrics[name] < 0) throw Error('Actual client-port metrics are required')
  const left = bounds.left + metrics.clientLeft, top = bounds.top + metrics.clientTop
  return (!/hidden|auto|scroll|clip/.test(overflowX) || (rect.left >= left - tolerance && rect.right <= left + metrics.clientWidth + tolerance)) &&
    (!/hidden|auto|scroll|clip/.test(overflowY) || (rect.top >= top - tolerance && rect.bottom <= top + metrics.clientHeight + tolerance))
}


/* CSS fixed elements escape ordinary ancestors' overflow, but not a
   transform/filter/contain-created fixed containing block. This boundary
   never replaces the actual viewport, modal scroll-port or painted hit gates. */
export function viewportFixedClipBoundary(node, readStyle = getComputedStyle) {
  for (let fixed = node; fixed; fixed = fixed.parentElement) {
    if (readStyle(fixed).position !== 'fixed') continue
    let contained = false
    for (let ancestor = fixed.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const css = readStyle(ancestor)
      if ((css.transform && css.transform !== 'none') ||
          (css.perspective && css.perspective !== 'none') ||
          (css.filter && css.filter !== 'none') ||
          (css.backdropFilter && css.backdropFilter !== 'none') ||
          (css.translate && css.translate !== 'none') ||
          (css.rotate && css.rotate !== 'none') ||
          (css.scale && css.scale !== 'none') ||
          ['layout', 'paint', 'content', 'strict'].some(word => String(css.contain || '').split(' ').includes(word)) ||
          ['transform', 'perspective', 'filter', 'backdrop-filter'].some(word => String(css.willChange || '').includes(word)) ||
          css.contentVisibility === 'auto' || css.contentVisibility === 'hidden') {
        contained = true
        break
      }
    }
    if (!contained) return fixed
  }
  return null
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
// An uncontained viewport-fixed dialog is independent of any scrollable app
// surface behind its overlay. Keep its own nested scrollports and the fixed
// boundary, but never sweep ancestors above that boundary as page content.
export function collectFullAppScrollOwners(area, fixedBoundaryFor = () => null) {
  const owners = new Set([area, ...area.querySelectorAll('*')])
  const fixedBoundary = fixedBoundaryFor(area)
  if (fixedBoundary !== area) {
    for (let owner = area.parentElement; owner; owner = owner.parentElement) {
      owners.add(owner)
      if (owner === fixedBoundary) break
    }
  }
  return owners
}

export function observeFullAppPage({ root, anchors = [], editorExceptions = [], onlySelectors = [] }, withinClientPort, readOverflowViewport, fixedBoundaryFor = () => null) {
  const overflowViewport = readOverflowViewport(), viewport = overflowViewport.bounds
  // One synchronous renderer observation repeatedly visits the same ancestors
  // for each control, anchor and scroll surface. Reuse only native reads made
  // during this call. Every later observation (including both PNG boundaries)
  // starts fresh, so scroll, style, disabled state and owner changes stay real.
  const styles = new Map(), rectangles = new Map(), selectors = new Map()
  const style = node => {
    if (!styles.has(node)) styles.set(node, getComputedStyle(node))
    return styles.get(node)
  }
  const fixedBoundary = node => fixedBoundaryFor(node, style)
  const bounds = node => {
    if (rectangles.has(node)) return rectangles.get(node)
    const box = node.getBoundingClientRect()
    const value = { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
    rectangles.set(node, value)
    return value
  }
  const hiddenByClosedDetails = node => {
    // Closed native details may retain nonzero descendant boxes. Only its
    // first direct summary subtree participates in this rendered state.
    for (let owner = node.parentElement; owner; owner = owner.parentElement) {
      if (owner.tagName !== 'DETAILS' || owner.open) continue
      const summary = [...owner.children].find(child => child.tagName === 'SUMMARY')
      if (!summary?.contains(node)) return true
    }
    return false
  }
  const painted = node => {
    if (hiddenByClosedDetails(node)) return false
    for (let owner = node; owner; owner = owner.parentElement) {
      const css = style(owner)
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) <= 0) return false
    }
    return true
  }
  const rendered = node => {
    if (!node.isConnected || hiddenByClosedDetails(node)) return false
    for (let owner = node; owner; owner = owner.parentElement) if (style(owner).display === 'none') return false
    const box = bounds(node)
    return box.width > 0 && box.height > 0
  }
  const visibleRoots = [...document.querySelectorAll(root)].filter(rendered)
  if (visibleRoots.length !== 1) throw Error('Expected one actual page root: ' + root + ' (' + visibleRoots.length + ')')
  const area = visibleRoots[0]
  const readSelector = node => {
    if (node === document.documentElement) return 'html'
    if (node.id && document.querySelectorAll('[id=' + JSON.stringify(node.id) + ']').length === 1) return '[id=' + JSON.stringify(node.id) + ']'
    const parts = []
    for (let owner = node; owner && owner !== document.documentElement; owner = owner.parentElement) {
      parts.unshift(owner.tagName.toLowerCase() + ':nth-child(' + ([...owner.parentElement.children].indexOf(owner) + 1) + ')')
      if (owner === area) return root + (parts.length > 1 ? ' > ' + parts.slice(1).join(' > ') : '')
    }
    return 'html > ' + parts.join(' > ')
  }
  const selector = node => {
    if (!selectors.has(node)) selectors.set(node, readSelector(node))
    return selectors.get(node)
  }
  const observe = (node, checkPaintedFragments = false) => {
    const box = bounds(node), visible = painted(node), clippingAncestors = []
    const clipBoundary = fixedBoundary(node)
    let beyondFixed = clipBoundary === node
    let inViewport = box.left >= -1 && box.top >= -1 && box.right <= viewport.right + 1 && box.bottom <= viewport.bottom + 1
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const css = style(parent), clip = bounds(parent), applied = overflowViewport.local(parent, css)
      if (!beyondFixed) inViewport &&= withinClientPort(box, clip, parent, applied.x, applied.y)
      if (parent === clipBoundary) beyondFixed = true
      clippingAncestors.push({ tag: parent.tagName, id: parent.id, bounds: clip,
        clientPort: { left: clip.left + parent.clientLeft, top: clip.top + parent.clientTop, width: parent.clientWidth, height: parent.clientHeight },
        overflowX: css.overflowX, overflowY: css.overflowY, appliedOverflowX: applied.x, appliedOverflowY: applied.y, viewportApplied: applied.viewportApplied })
    }
    // An inline label can wrap into separate painted boxes. The centre of
    // its union can be an unpainted inter-line gap. Check each real painted
    // fragment for anchors; interactive controls retain the original gate.
    const hitRects = checkPaintedFragments ? [...node.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0) : [box]
    const hit = visible && inViewport && hitRects.length > 0 && hitRects.every(rect => {
      const front = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(front && (front === node || node.contains(front)))
    })
    return { ...box, visible, inViewport, hit, clippingAncestors: inViewport ? [] : clippingAncestors }
  }
  const controls = [], owners = new Set(), controlSelector = '[data-ui-control], button, input, select, textarea'
  const candidates = [...(area.matches(controlSelector) ? [area] : []), ...area.querySelectorAll(controlSelector)]
  for (const node of candidates) {
    const shared = node.closest('[data-ui-control]')
    if (shared && shared !== node) continue
    if (!shared && (node.type === 'hidden' || node.classList.contains('app-ui-validation-field'))) continue
    const kind = shared?.dataset.uiControl || node.tagName.toLowerCase()
    const field = kind === 'select' && shared ? node.querySelector('[role="combobox"]') : node.matches('input,textarea,button,select') ? node : node.querySelector('input,textarea,button,select')
    // A native project checkbox paints its adjacent mark, while the real input
    // stays transparent. Measure the mark only within this exact owned label.
    // All native classification, hit, visibility and keyboard gates remain.
    const nativeCheckboxMark = !shared && node.tagName === 'INPUT' && node.type === 'checkbox' &&
      node.dataset.uiNative === 'checkbox' && node.parentElement?.tagName === 'LABEL' &&
      node.parentElement.classList.contains('project-chapter-select') &&
      node.nextElementSibling?.tagName === 'SPAN' &&
      node.nextElementSibling.getAttribute('aria-hidden') === 'true' ? node.nextElementSibling : null
    const visual = kind === 'select' && shared ? node.querySelector('.app-ui-select') : nativeCheckboxMark ||
      (['input', 'password'].includes(kind) ? field?.closest('.ant-input-affix-wrapper') || node : node)
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
    const css = style(visual)
    item.computed = { color: css.color, background: css.backgroundColor, border: css.borderTopColor, whiteSpace: css.whiteSpace,
      lineHeight: css.lineHeight, fontSize: css.fontSize, overflowX: css.overflowX, opacity: css.opacity }
    if (nativeCheckboxMark) item.nativePresentation = { owner: 'project-chapter-select-label',
      inputChecked: Boolean(node.checked), inputNativeType: node.type, visibleMarkSelector: selector(nativeCheckboxMark) }
    if (exception) item.semanticException = { selector: exception.selector, source: exception.source, reason: exception.reason }
    if (kind === 'password' && field) {
      const css = style(field)
      item.innerPadding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(name => Number.parseFloat(css[name]))
    }
    controls.push(item)
  }
  const measuredAnchors = anchors.map(target => {
    const matches = [...document.querySelectorAll(target)].filter(rendered)
    if (matches.length !== 1) throw Error('Expected one rendered anchor: ' + target + ' (' + matches.length + ')')
    return { selector: target, ...observe(matches[0], true) }
  })
  const scrollOwners = collectFullAppScrollOwners(area, fixedBoundary)
  const scrollAreas = []
  for (const owner of scrollOwners) {
    const css = style(owner), viewportScrollOwner = overflowViewport.isViewportScroller(owner)
    if (overflowViewport.propagated(owner) && !viewportScrollOwner) continue
    const overflowY = viewportScrollOwner ? overflowViewport.viewportOverflowY : css.overflowY
    if (!/auto|scroll/.test(overflowY)) continue
    const clientHeight = viewportScrollOwner ? viewport.height : owner.clientHeight
    if ((!viewportScrollOwner && !rendered(owner)) || owner.scrollHeight <= clientHeight + 1) continue
    const ownerBounds = bounds(owner), box = viewportScrollOwner ? viewport : ownerBounds, maximum = owner.scrollHeight - clientHeight
    const ancestor = owner !== area && owner.contains(area)
    // An independently swept nested scroll surface owns its content. Its
    // outermost client port, rather than the moving route inside it, is the
    // stable content extent that this ancestor must photograph.
    let contentOwner = area, nestedContent = false
    if (ancestor) for (let nested = area; nested && nested !== owner; nested = nested.parentElement) {
      const nestedStyle = style(nested), nestedViewportOwner = overflowViewport.isViewportScroller(nested)
      if (overflowViewport.propagated(nested) && !nestedViewportOwner) continue
      const nestedOverflow = nestedViewportOwner ? overflowViewport.viewportOverflowY : nestedStyle.overflowY
      const nestedHeight = nestedViewportOwner ? viewport.height : nested.clientHeight
      if ((nestedViewportOwner || rendered(nested)) && /auto|scroll/.test(nestedOverflow) && nested.scrollHeight > nestedHeight + 1) {
        contentOwner = nested; nestedContent = true
      }
    }
    const contentBounds = bounds(contentOwner)
    const page = nestedContent ? { top: contentBounds.top + contentOwner.clientTop,
      bottom: contentBounds.top + contentOwner.clientTop + contentOwner.clientHeight } : bounds(area)
    const contentTop = viewportScrollOwner ? 0 : box.top + owner.clientTop
    const requiredContentStart = ancestor ? Math.max(0, Math.min(owner.scrollHeight, owner.scrollTop + page.top - contentTop)) : 0
    const requiredContentEnd = ancestor ? Math.max(requiredContentStart, Math.min(owner.scrollHeight, owner.scrollTop + page.bottom - contentTop)) : owner.scrollHeight
    let visibleTop = Math.max(0, contentTop), visibleBottom = Math.min(viewport.bottom, contentTop + clientHeight)
    // Fixed-position overlays escape ordinary ancestor overflow unless a
    // transform/contain-created fixed containing block makes that clip real.
    // Apply the same boundary already used for native control observations;
    // keep every actual viewport and in-boundary client-port gate intact.
    const clipBoundary = fixedBoundary(owner)
    let beyondFixed = clipBoundary === owner
    for (let parent = owner.parentElement; parent; parent = parent.parentElement) {
      const clipCss = style(parent), applied = overflowViewport.local(parent, clipCss)
      if (!beyondFixed && /hidden|auto|scroll|clip/.test(applied.y)) {
        const clip = bounds(parent), top = clip.top + parent.clientTop
        visibleTop = Math.max(visibleTop, top); visibleBottom = Math.min(visibleBottom, top + parent.clientHeight)
      }
      if (parent === clipBoundary) beyondFixed = true
    }
    // Native scroll offsets can be quantized while CSS boxes are fractional.
    // Request outward integer endpoints using the actual clipped client port;
    // the original one-pixel coverage and native-position gates remain exact.
    const start = Math.max(0, Math.min(maximum, Math.floor(requiredContentStart - (visibleTop - contentTop))))
    const end = Math.max(start, Math.min(maximum, Math.ceil(requiredContentEnd - (visibleBottom - contentTop))))
    const visibleHeight = painted(owner) ? Math.max(0, visibleBottom - visibleTop) : 0
    const visibleContentStart = Math.max(0, Math.min(owner.scrollHeight, owner.scrollTop + visibleTop - contentTop))
    const visibleContentEnd = Math.max(visibleContentStart, Math.min(owner.scrollHeight, visibleContentStart + visibleHeight))
    scrollAreas.push({ selector: selector(owner), clientHeight, scrollHeight: owner.scrollHeight, scrollTop: owner.scrollTop,
      rangeStart: start, rangeEnd: end, ancestor, bounds: box, requiredContentStart, requiredContentEnd,
      contentTarget: { selector: selector(contentOwner), kind: nestedContent ? 'nested-scroll-client-port' : 'route-content' },
      visibleHeight, visibleContentStart, visibleContentEnd, viewportScrollOwner, ownerBounds })
  }
  return { root, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, theme: document.documentElement.dataset.theme,
    rootBounds: bounds(area), controls, anchors: measuredAnchors, text: area.innerText, scrollAreas, overflowViewport: overflowViewport.record,
    overflow: { document: Math.max(0, document.documentElement.scrollWidth - innerWidth), root: Math.max(0, area.scrollWidth - area.clientWidth), allowed: [] } }
}

export function observeFullAppFocus(selector, visibleShadow, withinClientPort, readOverflowViewport, fixedBoundaryFor = () => null) {
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
  const clippingAncestors = [], fixedBoundary = fixedBoundaryFor(root)
  let beyondFixed = fixedBoundary === root
  let inViewport = box.left >= -1 && box.top >= -1 && box.right <= viewport.right + 1 && box.bottom <= viewport.bottom + 1
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent), clip = parent.getBoundingClientRect(), applied = overflowViewport.local(parent, css)
    if (!beyondFixed) inViewport &&= withinClientPort(box, clip, parent, applied.x, applied.y)
    if (parent === fixedBoundary) beyondFixed = true
    clippingAncestors.push({ tag: parent.tagName, id: parent.id,
      bounds: { left: clip.left, top: clip.top, right: clip.right, bottom: clip.bottom, width: clip.width, height: clip.height },
      clientPort: { left: clip.left + parent.clientLeft, top: clip.top + parent.clientTop, width: parent.clientWidth, height: parent.clientHeight },
      overflowX: css.overflowX, overflowY: css.overflowY, appliedOverflowX: applied.x, appliedOverflowY: applied.y, viewportApplied: applied.viewportApplied })
  }
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return { selector, focused: document.activeElement === field, focusVisible: field.matches(':focus-visible'), inViewport,
    hit: Boolean(hit && (hit === root || root.contains(hit))), outlines, shadows, overflowViewport: overflowViewport.record, clippingAncestors }
}

// Read only the repaired real expand control. No scroll, style, focus or React
// state is changed here; the surrounding driver supplies trusted Tab input.
export function observeCollapsedSidebarFocus(selector, observeFocus, visibleShadow, withinClientPort, readOverflowViewport, fixedBoundaryFor = () => null) {
  const sample = observeFocus(selector, visibleShadow, withinClientPort, readOverflowViewport, fixedBoundaryFor)
  const field = document.querySelector(selector), sidebar = field.closest('.workspace-sidebar')
  const overflow = readOverflowViewport(), css = getComputedStyle(field)
  const bounds = node => { const b = node.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height } }
  const painted = node => {
    if (!node) return false
    for (let owner = node; owner; owner = owner.parentElement) {
      const style = getComputedStyle(owner)
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0) return false
    }
    return true
  }
  const describe = node => node ? { tag: node.tagName, id: node.id || null, className: typeof node.className === 'string' ? node.className : null,
    relation: node === field ? 'control' : field.contains(node) ? 'descendant' : node.contains(field) ? 'ancestor' : 'foreign' } : null
  const iconNodes = [...field.querySelectorAll('.ant-btn-icon')], icon = iconNodes[0], glyphs = icon ? [...icon.children] : [], glyph = glyphs[0]
  const content = node => node ? { bounds: bounds(node), painted: painted(node), text: node.textContent.trim(), fontSize: getComputedStyle(node).fontSize } : null
  const box = bounds(field), width = Number.parseFloat(css.outlineWidth), offset = Number.parseFloat(css.outlineOffset)
  const extent = Number.isFinite(width + offset) ? Math.max(0, width + offset) : 0
  const outlineBounds = { left: box.left - extent, top: box.top - extent, right: box.right + extent, bottom: box.bottom + extent, width: box.width + 2 * extent, height: box.height + 2 * extent }
  const ringSamples = []
  if (width > 0 && Number.isFinite(offset)) {
    const middle = offset + width / 2
    for (const side of ['left', 'right', 'top', 'bottom']) for (const fraction of [1 / 3, 1 / 2, 2 / 3]) {
      const vertical = side === 'left' || side === 'right'
      const x = vertical ? box[side] + (side === 'left' ? -middle : middle) : box.left + box.width * fraction
      const y = vertical ? box.top + box.height * fraction : box[side] + (side === 'top' ? -middle : middle)
      const hit = document.elementFromPoint(x, y), topElement = describe(hit)
      ringSamples.push({ side, fraction, x, y, topElement, hitWithinOwner: Boolean(topElement && topElement.relation !== 'foreign') })
    }
  }
  // elementFromPoint ignores pointer-events:none. Preserve potential painted
  // overlaps too; the bound PNG decides whether these are above the outline.
  const pointerTransparentOverlaps = []
  const colorVisible = color => visibleShadow('0 0 0 1px ' + color)
  for (const node of document.querySelectorAll('*')) {
    if (node === field || node.contains(field) || field.contains(node) || !painted(node)) continue
    const style = getComputedStyle(node)
    if (style.pointerEvents !== 'none') continue
    const b = bounds(node)
    if (b.width <= 0 || b.height <= 0) continue
    const points = ringSamples.filter(point => point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom).filter(point => {
      const rect = { left: point.x, right: point.x, top: point.y, bottom: point.y }
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent), clip = overflow.local(parent, parentStyle)
        if (!withinClientPort(rect, parent.getBoundingClientRect(), parent, clip.x, clip.y, 0)) return false
      }
      return true
    })
    if (!points.length) continue
    const text = [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()) && colorVisible(style.color)
    const replaced = /^(IMG|SVG|CANVAS|VIDEO)$/.test(node.tagName)
    const background = colorVisible(style.backgroundColor) || style.backgroundImage !== 'none'
    const border = ['Top', 'Right', 'Bottom', 'Left'].some(side => Number.parseFloat(style['border' + side + 'Width']) > 0 && colorVisible(style['border' + side + 'Color']))
    if (text || replaced || background || border || visibleShadow(style.boxShadow)) pointerTransparentOverlaps.push({ element: describe(node), bounds: b,
      pointerEvents: style.pointerEvents, text, replaced, background, border, points: points.map(point => ({ side: point.side, fraction: point.fraction, x: point.x, y: point.y })) })
  }
  const scrollPositions = []
  for (let owner = field.parentElement; owner; owner = owner.parentElement) scrollPositions.push({ tag: owner.tagName, id: owner.id || null, left: owner.scrollLeft, top: owner.scrollTop })
  return { ...sample, viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme,
    sidebarIcon: { collapsed: Boolean(sidebar?.classList.contains('collapsed')), tag: field.tagName, disabled: field.matches(':disabled'),
      layout: field.dataset.uiLayout, size: field.classList.contains('ant-btn-sm') ? 'small' : field.classList.contains('ant-btn-lg') ? 'large' : 'middle',
      controlBounds: box, viewportBounds: { ...overflow.bounds }, iconCount: iconNodes.length, glyphCount: glyphs.length, icon: content(icon), glyph: content(glyph),
      outline: { width, offset, color: css.outlineColor }, outlineBounds, ringSamples, pointerTransparentOverlaps, scrollPositions } }
}

export function ensureFullAppTargetVisible(selector, withinClientPort, readOverflowViewport, fixedBoundaryFor = () => null) {
  const overflowViewport = readOverflowViewport(), viewport = overflowViewport.bounds
  const nodes = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
  if (nodes.length !== 1) throw Error('Missing or ambiguous actual scroll target')
  const node = nodes[0], box = node.getBoundingClientRect()
  const fixedBoundary = fixedBoundaryFor(node)
  let beyondFixed = fixedBoundary === node
  let fits = box.left >= 0 && box.top >= 0 && box.right <= viewport.right && box.bottom <= viewport.bottom
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent), clip = parent.getBoundingClientRect(), applied = overflowViewport.local(parent, css)
    if (!beyondFixed) fits &&= withinClientPort(box, clip, parent, applied.x, applied.y, 0)
    if (parent === fixedBoundary) beyondFixed = true
  }
  if (!fits) node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  return true
}

export function observeFullAppPopup(selector) {
  const nodes = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0)
  if (nodes.length !== 1) throw Error('Expected one actual shared Select')
  // A data-* selector may identify the real shared Select wrapper; ARIA
  // popup ownership is on its one combobox input. Preserve every paint/hit gate.
  const owner = nodes[0]
  const fields = owner.matches('[role="combobox"]') ? [owner] : [...owner.querySelectorAll('[role="combobox"]')]
  if (fields.length !== 1) throw Error('Expected one actual shared Select combobox')
  const field = fields[0], host = field.closest('[data-ui-control="select"]')
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


/**
 * Markdown source opens with native textarea focus. The immediately preceding
 * button is Close, so the genuine keyboard path to it is Shift+Tab, not a
 * forward sweep out of the source panel into Lexical (which owns Tab indent).
 * Prove both directions and the return without calling focus() or clicking.
 * This does not replace the shared focus ring, hit, visibility or trusted-key
 * assertions performed by the caller.
 */
export async function traverseMarkdownSourceCloseWithNativeTabs({ key, evaluate }) {
  const observe = () => evaluate('(() => { const panel = document.querySelector(".markdown-source-panel"); const textarea = panel?.querySelector(".markdown-source-textarea"); const close = panel?.querySelector(".markdown-source-actions button:last-child"); return { panelReady: !!panel && !!textarea && !!close && close.textContent.trim() === "关闭" && !close.disabled, textareaFocused: !!textarea && document.activeElement === textarea, closeFocused: !!close && document.activeElement === close }; })()')
  const initial = await observe()
  const result = { initial, backward: null, forward: null, returned: null, reverseTabs: 0, forwardTabs: 0, reached: false }
  if (!initial.panelReady || !initial.textareaFocused) return result
  await key('Tab', 8); result.reverseTabs++; result.backward = await observe()
  await key('Tab'); result.forwardTabs++; result.forward = await observe()
  await key('Tab', 8); result.reverseTabs++; result.returned = await observe()
  result.reached = result.backward.panelReady && result.backward.closeFocused &&
    result.forward.panelReady && result.forward.textareaFocused &&
    result.returned.panelReady && result.returned.closeFocused
  return result
}

/**
 * Prove a native F6 entry reaches the embed's first action, then a real Tab
 * moves to its sibling and Shift+Tab returns. Lexical continues to own ordinary
 * Tab while the editable body itself has focus. Never programmatically focus
 * a required button, replace the original focus assertion, or skip a key.
 */
export async function traverseBlockEmbedWithNativeTabs({ key, evaluate }) {
  const observe = () => evaluate('(() => { const root = document.querySelector(".editor-input[contenteditable=true]"); const embeds = root ? [...root.querySelectorAll(".block-reference-embed")] : []; const first = embeds[0]?.querySelector("footer button:first-child"); const second = first?.nextElementSibling; return { ownerReady: embeds.length > 0 && first?.tagName === "BUTTON" && second?.tagName === "BUTTON" && !first.disabled && !second.disabled && first.parentElement === second.parentElement && first.closest(".block-reference-embed") === embeds[0] && document.querySelectorAll(".block-reference-embed footer button:first-child").length === 1, firstFocused: !!first && document.activeElement === first, secondFocused: !!second && document.activeElement === second }; })()')
  const initial = await observe()
  const receipt = { initial, forward: null, returned: null, reverseTabs: 0, forwardTabs: 0, reached: false }
  if (!initial.ownerReady || !initial.firstFocused) return receipt
  await key('Tab'); receipt.forwardTabs++; receipt.forward = await observe()
  await key('Tab', 8); receipt.reverseTabs++; receipt.returned = await observe()
  receipt.reached = receipt.forward.ownerReady && receipt.forward.secondFocused &&
    receipt.returned.ownerReady && receipt.returned.firstFocused
  return receipt
}

/**
 * The original mouse click on a WikiLink leaves focus in Lexical, where Tab
 * intentionally indents the document. After a real pointer moves to the
 * status's inert heading, require one native Tab to reach its close button.
 * No button is focused or clicked by the verifier and all original focus
 * geometry, trusted-input and screenshot assertions remain in place.
 */
/**
 * Lexical consumes plain Tab inside its editable root. The product's F6
 * escape enters the first real attachment action; native Tab then reaches
 * Preview, Shift+Tab returns to Replace, and Tab reaches Preview again.
 * Do not set focus directly or substitute a mouse click for keyboard proof.
 */
export async function traverseAttachmentPreviewWithNativeKeys({ key, evaluate }) {
  const observe = () => evaluate(`(() => {
    const roots = [...document.querySelectorAll('.editor-input[contenteditable="true"]')]
    const root = roots[0], blocks = root ? [...root.querySelectorAll('.attachment-block')] : []
    const actions = blocks[0]?.querySelector('.attachment-actions')
    const buttons = actions ? [...actions.querySelectorAll('button')] : []
    const first = actions?.querySelector('.attachment-replace-button')
    const preview = actions?.querySelector('.attachment-preview-button')
    return {
      ownerReady: roots.length === 1 && blocks.length === 1 &&
        !!actions && buttons[0] === first && buttons[1] === preview &&
        first?.tagName === 'BUTTON' && preview?.tagName === 'BUTTON' &&
        !first.disabled && !preview.disabled &&
        document.querySelectorAll('.attachment-preview-button').length === 1,
      editorFocused: !!root && document.activeElement === root,
      firstFocused: !!first && document.activeElement === first,
      previewFocused: !!preview && document.activeElement === preview,
    }
  })()`)
  const initial = await observe()
  const receipt = { initial, entered: null, forward: null, backward: null,
    returned: null, nativeEntry: null, reverseTabs: 0, forwardTabs: 0, reached: false }
  if (!initial.ownerReady || !initial.editorFocused || initial.firstFocused || initial.previewFocused) return receipt
  await key('F6'); receipt.nativeEntry = 'F6'; receipt.entered = await observe()
  if (!receipt.entered.ownerReady || !receipt.entered.firstFocused) return receipt
  await key('Tab'); receipt.forwardTabs++; receipt.forward = await observe()
  if (!receipt.forward.ownerReady || !receipt.forward.previewFocused) return receipt
  await key('Tab', 8); receipt.reverseTabs++; receipt.backward = await observe()
  if (!receipt.backward.ownerReady || !receipt.backward.firstFocused) return receipt
  await key('Tab'); receipt.forwardTabs++; receipt.returned = await observe()
  receipt.reached = receipt.returned.ownerReady && receipt.returned.previewFocused
  return receipt
}


/** Lexical consumes Tab; use its real F6 decorator escape and prove a Todo
 * checkbox-to-text-button round trip with native keys and no fake focus. */
export async function traverseTodoTextWithNativeKeys({ key, evaluate }) {
  const observe = () => evaluate(`(() => {
    const roots = [...document.querySelectorAll('.editor-input[contenteditable="true"]')]
    const root = roots[0], todos = root ? [...root.querySelectorAll('.todo-block')] : []
    const checkbox = todos[0]?.querySelector('input.todo-checkbox[type="checkbox"]')
    const text = todos[0]?.querySelector('button.todo-text-button')
    return {
      ownerReady: roots.length === 1 && todos.length === 1 &&
        checkbox?.tagName === 'INPUT' && !checkbox.disabled &&
        text?.tagName === 'BUTTON' && !text.disabled &&
        checkbox.parentElement === text.parentElement && checkbox.nextElementSibling === text &&
        document.querySelectorAll('.todo-text-button').length === 1,
      editorFocused: !!root && document.activeElement === root,
      checkboxFocused: !!checkbox && document.activeElement === checkbox,
      textFocused: !!text && document.activeElement === text,
    }
  })()`)
  const initial = await observe()
  const receipt = { initial, entered: null, forward: null, backward: null, returned: null,
    nativeEntry: null, reverseTabs: 0, forwardTabs: 0, reached: false }
  if (!initial.ownerReady || !initial.editorFocused || initial.checkboxFocused || initial.textFocused) return receipt
  await key('F6'); receipt.nativeEntry = 'F6'; receipt.entered = await observe()
  if (!receipt.entered.ownerReady || !receipt.entered.checkboxFocused) return receipt
  await key('Tab'); receipt.forwardTabs++; receipt.forward = await observe()
  if (!receipt.forward.ownerReady || !receipt.forward.textFocused) return receipt
  await key('Tab', 8); receipt.reverseTabs++; receipt.backward = await observe()
  if (!receipt.backward.ownerReady || !receipt.backward.checkboxFocused) return receipt
  await key('Tab'); receipt.forwardTabs++; receipt.returned = await observe()
  receipt.reached = receipt.returned.ownerReady && receipt.returned.textFocused
  return receipt
}

export async function traverseWikiNavigationCloseWithNativeTabs({ key, evaluate }) {
  const observe = () => evaluate(`(() => {
    const panels = [...document.querySelectorAll('.wiki-navigation-status[aria-label="引用导航状态"]')]
    const panel = panels[0]
    const heading = panel?.querySelector('header strong')
    const close = panel?.querySelector('header button[aria-label="关闭引用导航提示"]')
    const alerts = panel?.querySelectorAll('[role="alert"]')
    return { ownerReady: panels.length === 1 && !!heading && heading.textContent.trim() === '打开引用' &&
        !!close && close.tagName === 'BUTTON' && !close.disabled && alerts?.length === 1,
      neutralOrigin: document.activeElement === document.body,
      closeFocused: !!close && document.activeElement === close }
  })()`)
  const initial = await observe()
  const receipt = { initial, forward: null, reverseTabs: 0, forwardTabs: 0, reached: false }
  if (!initial.ownerReady || !initial.neutralOrigin || initial.closeFocused) return receipt
  await key('Tab'); receipt.forwardTabs++
  receipt.forward = await observe()
  receipt.reached = receipt.forward.ownerReady && receipt.forward.closeFocused
  return receipt
}
/**
 * A pointer-opened table action menu leaves native focus on its real trigger.
 * Its first menuitem comes NEXT in Tab order. A generic initial Shift+Tab
 * instead escapes backward into Lexical, which owns Tab for text indentation.
 * Verify forward, reverse and return using only genuine native key events.
 * Shared screenshot, focus ring and hit-test assertions run unchanged.
 */
export async function traverseTableActionMenuWithNativeTabs({ key, evaluate }) {
  const observe = () => evaluate('(() => { const host = document.querySelector(".editor-container"); const trigger = host?.querySelector(".table-action-menu-trigger"); const menu = host?.querySelector(".table-action-menu[role=menu]"); const first = menu?.querySelector(".product-table-menu-section:first-child .table-action-menu-item:first-of-type"); return { ownerReady: !!host && !!trigger && trigger.tagName === "BUTTON" && !trigger.disabled && !!menu && !!first && first.tagName === "BUTTON" && !first.disabled && first.getAttribute("role") === "menuitem" && document.querySelectorAll(".product-table-menu-section:first-child .table-action-menu-item:first-of-type").length === 1, triggerFocused: !!trigger && document.activeElement === trigger, firstFocused: !!first && document.activeElement === first }; })()')
  const initial = await observe()
  const receipt = { initial, forward: null, backward: null, returned: null, reverseTabs: 0, forwardTabs: 0, reached: false }
  if (!initial.ownerReady || !initial.triggerFocused || initial.firstFocused) return receipt
  await key('Tab'); receipt.forwardTabs++; receipt.forward = await observe()
  if (!receipt.forward.ownerReady || !receipt.forward.firstFocused) return receipt
  await key('Tab', 8); receipt.reverseTabs++; receipt.backward = await observe()
  await key('Tab'); receipt.forwardTabs++; receipt.returned = await observe()
  receipt.reached = receipt.backward.ownerReady && receipt.backward.triggerFocused &&
    receipt.returned.ownerReady && receipt.returned.firstFocused
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

// A pinned nested popup can remain at one native viewport rectangle while
// an enclosing editor scroller moves. The ancestor's content coordinates then
// shift by exactly that native scroll offset. Accept this alternate coordinate
// frame only with unchanged real root and scroll-port geometry, not missing PNG
// intervals or genuine changes to content extent.
function pinnedNestedAncestorRange(surface, baseline, sample, actual) {
  const sameBounds = (left, right) => left && right && ['left', 'top', 'right', 'bottom', 'width', 'height'].every(
    key => Number.isFinite(left[key]) && Number.isFinite(right[key]) && Math.abs(left[key] - right[key]) <= 0.6)
  if (!surface.ancestor || surface.contentTarget?.kind !== 'nested-scroll-client-port' ||
      surface.contentTarget?.selector !== baseline?.root || sample?.root !== baseline.root ||
      actual.contentTarget?.kind !== surface.contentTarget.kind ||
      actual.contentTarget?.selector !== surface.contentTarget.selector ||
      !sameBounds(sample.rootBounds, baseline.rootBounds) || !sameBounds(actual.bounds, surface.bounds) ||
      !sameBounds(actual.ownerBounds, surface.ownerBounds) ||
      !Number.isFinite(actual.scrollTop) || !Number.isFinite(surface.scrollTop)) return false
  const delta = actual.scrollTop - surface.scrollTop
  return Math.abs(delta) > 1 &&
    Math.abs(actual.requiredContentStart - surface.requiredContentStart - delta) <= 1 &&
    Math.abs(actual.requiredContentEnd - surface.requiredContentEnd - delta) <= 1
}

// Keep raw PNG observations and later sweep planning in the SAME first recorded
// scene frame. Only a proven pinned ancestor changes coordinates; native scroll
// offsets, sweep ranges, geometry and the original four endpoints remain intact.
function normalizePinnedSceneCoordinates(baseline, sample) {
  const areas = sample.scrollAreas || []
  for (const actual of areas) assert.ok(!Object.hasOwn(actual, 'nativeCoordinates') && !Object.hasOwn(actual, 'coordinateFrame'),
    'Native scroll coordinates are already normalized')
  const scrollAreas = areas.map(actual => {
    const matches = baseline.scrollAreas?.filter(surface => surface.selector === actual.selector) || []
    if (matches.length !== 1 || areas.filter(surface => surface.selector === actual.selector).length !== 1) return actual
    const surface = matches[0]
    const originalRange = Math.abs(actual.requiredContentStart - surface.requiredContentStart) <= 1 &&
      Math.abs(actual.requiredContentEnd - surface.requiredContentEnd) <= 1
    if (originalRange || !actual.ancestor || actual.scrollHeight !== surface.scrollHeight || actual.clientHeight !== surface.clientHeight ||
        !pinnedNestedAncestorRange(surface, baseline, sample, actual)) return actual
    const delta = actual.scrollTop - surface.scrollTop
    const nativeCoordinates = Object.fromEntries(['requiredContentStart', 'requiredContentEnd', 'visibleContentStart', 'visibleContentEnd']
      .map(key => [key, actual[key]]))
    return { ...actual, ...Object.fromEntries(Object.entries(nativeCoordinates).map(([key, value]) => [key, value - delta])),
      nativeCoordinates, coordinateFrame: { baselineScrollTop: surface.scrollTop, delta } }
  })
  return { ...sample, scrollAreas }
}

export function measureFullAppScrollCoverage(surface, samples, images) {
  const start = surface.requiredContentStart, end = surface.requiredContentEnd
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start && end <= surface.scrollHeight)
  const baseline = samples.find(sample => sample.scrollAreas?.some(item => item.selector === surface.selector))
  const intervals = []
  for (const image of images) {
    const pair = ['before-capture', 'after-capture'].map(phase => {
      const sample = samples.find(sample => sample.phase === phase && sample.image === image.filename)
      return { sample, actual: sample?.scrollAreas.find(item => item.selector === surface.selector) }
    })
    if (pair.some(({ actual }) => !actual)) continue
    const visible = []
    for (const { sample, actual } of pair) {
      assert.equal(actual.scrollHeight, surface.scrollHeight); assert.equal(actual.clientHeight, surface.clientHeight)
      const originalRange = Math.abs(actual.requiredContentStart - start) <= 1 && Math.abs(actual.requiredContentEnd - end) <= 1
      assert.ok(originalRange || pinnedNestedAncestorRange(surface, baseline, sample, actual), 'Actual long-page content range changed')
      assert.ok(Number.isFinite(actual.visibleContentStart) && Number.isFinite(actual.visibleContentEnd) && actual.visibleContentEnd >= actual.visibleContentStart)
      // A pinned coordinate shift cannot reveal more content. Map each PNG
      // boundary back to the baseline frame before intersecting its interval.
      const delta = originalRange ? 0 : actual.scrollTop - surface.scrollTop
      visible.push({ from: actual.visibleContentStart - delta, to: actual.visibleContentEnd - delta })
    }
    const from = Math.max(start, visible[0].from, visible[1].from)
    const to = Math.min(end, visible[0].to, visible[1].to)
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
  const sealStableJSON = (collection, value) => ctx.evidenceStore?.sealStableJSON?.(collection, value, {
    protectedObjects: [ctx, ...Object.values(ctx).filter(item => item && typeof item === 'object'),
      ctx.matrix?.viewport, ctx.windowReceipt?.viewport, ctx.windowReceipt?.requested],
  })
  const appendRaw = (scene, sample) => ctx.evidenceStore ? ctx.evidenceStore.appendRaw(scene, sample) : scene.rawSamples.push(sample)
  const frame = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
  const originalSelect = createNativeUiSelect({ evaluate, click, cdp, until })
  const nativeSelect = { inspect: originalSelect.inspect, value: originalSelect.value, choose: async (selector, value) => {
    // A real workspace remount can briefly leave no Select in the DOM. Wait
    // only for that absent state, within the original readiness deadline; a
    // duplicate, unsupported or native control remains a strict refusal.
    await until(async () => {
      const observed = await originalSelect.inspect(selector)
      if (observed.count === 0) return false
      assert.equal(observed.count, 1, 'Current App acceptance requires one actual migrated shared Select')
      assert.equal(observed.kind, 'shared', 'Current App acceptance requires the actual migrated shared Select')
      return observed
    }, 'Current App migrated shared Select did not mount: ' + selector)
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
    await evaluate(`(${ensureFullAppTargetVisible.toString()})(${q(selector)},${withinActualClientPort.toString()},${observeFullAppOverflowViewport.toString()},${viewportFixedClipBoundary.toString()})`)
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
  const sidebarFocusExpression = `(${observeCollapsedSidebarFocus.toString()})(${q(COLLAPSED_SIDEBAR_EXPAND)},${observeFullAppFocus.toString()},${hasVisibleBoxShadow.toString()},${withinActualClientPort.toString()},${observeFullAppOverflowViewport.toString()},${viewportFixedClipBoundary.toString()})`
  const samplePage = (route, root, anchors, onlySelectors = [], sidebarFocusRequired = false) => evaluate(`(()=>{const collectFullAppScrollOwners=${collectFullAppScrollOwners.toString()};const page=(${observeFullAppPage.toString()})(${q({ root, anchors, onlySelectors, editorExceptions: route.editorExceptions || [] })},${withinActualClientPort.toString()},${observeFullAppOverflowViewport.toString()},${viewportFixedClipBoundary.toString()});${sidebarFocusRequired ? `page.sidebarFocus=${sidebarFocusExpression};` : ''}return page;})()`)
  const nativeSamplePage = samplePage
  const captureState = async ({ routeId, stateId, root, anchors = [], requiredText = [], allowHorizontalScroll = [], coverageMode = 'route-controls', onlySelectors = [] }) => {
    const route = routeFor(routeId), registeredRoot = route.stateRoots?.[stateId] || route.root
    root ||= registeredRoot
    assert.ok(route.requiredStates.includes(stateId), 'Unregistered actual route state: ' + routeId + '/' + stateId)
    assert.equal(root, registeredRoot, 'An actual page state must use its independently registered root')
    const meta = binding({ routeId, stateId })
    const sidebarFocusRequired = routeId === 'nav-sidebar' && stateId === 'collapsed'
    assert.equal(ui.scenes.some(scene => scene.routeId === routeId && scene.stateId === stateId && scene.theme === meta.theme && scene.viewport.width === meta.viewport.width && scene.viewport.height === meta.viewport.height), false, 'Duplicate actual page scene')
    assert.equal(ctx.windowReceipt?.nativeWindow, true, 'Actual owned native window receipt is required before a scene')
    assert.deepEqual(ctx.windowReceipt.viewport, ctx.matrix.viewport)
    const scene = { ...meta, requested: { ...ctx.windowReceipt.requested }, nativeWindow: ctx.windowReceipt.nativeWindow, root, coverageMode, complete: false,
      controls: [], anchors: [], images: [], geometry: { valid: false, failures: [] }, rawSamples: [], scrollCoverage: [], disclosures: [], motionReadiness: [] }
    ui.scenes.push(scene); save()
    const seen = new Map(), wanted = new Map(), capturedAnchors = new Map()
    const syncReadiness = ['sync-presentation', 'settings-main', 'local-sync-activity'].includes(meta.routeId) ? createSyncActivityCaptureReadiness({ routeId: meta.routeId,
      ownerToken: JSON.stringify(meta), evaluate, until, receipt: (scene.syncActivityReadiness = {}), save }) : null
    let captureFailure = null
    let coordinateBaseline = null
    const samplePage = async (...args) => {
      const sample = await nativeSamplePage(...args)
      coordinateBaseline ||= structuredClone({ root: sample.root, rootBounds: sample.rootBounds, scrollAreas: sample.scrollAreas })
      return normalizePinnedSceneCoordinates(coordinateBaseline, sample)
    }
    let index = 0
    const snap = async targetAnchors => {
      // A momentary enabled button can be just before the next normal poll.
      // Observe a newly completed owned renderer read, without initiating one.
      // Obtain the renderer cycle only at the native PNG boundary; motion and
      // preliminary layout reads can outlast its strict one-second validity.
      const motion = { complete: false }; scene.motionReadiness.push(motion)
      await waitForFiniteOwnerMotion(() => evaluate(`(${observeFullAppOwnerMotion.toString()})(${q(root)})`), until, motion)
      const before = await samplePage(route, root, targetAnchors, onlySelectors, sidebarFocusRequired)
      // Only renderer painting overlaps the following synchronous host work.
      // Keep the actual filename/index/motion receipt updates in their original
      // positions, so an earlier evidence or geometry failure stays earlier.
      const paintTicket = capture.preparePaint?.(nameFor(meta, 'part-' + (index + 1)))
      appendRaw(scene, { ...before, text: undefined }); save()
      if (sidebarFocusRequired) validateCollapsedSidebarObservation(before.sidebarFocus, ctx.matrix)
      assert.deepEqual(before.viewport, meta.viewport); assert.equal(before.theme, meta.theme)
      for (const text of requiredText) assert.ok(before.text.includes(text), 'Actual visible page text missing: ' + text)
      const considered = coverageMode === 'owned-popup' ? before.controls.filter(control => control.selectedForProbe) : before.controls
      if (coverageMode === 'owned-popup') assert.equal(considered.length, 1, 'Owned popup scene must measure its actual single trigger')
      for (const item of considered) wanted.set(item.selector, item)
      const controls = considered.filter(item => item.visible && item.inViewport)
      const measured = { ...before, controls, overflow: { ...before.overflow, allowed: allowHorizontalScroll } }
      let afterCapture
      const filename = nameFor(meta, 'part-' + (++index))
      motion.image = filename
      // The same observed renderer request must cover both native PNG boundaries.
      // Keep its ticket in the enclosing snap scope, not only the callback.
      let syncTicket = null
      const image = await capture(filename, async () => {
        syncTicket = syncReadiness ? await syncReadiness.wait() : null
        const fresh = await samplePage(route, root, targetAnchors, onlySelectors, sidebarFocusRequired)
        appendRaw(scene, { ...fresh, text: undefined, phase: 'before-capture', image: filename }); save()
        if (sidebarFocusRequired) validateCollapsedSidebarObservation(fresh.sidebarFocus, ctx.matrix)
        validateFullAppCaptureContinuity(measured, fresh, ctx.matrix)
        if (syncReadiness) await syncReadiness.boundary(syncTicket, 'before-capture', filename)
        return true
      }, paintTicket)
      scene.images.push(image); scene.image ||= image; scene.devicePixelRatio = before.devicePixelRatio
      for (const item of controls) seen.set(item.selector, { ...item, image: image.filename })
      for (const item of before.anchors) capturedAnchors.set(item.selector, { ...item, image: image.filename })
      scene.controls = [...seen.values()]; scene.anchors = [...capturedAnchors.values()]; scene.overflow = measured.overflow; save()
      validateFullAppPageSample(measured, ctx.matrix)
      afterCapture = await samplePage(route, root, targetAnchors, onlySelectors, sidebarFocusRequired)
      appendRaw(scene, { ...afterCapture, text: undefined, phase: 'after-capture', image: image.filename }); save()
      if (sidebarFocusRequired) validateCollapsedSidebarObservation(afterCapture.sidebarFocus, ctx.matrix)
      validateFullAppCaptureContinuity(measured, afterCapture, ctx.matrix)
      if (syncReadiness) await syncReadiness.boundary(syncTicket, 'after-capture', image.filename)
      return image
    }
    try {
      if (syncReadiness) await syncReadiness.install()
      if (anchors.length) { await ensureVisible(anchors[0]); await snap([anchors[0]]) }
      else {
        const initial = await nativeSamplePage(route, root, [])
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
          covered.initialRange = { start: covered.rangeStart, end: covered.rangeEnd }
          covered.rangeStart = visible.rangeStart; covered.rangeEnd = visible.rangeEnd
          covered.sweepRange = { start: visible.rangeStart, end: visible.rangeEnd }
          const positions = []
          for (let value = visible.rangeStart; value < visible.rangeEnd; value += step) positions.push(value)
          positions.push(visible.rangeEnd)
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
      // Dispose before sealing the immutable successful scene. The failure
      // path below still disposes in finally and retains its complete trace.
      if (syncReadiness) await syncReadiness.close()
      scene.controlCoverage = { renderedCount: wanted.size, observedCount: seen.size, unobserved: [...wanted.keys()].filter(selector => !seen.has(selector)) }
      assert.deepEqual(scene.controlCoverage.unobserved, [])
      scene.geometry = { valid: true, failures: [] }; scene.complete = true; save()
      ctx.evidenceStore?.sealScene(scene)
      return scene
    } catch (error) {
      captureFailure = error
      scene.geometry.failures.push({ message: String(error.message), actual: error.actual, expected: error.expected, operator: error.operator }); save()
      try { scene.failureImage = await capture(nameFor(meta, 'failure')); save() }
      catch (diagnostic) { scene.failureImageError = String(diagnostic.message); save() }
      throw error
    } finally {
      if (syncReadiness && !syncReadiness.closed) {
        try { await syncReadiness.close() }
        catch (error) {
          scene.syncActivityReadiness.cleanupError = { name: error.name, message: error.message }; save()
          if (!captureFailure) throw error
        }
      }
    }
  }
  const focus = async (selector, meta) => {
    routeFor(meta.routeId)
    const decoratorKind = decoratorKeyboardKind(meta.routeId, meta.stateId, selector)
    const sidebarFocusRequired = meta.routeId === 'nav-sidebar' && meta.stateId === 'collapsed'
    let beforeTab, motion, pendingSidebarFocus
    if (sidebarFocusRequired) {
      assert.equal(selector, COLLAPSED_SIDEBAR_EXPAND)
      motion = { complete: false }
      pendingSidebarFocus = { ...binding(meta), selector, motion }
      ui.focus.push(pendingSidebarFocus); save()
      await waitForFiniteOwnerMotion(() => evaluate(`(${observeFullAppOwnerMotion.toString()})('.workspace-sidebar')`), until, motion)
      beforeTab = await evaluate(sidebarFocusExpression)
      pendingSidebarFocus.beforeTab = beforeTab; save()
      validateCollapsedSidebarObservation(beforeTab, ctx.matrix, { focusRequired: false })
    } else await ensureVisible(selector)
    const first = await eventCount(), field = await evaluate(`(()=>{const n=document.querySelector(${q(selector)});return {tag:n?.tagName,type:n?.type}})()`)
    if (!decoratorKind && (field.tag === 'TEXTAREA' || (field.tag === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(field.type)))) {
      const select = await nativeSelect.inspect(selector)
      if (select.kind === 'shared') {
        if (!select.expanded) await click('[data-ui-control="select"]:has([role="combobox"][id=' + q(select.inputId) + '])')
        await until(async () => (await nativeSelect.inspect(selector)).expanded, 'Actual focus Select did not open')
        await key('Escape')
        await until(async () => !(await nativeSelect.inspect(selector)).expanded, 'Actual focus Select did not close')
      } else await click(selector)
    }
    let reached = false, tabAttempts = 0, reverseTabs = 0, nativeSourceOrder = null
    if (decoratorKind) {
      const receipt = { ...binding(meta), selector, kind: decoratorKind, eventStart: first,
        ownerToken: 'decorator:' + decoratorKind + ':' + ui.focus.length + ':' + first,
        method: 'native-f6-and-adjacent-tab-round-trip', reached: false }
      ;(ui.decoratorKeyboardEntries ||= []).push(receipt)
      nativeSourceOrder = await traverseDecoratorWithNativeKeys({ key, evaluate, receipt, save })
      reached = nativeSourceOrder.reached
      reverseTabs = nativeSourceOrder.reverseTabs
      tabAttempts = nativeSourceOrder.forwardTabs
    } else if (meta.routeId === 'editor-source' && meta.stateId === 'default' &&
        selector === '.markdown-source-actions button:last-child') {
      nativeSourceOrder = await traverseMarkdownSourceCloseWithNativeTabs({ key, evaluate })
      reached = nativeSourceOrder.reached
      reverseTabs = nativeSourceOrder.reverseTabs
      tabAttempts = nativeSourceOrder.forwardTabs
    } else if (meta.routeId === 'editor-block-embed' && meta.stateId === 'loaded' &&
        selector === '.block-reference-embed footer button:first-child') {
      nativeSourceOrder = await traverseBlockEmbedWithNativeTabs({ key, evaluate })
      reached = nativeSourceOrder.reached
      reverseTabs = nativeSourceOrder.reverseTabs
      tabAttempts = nativeSourceOrder.forwardTabs
    } else if (meta.routeId === 'editor-attachment' && meta.stateId === 'default' &&
        selector === '.attachment-preview-button') {
      nativeSourceOrder = await traverseAttachmentPreviewWithNativeKeys({ key, evaluate })
      reached = nativeSourceOrder.reached
      reverseTabs = nativeSourceOrder.reverseTabs
      tabAttempts = nativeSourceOrder.forwardTabs
    } else if (meta.routeId === 'editor-todo' && meta.stateId === 'default' &&
        selector === '.todo-text-button') {
      nativeSourceOrder = await traverseTodoTextWithNativeKeys({ key, evaluate })
      reached = nativeSourceOrder.reached
      reverseTabs = nativeSourceOrder.reverseTabs
      tabAttempts = nativeSourceOrder.forwardTabs
    } else if (meta.routeId === 'editor-code' && meta.stateId === 'default' &&
        selector === '.editor-input[contenteditable="true"] .code-block-wrapper:has(> .code-block-header) .language-selector-button') {
      const receipt = { ...binding(meta), selector, eventStart: first,
        ownerToken: 'code-language:' + ui.focus.length + ':' + first,
        method: 'native-f6-and-adjacent-tab-round-trip', reached: false }
      ;(ui.codeLanguageKeyboardEntries ||= []).push(receipt)
      nativeSourceOrder = await traverseCodeLanguageWithNativeKeys({ key, evaluate, receipt, save })
      reached = nativeSourceOrder.reached
      reverseTabs = nativeSourceOrder.reverseTabs
      tabAttempts = nativeSourceOrder.forwardTabs
    } else if (meta.routeId === 'editor-wiki-navigation' && meta.stateId === 'missing-source' &&
        selector === '[aria-label="关闭引用导航提示"]') {
      nativeSourceOrder = await traverseWikiNavigationCloseWithNativeTabs({ key, evaluate })
      reached = nativeSourceOrder.reached
      reverseTabs = nativeSourceOrder.reverseTabs
      tabAttempts = nativeSourceOrder.forwardTabs
    } else if (meta.routeId === 'editor-table-actions' && meta.stateId === 'actions' &&
        selector === '.product-table-menu-section:first-child .table-action-menu-item:first-of-type') {
      nativeSourceOrder = await traverseTableActionMenuWithNativeTabs({ key, evaluate })
      reached = nativeSourceOrder.reached
      reverseTabs = nativeSourceOrder.reverseTabs
      tabAttempts = nativeSourceOrder.forwardTabs
    } else if (meta.routeId === 'projects-focus-session' && meta.stateId === 'focused' &&
        selector === '.focus-session-actions > button:first-child') {
      // Lexical consumes Tab as indent. The preceding trusted action toggle
      // restored the real first button's focus; prove its *adjacent* keyboard
      // traversal in both directions without accidentally entering Lexical.
      assert.equal(await evaluate(`document.activeElement===document.querySelector(${q(selector)})`), true,
        'Actual Session action did not own keyboard focus before native traversal')
      await key('Tab')
      tabAttempts++
      assert.equal(await evaluate(`(() => {
        const first = document.querySelector(${q(selector)})
        const next = first?.nextElementSibling
        return next?.tagName === 'BUTTON' && !next.disabled && document.activeElement === next
      })()`), true, 'Actual Session actions are not adjacent in real forward Tab order')
      await key('Tab', 8)
      reverseTabs++
      reached = await evaluate(`document.activeElement===document.querySelector(${q(selector)})`)
    } else {
      await key('Tab', 8)
      reverseTabs++
      // The incoming reverse Tab is itself native evidence. In the installed
      // Wiki trace, the *next* forward keydown originated on the exact target:
      // the reverse Tab had already focused it before the forward loop began.
      // Read the settled result before advancing and potentially losing it.
      if (meta.routeId === 'editor-wiki-preview' && meta.stateId === 'preview') {
        await frame()
        reached = await evaluate(`document.activeElement===document.querySelector(${q(selector)})`)
      }
      for (let index = 0; index < 256 && !reached; index++) {
        await key('Tab')
        tabAttempts++
        if (await evaluate(`document.activeElement===document.querySelector(${q(selector)})`)) { reached = true; break }
        // A native focus transition can settle after the immediate CDP key-up
        // read. For the Wiki preview only, observe the next painted frame
        // before sending another Tab; never focus a node or relax the proof.
        if (meta.routeId === 'editor-wiki-preview' && meta.stateId === 'preview') {
          await frame()
          if (await evaluate(`document.activeElement===document.querySelector(${q(selector)})`)) { reached = true; break }
        }
      }
    }
    if (!reached) {
      // Observe only an exhausted traversal. Keep the original input sequence,
      // budget and assertion, even if this diagnostic read or checkpoint fails.
      const failure = { ...binding(meta), selector, complete: false, reached: false, reason: 'tab-order-exhausted',
        attempts: { reverseTabs, forwardTabs: tabAttempts, totalTabs: tabAttempts + reverseTabs },
        ...(nativeSourceOrder ? { nativeSourceOrder } : {}), eventStart: first,
        diagnosticComplete: false, activeElement: null, events: null, traceTruncated: null }
      ;(ui.focusFailures ||= []).push(failure)
      try {
        Object.assign(failure, await evaluate(`(() => {
          const node=document.activeElement, trace=window.__fullAppUiEvents;
          if(!Array.isArray(trace)||typeof window.__fullAppUiTraceTruncated!=='boolean')throw Error('Actual focus failure trace is unavailable');
          return {activeElement:node?{tag:node.tagName,id:node.id||null,role:node.getAttribute('role'),type:node.getAttribute('type'),contentEditable:node.getAttribute('contenteditable')}:null,
            events:trace.slice(${Number(first)}),eventEnd:trace.length,traceTruncated:window.__fullAppUiTraceTruncated};
        })()`))
        failure.diagnosticComplete = true
      } catch (error) {
        failure.diagnosticError = { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack }
      }
      try { save() } catch (error) {
        failure.diagnosticSaveError = { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack }
      }
    }
    assert.equal(reached, true, 'Actual Tab order never reached control: ' + selector)
    const sample = { ...binding(meta), ...await evaluate(sidebarFocusRequired ? sidebarFocusExpression : `(${observeFullAppFocus.toString()})(${q(selector)},${hasVisibleBoxShadow.toString()},${withinActualClientPort.toString()},${observeFullAppOverflowViewport.toString()},${viewportFixedClipBoundary.toString()})`),
      ...(sidebarFocusRequired ? { beforeTab, motion } : {}), ...(nativeSourceOrder ? { nativeSourceOrder } : {}) }
    sample.events = await events(first); sample.trustedTab = sample.events.some(event => event.type === 'keydown' && event.key === 'Tab' && event.trusted)
    if (pendingSidebarFocus) Object.assign(pendingSidebarFocus, sample)
    else ui.focus.push(sample)
    save()
    assert.ok(sample.trustedTab && sample.focused && sample.focusVisible && sample.inViewport && sample.hit, 'Actual keyboard focus was not visible and reachable')
    assert.equal(sample.outlines.length, 1, 'Actual control has no single focus outline'); assert.deepEqual(sample.shadows, [], 'Actual control has duplicate focus glow')
    if (sidebarFocusRequired) validateCollapsedSidebarFocus(sample, ctx.matrix)
    sealStableJSON('fullAppUi.focus', pendingSidebarFocus || sample)
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
    await key('ArrowDown')
    try {
      await opened()
    } catch (error) {
      // Diagnose the original failed post-pointer keyboard reopening in the
      // installed renderer. No added input or relaxed popup/ownership gate.
      try {
        receipt.keyboardReopenFailure = {
          select: await nativeSelect.inspect(selector),
          painted: await evaluate(`(${observeFullAppPopup.toString()})(${q(selector)})`),
          focus: await evaluate(`(() => {const node=document.activeElement;return node ? {
            tag:node.tagName,id:node.id||null,role:node.getAttribute('role'),ariaLabel:node.getAttribute('aria-label')
          } : null})()`)
        }
      } catch (diagnostic) {
        receipt.keyboardReopenFailureError = String(diagnostic?.message || diagnostic)
      } finally {
        save()
      }
      throw error
    }
    await key('ArrowDown')
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
    sealStableJSON('fullAppUi.popups', receipt)
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
    receipt.complete = true; save()
    sealStableJSON('fullAppUi.popups', receipt)
    return receipt
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
  const openSearch = async () => { await closeSettings(); await collapseSidebar(); if (!(await evaluate('Boolean(document.querySelector(".global-search-panel"))'))) { await click('.workspace-sidebar button[aria-label="搜索笔记"]'); await until(() => evaluate('Boolean(document.querySelector(".global-search-panel"))'), 'Actual Search entry did not mount') } }
  const closeSearch = async () => { if (await evaluate('Boolean(document.querySelector(".global-search-panel"))')) { await click('[aria-label="关闭全局检索"]'); await until(() => evaluate('!document.querySelector(".global-search-panel")'), 'Actual Search entry did not close') } }
  const enterWorkspace = async (ariaLabel, root) => { await closeSearch(); await closeSettings(); await collapseSidebar(); await click('[aria-label=' + q(ariaLabel) + ']'); await until(() => evaluate('Boolean(document.querySelector(' + q(root) + '))'), 'Actual workspace did not mount: ' + root) }
  return { frame, key, text, ensureVisible, hover, chooseFile, nativeSelect, focus, select, selectPreview, captureState, openSettings, closeSettings, openSearch, closeSearch, enterWorkspace, collapseSidebar }
}

// Only the canonical owned-option request emitted by native-ui-select enters
// this preparation. Ordinary buttons and all existing shared interactions keep
// their original input path. No business state or focus is assigned here.
export function fullAppOwnedOptionRequest(request) {
  if (typeof request === 'string') request = { selector: request }
  if (!request || typeof request.selector !== 'string' || request.text !== undefined) return null
  const quoted = '"(?:[^"\\\\]|\\\\.)*"'
  const pattern = new RegExp('^\\[role="listbox"\\]\\[id=(' + quoted + ')\\] \\[role="option"\\]\\[id=(' + quoted + ')\\]$')
  const match = pattern.exec(request.selector)
  if (!match) return null
  const listboxId = JSON.parse(match[1]), optionId = JSON.parse(match[2])
  if (!listboxId || !optionId) return null
  const selector = '[role="listbox"][id=' + JSON.stringify(listboxId) + '] [role="option"][id=' + JSON.stringify(optionId) + ']'
  return selector === request.selector ? { selector, listboxId, optionId } : null
}

// Self-contained because it is serialized into the actual installed renderer.
// A semantic listbox alone is not evidence that its option is painted at the
// point which will receive the one original mouse press/release.
export function observeFullAppOwnedOptionPointer(request, scroll = false) {
  const unavailable = (reason, details = {}) => ({ ready: false, reason, scrolled: false, ...details })
  const nodes = [...document.querySelectorAll(request.selector)]
  if (nodes.length !== 1) return unavailable('option-count', { count: nodes.length })
  const option = nodes[0], list = option.closest('[role="listbox"]')
  const uniqueId = node => node?.id && document.querySelectorAll('[id=' + JSON.stringify(node.id) + ']').length === 1
  if (!option.isConnected || option.id !== request.optionId || !uniqueId(option) ||
      list?.id !== request.listboxId || !uniqueId(list)) return unavailable('option-listbox-identity')
  const fields = [...document.querySelectorAll('[role="combobox"]')].filter(field =>
    field.getAttribute('aria-controls') === list.id || (field.getAttribute('aria-owns') || '').split(/\s+/).includes(list.id))
  if (fields.length !== 1) return unavailable('combobox-owner-count', { count: fields.length })
  const field = fields[0], host = field.closest('[data-ui-control="select"]'), outer = list.closest('.ant-select-dropdown')
  const markers = [...option.querySelectorAll('[data-ui-option-value]')]
  if (!field.isConnected || !uniqueId(field) || !host || host.querySelectorAll('[role="combobox"]').length !== 1 ||
      !host.hasAttribute('data-ui-value') || !outer || markers.length !== 1) return unavailable('shared-option-ownership')
  const identity = { inputId: field.id, listboxId: list.id, optionId: option.id,
    optionValue: markers[0].getAttribute('data-ui-option-value'), selectedValue: host.getAttribute('data-ui-value') }
  if (field.matches(':disabled') || field.getAttribute('aria-disabled') === 'true' ||
      option.getAttribute('aria-disabled') === 'true' || field.getAttribute('aria-expanded') !== 'true') {
    return unavailable('closed-or-disabled-owner-option', { identity })
  }
  if (scroll) option.scrollIntoView({ block: 'center', behavior: 'instant' })
  const bounds = node => { const b = node.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height } }
  const rect = bounds(option), popup = bounds(outer), listbox = bounds(list), trigger = bounds(field)
  const positive = box => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0
  let visible = [rect, popup, listbox, trigger].every(positive)
  for (let node = option; node && visible; node = node.parentElement) {
    const css = getComputedStyle(node)
    visible = css.display !== 'none' && css.visibility === 'visible' && Number(css.opacity) > 0
  }
  const viewport = { width: innerWidth, height: innerHeight }
  const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  const inViewport = point.x >= 0 && point.y >= 0 && point.x < innerWidth && point.y < innerHeight
  const hit = visible && inViewport ? document.elementFromPoint(point.x, point.y) : null
  const ownedHit = Boolean(hit && (hit === option || option.contains(hit)))
  return { identity, rect, popup, listbox, trigger, viewport, point, visible, inViewport, ownedHit,
    hit: hit ? { tag: hit.tagName, id: hit.id || null, role: hit.getAttribute('role') } : null,
    scrolled: scroll, ready: visible && inViewport && ownedHit,
    reason: !visible ? 'not-painted' : !inViewport ? 'outside-viewport' : !ownedHit ? 'foreign-hit' : null }
}

export async function prepareFullAppOwnedOptionPointer({ request, evaluate, until, receipt, save }) {
  const owned = fullAppOwnedOptionRequest(request)
  assert.ok(owned, 'Only the original owned Select option request may use pointer preparation')
  Object.assign(receipt, { scope: 'owned-select-option-pointer-preparation', request: owned, complete: false,
    nativeInputSentByPreparation: 0, sampleRetention: 'first and latest seven observations', omittedSamples: 0, samples: [], checks: 0 })
  save()
  let scrolled = false, identity = null
  const read = async (phase, shouldScroll = false, checkpoint = true) => {
    const sample = await evaluate(`(${observeFullAppOwnedOptionPointer.toString()})(${JSON.stringify(owned)},${shouldScroll})`)
    receipt.samples.push({ phase, sample })
    if (receipt.samples.length > 8) { receipt.samples.splice(1, 1); receipt.omittedSamples++ }
    receipt.lastPhase = phase
    if (sample.scrolled) scrolled = true
    if (checkpoint) save()
    if (identity) assert.deepEqual(sample.identity, identity, 'Actual owned Select option identity changed during pointer preparation')
    else if (sample.identity) { identity = sample.identity; receipt.identity = identity; if (checkpoint) save() }
    return sample
  }
  const geometry = sample => JSON.stringify([sample.rect, sample.popup, sample.listbox, sample.trigger, sample.viewport, sample.point])
  const frame = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))')
  try {
    // One call uses the runner's unchanged 15000 ms / 100 ms until body. A
    // pending alignment never adds a click, a focus call or another budget.
    const stable = await until(async () => {
      receipt.checks++
      const first = await read('before-frame', !scrolled)
      if (!first.ready) return false
      await frame()
      const second = await read('first-frame')
      if (!second.ready || geometry(first) !== geometry(second)) return false
      await frame()
      const third = await read('second-frame')
      if (!third.ready || geometry(second) !== geometry(third)) return false
      receipt.stableSamples = [first, second, third]; save()
      return third
    }, 'Actual owned Select option did not settle before native pointer')
    // This is a new actual renderer read after the wait returned, not the
    // previously cached point. Any final drift refuses input instead of replay.
    // Keep the fresh journal in memory: synchronous checkpoint I/O here would
    // reopen the observed point-to-press gap. The caller saves after its one
    // original press/release; failures still reach the existing saved catch.
    const fresh = await read('fresh-before-input', false, false)
    assert.equal(fresh.ready, true, 'Actual owned Select option lost its fresh native hit target')
    assert.equal(geometry(fresh), geometry(stable), 'Actual owned Select option moved before native pointer')
    receipt.fresh = fresh; receipt.complete = true
    return fresh.point
  } catch (error) {
    receipt.complete = false; receipt.error = { name: error.name, message: error.message, stack: error.stack }
    save()
    throw error
  }
}

// Observe the real renderer fetch and its existing DOM loading cycle. This
// verifier never starts a request, changes a timer, or changes application DOM.
// The function is deliberately self-contained for Runtime.evaluate serialization.
export function observeSyncActivityCaptureCycle(action, ownerToken) {
  const key = '__fullAppSyncActivityCaptureCycle'
  if (action !== 'install') {
    const owned = window[key]
    if (!owned && action === 'dispose') return { disposed: true, absent: true, ownerToken }
    if (!owned || owned.ownerToken !== ownerToken) throw Error('Sync capture observer ownership changed')
    if (action === 'read') return owned.read()
    if (action === 'dispose') {
      try { return { ...owned.read(), events: owned.events, cycles: owned.cycles, resources: owned.resources, disposed: true } }
      finally { owned.disconnect(); delete window[key] }
    }
    throw Error('Unknown Sync capture observer operation')
  }
  if (window[key]) throw Error('An earlier Sync capture observer was not disposed')
  if (window.__API_BASE__ !== 'http://127.0.0.1:27121') throw Error('Sync activity renderer API origin changed')
  if (typeof PerformanceObserver !== 'function' || !PerformanceObserver.supportedEntryTypes.includes('resource') ||
      typeof MutationObserver !== 'function') throw Error('Actual Sync resource or DOM observation is unavailable')
  const rootSelector = '.sync-center-card', ownerSelector = '.sync-activity[aria-label="当前同步任务"]'
  const one = (base, selector) => { const values = [...base.querySelectorAll(selector)]; return values.length === 1 ? values[0] : null }
  const root = one(document, rootSelector), owner = one(document, ownerSelector)
  const button = owner && one(owner, '.sync-activity-heading > button')
  const status = owner && one(owner, '.sync-activity-heading > strong[role="status"]')
  const endpoint = root && one(root, 'input[aria-label="WebDAV 端点"]')
  if (!root || !owner || owner.parentElement !== root || !button || !status || !endpoint ||
      button.textContent.trim() !== '刷新任务状态') throw Error('Missing or ambiguous actual Sync activity owner')
  // Long-running installed-page matrices can exceed Chromium's default 250
  // resource entries. Reserve headroom before observing; do not clear history,
  // suppress PerformanceObserver.droppedEntriesCount, or invent an API response.
  if (typeof performance.getEntriesByType !== 'function' ||
      typeof performance.setResourceTimingBufferSize !== 'function') {
    throw Error('Actual Sync resource timing capacity cannot be configured')
  }
  const existingResourceEntries = performance.getEntriesByType('resource').length
  if (!Number.isSafeInteger(existingResourceEntries) || existingResourceEntries < 0) {
    throw Error('Actual Sync resource timing baseline is invalid')
  }
  performance.setResourceTimingBufferSize(existingResourceEntries + 8192)
  const installedAt = performance.now(), resources = [], cycles = [], events = []
  let mutationObserver, resourceObserver, fatal = null, transitionVersion = 0, lowerBound = installedAt
  let lastDisabled = button.disabled, pending = null, ignoredResources = 0
  const log = value => {
    if (events.length >= 2048) { fatal ||= 'Sync passive observation exceeded its complete bounded trace'; return }
    events.push({ observedAt: performance.now(), ...value })
  }
  const dom = () => {
    const sameOwner = root.isConnected && owner.isConnected && button.isConnected && status.isConnected && endpoint.isConnected &&
      one(document, rootSelector) === root && one(document, ownerSelector) === owner && owner.parentElement === root &&
      one(owner, '.sync-activity-heading > button') === button && one(owner, '.sync-activity-heading > strong[role="status"]') === status &&
      one(root, 'input[aria-label="WebDAV 端点"]') === endpoint && button.closest(ownerSelector) === owner &&
      button.textContent.trim() === '刷新任务状态' && window.__API_BASE__ === 'http://127.0.0.1:27121'
    if (!sameOwner) fatal ||= 'Actual Sync activity owner was detached, replaced, or moved'
    const label = status.textContent.trim(), statusCount = owner.querySelectorAll('[role="status"]').length
    const healthyIdle = sameOwner && label === '当前没有正在执行的同步任务' && statusCount === 1 &&
      owner.querySelectorAll('button').length === 1 && !endpoint.disabled
    return { sameOwner, disabled: button.disabled, endpointDisabled: endpoint.disabled, label, statusCount, healthyIdle }
  }
  const mutations = records => {
    const changes = records.filter(record => record.type === 'attributes' && record.target === button && record.attributeName === 'disabled')
    for (let index = 0; index < changes.length; index++) {
      const before = changes[index].oldValue !== null
      const after = index + 1 < changes.length ? changes[index + 1].oldValue !== null : button.hasAttribute('disabled')
      if (before === after) continue
      if (before !== lastDisabled) fatal ||= 'Actual Sync loading transition history is incomplete'
      lastDisabled = after; transitionVersion++
      const observedAt = performance.now()
      log({ kind: 'disabled-transition', before, after, transitionVersion })
      if (after) {
        if (pending) fatal ||= 'Actual Sync loading cycles overlapped'
        pending = { version: cycles.length + 1, lowerBound, busyObservedAt: observedAt, idleObservedAt: null, resource: null }
        cycles.push(pending)
      } else {
        if (pending) {
          pending.idleObservedAt = observedAt; pending.endTransitionVersion = transitionVersion
          pending.idleObservation = dom(); pending = null
        }
        // A request already busy at installation is deliberately ineligible.
        lowerBound = observedAt
      }
    }
    dom()
  }
  const entries = values => {
    for (const entry of values) {
      if (entry.entryType !== 'resource' || entry.initiatorType !== 'fetch' || entry.name !== 'http://127.0.0.1:27121/api/sync/activity') {
        ignoredResources++; continue
      }
      const item = { serial: resources.length + 1, name: entry.name, initiatorType: entry.initiatorType,
        startTime: entry.startTime, responseEnd: entry.responseEnd }
      if (!Number.isFinite(item.startTime) || !Number.isFinite(item.responseEnd) || item.startTime < installedAt ||
          item.responseEnd < item.startTime || item.responseEnd > performance.now()) {
        log({ kind: 'ineligible-resource', ...item }); continue
      }
      if (resources.some(value => value.startTime === item.startTime && value.responseEnd === item.responseEnd)) {
        fatal ||= 'Actual Sync resource timing identity is duplicated'; continue
      }
      resources.push(item); log({ kind: 'resource-completed', ...item })
    }
  }
  const read = () => {
    if (mutationObserver) mutations(mutationObserver.takeRecords())
    if (resourceObserver) entries(resourceObserver.takeRecords())
    const state = dom(), now = performance.now()
    for (const cycle of cycles.filter(value => value.idleObservedAt !== null && !value.resource)) {
      const matching = resources.filter(value => value.startTime >= cycle.lowerBound && value.responseEnd <= cycle.idleObservedAt)
      if (matching.length > 1) fatal ||= 'Actual Sync loading cycle has ambiguous renderer requests'
      if (matching.length === 1) cycle.resource = matching[0]
    }
    const cycle = cycles.at(-1), resource = cycle?.resource || null
    const ageMs = resource ? now - resource.responseEnd : null
    const settledCycle = Boolean(cycle && cycle.idleObservedAt !== null && cycle.idleObservation.healthyIdle &&
      cycle.endTransitionVersion === transitionVersion && !state.disabled && state.healthyIdle && resource)
    const ready = !fatal && settledCycle && ageMs >= 0 && ageMs <= 1000
    return { ownerToken, installedAt, observedAt: now, ...state, fatal, transitionVersion, ignoredResources,
      completedCycle: cycle ? { ...cycle, resource } : null, ageMs, settledCycle, ready }
  }
  const owned = { ownerToken, resources, cycles, events, read, disconnect() { mutationObserver?.disconnect(); resourceObserver?.disconnect() } }
  window[key] = owned
  try {
    mutationObserver = new MutationObserver(mutations)
    mutationObserver.observe(owner, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['disabled'], attributeOldValue: true })
    resourceObserver = new PerformanceObserver((list, observer, options) => {
      if (options?.droppedEntriesCount) fatal ||= 'Actual Sync resource observation dropped entries'
      entries(list.getEntries())
    })
    resourceObserver.observe({ type: 'resource', buffered: false })
    log({ kind: 'installed', initialObservation: dom() })
  } catch (error) { fatal = 'Sync passive observer installation failed: ' + String(error.message); owned.disconnect() }
  return read()
}

export function createSyncActivityCaptureReadiness({ routeId, ownerToken, evaluate, until, receipt, save }) {
  if (!['sync-presentation', 'settings-main', 'local-sync-activity'].includes(routeId)) return null
  receipt.kind = 'passive-renderer-resource-and-owned-loading-cycle'; receipt.attempts = []; receipt.complete = false
  const call = action => evaluate(`(${observeSyncActivityCaptureCycle.toString()})(${JSON.stringify(action)},${JSON.stringify(ownerToken)})`)
  const valid = sample => {
    assert.equal(sample.ownerToken, ownerToken, 'Actual Sync capture observer token changed')
    assert.equal(sample.fatal, null, sample.fatal || 'Actual Sync observer rejected its evidence')
    assert.equal(sample.sameOwner, true, 'Actual Sync capture owner changed')
  }
  let closed = false
  return {
    get closed() { return closed },
    async install() { receipt.install = await call('install'); save(); valid(receipt.install) },
    async wait() {
      const attempt = { polls: 0, complete: false, boundaries: [] }; receipt.attempts.push(attempt)
      try {
        const ready = await until(async () => {
          const sample = await call('read'); attempt.polls++; attempt.first ||= sample; attempt.latest = sample
          save(); valid(sample)
          // A healthy cycle near its one-second expiry cannot survive the native
          // screenshot boundary. Wait for the next real 5-second refresh instead
          // of accepting a ticket that is already too old to photograph.
          return sample.ready && sample.ageMs <= 650 && sample
        }, 'Actual Sync activity refresh was not settled before native capture: did not complete a fresh owned renderer read')
        const ticket = { transitionVersion: ready.transitionVersion, cycleVersion: ready.completedCycle.version,
          startTime: ready.completedCycle.resource.startTime, responseEnd: ready.completedCycle.resource.responseEnd }
        attempt.ready = ready; attempt.ticket = ticket; save(); return ticket
      } catch (error) { attempt.error = { name: error.name, message: error.message }; save(); throw error }
    },
    async boundary(ticket, phase, image) {
      const sample = await call('read'), attempt = receipt.attempts.at(-1)
      attempt.boundaries.push({ phase, image, sample }); save(); valid(sample)
      assert.equal(sample.settledCycle, true, 'Actual Sync refresh ceased to be healthy and idle at PNG boundary')
      assert.deepEqual({ transitionVersion: sample.transitionVersion, cycleVersion: sample.completedCycle.version,
        startTime: sample.completedCycle.resource.startTime, responseEnd: sample.completedCycle.resource.responseEnd }, ticket,
      'Actual Sync refresh cycle changed at PNG boundary')
      assert.ok(sample.ageMs >= 0 && sample.ageMs < 5000, 'Actual PNG exceeded the observed normal Sync idle interval')
      if (phase === 'before-capture') assert.equal(sample.ready, true, 'Actual Sync refresh cycle became stale before PNG capture')
      if (phase === 'after-capture') attempt.complete = true
      save()
    },
    async close() {
      if (closed) return
      receipt.disposal = await call('dispose'); closed = receipt.disposal.disposed === true; save()
      assert.equal(closed, true, 'Actual Sync passive observers were not disposed')
      assert.equal(receipt.disposal.absent, undefined, 'Actual Sync passive observer disappeared before disposal')
      valid(receipt.disposal)
      receipt.complete = receipt.attempts.length > 0 && receipt.attempts.every(attempt => attempt.complete)
      save()
    },
  }
}

// Renderer-only observation state. It holds original DOM references and a
// passive key observer; it never focuses, clicks, restores a Range or edits UI.
export function observeCodeLanguageKeyboardEntry(ownerToken, action = 'read') {
  const key = '__fullAppCodeLanguageKeyboardOwner'
  const owned = window[key]
  const selectors = {
    editor: '.editor-input[contenteditable="true"]',
    owner: '.editor-input[contenteditable="true"] .code-block-wrapper:has(> .code-block-header)',
    target: '.editor-input[contenteditable="true"] .code-block-wrapper:has(> .code-block-header) .language-selector-button',
  }
  const sameOwner = state => state && Object.entries(state.refs).every(([name, node]) => {
    if (!node.isConnected) return false
    if (name === 'header') return state.refs.owner.querySelector(':scope > .code-block-header') === node
    if (name === 'next') return [...state.refs.header.querySelectorAll('button')].filter(button => !button.disabled && button.tabIndex >= 0)[1] === node
    const nodes = document.querySelectorAll(selectors[name]); return nodes.length === 1 && nodes[0] === node
  })
  if (action === 'dispose') {
    if (!owned) return { disposed: true, absent: true, ownerToken }
    if (owned.ownerToken !== ownerToken) throw Error('Code language keyboard observer token changed')
    try {
      let originalRemovalError = null
      try { document.removeEventListener('keydown', owned.onKey, true) } catch (error) { originalRemovalError = error }
      const nativeCleanup = owned.disposeNativeTrace?.()
      if (originalRemovalError) throw originalRemovalError
      return { disposed: nativeCleanup !== false, ownerToken, identityRetained: Boolean(sameOwner(owned)),
        ownedEvents: owned.events.slice(), ownedTraceTruncated: owned.truncated,
        ...(owned.failureDiagnostic ? { failureDiagnostic: owned.failureDiagnostic, nativeTrace: owned.nativeTrace } : {}) }
    } finally { delete window[key] }
  }
  if (!ownerToken || !['read', 'install'].includes(action)) throw Error('Code language keyboard observer operation is invalid')
  const one = selector => {
    const nodes = document.querySelectorAll(selector)
    if (nodes.length !== 1) throw Error('Code language keyboard owner missing or ambiguous: ' + selector)
    return nodes[0]
  }
  const editor = one(selectors.editor), owner = one(selectors.owner), target = one(selectors.target)
  const header = owner.querySelector(':scope > .code-block-header')
  const buttons = header ? [...header.querySelectorAll('button')].filter(button => !button.disabled && button.tabIndex >= 0) : []
  const next = buttons[1], refs = { editor, owner, header, target, next }
  if (action === 'read') {
    if (!owned || owned.ownerToken !== ownerToken) throw Error('Code language keyboard observer token changed')
    if (Object.keys(refs).some(name => owned.refs[name] !== refs[name])) throw Error('Code language keyboard owner identity was replaced')
  }
  if (!header || !Object.values(refs).every(node => node?.isConnected) || owner.closest('.editor-input[contenteditable]') !== editor ||
      target.tagName !== 'BUTTON' || next?.tagName !== 'BUTTON' || target.disabled || next.disabled ||
      buttons[0] !== target || target.tabIndex < 0 || next.tabIndex < 0 ||
      target.closest('.code-block-header') !== header || next.closest('.code-block-header') !== header ||
      next.closest('.code-block-toolbar')?.parentElement !== header ||
      !['自动换行', '取消换行'].includes(next.textContent.trim())) {
    throw Error('Code language keyboard does not own the actual enabled adjacent header controls')
  }
  if (owner.querySelector('.language-selector-dropdown')) throw Error('Code language keyboard unexpectedly opened its language popup')
  if (document.querySelector('.workspace-save-chip,.editor-unapplied-draft-pill,.save-state.error,.save-state.saving,.quit-save-veil,.consumer-confirm-modal')) {
    throw Error('Code language keyboard changed the clean note or entered a pending action')
  }
  const fields = owner.querySelectorAll('textarea.code-textarea'), previews = owner.querySelectorAll('pre.code-preview')
  if (fields.length !== 1 || previews.length !== 1 || fields[0].readOnly || fields[0].disabled) throw Error('Code language keyboard lost its editable source')
  const selection = window.getSelection()
  if (!selection || selection.rangeCount > 1) throw Error('Code language keyboard selection is unavailable or ambiguous')
  const point = (node, offset) => {
    if (!node) return null
    if (node !== editor && !editor.contains(node)) throw Error('Code language keyboard selection left its editor')
    const path = [], type = node.nodeType
    while (node !== editor) { const parent = node.parentNode; path.unshift([...parent.childNodes].indexOf(node)); node = parent }
    return { path, type, offset }
  }
  // Header button styles are presentation, not saved rich-text content. The
  // unchanged shared.focus gates below inspect their actual computed outline,
  // shadow, viewport and hit state; paragraph/code styles remain in this copy.
  const content = editor.cloneNode(true)
  for (const button of content.querySelectorAll('.code-block-wrapper > .code-block-header button')) button.removeAttribute('style')
  const snapshot = { content: content.innerHTML, code: fields[0].value, previewText: previews[0].textContent,
    language: target.textContent.trim(), documentTitle: one('.workspace-title-button').textContent.trim(),
    selection: { rangeCount: selection.rangeCount, collapsed: selection.isCollapsed, text: selection.toString(),
      anchor: point(selection.anchorNode, selection.anchorOffset), focus: point(selection.focusNode, selection.focusOffset) } }
  if (action === 'install') {
    if (owned) throw Error('Code language keyboard previous observer was not disposed')
    const state = { ownerToken, refs, snapshot, selectionNodes: [selection.anchorNode, selection.focusNode], events: [], truncated: false, onKey: null }
    state.onKey = event => {
      if (state.events.length >= 8) { state.truncated = true; return }
      const name = node => node === editor ? 'editor' : node === target ? 'language' : node === next ? 'next' : 'other'
      state.events.push({ type: event.type, key: event.key, trusted: event.isTrusted,
        target: name(event.target), active: name(document.activeElement), shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
        composing: event.isComposing || event.keyCode === 229 || event.which === 229 })
      if (event.key === 'F6') state.captureNativeF6?.(event)
    }
    window[key] = state
    document.addEventListener('keydown', state.onKey, { capture: true, passive: true })
    // This diagnostic observes the real installed Editor. It never invokes
    // editor.read/update/focus, synthesizes input, flushes, or edits a Selection.
    // Extra native callbacks can still add microtask-checkpoint opportunities.
    const native = state.nativeTrace = { schemaVersion: 1, mode: 'instrumented-readonly-observer',
      available: false, unavailableReason: 'lexical-owner-missing-or-foreign', rowLimit: 64,
      rows: [], attempts: 0, truncated: false, captureErrors: 0, ownerChanged: false, registrationCleanupUnknown: false,
      observationComplete: false, productAccepted: false, originalWindowsProducerProven: false }
    const disposers = [], objects = new WeakMap(), keys = new Map()
    let nextObject = 0, nextKey = 0, sequence = 0, armed = false, closed = false, lexical = null
    const data = (object, name) => {
      if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined
      const descriptor = Object.getOwnPropertyDescriptor(object, name)
      return descriptor && 'value' in descriptor ? descriptor.value : undefined
    }
    const id = value => {
      if (!value) return null
      if (!objects.has(value)) objects.set(value, ++nextObject)
      return objects.get(value)
    }
    const keyID = value => {
      if (typeof value !== 'string' || value.length > 128) throw Error('unsupported-logical-key')
      if (!keys.has(value)) { if (keys.size >= 256) throw Error('logical-key-bound'); keys.set(value, ++nextKey) }
      return keys.get(value)
    }
    const role = node => !node ? null : node === editor ? 'editor' : node === target ? 'language' : node === next ? 'next' :
      node === owner ? 'owner' : node === header ? 'header' : editor.contains(node) ? 'editor-descendant' : 'other'
    const domPoint = (node, offset) => node && ({ id: id(node), role: role(node), type: node.nodeType,
      offset, connected: node.isConnected, sameDocument: node.ownerDocument === document })
    const logical = value => {
      if (value === null) return null
      if (!value || typeof value !== 'object') throw Error('unsupported-logical-selection')
      const anchor = data(value, 'anchor'), focus = data(value, 'focus')
      const point = item => {
        const offset = data(item, 'offset'), type = data(item, 'type')
        if (!Number.isSafeInteger(offset) || offset < 0 || !['text', 'element'].includes(type)) throw Error('unsupported-logical-point')
        return { keyID: keyID(data(item, 'key')), offset, type }
      }
      return { id: id(value), kind: anchor && focus ? 'points' : 'other',
        anchor: anchor && focus ? point(anchor) : null, focus: anchor && focus ? point(focus) : null,
        dirty: data(value, 'dirty') === true }
    }
    const tagSummary = tags => {
      const count = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get.call(tags)
      const known = ['skip-dom-selection', 'focus', 'history-merge', 'history-push', 'historic', 'local-notepad:content-load', 'evidence-navigation']
      return { count, known: known.filter(tag => Set.prototype.has.call(tags, tag)) }
    }
    const record = (stage, event = null, currentSelection = null, update = null) => {
      if (closed || !native.available) return
      if (native.attempts >= native.rowLimit) { native.truncated = true; return }
      native.attempts++
      try {
        if (!sameOwner(state) || data(editor, '__lexicalEditor') !== lexical || data(lexical, '_rootElement') !== editor) {
          native.ownerChanged = true; throw Error('native-owner-changed')
        }
        const current = data(lexical, '_editorState'), pending = data(lexical, '_pendingEditorState')
        const selection = currentSelection || window.getSelection()
        if (!selection || !current || (pending !== null && !pending)) throw Error('native-state-unavailable')
        const dirtyType = data(lexical, '_dirtyType')
        if (!Number.isSafeInteger(dirtyType) || dirtyType < 0) throw Error('native-dirty-state-unavailable')
        native.rows.push({ sequence: ++sequence, stage, at: performance.now(),
          event: event ? { id: id(event), type: event.type, key: event.key === 'F6' ? 'F6' : null,
            trusted: event.isTrusted === true, phase: event.eventPhase, prevented: event.defaultPrevented === true,
            target: role(event.target), shift: !!event.shiftKey, ctrl: !!event.ctrlKey, alt: !!event.altKey,
            meta: !!event.metaKey, composing: !!event.isComposing || event.keyCode === 229 || event.which === 229 } : null,
          dom: { objectID: id(selection), rangeCount: selection.rangeCount, collapsed: selection.isCollapsed,
            anchor: domPoint(selection.anchorNode, selection.anchorOffset), focus: domPoint(selection.focusNode, selection.focusOffset),
            active: role(document.activeElement) },
          current: { id: id(current), selection: logical(data(current, '_selection')) },
          pending: pending === null ? null : { id: id(pending), selection: logical(data(pending, '_selection')) },
          dirtyType, pendingTags: tagSummary(data(lexical, '_updateTags')),
          committed: update ? { id: id(update.editorState), tags: tagSummary(update.tags),
            dirtyElements: update.dirtyElements.size, dirtyLeaves: update.dirtyLeaves.size } : null })
      } catch { native.captureErrors++; native.firstCaptureError ||= stage }
    }
    const cleanup = () => {
      closed = true
      let errors = 0
      for (const item of [...disposers].reverse()) if (item.active) {
        try { item.remove(); item.active = false } catch { errors++ }
      }
      native.cleanup = { attempted: true, installed: disposers.length,
        removed: disposers.filter(item => !item.active).length, errors, remaining: disposers.filter(item => item.active).length }
      const downs = native.rows.filter(row => row.stage === 'document-keydown-capture')
      const tails = native.rows.filter(row => row.stage === 'root-keydown-tail')
      const ups = native.rows.filter(row => row.stage === 'document-keyup-capture')
      const reads = native.rows.filter(row => row.stage === 'first-read-after-f6')
      const input = row => row.event?.trusted && !row.event.shift && !row.event.ctrl && !row.event.alt && !row.event.meta && !row.event.composing
      native.observationComplete = native.available && !native.truncated && !native.captureErrors && !native.ownerChanged &&
        !native.registrationCleanupUnknown && errors === 0 && native.cleanup.remaining === 0 && downs.length === 1 && tails.length === 1 && ups.length === 1 && reads.length === 1 &&
        input(downs[0]) && input(ups[0]) && tails[0].event.id === downs[0].event.id &&
        downs[0].sequence < tails[0].sequence && tails[0].sequence < ups[0].sequence && ups[0].sequence < reads[0].sequence
      return !native.registrationCleanupUnknown && errors === 0 && native.cleanup.remaining === 0
    }
    state.disposeNativeTrace = cleanup
    state.captureNativeF6 = event => { if (!closed) { armed = true; record('document-keydown-capture', event) } }
    state.readNativeTrace = currentSelection => {
      if (!closed) { record(armed ? 'first-read-after-f6' : 'read-before-f6', null, currentSelection); if (armed) closed = true }
    }
    try {
      lexical = data(editor, '__lexicalEditor')
      if (lexical && data(lexical, '_rootElement') === editor && typeof lexical.registerUpdateListener === 'function') {
        native.registrationCleanupUnknown = true
        const remove = lexical.registerUpdateListener(update => { if (armed) record('lexical-committed-update', null, null, update) })
        if (typeof remove !== 'function') throw Error('native-listener-disposer-unavailable')
        disposers.push({ active: true, remove })
        native.registrationCleanupUnknown = false
        const listen = (node, type, callback, capture) => {
          disposers.push({ active: true, remove: () => node.removeEventListener(type, callback, capture) })
          node.addEventListener(type, callback, { capture, passive: true })
        }
        listen(editor, 'keydown', event => { if (armed && event.key === 'F6') record('root-keydown-tail', event) }, false)
        listen(document, 'keyup', event => { if (armed && event.key === 'F6') record('document-keyup-capture', event) }, true)
        listen(document, 'selectionchange', event => { if (armed) record('document-selectionchange', event) }, true)
        native.available = true; native.unavailableReason = null
        record('installed', null, selection)
      }
    } catch {
      native.available = false; native.unavailableReason = 'native-trace-registration-failed'
      cleanup()
    }
  } else {
    owned.readNativeTrace?.(selection)
    if (owned.selectionNodes[0] !== selection.anchorNode || owned.selectionNodes[1] !== selection.focusNode) {
      // Keep only this failed read, before its original throw. The existing
      // disposal response and finally save retain plain data without a reread,
      // an additional checkpoint, or any repair of focus/selection/content.
      try {
        if (!owned.failureDiagnostic) {
          const point = value => value && ({ path: value.path.slice(0, 64), pathLength: value.path.length,
            pathTruncated: value.path.length > 64, type: value.type, offset: value.offset })
          const compact = value => ({ rangeCount: value.rangeCount, collapsed: value.collapsed,
            anchor: point(value.anchor), focus: point(value.focus) })
          const role = node => node === editor ? 'editor' : node === target ? 'language' : node === next ? 'next' :
            target.contains(node) ? 'language-descendant' : next.contains(node) ? 'next-descendant' :
            node === header ? 'header' : node === owner ? 'owner' : editor.contains(node) ? 'editor-descendant' : 'other'
          const describe = node => node && ({ nodeType: node.nodeType, nodeName: String(node.nodeName).slice(0, 64),
            connectedAtFailure: node.isConnected, sameOwnerDocument: node.ownerDocument === document, role: role(node) })
          owned.failureDiagnostic = { schemaVersion: 1, kind: 'selection-endpoint-identity', action: 'read',
            before: compact(owned.snapshot.selection), after: compact(snapshot.selection),
            anchorIdentityRetained: owned.selectionNodes[0] === selection.anchorNode,
            focusIdentityRetained: owned.selectionNodes[1] === selection.focusNode,
            active: document.activeElement === editor ? 'editor' : document.activeElement === target ? 'language' :
              document.activeElement === next ? 'next' : 'other',
            originalEndpoints: { anchor: describe(owned.selectionNodes[0]), focus: describe(owned.selectionNodes[1]) },
            observedEndpoints: { anchor: describe(selection.anchorNode), focus: describe(selection.focusNode) } }
        }
      } catch {
        // A diagnostic-only failure must never replace the existing rejection.
        try { owned.failureDiagnostic ||= { schemaVersion: 1, kind: 'selection-endpoint-identity', action: 'read', captureFailed: true } } catch {}
      }
      throw Error('Code language keyboard original selection endpoints were replaced')
    }
    for (const name of Object.keys(snapshot)) if (JSON.stringify(snapshot[name]) !== JSON.stringify(owned.snapshot[name])) {
      throw Error('Code language keyboard changed its original ' + name)
    }
  }
  const state = window[key]
  return { ...snapshot, ownerToken, ownerReady: true,
    active: document.activeElement === editor ? 'editor' : document.activeElement === target ? 'language' : document.activeElement === next ? 'next' : 'other',
    ownedEvents: state.events.slice(), ownedTraceTruncated: state.truncated }
}

/** New product F6 entry plus genuine adjacent Tab round-trip. Only the exact
 * code/default route opts in; generic 1 reverse / 256 forward is unchanged. */
export async function traverseCodeLanguageWithNativeKeys({ key, evaluate, receipt, save }) {
  Object.assign(receipt, { nativeEntry: null, forwardTabs: 0, reverseTabs: 0, reached: false,
    observations: [], inputs: [], ownerInstalled: false })
  let failure = null
  const read = async (stage, action = 'read') => {
    const value = await evaluate(`(${observeCodeLanguageKeyboardEntry.toString()})(${JSON.stringify(receipt.ownerToken)},${JSON.stringify(action)})`)
    if (action === 'install') receipt.ownerInstalled = true
    receipt.observations.push({ stage, value }); receipt.stage = stage; save()
    return value
  }
  const input = async (name, modifiers = 0) => {
    const item = { key: name, modifiers, complete: false }; receipt.inputs.push(item); save()
    // A checkpoint can take time. Re-read the real identity and focus after it,
    // immediately before sending the key; never repair a changed entry point.
    item.before = await evaluate(`(${observeCodeLanguageKeyboardEntry.toString()})(${JSON.stringify(receipt.ownerToken)},'read')`)
    assert.equal(item.before.active, name === 'F6' ? 'editor' : modifiers === 8 ? 'next' : 'language', 'Code language keyboard focus changed before its next native input')
    await key(name, modifiers); item.complete = true
  }
  const trace = async () => {
    const result = await evaluate(`({events:window.__fullAppUiEvents.slice(${Number(receipt.eventStart)}),traceTruncated:window.__fullAppUiTraceTruncated})`)
    Object.assign(receipt, result)
    assert.equal(result.traceTruncated, false, 'Code language keyboard trace was truncated')
    return result
  }
  save()
  try {
    const initial = await read('initial', 'install')
    if (initial.active !== 'editor') { receipt.refusal = { stage: 'initial', expected: 'editor', actual: initial.active }; return receipt }
    await input('F6'); receipt.nativeEntry = 'F6'
    const entered = await read('entered')
    if (entered.active !== 'language') { receipt.refusal = { stage: 'entered', expected: 'language', actual: entered.active }; return receipt }
    await input('Tab'); receipt.forwardTabs++
    const forward = await read('forward')
    if (forward.active !== 'next') { receipt.refusal = { stage: 'forward', expected: 'next', actual: forward.active }; return receipt }
    await input('Tab', 8); receipt.reverseTabs++
    const returned = await read('returned')
    if (returned.active !== 'language') { receipt.refusal = { stage: 'returned', expected: 'language', actual: returned.active }; return receipt }
    receipt.ownedEvents = returned.ownedEvents
    assert.equal(returned.ownedTraceTruncated, false, 'Code language keyboard owned trace was truncated')
    const expected = [['F6', false, 'editor'], ['Tab', false, 'language'], ['Tab', true, 'next']]
    assert.deepEqual(receipt.ownedEvents.map(event => [event.key, event.shiftKey, event.target]), expected, 'Code language keyboard trusted owner trace did not prove the exact adjacent traversal')
    assert.ok(receipt.ownedEvents.every(event => event.type === 'keydown' && event.trusted && !event.ctrlKey && !event.altKey && !event.metaKey && !event.composing && event.target === event.active), 'Code language keyboard requires actual trusted unmodified owned input')
    const current = await trace(), keys = current.events.filter(event => event.type === 'keydown')
    assert.deepEqual(keys.map(event => event.key), ['F6', 'Tab', 'Tab'], 'Code language keyboard global trace is missing the original real key sequence')
    assert.ok(keys.every(event => event.trusted), 'Code language keyboard global trace contains untrusted input')
    receipt.reached = true
    return receipt
  } catch (error) {
    failure = error; receipt.reached = false
    receipt.error = { name: error.name, message: error.message, stack: error.stack }
    throw error
  } finally {
    try {
      if (!receipt.events) {
        try { await trace() } catch (error) { receipt.traceError = { name: error.name, message: error.message } }
      }
      receipt.disposal = await evaluate(`(${observeCodeLanguageKeyboardEntry.toString()})(${JSON.stringify(receipt.ownerToken)},'dispose')`)
      if (receipt.disposal.nativeTrace) {
        // Only bounded anonymous metadata leaves the renderer. Hash it during
        // the original disposal/save path, never by another CDP read or wait.
        try {
          const bytes = Buffer.from(JSON.stringify(receipt.disposal.nativeTrace), 'utf8')
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          receipt.disposal.nativeTrace = bytes.length <= 65536 ? { ...receipt.disposal.nativeTrace, bytes: bytes.length, sha256 } :
            { schemaVersion: 1, mode: 'instrumented-readonly-observer', available: false, unavailableReason: 'serialized-metadata-limit',
              observationComplete: false, productAccepted: false, originalWindowsProducerProven: false,
              truncated: true, payloadRetained: false, bytes: bytes.length, sha256 }
        } catch {
          receipt.disposal.nativeTrace = { schemaVersion: 1, mode: 'instrumented-readonly-observer', available: false,
            unavailableReason: 'metadata-hash-failed', observationComplete: false, productAccepted: false, originalWindowsProducerProven: false }
        }
      }
      receipt.ownedEvents ||= receipt.disposal.ownedEvents || []
      assert.equal(receipt.disposal.disposed, true, 'Code language keyboard observer was not disposed')
      if (receipt.ownerInstalled) assert.equal(receipt.disposal.absent, undefined, 'Code language keyboard observer disappeared before disposal')
      if (!failure) assert.equal(receipt.disposal.identityRetained, true, 'Code language keyboard owner changed before disposal')
    } catch (error) {
      receipt.reached = false; receipt.cleanupError = { name: error.name, message: error.message }
      if (!failure) throw error
    } finally {
      try { save() } catch (error) { if (!failure) throw error; receipt.saveError = { name: error.name, message: error.message } }
    }
  }
}
