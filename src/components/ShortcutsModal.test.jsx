// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ShortcutsModal from './ShortcutsModal'
import useLocalShortcuts from '../hooks/useLocalShortcuts'
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_STORAGE_KEY,
  formatShortcut,
  getDefaultShortcutBindings,
  getShortcutSnapshot,
  matchShortcut,
  reloadShortcutPreferences,
  serializeShortcutPreferences,
} from '../services/localShortcuts'

describe('complete local shortcut settings workflow', () => {
  let container
  let root
  let opener
  let onClose
  let cleanupListeners

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    reloadShortcutPreferences()
    opener = document.createElement('button')
    opener.textContent = '原入口'
    document.body.append(opener)
    opener.focus()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    onClose = vi.fn(() => root.render(<ShortcutsModal open={false} onClose={onClose} />))
    cleanupListeners = []
  })

  afterEach(async () => {
    for (const cleanup of cleanupListeners) cleanup()
    await act(async () => root.unmount())
    container.remove()
    opener.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    reloadShortcutPreferences()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })

  const query = selector => container.querySelector(selector)
  const row = id => query(`[data-shortcut-command="${id}"]`)
  const binding = id => row(id)?.querySelector('kbd')?.textContent
  const button = text => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === text)
  const applyButton = () => query('[data-shortcut-apply]')
  const recorder = () => query('[data-shortcut-recorder]')
  const defaultBindings = () => getDefaultShortcutBindings()
  const focusKey = { key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true }

  async function mount(open = true) {
    await act(async () => root.render(<ShortcutsModal open={open} onClose={onClose} />))
  }

  async function click(node) {
    expect(node, 'requested control must exist').toBeTruthy()
    await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  }

  async function key(target, options) {
    const { altGraph = false, ...keys } = options
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...keys })
    const modifierState = event.getModifierState.bind(event)
    // happy-dom conflates Ctrl+Alt with AltGraph; keep the native modifier states distinct.
    Object.defineProperty(event, 'getModifierState', { value: name => name === 'AltGraph' ? altGraph : modifierState(name) })
    await act(async () => target.dispatchEvent(event))
    return event
  }

  async function type(value) {
    const input = query('[data-shortcut-search]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function record(id, options = focusKey, accept = true) {
    await click(query(`[data-shortcut-edit="${id}"]`))
    await key(recorder(), options)
    if (accept) await click(button('使用此快捷键'))
  }

  function savedBindings() {
    const raw = localStorage.getItem(SHORTCUT_STORAGE_KEY)
    return raw ? JSON.parse(raw).bindings : null
  }

  function seed(bindings) {
    const serialized = serializeShortcutPreferences(bindings)
    expect(serialized.ok).toBe(true)
    localStorage.setItem(SHORTCUT_STORAGE_KEY, serialized.raw)
    reloadShortcutPreferences()
  }

  async function externalUpdate(bindings, notify = true) {
    const serialized = serializeShortcutPreferences(bindings)
    expect(serialized.ok).toBe(true)
    await act(async () => {
      localStorage.setItem(SHORTCUT_STORAGE_KEY, serialized.raw)
      if (notify) window.dispatchEvent(new StorageEvent('storage', { key: SHORTCUT_STORAGE_KEY }))
    })
  }

  function recordingViewport({ panelTop = 560, height = 340 } = {}) {
    const scroll = query('.local-shortcuts-scroll')
    const metrics = { height }
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => metrics.height })
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => 1800 })
    scroll.scrollTop = 100
    const rect = (top, bottom) => ({ x: 100, y: top, top, bottom, left: 100, right: 900, width: 800, height: bottom - top, toJSON() {} })
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this === scroll) return rect(200, 200 + metrics.height)
      const panel = query('.local-shortcuts-recorder-panel')
      const top = panelTop - scroll.scrollTop
      const feedback = panel?.querySelector('[role="alert"]')
      if (this === panel) return rect(top, top + (feedback ? 268 : 228))
      if (this === recorder()) return rect(top + 30, top + 78)
      if (this === feedback) return rect(top + 115, top + 163)
      if (this.matches('[data-shortcut-edit="newNote"]')) return rect(920 - scroll.scrollTop, 956 - scroll.scrollTop)
      return originalRect.call(this)
    })
    return { scroll, metrics, panelRect: () => query('.local-shortcuts-recorder-panel').getBoundingClientRect() }
  }

  it('reveals the complete recording card above the footer when a lower list row opens', async () => {
    await mount()
    const view = recordingViewport()
    const write = vi.spyOn(localStorage, 'setItem')
    await click(query('[data-shortcut-edit="focusMode"]'))
    expect(view.panelRect().top).toBeGreaterThanOrEqual(208)
    expect(view.panelRect().bottom).toBeLessThanOrEqual(532)
    expect(document.activeElement).toBe(recorder())
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)
    expect(write).not.toHaveBeenCalled()
  })

  it.each([
    ['reserved save', { key: 's', code: 'KeyS', ctrlKey: true }, /保留|保存/],
    ['conflicting quick switch', { key: 'k', code: 'KeyK', ctrlKey: true }, /已用于/],
  ])('keeps the recording input, %s feedback and its actions inside the scroll viewport', async (_name, keys, message) => {
    await mount()
    const view = recordingViewport()
    await click(query('[data-shortcut-edit="focusMode"]'))
    // Begin with the old-height card fully visible, then grow it with real feedback.
    view.scroll.scrollTop = 256
    await key(recorder(), keys)
    expect(query('.local-shortcuts-recorder-panel [role="alert"]').textContent).toMatch(message)
    expect(view.panelRect().top).toBeGreaterThanOrEqual(208)
    expect(view.panelRect().bottom).toBeLessThanOrEqual(532)
    expect(document.activeElement).toBe(recorder())
    expect(savedBindings()).toBe(null)
  })

  it('keeps the open recording card visible after a viewport resize without taking button focus', async () => {
    const observers = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this) }
    })
    await mount()
    const view = recordingViewport()
    await click(query('[data-shortcut-edit="focusMode"]'))
    view.scroll.scrollTop = 256
    button('取消录入').focus()
    view.metrics.height = 280
    await act(async () => {
      for (const observer of observers) observer.callback([])
      window.dispatchEvent(new Event('resize'))
    })
    expect(view.panelRect().bottom).toBeLessThanOrEqual(472)
    expect(document.activeElement).toBe(button('取消录入'))
    expect(savedBindings()).toBe(null)
  })

  it('does not move an already visible recording card or scroll after recording closes', async () => {
    const observers = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this) }
    })
    await mount()
    const view = recordingViewport({ panelTop: 360 })
    await click(query('[data-shortcut-edit="focusMode"]'))
    expect(view.scroll.scrollTop).toBe(100)
    await click(button('取消录入'))
    view.scroll.scrollTop = 180
    query('[data-shortcut-search]').focus()
    await act(async () => {
      for (const observer of observers) observer.callback([])
      window.dispatchEvent(new Event('resize'))
    })
    expect(view.scroll.scrollTop).toBe(180)
    expect(document.activeElement).toBe(query('[data-shortcut-search]'))
    expect(savedBindings()).toBe(null)
    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalled()
  })

  it('keeps a different focused list control visible when an older recording card observes a resize', async () => {
    const observers = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this) }
    })
    await mount()
    const view = recordingViewport()
    await click(query('[data-shortcut-edit="focusMode"]'))
    const next = query('[data-shortcut-edit="newNote"]')
    next.focus()
    view.scroll.scrollTop = 500
    view.metrics.height = 280
    expect(next.getBoundingClientRect().bottom).toBeLessThanOrEqual(480)
    await act(async () => {
      for (const observer of observers) observer.callback([])
      window.dispatchEvent(new Event('resize'))
    })
    expect(view.scroll.scrollTop).toBe(500)
    expect(next.getBoundingClientRect().bottom).toBeLessThanOrEqual(480)
    expect(document.activeElement).toBe(next)
    expect(recorder()).toBeTruthy()
    expect(savedBindings()).toBe(null)
  })

  it('prioritizes the recording input and current refusal when a very short viewport cannot fit the whole card', async () => {
    await mount()
    const view = recordingViewport({ height: 180 })
    await click(query('[data-shortcut-edit="focusMode"]'))
    await key(recorder(), { key: 's', code: 'KeyS', ctrlKey: true })
    const feedback = query('.local-shortcuts-recorder-panel [role="alert"]').getBoundingClientRect()
    expect(recorder().getBoundingClientRect().top).toBeGreaterThanOrEqual(208)
    expect(feedback.bottom).toBeLessThanOrEqual(372)
    expect(document.activeElement).toBe(recorder())
    expect(savedBindings()).toBe(null)
  })

  it('opens all supported commands and fixed save help without writing preferences', async () => {
    const write = vi.spyOn(localStorage, 'setItem')
    await mount()
    expect(query('[role="dialog"][aria-modal="true"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-shortcut-command]').length).toBe(SHORTCUT_COMMANDS.length)
    expect(binding('focusMode')).toBe('F11')
    expect(container.textContent).toContain('保存笔记')
    expect(container.textContent).not.toContain('章节结构变化时先检查引用影响')
    expect(applyButton().disabled).toBe(true)
    expect(document.activeElement).toBe(query('[data-shortcut-search]'))
    expect(write).not.toHaveBeenCalled()
  })

  it('finds Chinese names and English keywords and combines them with categories', async () => {
    await mount()
    await type('formula')
    expect(container.querySelectorAll('[data-shortcut-command]').length).toBe(1)
    expect(row('formula')).toBeTruthy()
    await type('表格')
    expect(container.querySelectorAll('[data-shortcut-command]').length).toBe(2)
    const select = query('select[aria-label="操作分类"]')
    await act(async () => { select.value = '全局'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('没有匹配的操作')
    await click(query('[aria-label="清除搜索"]'))
    expect(container.querySelectorAll('[data-shortcut-command]').length).toBe(4)
    expect(query('[data-shortcut-search]').value).toBe('')
  })

  it('finds shortcut combinations with compact or spaced plus signs', async () => {
    await mount()
    for (const value of ['Ctrl+K', 'Ctrl + K', 'ctrl +k']) {
      await type(value)
      expect(container.querySelectorAll('[data-shortcut-command]').length).toBe(1)
      expect(row('quickSwitch')).toBeTruthy()
    }
    for (const value of ['Ctrl+Shift+K', 'Ctrl +Shift+ K']) {
      await type(value)
      expect(container.querySelectorAll('[data-shortcut-command]').length).toBe(1)
      expect(row('globalSearch')).toBeTruthy()
    }
  })

  it('does not filter half-finished Chinese input or close for an IME Escape', async () => {
    await mount()
    const input = query('[data-shortcut-search]')
    await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await type('专注')
    expect(container.querySelectorAll('[data-shortcut-command]').length).toBe(SHORTCUT_COMMANDS.length)
    await key(input, { key: 'Escape', isComposing: true, keyCode: 229 })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '专注' })))
    expect(container.querySelectorAll('[data-shortcut-command]').length).toBe(1)
    expect(row('focusMode')).toBeTruthy()
  })

  it('requires acceptance of the recorded combination and application before it becomes active', async () => {
    await mount()
    await record('focusMode', focusKey, false)
    expect(recorder().value).toBe(formatShortcut('Mod+Alt+J'))
    expect(binding('focusMode')).toBe('F11')
    expect(getShortcutSnapshot().bindings.focusMode).toBe('F11')
    expect(savedBindings()).toBeNull()
    await click(button('使用此快捷键'))
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    expect(row('focusMode').textContent).toContain('待应用')
    expect(row('focusMode').textContent).toContain('当前生效：F11')
    expect(getShortcutSnapshot().bindings.focusMode).toBe('F11')
    expect(savedBindings()).toBeNull()
    await click(applyButton())
    expect(getShortcutSnapshot().bindings.focusMode).toBe('Mod+Alt+J')
    expect(savedBindings().focusMode).toBe('Mod+Alt+J')
    expect(matchShortcut(focusKey, 'focusMode')).toBe(true)
    expect(matchShortcut({ key: 'F11' }, 'focusMode')).toBe(false)
    expect(container.textContent).toContain('已应用并保存到本机')
  })

  it('restores saved bindings when the settings dialog is reopened', async () => {
    await mount()
    await record('focusMode')
    await click(applyButton())
    await click(button('完成'))
    expect(query('[data-shortcut-settings]')).toBeNull()
    reloadShortcutPreferences()
    await mount()
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    expect(applyButton().disabled).toBe(true)
  })

  it('reports a conflict and leaves both bindings unchanged when recording is cancelled', async () => {
    await mount()
    await record('focusMode', { key: 'k', ctrlKey: true }, false)
    expect(container.textContent).toContain('已用于“快速切换笔记”')
    expect(button('替换冲突快捷键')).toBeTruthy()
    expect(getShortcutSnapshot().bindings).toEqual(defaultBindings())
    await click(button('取消录入'))
    expect(binding('focusMode')).toBe('F11')
    expect(binding('quickSwitch')).toBe(formatShortcut('Mod+K'))
    expect(savedBindings()).toBeNull()
  })

  it('only replaces a conflicting assignment after an explicit choice and one apply', async () => {
    await mount()
    await record('focusMode', { key: 'k', ctrlKey: true }, false)
    await click(button('替换冲突快捷键'))
    expect(binding('quickSwitch')).toBe('未设置')
    expect(binding('focusMode')).toBe(formatShortcut('Mod+K'))
    expect(getShortcutSnapshot().bindings).toEqual(defaultBindings())
    await click(applyButton())
    expect(savedBindings().quickSwitch).toBeNull()
    expect(savedBindings().focusMode).toBe('Mod+K')
    expect(matchShortcut({ key: 'k', ctrlKey: true }, 'quickSwitch')).toBe(false)
    expect(matchShortcut({ key: 'k', ctrlKey: true }, 'focusMode')).toBe(true)
  })

  it('refuses reserved save and plain typing combinations without creating a candidate', async () => {
    await mount()
    await record('focusMode', { key: 's', ctrlKey: true }, false)
    expect(container.textContent).toContain('保存笔记')
    expect(button('使用此快捷键').disabled).toBe(true)
    await key(recorder(), { key: 'j' })
    expect(container.textContent).toContain('避免影响正常输入')
    expect(button('使用此快捷键').disabled).toBe(true)
    expect(savedBindings()).toBeNull()
  })

  it('does not let the shortcut recorder send save or new-note keys to global listeners', async () => {
    await mount()
    const callback = vi.fn()
    document.addEventListener('keydown', callback)
    window.addEventListener('keydown', callback)
    cleanupListeners.push(() => { document.removeEventListener('keydown', callback); window.removeEventListener('keydown', callback) })
    await record('focusMode', { key: 's', ctrlKey: true }, false)
    await key(recorder(), { key: 'n', ctrlKey: true })
    expect(callback).not.toHaveBeenCalled()
    expect(savedBindings()).toBeNull()
  })

  it('ignores IME and repeat recording and lets Escape cancel only the recorder first', async () => {
    await mount()
    await click(query('[data-shortcut-edit="focusMode"]'))
    await key(recorder(), { ...focusKey, isComposing: true, keyCode: 229 })
    await key(recorder(), { ...focusKey, repeat: true })
    await key(recorder(), { ...focusKey, altGraph: true })
    expect(recorder().value).toBe('请按下组合键')
    await key(recorder(), { key: 'Escape', isComposing: true, keyCode: 229 })
    expect(recorder()).toBeTruthy()
    await key(recorder(), { key: 'Escape', repeat: true })
    expect(recorder()).toBeTruthy()
    await key(recorder(), { key: 'Escape' })
    expect(recorder()).toBeNull()
    expect(query('[data-shortcut-settings]')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    await key(query('[data-shortcut-edit="focusMode"]'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes directly when the only change is an unaccepted recorded candidate', async () => {
    await mount()
    await record('focusMode', focusKey, false)
    await click(query('[aria-label="关闭快捷键设置"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getShortcutSnapshot().bindings).toEqual(defaultBindings())
    expect(savedBindings()).toBeNull()
  })

  it('keeps staged edits when closing is cancelled and discards them only after confirmation', async () => {
    await mount()
    await record('focusMode')
    await click(query('[aria-label="关闭快捷键设置"]'))
    expect(container.textContent).toContain('还有未应用的修改')
    expect(onClose).not.toHaveBeenCalled()
    await click(button('继续编辑'))
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    await click(button('取消'))
    await click(button('放弃修改并关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getShortcutSnapshot().bindings).toEqual(defaultBindings())
    expect(savedBindings()).toBeNull()
    await mount()
    expect(binding('focusMode')).toBe('F11')
  })

  it('applies the same unsaved-change decision to an overlay click', async () => {
    await mount()
    await record('focusMode')
    await act(async () => query('[role="presentation"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(button('放弃修改并关闭')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('can clear a binding and restore that command to its default', async () => {
    await mount()
    await click(row('focusMode').querySelector('[aria-label="清除切换专注模式快捷键"]'))
    expect(binding('focusMode')).toBe('未设置')
    await click(applyButton())
    expect(savedBindings().focusMode).toBeNull()
    expect(matchShortcut({ key: 'F11' }, 'focusMode')).toBe(false)
    await record('focusMode', focusKey, false)
    await click(query('[data-shortcut-reset="focusMode"]'))
    expect(recorder()).toBeNull()
    expect(binding('focusMode')).toBe('F11')
    expect(getShortcutSnapshot().bindings.focusMode).toBeNull()
    await click(applyButton())
    expect(matchShortcut({ key: 'F11' }, 'focusMode')).toBe(true)
  })

  it('shows the conflict when a single default has been assigned to a different command', async () => {
    seed({ ...defaultBindings(), focusMode: 'Mod+Alt+J', quickSwitch: 'F11' })
    await mount()
    await click(query('[data-shortcut-reset="focusMode"]'))
    expect(container.textContent).toContain('已用于“快速切换笔记”')
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    await click(button('替换冲突快捷键'))
    expect(binding('focusMode')).toBe('F11')
    expect(binding('quickSwitch')).toBe('未设置')
    expect(savedBindings().quickSwitch).toBe('F11')
  })

  it('restores all defaults as a draft and leaves persisted customization until applied', async () => {
    seed({ ...defaultBindings(), focusMode: 'Mod+Alt+J', quickSwitch: null })
    await mount()
    await click(button('全部恢复默认'))
    expect(binding('focusMode')).toBe('F11')
    expect(savedBindings().focusMode).toBe('Mod+Alt+J')
    await click(applyButton())
    expect(savedBindings()).toEqual(defaultBindings())
    expect(getShortcutSnapshot().bindings).toEqual(defaultBindings())
  })

  it('does not offer an unnecessary apply when all active shortcuts are already default', async () => {
    await mount()
    const write = vi.spyOn(localStorage, 'setItem')
    await click(button('全部恢复默认'))
    expect(container.textContent).toContain('当前已使用默认快捷键')
    expect(applyButton().disabled).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })

  it('recovers a malformed configuration only after an explicit restore and apply', async () => {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, 'PRIVATE_INVALID_<script>bad()</script>')
    reloadShortcutPreferences()
    await mount()
    expect(container.textContent).toContain('配置无法识别')
    expect(container.textContent).not.toContain('PRIVATE_INVALID')
    expect(binding('focusMode')).toBe('F11')
    await record('focusMode')
    expect(applyButton().disabled).toBe(true)
    expect(localStorage.getItem(SHORTCUT_STORAGE_KEY)).toContain('PRIVATE_INVALID')
    await click(button('恢复默认配置'))
    expect(applyButton().disabled).toBe(false)
    await click(applyButton())
    expect(savedBindings()).toEqual(defaultBindings())
    expect(getShortcutSnapshot().status).toBe('ready')
  })

  it('retains the draft and active map after a storage quota failure and can retry', async () => {
    await mount()
    await record('focusMode')
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('PRIVATE_QUOTA') })
    await click(applyButton())
    expect(getShortcutSnapshot().bindings.focusMode).toBe('F11')
    expect(getShortcutSnapshot().status).toBe('unconfirmed')
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    expect(container.textContent).toContain('无法确认快捷键已保存')
    expect(container.textContent).not.toContain('PRIVATE_QUOTA')
    expect(container.textContent).not.toContain('已应用并保存到本机')
    write.mockRestore()
    await click(applyButton())
    expect(savedBindings().focusMode).toBe('Mod+Alt+J')
    expect(getShortcutSnapshot().status).toBe('ready')
  })

  it('does not claim activation after readback failure and verifies the existing bytes on retry', async () => {
    await mount()
    await record('focusMode')
    const originalSet = localStorage.setItem.bind(localStorage)
    const originalGet = localStorage.getItem.bind(localStorage)
    let failRead = false
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => { originalSet(key, value); failRead = true })
    vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
      if (failRead) { failRead = false; throw Error('PRIVATE_READBACK') }
      return originalGet(key)
    })
    await click(applyButton())
    expect(JSON.parse(originalGet(SHORTCUT_STORAGE_KEY)).bindings.focusMode).toBe('Mod+Alt+J')
    expect(getShortcutSnapshot().bindings.focusMode).toBe('F11')
    expect(container.textContent).toContain('无法确认写入结果')
    expect(container.textContent).not.toContain('已应用并保存到本机')
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    await click(applyButton())
    expect(write).toHaveBeenCalledTimes(1)
    expect(getShortcutSnapshot().bindings.focusMode).toBe('Mod+Alt+J')
    expect(container.textContent).toContain('已应用并保存到本机')
  })

  it('can explicitly restore defaults after an uncertain write without activating its old candidate first', async () => {
    await mount()
    await record('focusMode')
    const originalSet = localStorage.setItem.bind(localStorage)
    const originalGet = localStorage.getItem.bind(localStorage)
    let failRead = false
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      originalSet(key, value)
      failRead = true
    })
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
      if (failRead) { failRead = false; throw Error('PRIVATE_READBACK') }
      return originalGet(key)
    })
    await click(applyButton())
    expect(getShortcutSnapshot().status).toBe('unconfirmed')
    expect(JSON.parse(originalGet(SHORTCUT_STORAGE_KEY)).bindings.focusMode).toBe('Mod+Alt+J')
    write.mockRestore()
    read.mockRestore()
    const resetWrite = vi.spyOn(localStorage, 'setItem')
    await click(button('全部恢复默认'))
    expect(binding('focusMode')).toBe('F11')
    expect(getShortcutSnapshot().bindings.focusMode).toBe('F11')
    expect(savedBindings().focusMode).toBe('Mod+Alt+J')
    expect(resetWrite).not.toHaveBeenCalled()
    expect(applyButton().disabled).toBe(false)
    await click(applyButton())
    expect(savedBindings()).toEqual(defaultBindings())
    expect(getShortcutSnapshot().status).toBe('ready')
    expect(getShortcutSnapshot().bindings.focusMode).toBe('F11')
    expect(container.textContent).toContain('已应用并保存到本机')
    expect(resetWrite).toHaveBeenCalledTimes(1)
    expect(applyButton().disabled).toBe(true)
  })

  it('reports unavailable reading and can recover without touching a draft first', async () => {
    const storage = localStorage
    vi.stubGlobal('localStorage', { getItem() { throw Error('PRIVATE_READ') }, setItem() {} })
    reloadShortcutPreferences()
    await mount()
    expect(container.textContent).toContain('无法读取本机快捷键设置')
    expect(container.textContent).not.toContain('PRIVATE_READ')
    await record('focusMode')
    await click(button('重新读取'))
    await click(button('放弃修改并重新读取'))
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    vi.stubGlobal('localStorage', storage)
    await click(button('重新读取'))
    await click(button('放弃修改并重新读取'))
    expect(binding('focusMode')).toBe('F11')
    expect(getShortcutSnapshot().status).toBe('ready')
  })

  it('updates an untouched dialog when another window changes the settings', async () => {
    await mount()
    await externalUpdate({ ...defaultBindings(), focusMode: 'Mod+Alt+J' })
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    expect(applyButton().disabled).toBe(true)
    expect(container.textContent).toContain('本机最新设置')
  })

  it('keeps dirty edits when an external map arrives and asks before loading it', async () => {
    await mount()
    await record('focusMode')
    await externalUpdate({ ...defaultBindings(), focusMode: 'Mod+Alt+G' })
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    expect(applyButton().disabled).toBe(true)
    expect(container.textContent).toContain('其他窗口已更改快捷键')
    await click(button('重新读取最新设置'))
    await click(button('继续编辑'))
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    await click(button('重新读取最新设置'))
    await click(button('放弃修改并重新读取'))
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+G'))
    expect(savedBindings().focusMode).toBe('Mod+Alt+G')
    expect(applyButton().disabled).toBe(true)
  })

  it('rejects a stale apply even before an external storage event has been delivered', async () => {
    await mount()
    await record('focusMode')
    await externalUpdate({ ...defaultBindings(), focusMode: 'Mod+Alt+G' }, false)
    await click(applyButton())
    expect(savedBindings().focusMode).toBe('Mod+Alt+G')
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    expect(container.textContent).toContain('更改')
    expect(container.textContent).not.toContain('已应用并保存到本机')
  })

  it('does not overwrite an external map when apply runs before the passive external-change notice', async () => {
    let armed = false
    let attempts = 0
    function BoundaryHarness() {
      const snapshot = useLocalShortcuts()
      const previousRevision = React.useRef(snapshot.revision)
      React.useLayoutEffect(() => {
        if (snapshot.revision === previousRevision.current) return
        previousRevision.current = snapshot.revision
        if (!armed) return
        armed = false
        const control = container.querySelector('[data-shortcut-apply]')
        expect(control.disabled).toBe(false)
        attempts++
        control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }, [snapshot.revision])
      return <ShortcutsModal open onClose={onClose} />
    }
    await act(async () => root.render(<BoundaryHarness />))
    await record('focusMode')
    armed = true
    await externalUpdate({ ...defaultBindings(), focusMode: 'Mod+Alt+G' })
    expect(attempts).toBe(1)
    expect(savedBindings().focusMode).toBe('Mod+Alt+G')
    expect(binding('focusMode')).toBe(formatShortcut('Mod+Alt+J'))
    expect(container.textContent).not.toContain('已应用并保存到本机')
  })

  it('allows explicit default recovery after an external malformed configuration', async () => {
    await mount()
    await record('focusMode')
    await act(async () => {
      localStorage.setItem(SHORTCUT_STORAGE_KEY, '{bad')
      window.dispatchEvent(new StorageEvent('storage', { key: SHORTCUT_STORAGE_KEY }))
    })
    await click(button('恢复默认配置'))
    expect(applyButton().disabled).toBe(false)
    await click(applyButton())
    expect(savedBindings()).toEqual(defaultBindings())
  })

  it('keeps keyboard focus inside the dialog and returns to a connected opener', async () => {
    await mount()
    const first = query('[aria-label="关闭快捷键设置"]')
    const lastEnabled = button('完成')
    first.focus()
    await key(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(lastEnabled)
    await key(lastEnabled, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    await click(first)
    expect(document.activeElement).toBe(opener)
  })

  it('does not restore focus to a removed opener or steal focus from a new surface', async () => {
    await mount()
    opener.remove()
    const removedFocus = vi.spyOn(opener, 'focus')
    const next = document.createElement('input')
    document.body.append(next)
    try {
      next.focus()
      await mount(false)
      expect(removedFocus).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(next)
    } finally { next.remove() }
  })

  it('does not leave a hidden recorder active after searching for another command', async () => {
    await mount()
    await record('focusMode', focusKey, false)
    await type('formula')
    expect(recorder()).toBeNull()
    expect(row('formula')).toBeTruthy()
    await click(query('[aria-label="关闭快捷键设置"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(savedBindings()).toBeNull()
  })
})
