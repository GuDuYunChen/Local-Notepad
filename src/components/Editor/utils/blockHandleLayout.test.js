import { expect, test } from 'vitest'
import { getBlockHandleLayout, getBlockMenuPosition } from './blockHandleLayout.mjs'

const fit = (box, bounds) => {
  expect(box.left).toBeGreaterThanOrEqual(bounds.left)
  expect(box.top).toBeGreaterThanOrEqual(bounds.top)
  expect(box.left + box.width).toBeLessThanOrEqual(bounds.right)
  expect(box.top + box.height).toBeLessThanOrEqual(bounds.bottom)
}

test.each([
  { viewport: { width: 704, height: 455 }, port: { left: 220, top: 120, width: 464, height: 300 }, block: { left: 242, top: 150, width: 400, height: 24 } },
  { viewport: { width: 1280, height: 800 }, port: { left: 240, top: 160, width: 1000, height: 600 }, block: { left: 316, top: 200, width: 800, height: 24 } },
  { viewport: { width: 1920, height: 1080 }, port: { left: 260, top: 170, width: 1640, height: 860 }, block: { left: 720, top: 205, width: 900, height: 24 } },
])('handle and menu stay inside a $viewport.width by $viewport.height visible editor', input => {
  const before = JSON.stringify(input)
  const layout = getBlockHandleLayout(input)
  const bounds = { left: input.port.left, top: input.port.top, right: input.port.left + input.port.width, bottom: input.port.top + input.port.height }
  fit({ left: input.port.left + layout.left, top: input.port.top + layout.top, width: 24, height: 24 }, bounds)
  const size = { width: 210, height: Math.min(320, input.port.height - 16) }
  const menu = getBlockMenuPosition(layout, size)
  fit({ left: input.port.left + menu.left, top: input.port.top + menu.top, ...size }, bounds)
  expect(JSON.stringify(input)).toBe(before)
})

test('scroll offsets are accounted for in absolute coordinates, including horizontal scrolling', () => {
  const input = { viewport: { width: 800, height: 600 }, port: { left: 100, top: 100, width: 600, height: 400 }, block: { left: 300, top: 250, width: 300, height: 24 } }
  const first = getBlockHandleLayout(input)
  const scrolled = getBlockHandleLayout({ ...input, block: { ...input.block, left: 275, top: 200 }, scrollTop: 50, scrollLeft: 25 })
  expect(scrolled.left).toBe(first.left)
  expect(scrolled.top).toBe(first.top)
  const menu = getBlockMenuPosition(scrolled, { width: 210, height: 100 })
  expect(input.port.left + menu.left - 25).toBe(scrolled.handle.left)
  expect(input.port.top + menu.top - 50).toBe(scrolled.handle.top + 30)
})

test('a menu flips above a low block and clamps when neither side can contain its complete height', () => {
  const input = { viewport: { width: 600, height: 600 }, port: { left: 0, top: 0, width: 500, height: 500 }, block: { left: 100, top: 450, width: 350, height: 24 } }
  const lower = getBlockHandleLayout(input)
  const above = getBlockMenuPosition(lower, { width: 210, height: 200 })
  expect(above.top + 200).toBeLessThan(lower.handle.top)
  const tight = getBlockHandleLayout({ ...input, port: { ...input.port, height: 240 }, block: { ...input.block, top: 120 } })
  const clamped = getBlockMenuPosition(tight, { width: 210, height: 200 })
  fit({ ...clamped, width: 210, height: 200 }, { left: 0, top: 0, right: 500, bottom: 240 })
})

test('partially offscreen containers use the intersection of the viewport and the actual scroll port', () => {
  const input = { viewport: { width: 220, height: 180 }, port: { left: -50, top: -40, width: 300, height: 250 }, block: { left: 0, top: 0, width: 200, height: 24 } }
  const layout = getBlockHandleLayout(input)
  fit({ left: input.port.left + layout.left, top: input.port.top + layout.top, width: 24, height: 24 }, { left: 0, top: 0, right: 220, bottom: 180 })
  expect(layout.menu.maxWidth).toBe(204)
  expect(layout.menu.maxHeight).toBe(164)
  const size = { width: 204, height: 164 }
  const menu = getBlockMenuPosition(layout, size)
  fit({ left: input.port.left + menu.left, top: input.port.top + menu.top, ...size }, { left: 0, top: 0, right: 220, bottom: 180 })
})

test('hidden, offscreen and invalid rectangles cannot leave detached floating controls', () => {
  const input = { viewport: { width: 800, height: 600 }, port: { left: 100, top: 100, width: 500, height: 400 }, block: { left: 200, top: 200, width: 300, height: 24 } }
  for (const block of [
    { ...input.block, top: -50 }, { ...input.block, top: 501 },
    { ...input.block, left: -400 }, { ...input.block, left: 601 },
    { ...input.block, width: 0 }, { ...input.block, height: -1 }, { ...input.block, top: NaN },
  ]) expect(getBlockHandleLayout({ ...input, block })).toBeNull()
  expect(getBlockHandleLayout({ ...input, port: { ...input.port, width: 0 } })).toBeNull()
  expect(getBlockHandleLayout({ ...input, port: { ...input.port, height: 20 } })).toBeNull()
})

test('invalid or oversized menu measurements are refused instead of silently reporting a fitting box', () => {
  const layout = getBlockHandleLayout({ viewport: { width: 400, height: 300 }, port: { left: 0, top: 0, width: 300, height: 240 }, block: { left: 60, top: 80, width: 200, height: 24 } })
  expect(getBlockMenuPosition(layout, { width: 0, height: 100 })).toBeNull()
  expect(getBlockMenuPosition(layout, { width: 210, height: NaN })).toBeNull()
  expect(getBlockMenuPosition(layout, { width: 285, height: 100 })).toBeNull()
  expect(getBlockMenuPosition(layout, { width: 210, height: 225 })).toBeNull()
})
