import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Overview from './SyncOverviewPanel'
import Center from './SyncCenterPanel'
import { api } from '~/services/api'
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs'
import { conflictFixture } from '../../scripts/fixtures/sync-conflict-review.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./SyncActivityPanel', () => ({ default: () => null }))
let root, container, input, navigate, previousAct, settings, status, conflicts, pendingRun
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
const back = (scope = container) => scope.querySelector('[data-sync-help-return]')
const guidance = (scope = container) => scope.querySelector('[data-sync-guidance]')
const shortcut = (scope = container) => scope.querySelector('[data-sync-help-shortcut]')
const help = (scope = container) => scope.querySelector('[data-sync-help]')
const topic = key => help().querySelector(`[data-sync-help-topic="${key}"]`)
const button = text => [...container.querySelectorAll('button')].find(n => n.textContent === text)
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
async function render(element = <Overview {...input} onNavigate={navigate}/>) {
  await act(async () => { root.render(element); await flush() })
}
function assertTopic(key) {
  expect(help().open).toBe(true); expect(topic(key).open).toBe(true)
  expect(document.activeElement).toBe(topic(key).querySelector('summary'))
}
beforeEach(() => {
  previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  input = overviewFixture(); navigate = vi.fn(() => true)
  settings = { ...input.settings, sync_endpoint: 'https://example.test', sync_username: 'alice' }
  status = { ...input.status, device_id: 'device-a', remote_store_id: 'store' }; conflicts = []; pendingRun = null
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  api.mockImplementation(async (path, init) => {
    const read = !init?.method || init.method === 'GET'
    if (path === '/api/settings' && read) return { ...settings }
    if (path === '/api/sync/status') return { ...status }
    if (path === '/api/sync/conflicts') return [...conflicts]
    if (path === '/api/sync/run') return pendingRun ? new Promise(resolve => { pendingRun.finish = resolve }) : { conflicts: 0 }
    if (path.endsWith('/resolve')) return null
    throw new Error('Unexpected endpoint: ' + path)
  })
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() })
  container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
})
it('provides a named non-executable region and a return control outside static help', async () => {
  await render()
  expect(guidance().tagName).toBe('DIV'); expect(guidance().getAttribute('role')).toBe('region')
  expect(guidance().tabIndex).toBe(-1)
  expect(document.getElementById(guidance().getAttribute('aria-labelledby')).textContent).toBe('先预演，再决定是否同步')
  expect(help().nextElementSibling.contains(back())).toBe(true)
  expect(help().querySelector('button,input,textarea')).toBeNull()
  expect(navigate).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
})
it('returns to guidance without closing topics, replaying the shortcut or running sync', async () => {
  await render(); await click(shortcut()); const existing=topic('operations'), summary=document.activeElement
  existing.querySelector('summary').focus(); const banner=guidance().textContent
  await click(back()); expect(document.activeElement).toBe(guidance())
  expect(help().open).toBe(true); expect(existing.open).toBe(true); expect(topic('operations')).toBe(existing)
  expect(guidance().textContent).toBe(banner); expect(document.activeElement).not.toBe(summary)
  await click(back()); expect(document.activeElement).toBe(guidance())
  expect(navigate).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
})
it('returns to the updated live guidance without restoring an old snapshot', async () => {
  await render(); await click(shortcut()); const summary=document.activeElement
  input.health.loading=true; await render()
  expect(document.activeElement).toBe(summary); expect(topic('operations').open).toBe(true)
  await click(back()); expect(document.activeElement).toBe(guidance())
  expect(guidance().textContent).toContain('正在读取更新后的状态')
  expect(shortcut().textContent).toContain('状态与恢复'); expect(topic('operations').open).toBe(true)
  expect(topic('recovery').open).toBe(false); expect(api).not.toHaveBeenCalled()
})
it('StrictMode never moves focus or opens disclosures without user input', async () => {
  const element=<React.StrictMode><Overview {...input}/></React.StrictMode>
  await render(element); expect(help().open).toBe(false); expect(document.activeElement).not.toBe(guidance())
  await click(shortcut()); await click(back()); const region=guidance()
  await render(element); expect(document.activeElement).toBe(region); expect(topic('operations').open).toBe(true)
})
it('two instances return only to their own correctly labelled guidance', async () => {
  await render(<><Overview {...input}/><Overview {...input}/></>)
  const panels=container.querySelectorAll('.sync-overview')
  await click(shortcut(panels[1])); await click(back(panels[1]))
  expect(document.activeElement).toBe(guidance(panels[1])); expect(help(panels[0]).open).toBe(false)
  expect(guidance(panels[0]).getAttribute('aria-labelledby')).not.toBe(guidance(panels[1]).getAttribute('aria-labelledby'))
})
it('hidden guidance fails locally and a later explicit return can recover', async () => {
  await render(); await click(shortcut()); guidance().hidden=true
  await click(back()); expect(container.textContent).toContain('暂时无法返回状态提示')
  expect(help().open).toBe(true); expect(topic('operations').open).toBe(true)
  guidance().hidden=false; await click(back())
  expect(document.activeElement).toBe(guidance()); expect(container.textContent).not.toContain('暂时无法返回状态提示')
  expect(navigate).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
})
it('an executable impostor is not focused or clicked as a return fallback', async () => {
  await render(); await click(shortcut()); const actual=guidance(), impostor=shortcut()
  actual.removeAttribute('data-sync-guidance'); impostor.setAttribute('data-sync-guidance','')
  await click(back()); expect(container.textContent).toContain('暂时无法返回状态提示')
  expect(document.activeElement).not.toBe(impostor); expect(navigate).not.toHaveBeenCalled()
  impostor.removeAttribute('data-sync-guidance'); actual.setAttribute('data-sync-guidance','')
})
it('multiple manually opened topics survive the return', async () => {
  await render(); await click(shortcut())
  topic('recovery').open=true; topic('conflicts').open=true
  await click(back()); expect(document.activeElement).toBe(guidance())
  expect([...help().querySelectorAll('[data-sync-help-topic][open]')].map(n=>n.dataset.syncHelpTopic)).toEqual(['operations','conflicts','recovery'])
})
it('real center keeps unsaved endpoint and password and makes no additional requests', async () => {
  await render(<Center/>)
  await act(async () => {
    for (const [label, value] of [['WebDAV 端点', 'https://unsaved.test'], ['WebDAV 密码', 'PRIVATE_DRAFT']]) {
      const n = container.querySelector(`[aria-label="${label}"]`)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, value)
      n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await flush()
  })
  const count = api.mock.calls.length
  await click(shortcut()); assertTopic('first-use'); await click(back()); expect(document.activeElement).toBe(guidance())
  expect(container.querySelector('[aria-label="WebDAV 端点"]').value).toBe('https://unsaved.test')
  expect(container.querySelector('[aria-label="WebDAV 密码"]').value).toBe('PRIVATE_DRAFT')
  expect(container.querySelector('.sync-overview').textContent).not.toContain('PRIVATE_DRAFT')
  expect(button('预演同步').disabled).toBe(true); expect(api.mock.calls).toHaveLength(count)
})
it('real center retains diagnostic snapshot identity and text', async () => {
  await render(<Center/>); await click(button('生成诊断摘要'))
  const snapshot = container.querySelector('textarea'), text = snapshot.value, count = api.mock.calls.length
  await click(shortcut()); await click(back()); expect(document.activeElement).toBe(guidance())
  expect(container.querySelector('textarea')).toBe(snapshot); expect(snapshot.value).toBe(text)
  expect(api.mock.calls).toHaveLength(count)
})
it('real conflict review keeps the exact preview and explicit consent while reading help', async () => {
  conflicts = [conflictFixture()]; status.open_conflicts = 1; status.last_status = 'conflicts'
  await render(<Center/>); await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  const preview = container.querySelector('[aria-label="本机正文预览"]'), count = api.mock.calls.length
  await click(shortcut()); assertTopic('conflicts'); await click(back()); expect(document.activeElement).toBe(guidance())
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true)
  expect(container.querySelector('[aria-label="本机正文预览"]')).toBe(preview)
  expect(api.mock.calls).toHaveLength(count)
  await click(button('确认处理此冲突'))
  expect(api.mock.calls.filter(([path]) => path.endsWith('/resolve'))).toHaveLength(1)
})
it('reading help during a pending write does not release the lock, cancel or repeat it', async () => {
  pendingRun = {}; await render(<Center/>); await click(button('执行同步'))
  const count = api.mock.calls.length; await click(shortcut()); assertTopic('recovery'); await click(back()); expect(document.activeElement).toBe(guidance())
  expect(button('同步中…').disabled).toBe(true); expect(api.mock.calls).toHaveLength(count)
  expect(api.mock.calls.filter(([p]) => p === '/api/sync/run')).toHaveLength(1)
  await act(async () => { pendingRun.finish({ conflicts: 0 }); await flush() })
  expect(api.mock.calls.filter(([p]) => p === '/api/sync/run')).toHaveLength(1)
})
it('help never substitutes for the existing uncertain-write confirmation', async () => {
  status.recovery = { mode: 'review_required' }; status.last_status = 'review_required'
  await render(<Center/>); const count = api.mock.calls.length
  await click(shortcut()); assertTopic('recovery'); await click(back()); expect(document.activeElement).toBe(guidance()); expect(api.mock.calls).toHaveLength(count)
  expect(window.confirm).not.toHaveBeenCalled()
  window.confirm.mockReturnValue(false); await click(button('执行同步'))
  expect(api.mock.calls).toHaveLength(count)
})
