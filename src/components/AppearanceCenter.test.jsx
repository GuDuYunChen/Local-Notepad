import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppearanceCenter from './AppearanceCenter'
import {
  APPEARANCE_KEY, BUILTIN_SCHEMES, defaultAppearance, exportScheme,
  installAppearanceRuntime, readAppearance, saveAppearance,
} from '../services/localAppearance'
import { THEME_STORAGE_KEY } from '../services/themePreference'

let host, root, dispose, onClose, opener
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const panel = () => document.querySelector('[aria-label="本地主题方案中心"]')
const button = label => [...panel().querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)
const click = async label => { const node = button(label); expect(node, label).toBeTruthy(); await act(async () => { node.click(); await drain() }) }
const choose = async label => {
  const node = [...panel().querySelectorAll('[aria-pressed]')].find(item => item.textContent.includes(label))
  expect(node).toBeTruthy(); await act(async () => node.click())
}
const input = async (label, value) => act(async () => {
  const node = panel().querySelector(`[aria-label="${label}"]`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
  node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); await drain()
})
const upload = async file => act(async () => {
  const node = panel().querySelector('input[type="file"]')
  Object.defineProperty(node, 'files', { configurable: true, value: [file] })
  node.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 20)); await drain()
})
const mount = async () => act(async () => { root.render(<AppearanceCenter onClose={onClose} />); await drain() })
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear(); document.documentElement.removeAttribute('style'); document.documentElement.setAttribute('data-theme', 'light')
  dispose = installAppearanceRuntime()
  opener = document.createElement('button'); opener.textContent = 'open'; document.body.append(opener); opener.focus()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); onClose = vi.fn()
  await mount()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); opener.remove(); dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('complete local appearance workflow', () => {
  it('opens without writing storage or changing the theme', () => {
    expect(panel()).toBeTruthy(); expect(localStorage.length).toBe(0)
    expect(button('应用并保存').disabled).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
  it('selects, previews, applies and reloads a stored palette', async () => {
    await choose('松林绿'); await click('预览当前方案')
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#176b4a')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
    await click('应用并保存')
    expect(readAppearance().value.activeId).toBe('forest')
    expect(panel().textContent).toContain('读回确认')
    await act(async () => root.render(null)); await mount()
    expect(panel().querySelector('[aria-pressed="true"]').textContent).toContain('松林绿')
  })
  it('cancels preview without discarding the edited candidate', async () => {
    await choose('松林绿'); await click('预览当前方案'); await click('取消预览')
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('')
    expect(button('应用并保存').disabled).toBe(false)
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
  })
  it('requires confirmation on dirty close and restores on confirmed close', async () => {
    await choose('松林绿'); await click('预览当前方案'); await click('关闭主题方案中心')
    expect(panel().querySelector('[role="alertdialog"]')).toBeTruthy(); expect(onClose).not.toHaveBeenCalled()
    await click('继续编辑'); expect(panel().querySelector('[role="alertdialog"]')).toBeNull()
    await click('关闭主题方案中心'); await click('确认')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('')
  })
  it('restores preview even if the parent unmounts without clicking close', async () => {
    await choose('松林绿'); await click('预览当前方案')
    await act(async () => root.render(null))
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
  })
  it('creates, renames, validates, and deletes a custom scheme in one staged edit', async () => {
    await choose('松林绿'); await click('复制为自定义方案'); await input('方案名称', '我的绿色')
    await input('浅色强调色', '#ffffff')
    expect(button('应用并保存').disabled).toBe(true); expect(panel().textContent).toContain('对比度不足')
    await input('浅色强调色', '#176b4a'); await click('应用并保存')
    expect(readAppearance().value.schemes[0].name).toBe('我的绿色')
    await click('删除方案'); await click('继续编辑')
    expect(readAppearance().value.schemes).toHaveLength(1)
    await click('删除方案'); await click('确认')
    expect(readAppearance().value.schemes).toHaveLength(1)
    await click('应用并保存')
    expect(readAppearance().value).toEqual(defaultAppearance())
  })
  it('keeps built-in schemes immutable', () => {
    expect(panel().querySelector('[aria-label="方案名称"]').disabled).toBe(true)
    expect(button('删除方案').disabled).toBe(true)
  })
  it('rejects duplicate names instead of hiding one scheme', async () => {
    await click('复制为自定义方案'); await input('方案名称', '海洋蓝')
    expect(button('应用并保存').disabled).toBe(true)
    expect(panel().textContent).toContain('名称重复')
  })
  it('stages reset and leaves persisted data untouched until apply', async () => {
    await choose('松林绿'); await click('应用并保存')
    await click('恢复默认方案'); await click('确认')
    expect(readAppearance().value.activeId).toBe('forest')
    await click('应用并保存'); expect(readAppearance().value.activeId).toBe('default')
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('')
  })
  it('retains edits on storage failure and can retry the same operation', async () => {
    await choose('松林绿')
    const storage = localStorage
    const writer = vi.fn(() => { throw new Error('quota') })
    vi.stubGlobal('localStorage', { getItem: key => storage.getItem(key), setItem: writer })
    await click('应用并保存')
    expect(panel().textContent).toContain('未能写入本机')
    expect(button('应用并保存').disabled).toBe(false)
    expect(writer).toHaveBeenCalledTimes(1)
    expect(storage.getItem(APPEARANCE_KEY)).toBeNull()
    vi.stubGlobal('localStorage', storage); await click('应用并保存')
    expect(readAppearance().value.activeId).toBe('forest')
  })
  it('refuses stale application after an external change and supports explicit reload', async () => {
    await choose('松林绿'); await click('预览当前方案')
    await act(async () => {
      saveAppearance({ ...defaultAppearance(), activeId: 'ocean' }, readAppearance(), { target: null })
      window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY }))
    })
    expect(button('应用并保存').disabled).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#185fa5')
    await click('重新载入'); await click('确认')
    expect(panel().querySelector('[aria-pressed="true"]').textContent).toContain('海洋蓝')
  })
  it('keeps corrupt storage untouched until repair is explicitly approved', async () => {
    localStorage.setItem(APPEARANCE_KEY, 'bad-json')
    await act(async () => root.render(null)); await mount()
    await choose('松林绿')
    expect(button('应用并保存').disabled).toBe(true)
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('bad-json')
    await click('确认修复配置'); await click('确认'); await click('应用并保存')
    expect(readAppearance().value.activeId).toBe('forest')
  })
  it('imports a valid local file as an unapplied custom scheme', async () => {
    await upload(new File([exportScheme(BUILTIN_SCHEMES[1])], 'forest.json'))
    expect(panel().textContent).toContain('主题已导入为待应用方案')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
    await click('应用并保存')
    expect(readAppearance().value.schemes[0].name).toBe('松林绿 2')
  })
  it('rejects a broken file without losing the current candidate and retries a new file', async () => {
    await choose('松林绿'); await upload(new File(['not json'], 'bad.json'))
    expect(panel().textContent).toContain('无法解析')
    expect(panel().querySelector('[aria-pressed="true"]').textContent).toContain('松林绿')
    await upload(new File([exportScheme(BUILTIN_SCHEMES[2])], 'valid.json'))
    expect(panel().textContent).toContain('主题已导入')
  })
  it('does not apply a file that finishes after a newer selection', async () => {
    let reader
    vi.stubGlobal('FileReader', class { constructor() { reader = this; this.readyState = 1 } readAsText() {} abort() {} })
    await upload({ size: 50 })
    const late = reader.onload
    await choose('梅子紫')
    await act(async () => { reader.result = exportScheme(BUILTIN_SCHEMES[1]); late(); await drain() })
    expect(panel().querySelector('[aria-pressed="true"]').textContent).toContain('梅子紫')
    expect(panel().textContent).not.toContain('主题已导入')
  })
  it('cancels an in-flight file without changing the current selection', async () => {
    vi.stubGlobal('FileReader', class { constructor() { this.readyState = 1 } readAsText() {} abort() {} })
    await upload({ size: 50 }); await click('取消导入')
    expect(panel().textContent).toContain('导入已取消')
    expect(panel().querySelector('[aria-pressed="true"]').textContent).toContain('原生主题')
  })
  it('does not save notes or change the original light/dark preference', async () => {
    localStorage.setItem('editor:cache:a', 'unsaved-note'); localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const fetch = vi.spyOn(globalThis, 'fetch')
    await choose('松林绿'); await click('预览当前方案'); await click('应用并保存')
    expect(localStorage.getItem('editor:cache:a')).toBe('unsaved-note')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('traps keyboard focus, respects IME escape, and restores the opener', async () => {
    const close = button('关闭主题方案中心'); close.focus()
    await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(button('预览当前方案'))
    await act(async () => panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => root.render(null))
    expect(document.activeElement).toBe(opener)
  })
})
