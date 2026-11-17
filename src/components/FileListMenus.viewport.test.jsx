import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FileContextMenu, fitFileContextMenuToViewport } from './FileListMenus'

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

it('moves a real-height file menu above the Windows 704x455 lower edge without losing its actions', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
  const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 704 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 455 })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.classList?.contains('file-context-menu')
      ? { x: 100, y: 335, left: 100, top: 335, right: 318, bottom: 472, width: 218, height: 137 }
      : { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  })
  const parent = document.createElement('div')
  document.body.append(parent)
  const root = createRoot(parent)
  const menuRef = { current: null }
  const handlers = Object.fromEntries(
    ['onCreateNote', 'onCreateFolder', 'onTogglePin', 'onRename', 'onSaveAs', 'onDelete'].map(key => [key, vi.fn()])
  )
  const item = { id: 'real-note', title: '已有笔记.md', is_folder: false, is_pinned: false }
  try {
    await act(async () => {
      root.render(<FileContextMenu contextMenu={{ x: 100, y: 335, item }} menuRef={menuRef} {...handlers} />)
    })
    const menu = parent.querySelector('.file-context-menu')
    expect(menuRef.current).toBe(menu)
    expect(menu.style.position).toBe('fixed')
    expect(Number.parseFloat(menu.style.top)).toBe(310)
    expect(Number.parseFloat(menu.style.left)).toBe(100)
    expect(menu.style.overflowY).toBe('auto')
    expect([...menu.querySelectorAll('[role="menuitem"]')].map(node => node.textContent)).toEqual([
      expect.stringContaining('置顶'),
      expect.stringContaining('重命名'),
      expect.stringContaining('另存为'),
      expect.stringContaining('移到回收站'),
    ])
    await act(async () => menu.querySelectorAll('[role="menuitem"]')[3].click())
    expect(handlers.onDelete).toHaveBeenCalledWith(item)
    for (const key of ['onCreateNote', 'onCreateFolder', 'onTogglePin', 'onRename', 'onSaveAs']) {
      expect(handlers[key]).not.toHaveBeenCalled()
    }
  } finally {
    await act(async () => root.unmount())
    parent.remove()
    if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth)
    if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight)
  }
})

it.each([
  [{ x: 100, y: 335, width: 218, height: 137, viewportWidth: 704, viewportHeight: 455 }, { left: 100, top: 310 }],
  [{ x: 700, y: 450, width: 218, height: 137, viewportWidth: 704, viewportHeight: 455 }, { left: 478, top: 310 }],
  [{ x: 0, y: 0, width: 218, height: 137, viewportWidth: 704, viewportHeight: 455 }, { left: 8, top: 8 }],
  [{ x: 400, y: 400, width: 218, height: 200, viewportWidth: 704, viewportHeight: 455 }, { left: 400, top: 247 }],
  [{ x: 400, y: 400, width: 218, height: 600, viewportWidth: 704, viewportHeight: 455 }, { left: 400, top: 8 }],
])('keeps context menu placement inside the actual viewport with unchanged menu height: %j', (input, expected) => {
  expect(fitFileContextMenuToViewport(input)).toEqual(expected)
})
