import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPanel from './SettingsPanel'
import { api } from '~/services/api'
import { APPEARANCE_KEY, installAppearanceRuntime, readAppearance } from '~/services/localAppearance'
import { THEME_STORAGE_KEY } from '~/services/themePreference'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
// Unrelated panels are isolated; the actual SettingsPanel entry, ThemeToggle,
// AppearanceCenter, preview runtime and storage implementation remain in use.
vi.mock('./LibraryReferenceHealthPanel', () => ({ default: () => null }))
vi.mock('./SyncCenterPanel', () => ({ default: () => null }))
vi.mock('./S3ReadInspectionPanel', () => ({ default: () => null }))
vi.mock('./S3LocalOverviewPanel', () => ({ default: () => null }))
let host, root, dispose
const find = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text || node.getAttribute('aria-label') === text)
const click = async text => act(async () => { const button = find(text); expect(button).toBeTruthy(); button.focus(); button.click() })
const mount = async () => act(async () => root.render(<SettingsPanel onClose={() => {}} />))
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear(); document.documentElement.removeAttribute('style'); document.documentElement.setAttribute('data-theme', 'light')
  localStorage.setItem(THEME_STORAGE_KEY, 'light')
  api.mockReset().mockImplementation(async path => path === '/api/diagnostics' ? { status: 'ok', integrity: 'ok' } : {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  dispose = installAppearanceRuntime(); await mount()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('local appearance entry in the existing settings workflow', () => {
  it('opens from settings, applies locally, closes, and restores across runtime restart', async () => {
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
    await click('管理主题方案')
    expect(document.querySelector('[role="dialog"][aria-label="本地主题方案中心"]')).not.toBeNull()
    const ocean = [...document.querySelectorAll('[aria-pressed]')].find(node => node.textContent.includes('海洋蓝'))
    await act(async () => ocean.click()); await click('应用并保存'); await click('关闭主题方案中心')
    expect(document.querySelector('[role="dialog"][aria-label="本地主题方案中心"]')).toBeNull()
    expect(readAppearance().value.activeId).toBe('ocean')
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#185fa5')
    await act(async () => root.render(null)); dispose(); dispose = installAppearanceRuntime(); await mount()
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#185fa5')
    expect(api.mock.calls.every(([path, init]) => ['/api/diagnostics', '/api/settings'].includes(path) && !init?.method)).toBe(true)
  })
  it('leaves original light/dark choice untouched when opening and canceling a preview', async () => {
    await click('管理主题方案')
    const forest = [...document.querySelectorAll('[aria-pressed]')].find(node => node.textContent.includes('松林绿'))
    await act(async () => forest.click()); await click('预览当前方案'); await click('关闭主题方案中心'); await click('确认')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('')
    expect(document.activeElement).toBe(find('管理主题方案'))
  })
  it('uses the real light/dark toggle without discarding the chosen palette', async () => {
    await click('管理主题方案')
    const plum = [...document.querySelectorAll('[aria-pressed]')].find(node => node.textContent.includes('梅子紫'))
    await act(async () => plum.click()); await click('应用并保存'); await click('关闭主题方案中心')
    await click('切换主题')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('#deb1ef')
    expect(readAppearance().value.activeId).toBe('plum')
    expect(api.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([
      ['/api/settings', { method: 'PUT', body: JSON.stringify({ theme: 'dark' }) }],
    ])
  })
  it('retains no preview if the entire settings route is closed by its owner', async () => {
    await click('管理主题方案')
    const forest = [...document.querySelectorAll('[aria-pressed]')].find(node => node.textContent.includes('松林绿'))
    await act(async () => forest.click()); await click('预览当前方案')
    await act(async () => root.render(null))
    expect(document.documentElement.style.getPropertyValue('--clay')).toBe('')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
  })
})
