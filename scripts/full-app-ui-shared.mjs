import assert from 'node:assert/strict'
import { createNativeUiSelect } from './native-ui-select.mjs'
import controlEvidence from './check-ui-control-render.cjs'
import { COLLAPSED_SIDEBAR_EXPAND, validateCollapsedSidebarObservation, validateCollapsedSidebarFocus } from './full-app-ui-evidence.mjs'

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
export function viewportFixedClipBoundary(node) {
  for (let fixed = node; fixed; fixed = fixed.parentElement) {
    if (getComputedStyle(fixed).position !== 'fixed') continue
    let contained = false
    for (let ancestor = fixed.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor)
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
  const bounds = node => {
    const box = node.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
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
      const css = getComputedStyle(owner)
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) <= 0) return false
    }
    return true
  }
  const rendered = node => {
    if (!node.isConnected || hiddenByClosedDetails(node)) return false
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
  const observe = (node, checkPaintedFragments = false) => {
    const box = bounds(node), visible = painted(node), clippingAncestors = []
    const fixedBoundary = fixedBoundaryFor(node)
    let beyondFixed = fixedBoundary === node
    let inViewport = box.left >= -1 && box.top >= -1 && box.right <= viewport.right + 1 && box.bottom <= viewport.bottom + 1
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), clip = bounds(parent), applied = overflowViewport.local(parent, css)
      if (!beyondFixed) inViewport &&= withinClientPort(box, clip, parent, applied.x, applied.y)
      if (parent === fixedBoundary) beyondFixed = true
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
    const css = getComputedStyle(visual)
    item.computed = { color: css.color, background: css.backgroundColor, border: css.borderTopColor, whiteSpace: css.whiteSpace,
      lineHeight: css.lineHeight, fontSize: css.fontSize, overflowX: css.overflowX, opacity: css.opacity }
    if (nativeCheckboxMark) item.nativePresentation = { owner: 'project-chapter-select-label',
      inputChecked: Boolean(node.checked), inputNativeType: node.type, visibleMarkSelector: selector(nativeCheckboxMark) }
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
    return { selector: target, ...observe(matches[0], true) }
  })
  const scrollOwners = collectFullAppScrollOwners(area, fixedBoundaryFor)
  const scrollAreas = []
  for (const owner of scrollOwners) {
    const css = getComputedStyle(owner), viewportScrollOwner = overflowViewport.isViewportScroller(owner)
    if (overflowViewport.propagated(owner) && !viewportScrollOwner) continue
    const overflowY = viewportScrollOwner ? overflowViewport.viewportOverflowY : css.overflowY
    const clientHeight = viewportScrollOwner ? viewport.height : owner.clientHeight
    if ((!viewportScrollOwner && !rendered(owner)) || !/auto|scroll/.test(overflowY) || owner.scrollHeight <= clientHeight + 1) continue
    const ownerBounds = bounds(owner), box = viewportScrollOwner ? viewport : ownerBounds, maximum = owner.scrollHeight - clientHeight
    const ancestor = owner !== area && owner.contains(area)
    // An independently swept nested scroll surface owns its content. Its
    // outermost client port, rather than the moving route inside it, is the
    // stable content extent that this ancestor must photograph.
    let contentOwner = area, nestedContent = false
    if (ancestor) for (let nested = area; nested && nested !== owner; nested = nested.parentElement) {
      const nestedStyle = getComputedStyle(nested), nestedViewportOwner = overflowViewport.isViewportScroller(nested)
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
    const fixedBoundary = fixedBoundaryFor(owner)
    let beyondFixed = fixedBoundary === owner
    for (let parent = owner.parentElement; parent; parent = parent.parentElement) {
      const clipCss = getComputedStyle(parent), applied = overflowViewport.local(parent, clipCss)
      if (!beyondFixed && /hidden|auto|scroll|clip/.test(applied.y)) {
        const clip = bounds(parent), top = clip.top + parent.clientTop
        visibleTop = Math.max(visibleTop, top); visibleBottom = Math.min(visibleBottom, top + parent.clientHeight)
      }
      if (parent === fixedBoundary) beyondFixed = true
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
    for (const { sample, actual } of pair) {
      assert.equal(actual.scrollHeight, surface.scrollHeight); assert.equal(actual.clientHeight, surface.clientHeight)
      const originalRange = Math.abs(actual.requiredContentStart - start) <= 1 && Math.abs(actual.requiredContentEnd - end) <= 1
      assert.ok(originalRange || pinnedNestedAncestorRange(surface, baseline, sample, actual), 'Actual long-page content range changed')
      assert.ok(Number.isFinite(actual.visibleContentStart) && Number.isFinite(actual.visibleContentEnd) && actual.visibleContentEnd >= actual.visibleContentStart)
    }
    const from = Math.max(start, pair[0].actual.visibleContentStart, pair[1].actual.visibleContentStart)
    const to = Math.min(end, pair[0].actual.visibleContentEnd, pair[1].actual.visibleContentEnd)
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
    const syncReadiness = ['sync-presentation', 'settings-main'].includes(meta.routeId) ? createSyncActivityCaptureReadiness({ routeId: meta.routeId,
      ownerToken: JSON.stringify(meta), evaluate, until, receipt: (scene.syncActivityReadiness = {}), save }) : null
    let captureFailure = null
    let index = 0
    const snap = async targetAnchors => {
      // A momentary enabled button can be just before the next normal poll.
      // Observe a newly completed owned renderer read, without initiating one.
      const syncTicket = syncReadiness ? await syncReadiness.wait() : null
      const motion = { complete: false }; scene.motionReadiness.push(motion)
      await waitForFiniteOwnerMotion(() => evaluate(`(${observeFullAppOwnerMotion.toString()})(${q(root)})`), until, motion)
      const before = await samplePage(route, root, targetAnchors, onlySelectors, sidebarFocusRequired)
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
      const image = await capture(filename, async () => {
        const fresh = await samplePage(route, root, targetAnchors, onlySelectors, sidebarFocusRequired)
        appendRaw(scene, { ...fresh, text: undefined, phase: 'before-capture', image: filename }); save()
        if (sidebarFocusRequired) validateCollapsedSidebarObservation(fresh.sidebarFocus, ctx.matrix)
        validateFullAppCaptureContinuity(measured, fresh, ctx.matrix)
        if (syncReadiness) await syncReadiness.boundary(syncTicket, 'before-capture', filename)
        return true
      })
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
    if (field.tag === 'TEXTAREA' || (field.tag === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(field.type))) {
      const select = await nativeSelect.inspect(selector)
      if (select.kind === 'shared') {
        if (!select.expanded) await click('[data-ui-control="select"]:has([role="combobox"][id=' + q(select.inputId) + '])')
        await until(async () => (await nativeSelect.inspect(selector)).expanded, 'Actual focus Select did not open')
        await key('Escape')
        await until(async () => !(await nativeSelect.inspect(selector)).expanded, 'Actual focus Select did not close')
      } else await click(selector)
    }
    let reached = false, tabAttempts = 0, reverseTabs = 0, nativeSourceOrder = null
    if (meta.routeId === 'editor-source' && meta.stateId === 'default' &&
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
      for (let index = 0; index < 256; index++) {
        await key('Tab')
        tabAttempts++
        if (await evaluate(`document.activeElement===document.querySelector(${q(selector)})`)) { reached = true; break }
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
  if (!['sync-presentation', 'settings-main'].includes(routeId)) return null
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
