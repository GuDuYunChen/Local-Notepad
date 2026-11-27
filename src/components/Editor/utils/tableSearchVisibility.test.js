// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { revealTableSearchRange } from './tableSearchVisibility'

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })
let host
afterEach(() => { host?.remove(); vi.restoreAllMocks() })

// jsdom has no layout. These rectangles model scroll, clipping and sticky
// ownership explicitly; they are not a substitute for the Windows UI gate.
function fixture({ row = 79, column = 2, outerTop = 40, panel = false } = {}) {
  host = document.createElement('div')
  const outer = document.createElement('div'), root = document.createElement('div'), table = document.createElement('table')
  root.setAttribute('contenteditable', 'true')
  outer.style.overflowX = outer.style.overflowY = 'auto'
  table.style.overflowX = table.style.overflowY = 'auto'
  table.dataset.lexicalFrozenRow = table.dataset.lexicalFrozenColumn = 'true'
  outer.append(root); root.append(table); host.append(outer); document.body.append(host)
  const dimensions = (node, width, height, scrollWidth, scrollHeight) => Object.defineProperties(node, {
    clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height },
    scrollWidth: { configurable: true, value: scrollWidth }, scrollHeight: { configurable: true, value: scrollHeight },
  })
  dimensions(outer, 700, 500, 1000, 3000); dimensions(table, 600, 300, 800, 23800)
  outer.getBoundingClientRect = () => rect(20, 30, 700, 500)
  table.getBoundingClientRect = () => rect(40 - outer.scrollLeft, outerTop - outer.scrollTop, 600, 300)
  const calls = []
  for (const node of [outer, table]) node.scrollTo = options => {
    calls.push({ node, ...options })
    node.scrollLeft = Math.max(0, Math.min(node.scrollWidth - node.clientWidth, options.left))
    node.scrollTop = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, options.top))
  }
  table.scrollIntoView = () => {
    const box = table.getBoundingClientRect(), clip = outer.getBoundingClientRect()
    if (box.top > clip.bottom) outer.scrollTop += box.bottom - clip.bottom
    else if (box.bottom < clip.top) outer.scrollTop += box.top - clip.top
  }
  for (let r = 0; r < 80; r++) {
    const tr = table.insertRow()
    for (let c = 0; c < 3; c++) {
      const td = tr.insertCell(), p = document.createElement('p')
      td.dataset.tableColumn = String(c)
      if (r === 0 || c === 0) td.style.position = 'sticky'
      p.textContent = 'needle'; td.append(p)
      td.getBoundingClientRect = () => {
        const box = table.getBoundingClientRect()
        const x = [0, 240, 560][c] - (c === 0 ? 0 : table.scrollLeft)
        const y = r === 0 ? 0 : 56 + (r - 1) * 300 - table.scrollTop
        return rect(box.left + x, box.top + y, [240, 320, 240][c], r === 0 ? 56 : 300)
      }
    }
  }
  const cell = table.rows[row].cells[column], text = cell.firstChild.firstChild
  const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 6)
  const line = () => { const box = cell.getBoundingClientRect(); return rect(box.left + 12, box.top + 8, 80, 20) }
  range.getClientRects = () => [line()]
  // A match may span lines; the union rectangle must not become the scroll target.
  range.getBoundingClientRect = () => { throw new Error('Use the actual first line fragment') }
  const field = document.createElement('input'); host.append(field); field.focus()
  let overlay
  if (panel) { overlay = document.createElement('section'); host.append(overlay); overlay.getBoundingClientRect = () => rect(280, 20, 500, 220) }
  return { outer, root, table, cell, range, line, field, calls, panel: overlay }
}
function reveal(f) { return revealTableSearchRange(f) }
function expectWithin(line, box) {
  expect(line.left).toBeGreaterThanOrEqual(box.left)
  expect(line.right).toBeLessThanOrEqual(box.right)
  expect(line.top).toBeGreaterThanOrEqual(box.top)
  expect(line.bottom).toBeLessThanOrEqual(box.bottom)
}

test('reveals the distant exact line on both axes beyond the frozen row and column', () => {
  const f = fixture(), original = f.root.innerHTML
  expect(reveal(f)).toBe(true)
  const box = f.table.getBoundingClientRect()
  expectWithin(f.line(), { left: box.left + 240, right: box.right, top: box.top + 56, bottom: box.bottom })
  expect(f.table.scrollTop).toBeGreaterThan(20000)
  expect(f.table.scrollLeft).toBeGreaterThan(0)
  expect(f.calls.every(call => call.behavior === 'instant')).toBe(true)
  expect(document.activeElement).toBe(f.field)
  expect(f.root.innerHTML).toBe(original)
})

test('an already visible match does not move the viewport again', () => {
  const f = fixture(); reveal(f); f.calls.length = 0
  expect(reveal(f)).toBe(true)
  expect(f.calls).toEqual([])
})

