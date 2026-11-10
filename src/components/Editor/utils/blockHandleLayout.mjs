const HANDLE_SIZE = 24
const HANDLE_MARGIN = 4
const MENU_MARGIN = 8
const MENU_GAP = 6

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const finite = (...values) => values.every(Number.isFinite)

// All input rectangles use viewport coordinates. Returned top/left values use
// the scroll container's absolute-positioning coordinates, including its scroll.
export function getBlockHandleLayout({ block, port, viewport, scrollTop = 0, scrollLeft = 0 }) {
  if (!block || !port || !viewport || !finite(block.left, block.top, block.width, block.height,
    port.left, port.top, port.width, port.height, viewport.width, viewport.height, scrollTop, scrollLeft)
    || block.width <= 0 || block.height <= 0 || port.width <= 0 || port.height <= 0) return null

  const bounds = {
    left: Math.max(0, port.left), top: Math.max(0, port.top),
    right: Math.min(viewport.width, port.left + port.width),
    bottom: Math.min(viewport.height, port.top + port.height),
  }
  if (bounds.right - bounds.left < HANDLE_SIZE + HANDLE_MARGIN * 2
    || bounds.bottom - bounds.top < HANDLE_SIZE + HANDLE_MARGIN * 2
    || block.left + block.width <= bounds.left || block.left >= bounds.right
    || block.top + block.height <= bounds.top || block.top >= bounds.bottom) return null

  const handle = {
    left: clamp(block.left - HANDLE_SIZE - 8, bounds.left + HANDLE_MARGIN, bounds.right - HANDLE_SIZE - HANDLE_MARGIN),
    top: clamp(block.top, bounds.top + HANDLE_MARGIN, bounds.bottom - HANDLE_SIZE - HANDLE_MARGIN),
  }
  const origin = { left: port.left - scrollLeft, top: port.top - scrollTop }
  const maxWidth = Math.floor(bounds.right - bounds.left - MENU_MARGIN * 2)
  const maxHeight = Math.floor(Math.min(320, bounds.bottom - bounds.top - MENU_MARGIN * 2))
  return {
    top: handle.top - origin.top, left: handle.left - origin.left,
    handle, bounds, origin,
    menu: { minWidth: Math.min(210, maxWidth), maxWidth, maxHeight },
  }
}

export function getBlockMenuPosition(layout, size) {
  if (!layout || !size || !finite(size.width, size.height) || size.width <= 0 || size.height <= 0
    || size.width > layout.menu.maxWidth || size.height > layout.menu.maxHeight) return null
  const { handle, bounds, origin } = layout
  const left = clamp(handle.left, bounds.left + MENU_MARGIN, bounds.right - size.width - MENU_MARGIN)
  let top = handle.top + HANDLE_SIZE + MENU_GAP
  if (top + size.height > bounds.bottom - MENU_MARGIN) top = handle.top - size.height - MENU_GAP
  top = clamp(top, bounds.top + MENU_MARGIN, bounds.bottom - size.height - MENU_MARGIN)
  return { left: left - origin.left, top: top - origin.top }
}
