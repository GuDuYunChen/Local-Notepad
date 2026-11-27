import { getScrollParent } from '@lexical/utils'

const clips = value => /^(auto|scroll|overlay|hidden|clip)$/.test(value)
const scrolls = value => /^(auto|scroll|overlay|hidden)$/.test(value)
const elementOf = node => node?.nodeType === 1 ? node : node?.parentElement
const nonempty = rect => rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top

function clientBox(element) {
  const rect = element.getBoundingClientRect()
  const left = rect.left + element.clientLeft, top = rect.top + element.clientTop
  return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight }
}

function visibleBox(element, window) {
  const box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  for (let node = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node), rect = clientBox(node)
    if (clips(style.overflowX)) { box.left = Math.max(box.left, rect.left); box.right = Math.min(box.right, rect.right) }
    if (clips(style.overflowY)) { box.top = Math.max(box.top, rect.top); box.bottom = Math.min(box.bottom, rect.bottom) }
  }
  return box
}

function withoutPanel(box, panel, match) {
  if (!nonempty(panel) || panel.right <= box.left || panel.left >= box.right || panel.bottom <= box.top || panel.top >= box.bottom) return box
  // The find panel is an overlay, not a scroll ancestor. Prefer a complete
  // line fragment in the largest unobscured part of this same viewport.
  const candidates = [
    { ...box, bottom: Math.min(box.bottom, panel.top) },
    { ...box, top: Math.max(box.top, panel.bottom) },
    { ...box, right: Math.min(box.right, panel.left) },
    { ...box, left: Math.max(box.left, panel.right) },
  ].filter(nonempty)
  const fitting = candidates.filter(rect => rect.right - rect.left >= match.right - match.left && rect.bottom - rect.top >= match.bottom - match.top)
  return (fitting.length ? fitting : candidates).sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))[0] || box
}

function clearTableBox(box, table, cell, match, window, axis) {
  const result = { ...box }
  if (axis === 'y' && table.dataset.lexicalFrozenRow === 'true' && cell.parentElement !== table.rows[0]) {
    for (const frozen of table.rows[0]?.cells || []) {
      if (frozen === cell || window.getComputedStyle(frozen).position !== 'sticky') continue
      const rect = frozen.getBoundingClientRect()
      if (rect.right > match.left && rect.left < match.right) result.top = Math.max(result.top, rect.bottom)
    }
  }
  if (table.dataset.lexicalFrozenColumn === 'true') {
    for (const frozen of table.querySelectorAll('[data-table-column="0"]')) {
      if (frozen === cell || frozen.closest('table') !== table || window.getComputedStyle(frozen).position !== 'sticky') continue
      const rect = frozen.getBoundingClientRect()
      if (rect.bottom > match.top && rect.top < match.bottom) result.left = Math.max(result.left, rect.right)
    }
  }
  return result
}

function delta(start, end, low, high) {
  if (start >= low && end <= high) return 0
  // A very long query can span several lines. Reveal the first actual line,
  // aligning its start when even that fragment is wider than the viewport.
  return end - start > high - low ? start - low : (start + end - low - high) / 2
}

/** Reveal a text range inside an existing Table without taking selection/focus. */
export function revealTableSearchRange({ range, table, root, panel }) {
  const start = elementOf(range?.startContainer), end = elementOf(range?.endContainer)
  const cell = start?.closest('td,th'), document = root?.ownerDocument, window = document?.defaultView
  if (!window || !root.isConnected || !table?.isConnected || !root.contains(table) || !cell || cell !== end?.closest('td,th') || cell.closest('table') !== table || start.closest('[contenteditable]') !== root || end.closest('[contenteditable]') !== root) return false
  const fragment = () => [...(range.getClientRects?.() || [])].find(nonempty)
  if (!fragment()) return false
  // First expose the Table's viewport when the whole block is outside its
  // enclosing scroller. Scrolling an inner, clipped line in the outer scroller
  // would otherwise overshoot the entire Table before its own scroll can run.
  if (!nonempty(visibleBox(table, window))) table.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  const chain = [], seen = new Set()
  const add = node => {
    if (!node || seen.has(node)) return
    seen.add(node)
    const style = window.getComputedStyle(node)
    const page = node === document.scrollingElement
    const x = (page || scrolls(style.overflowX)) && node.scrollWidth > node.clientWidth
    const y = (page || scrolls(style.overflowY)) && node.scrollHeight > node.clientHeight
    if (x || y) chain.push({ node, x, y })
  }
  for (let node = start; node && node !== document.body;) {
    node = getScrollParent(node, true)
    if (seen.has(node)) break
    add(node)
  }
  add(document.scrollingElement)
  // Inner scrolling can expose a range that an outer viewport still clips.
  // A second bounded pass handles a Table which started outside that viewport;
  // every move is calculated from the current Range, never a paragraph centre.
  for (let pass = 0; pass < 2; pass++) {
    let moved = false
    for (const { node, x, y } of chain) {
      // Leave a frozen column first. A row-spanning header may be very tall;
      // its vertical occlusion only applies while it still covers this line.
      for (const axis of ['x', 'y']) {
        if (axis === 'x' ? !x : !y) continue
        const match = fragment()
        if (!match) return false
        let box = visibleBox(node, window)
        if (node === table) box = clearTableBox(box, table, cell, match, window, axis)
        box = withoutPanel(box, panel?.isConnected ? panel.getBoundingClientRect() : null, match)
        if (!nonempty(box)) continue
        const distance = axis === 'x' ? delta(match.left, match.right, box.left + 2, box.right - 2) : delta(match.top, match.bottom, box.top + 2, box.bottom - 2)
        if (Math.abs(distance) <= 0.5) continue
        const beforeX = node.scrollLeft, beforeY = node.scrollTop
        // `auto` inherits CSS scroll-behavior and can leave the next measurement
        // at the old offset. Search navigation is one synchronous presentation step.
        node.scrollTo({ left: beforeX + (axis === 'x' ? distance : 0), top: beforeY + (axis === 'y' ? distance : 0), behavior: 'instant' })
        moved ||= beforeX !== node.scrollLeft || beforeY !== node.scrollTop
      }
    }
    if (!moved) break
  }
  return true
}