test('a panel covering the top right does not cover the revealed match', () => {
  const f = fixture({ panel: true }); reveal(f)
  const line = f.line(), panel = f.panel.getBoundingClientRect()
  expect(line.right <= panel.left || line.left >= panel.right || line.bottom <= panel.top || line.top >= panel.bottom).toBe(true)
  expectWithin(line, f.table.getBoundingClientRect())
  expect(document.activeElement).toBe(f.field)
})

test('a Table initially below the outer viewport scrolls both levels into view', () => {
  const f = fixture({ outerTop: 1500 }); reveal(f)
  expect(f.outer.scrollTop).toBeGreaterThan(0)
  expect(f.table.scrollTop).toBeGreaterThan(20000)
  expectWithin(f.line(), f.outer.getBoundingClientRect())
  expectWithin(f.line(), f.table.getBoundingClientRect())
})

test('a first-row match is not treated as occluded by its own frozen row', () => {
  const f = fixture({ row: 0, column: 2 }); reveal(f)
  expect(f.table.scrollTop).toBe(0)
  expectWithin(f.line(), f.table.getBoundingClientRect())
})

test('a first-column match is not treated as occluded by its own frozen column', () => {
  const f = fixture({ row: 79, column: 0 }); reveal(f)
  expect(f.table.scrollLeft).toBe(0)
  expectWithin(f.line(), f.table.getBoundingClientRect())
})

test('a spanning frozen column uses its actual rectangle at the target row', () => {
  const f = fixture({ row: 2, column: 1 }), spanning = f.table.rows[1].cells[0]
  spanning.rowSpan = 2; f.table.rows[2].deleteCell(0)
  spanning.getBoundingClientRect = () => {
    const box = f.table.getBoundingClientRect()
    return rect(box.left, box.top + 56 - f.table.scrollTop, 360, 600)
  }
  f.cell.getBoundingClientRect = () => {
    const box = f.table.getBoundingClientRect()
    return rect(box.left + 360 - f.table.scrollLeft, box.top + 356 - f.table.scrollTop, 320, 300)
  }
  f.table.scrollLeft = 180
  reveal(f)
  expect(f.line().left).toBeGreaterThanOrEqual(spanning.getBoundingClientRect().right)
  expectWithin(f.line(), f.table.getBoundingClientRect())
})

test('a tall frozen row-span in another column does not hide an unobscured match', () => {
  const f = fixture(), spanning = f.table.rows[0].cells[0]
  spanning.rowSpan = 80
  for (const row of [...f.table.rows].slice(1)) row.deleteCell(0)
  spanning.getBoundingClientRect = () => {
    const box = f.table.getBoundingClientRect()
    return rect(box.left, box.top, 240, 23800)
  }
  reveal(f)
  const box = f.table.getBoundingClientRect()
  expectWithin(f.line(), { left: box.left + 240, right: box.right, top: box.top + 56, bottom: box.bottom })
  expect(f.line().left).toBeGreaterThanOrEqual(spanning.getBoundingClientRect().right)
})

test('a match initially behind a tall frozen row-span scrolls horizontally before resolving vertical occlusion', () => {
  const f = fixture({ column: 1 }), spanning = f.table.rows[0].cells[0]
  spanning.rowSpan = 80
  for (const row of [...f.table.rows].slice(1)) row.deleteCell(0)
  spanning.getBoundingClientRect = () => {
    const box = f.table.getBoundingClientRect()
    return rect(box.left, box.top, 240, 23800)
  }
  f.table.scrollLeft = 200
  expect(f.line().left).toBeLessThan(spanning.getBoundingClientRect().right)
  reveal(f)
  expect(f.line().left).toBeGreaterThanOrEqual(spanning.getBoundingClientRect().right)
  expectWithin(f.line(), f.table.getBoundingClientRect())
})

test('an empty leading client rect and a multi-line union cannot misplace the first visible line', () => {
  const f = fixture()
  f.range.getClientRects = () => [rect(0, 0, 0, 0), f.line(), rect(f.line().left, f.line().top + 1000, 150, 20)]
  reveal(f)
  expectWithin(f.line(), f.table.getBoundingClientRect())
})

for (const invalid of ['disconnected', 'another cell', 'another editor', 'empty geometry']) test(`${invalid} refuses scrolling without changing focus`, () => {
  const f = fixture()
  if (invalid === 'disconnected') f.table.remove()
  if (invalid === 'another cell') f.range.setStart(f.table.rows[79].cells[1].firstChild.firstChild, 1)
  if (invalid === 'another editor') f.root = document.createElement('div')
  if (invalid === 'empty geometry') f.range.getClientRects = () => [rect(0, 0, 0, 0)]
  expect(reveal(f)).toBe(false)
  expect(f.calls).toEqual([])
  expect(document.activeElement).toBe(f.field)
})
