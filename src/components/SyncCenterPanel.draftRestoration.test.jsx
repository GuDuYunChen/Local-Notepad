import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SyncCenterPanel from './SyncCenterPanel'
import UiThemeProvider from './ui/UiThemeProvider'
import { api } from '~/services/api'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let host, root, settings, writeError
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
const field = label => host.querySelector(`[aria-label="${label}"]`)
const notice = () => host.querySelector('.sync-draft-notice')
const button = text => [...host.querySelectorAll('button')].find(node => node.textContent === text)
const writes = () => api.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  settings = { sync_enabled: true, sync_provider: 'local-lab', sync_endpoint: '', sync_username: '',
    sync_password_set: false, sync_auto_enabled: false, sync_interval_minutes: 5 }
  writeError = null
  window.electronAPI = {
    webdavSecretStatus: vi.fn().mockResolvedValue({ available: true, stored: false, managed: true, backend: 'dpapi' }),
    webdavSecretSave: vi.fn().mockResolvedValue({ success: true, stored: true, restartRequired: false }),
  }
  api.mockImplementation(async (path, init) => {
    const read = !init?.method || init.method === 'GET'
    if (path === '/api/settings' && read) return { ...settings }
    if (path === '/api/sync/status' && read) return { device_id: 'draft-device', provider: settings.sync_provider,
      enabled: settings.sync_enabled, base_items: 0, open_conflicts: 0, last_status: 'never', last_error: '' }
    if (path === '/api/sync/conflicts' && read) return []
    if (path === '/api/sync/activity' && read) return { active: false }
    if (path === '/api/settings' && init?.method === 'PUT') {
      if (writeError) throw writeError
      Object.assign(settings, JSON.parse(init.body)); return { ...settings }
    }
    if (path === '/api/sync/check' && init?.method === 'POST') return { provider: 'webdav', initialized: true, generation: 4, items: 12 }
    throw new Error('Unexpected draft-test request: ' + path)
  })
})

afterEach(async () => {
  await act(async () => { root.unmount(); await flush() })
  host.remove(); delete window.electronAPI; vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals()
})

async function render() {
  await act(async () => { root.render(<UiThemeProvider><SyncCenterPanel/></UiThemeProvider>); await flush() })
}
async function input(label, value) {
  const node = field(label); expect(node).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  })
  expect(field(label).value).toBe(value)
}
async function click(node) {
  expect(node).toBeTruthy()
  await act(async () => { node.click(); await flush() })
}

describe('WebDAV draft restoration through the real shared input', () => {
  it.each([
    ['WebDAV 端点', 'sync_endpoint', '', 'https://synthetic.invalid/草稿/不保存'],
    ['WebDAV 用户名', 'sync_username', 'alice', '另一位用户'],
  ])('restoring %s to its saved raw value removes only the unsaved state', async (label, key, saved, draft) => {
    settings[key] = saved
    await render(); expect(notice()).toBeNull()
    await input(label, draft); expect(notice()).not.toBeNull()
    await input(label, saved); expect(notice()).toBeNull()
    expect(writes()).toHaveLength(0)
    expect(window.electronAPI.webdavSecretSave).not.toHaveBeenCalled()
  })

  it('preserves the other field and password drafts when one field is restored, including a status refresh', async () => {
    await render()
    await input('WebDAV 端点', 'https://synthetic.invalid/unsaved')
    await input('WebDAV 用户名', 'draft-user')
    await input('WebDAV 密码', 'draft-secret')
    await input('WebDAV 端点', '')
    expect(notice()).not.toBeNull()
    await click(button('刷新状态'))
    expect(field('WebDAV 端点').value).toBe('')
    expect(field('WebDAV 用户名').value).toBe('draft-user')
    expect(field('WebDAV 密码').value).toBe('draft-secret')
    await input('WebDAV 用户名', ''); expect(notice()).not.toBeNull()
    await input('WebDAV 密码', ''); expect(notice()).toBeNull()
    expect(writes()).toHaveLength(0)
  })

  it('compares against the current saved snapshot and never revives an old connection receipt', async () => {
    Object.assign(settings, { sync_provider: 'webdav', sync_endpoint: 'https://saved.test/old', sync_username: 'alice' })
    await render()
    await click(button('测试连接（只读）'))
    expect(host.textContent).toContain('第 4 代 · 12 个对象')
    await input('WebDAV 端点', 'https://draft.test/unsaved')
    expect(host.textContent).not.toContain('第 4 代 · 12 个对象')
    settings.sync_endpoint = 'https://saved.test/new'
    await click(button('刷新状态'))
    expect(field('WebDAV 端点').value).toBe('https://draft.test/unsaved')
    await input('WebDAV 端点', 'https://saved.test/new')
    expect(notice()).toBeNull()
    expect(button('测试连接（只读）').disabled).toBe(false)
    expect(host.textContent).not.toContain('第 4 代 · 12 个对象')
    expect(writes().map(([path]) => path)).toEqual(['/api/sync/check'])
  })

  it('keeps failed-save drafts and the error while restoring only one field', async () => {
    settings.sync_username = 'alice'
    await render()
    await input('WebDAV 端点', 'https://draft.test/unsaved')
    await input('WebDAV 用户名', 'draft-user')
    await input('WebDAV 密码', 'draft-secret')
    writeError = new Error('settings write failed')
    await click(button('保存、验证并启用 WebDAV'))
    expect(host.textContent).toContain('settings write failed')
    expect(field('WebDAV 端点').value).toBe('https://draft.test/unsaved')
    expect(field('WebDAV 用户名').value).toBe('draft-user')
    expect(field('WebDAV 密码').value).toBe('draft-secret')
    expect(notice()).not.toBeNull()
    await input('WebDAV 用户名', 'alice')
    expect(notice()).not.toBeNull()
    expect(host.textContent).toContain('settings write failed')
    expect(field('WebDAV 端点').value).toBe('https://draft.test/unsaved')
    expect(field('WebDAV 密码').value).toBe('draft-secret')
    expect(writes()).toHaveLength(1)
    expect(writes()[0][0]).toBe('/api/settings')
    expect(JSON.parse(writes()[0][1].body)).toEqual({ sync_enabled: false, sync_auto_enabled: false,
      sync_provider: 'webdav', sync_endpoint: 'https://draft.test/unsaved', sync_username: 'draft-user' })
    expect(window.electronAPI.webdavSecretSave).not.toHaveBeenCalled()
  })

  it('does not treat whitespace normalization as an exact draft restoration', async () => {
    settings.sync_username = 'alice'
    await render()
    await input('WebDAV 用户名', ' alice '); expect(notice()).not.toBeNull()
    await click(button('刷新状态'))
    expect(field('WebDAV 用户名').value).toBe(' alice ')
    await input('WebDAV 用户名', 'alice'); expect(notice()).toBeNull()
    expect(writes()).toHaveLength(0)
  })
})
