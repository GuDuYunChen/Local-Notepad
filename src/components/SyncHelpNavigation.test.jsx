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
it('StrictMode and rerenders do not open help or move focus automatically', async () => {
  await render(<React.StrictMode><Overview {...input} onNavigate={navigate}/></React.StrictMode>)
  expect(help().open).toBe(false); shortcut().focus()
  input.health.loading = true
  await render(<React.StrictMode><Overview {...input} onNavigate={navigate}/></React.StrictMode>)
  expect(help().open).toBe(false); expect(document.activeElement).toBe(shortcut())
  expect(navigate).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
})
for (const [key, change] of [
  ['first-use', x => { x.settings.sync_enabled = false }],
  ['operations', () => {}],
  ['conflicts', x => { x.status.open_conflicts = x.conflictCount = 1 }],
  ['recovery', x => { x.status.last_status = 'review_required'; x.status.recovery.mode = 'blocked'; x.health.failures = 1 }],
]) it(`opens only ${key} from the real overview without calling navigation or API`, async () => {
  change(input); await render(); const banner = container.querySelector('.sync-overview-status>strong').textContent
  await click(shortcut()); assertTopic(key)
  expect([...help().querySelectorAll('[data-sync-help-topic][open]')].map(n => n.dataset.syncHelpTopic)).toEqual([key])
  expect(container.querySelector('.sync-overview-status>strong').textContent).toBe(banner)
  expect(navigate).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
})
it('existing topic state and focused summary survive changing status', async () => {
  await render(); await click(shortcut()); const summary = document.activeElement, oldTopic = topic('operations')
  input.health.failures = 1; await render()
  expect(oldTopic.open).toBe(true); expect(document.activeElement).toBe(summary)
  expect(shortcut().textContent).toContain('状态与恢复')
  await click(shortcut()); assertTopic('recovery'); expect(oldTopic.open).toBe(true)
  expect(navigate).not.toHaveBeenCalled()
})
it('repeated explicit requests do not toggle help closed', async () => {
  await render(); await click(shortcut()); const original = topic('operations')
  await click(shortcut()); assertTopic('operations'); expect(topic('operations')).toBe(original)
})
it('missing or hidden help reports failure without a fallback action', async () => {
  await render(); help().hidden = true; await click(shortcut())
  expect(container.textContent).toContain('暂时无法定位帮助'); expect(help().open).toBe(false)
  help().hidden = false; await click(shortcut()); assertTopic('operations')
  expect(container.textContent).not.toContain('暂时无法定位帮助')
  expect(navigate).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
})
it('two overviews never open or focus the other instance', async () => {
  await render(<><Overview {...input}/><Overview {...input}/></>)
  const panels = container.querySelectorAll('.sync-overview')
  await click(shortcut(panels[1]))
  expect(help(panels[0]).open).toBe(false); expect(help(panels[1]).open).toBe(true)
  expect(document.activeElement.closest('.sync-overview')).toBe(panels[1])
})
it('unread state still offers documentation without disclosing raw values', async () => {
  input.health.lastReadAt = 0; input.settings.sync_endpoint = 'PRIVATE_HELP'; input.status.last_error = '<script>PRIVATE_HELP</script>'
  await render(); await click(shortcut()); assertTopic('recovery')
  expect(container.textContent).not.toContain('PRIVATE_HELP'); expect(container.querySelector('script,img,iframe')).toBeNull()
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
  await click(shortcut()); assertTopic('first-use')
  expect(container.querySelector('[aria-label="WebDAV 端点"]').value).toBe('https://unsaved.test')
  expect(container.querySelector('[aria-label="WebDAV 密码"]').value).toBe('PRIVATE_DRAFT')
  expect(container.querySelector('.sync-overview').textContent).not.toContain('PRIVATE_DRAFT')
  expect(button('预演同步').disabled).toBe(true); expect(api.mock.calls).toHaveLength(count)
})
it('real center retains diagnostic snapshot identity and text', async () => {
  await render(<Center/>); await click(button('生成诊断摘要'))
  const snapshot = container.querySelector('textarea'), text = snapshot.value, count = api.mock.calls.length
  await click(shortcut())
  expect(container.querySelector('textarea')).toBe(snapshot); expect(snapshot.value).toBe(text)
  expect(api.mock.calls).toHaveLength(count)
})
it('real conflict review keeps the exact preview and explicit consent while reading help', async () => {
  conflicts = [conflictFixture()]; status.open_conflicts = 1; status.last_status = 'conflicts'
  await render(<Center/>); await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  const preview = container.querySelector('[aria-label="本机正文预览"]'), count = api.mock.calls.length
  await click(shortcut()); assertTopic('conflicts')
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true)
  expect(container.querySelector('[aria-label="本机正文预览"]')).toBe(preview)
  expect(api.mock.calls).toHaveLength(count)
  await click(button('确认处理此冲突'))
  expect(api.mock.calls.filter(([path]) => path.endsWith('/resolve'))).toHaveLength(1)
})
it('reading help during a pending write does not release the lock, cancel or repeat it', async () => {
  pendingRun = {}; await render(<Center/>); await click(button('执行同步'))
  const count = api.mock.calls.length; await click(shortcut()); assertTopic('recovery')
  expect(button('同步中…').disabled).toBe(true); expect(api.mock.calls).toHaveLength(count)
  expect(api.mock.calls.filter(([p]) => p === '/api/sync/run')).toHaveLength(1)
  await act(async () => { pendingRun.finish({ conflicts: 0 }); await flush() })
  expect(api.mock.calls.filter(([p]) => p === '/api/sync/run')).toHaveLength(1)
})
it('help never substitutes for the existing uncertain-write confirmation', async () => {
  status.recovery = { mode: 'review_required' }; status.last_status = 'review_required'
  await render(<Center/>); const count = api.mock.calls.length
  await click(shortcut()); assertTopic('recovery'); expect(api.mock.calls).toHaveLength(count)
  expect(window.confirm).not.toHaveBeenCalled()
  window.confirm.mockReturnValue(false); await click(button('执行同步'))
  expect(api.mock.calls).toHaveLength(count)
})
