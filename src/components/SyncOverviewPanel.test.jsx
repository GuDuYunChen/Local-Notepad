import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Panel from './SyncOverviewPanel'
import { overviewFixture } from '../../scripts/fixtures/sync-overview.mjs'
let root, container, props, navigate, actMode
const button = label => container.querySelector(`[aria-label="定位${label}"]`)
async function render(strict = false) {
  await act(async () => { const panel = <Panel {...props} onNavigate={navigate}/>; root.render(strict ? <React.StrictMode>{panel}</React.StrictMode> : panel) })
}
async function click(element) { expect(element).toBeTruthy(); await act(async () => element.click()) }
beforeEach(() => {
  actMode = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  props = overviewFixture(); navigate = vi.fn(() => true)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = actMode
})
it('mount and StrictMode replay do not focus, navigate or execute', async () => {
  await render(true); expect(navigate).not.toHaveBeenCalled()
  expect(container.textContent).toContain('同步总览'); expect(button('预演与执行').disabled).toBe(false)
})
it('explicit navigation passes only the fixed region key', async () => {
  await render(); await click(button('连接配置'))
  expect(navigate).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledWith('connection')
})
it('unavailable regions remain visibly disabled with a reason', async () => {
  props.settings.sync_enabled = false; await render()
  expect(button('冲突队列').disabled).toBe(true); expect(button('预演与执行').disabled).toBe(true)
  expect(button('预演与执行').textContent).toContain('启用同步后')
  await click(button('预演与执行')); expect(navigate).not.toHaveBeenCalled()
})
it('read failure preserves previous counters without announcing healthy sync', async () => {
  props.health.error = 'PRIVATE'; props.status.open_conflicts = 4; props.conflictCount = 2; await render()
  expect(container.textContent).toContain('上次读取结果'); expect(container.textContent).not.toContain('PRIVATE')
  expect(container.querySelectorAll('dd')[0].textContent).toBe('4'); expect(container.querySelectorAll('dd')[1].textContent).toBe('2')
})
it('snapshot changes update the banner without moving the user or triggering navigation', async () => {
  await render(); const connection = button('连接配置'); connection.focus()
  props.status.last_status = 'review_required'; props.status.recovery = null; await render()
  expect(container.textContent).toContain('先核查写入结果'); expect(document.activeElement).toBe(connection)
  expect(navigate).not.toHaveBeenCalled()
})
it('missing callback and vanished targets do not produce success or fallback actions', async () => {
  navigate = undefined; await render(); expect(button('连接配置').disabled).toBe(true)
  navigate = vi.fn(() => false); await render(); await click(button('连接配置'))
  expect(container.textContent).toContain('该区域已变化或暂不可定位'); expect(navigate).toHaveBeenCalledTimes(1)
})
it('unknown values show unknown labels and never execute supplied markup', async () => {
  props.status.open_conflicts = '<img src=x>'; props.status.last_status = '__proto__'; props.settings.sync_endpoint = '<script>PRIVATE</script>'
  await render(); expect(container.querySelector('img,script,a,iframe')).toBeNull()
  expect(container.querySelector('dd').textContent).toBe('未知'); expect(container.textContent).not.toContain('PRIVATE')
})
it('busy operation still allows read-only navigation, not a stop or retry button', async () => {
  props.busy = true; await render(); await click(button('诊断摘要'))
  expect(container.textContent).toContain('不会停止等待'); expect(navigate).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledWith('diagnostic')
  expect(container.querySelector('input,textarea')).toBeNull()
})

for (const [last, mode, warning] of [
  ['recovery_blocked', 'blocked', '恢复保护阻断'], ['retry_wait', 'backoff', '预检暂缓'],
]) for (const context of ['busy', 'stale', 'refreshing']) it(`keeps ${mode} visible in the actual ${context} panel`, async () => {
  props.status.last_status = last; props.status.recovery.mode = mode
  if (context === 'busy') props.busy = true
  if (context === 'stale') { props.health.error = 'PRIVATE_READ_ERROR'; props.health.failures = 1 }
  if (context === 'refreshing') props.health.loading = true
  await render(true)
  expect(container.querySelector('.sync-overview-warning').textContent).toContain(warning)
  expect(container.textContent).toContain('状态依据：' + (context === 'busy' ? '已读取的状态快照' : context === 'stale' ? '上次读取结果' : '正在刷新；仍是上次读取结果'))
  expect(container.textContent).not.toContain('PRIVATE_READ_ERROR'); expect(navigate).not.toHaveBeenCalled()
  await click(button('状态与恢复')); expect(navigate).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledWith('health')
})
it('uncertain-write title does not conceal the refreshing provenance', async () => {
  props.status.last_status = 'review_required'; props.status.recovery.mode = 'review_required'; props.health.loading = true
  await render(); expect(container.textContent).toContain('先核查写入结果')
  expect(container.textContent).toContain('状态依据：正在刷新；仍是上次读取结果')
  expect(container.querySelectorAll('dd')[2].textContent).toBe(new Date(1790499900000).toISOString())
  expect(navigate).not.toHaveBeenCalled()
})
it('contradictory blocked and backoff evidence both survive the waiting banner', async () => {
  props.status.last_status = 'recovery_blocked'; props.status.recovery.mode = 'backoff'; props.busy = true; props.health.failures = 1
  await render(); const notice = container.querySelector('.sync-overview-warning').textContent
  expect(notice).toContain('恢复保护阻断'); expect(notice).toContain('预检暂缓'); expect(notice).toContain('不一致')
  expect(container.textContent).toContain('正在等待操作结果'); expect(container.textContent).toContain('刷新失败或状态待核实')
  expect(navigate).not.toHaveBeenCalled()
})
it('A-B-A read provenance and guards update without remounting controls or moving focus', async () => {
  props.status.last_status = 'recovery_blocked'; props.status.recovery.mode = 'blocked'; props.busy = true; props.health.failures = 1
  const original = structuredClone(props); await render(); const connection = button('连接配置'); connection.focus()
  props = overviewFixture(); await render(); expect(container.querySelector('.sync-overview-warning')).toBeNull()
  props = original; await render(); expect(container.textContent).toContain('不证明保护已解除')
  expect(container.textContent).toContain('状态依据：上次读取结果'); expect(button('连接配置')).toBe(connection)
  expect(document.activeElement).toBe(connection); expect(navigate).not.toHaveBeenCalled()
})
it('unread data cannot render a fabricated guard or a captured-state label', async () => {
  props.status.last_status = 'recovery_blocked'; props.status.recovery.mode = 'backoff'; props.health.lastReadAt = 0
  await render(); expect(container.querySelector('.sync-overview-warning')).toBeNull()
  expect(container.textContent).toContain('状态依据：尚无可核实的读取结果')
  expect(container.querySelector('dd').textContent).toBe('未知'); expect(navigate).not.toHaveBeenCalled()
})

// happy-dom does not stand in for a browser's summary activation behavior.
// These tests supply native DOM disclosure state and check React/state isolation;
// the Windows Electron scenarios separately exercise actual summary.click().
async function disclose(node, open = true) {
  await act(async () => { node.open = open; node.dispatchEvent(new Event('toggle')) })
}
it('shows four native help topics, all initially collapsed, without navigation', async () => {
  await render(true)
  const help = container.querySelector('[data-sync-help]')
  expect(help.open).toBe(false); expect(help.querySelectorAll('[data-sync-help-topic]')).toHaveLength(4)
  expect([...help.querySelectorAll('details')].every(topic => !topic.open)).toBe(true)
  expect(help.querySelector('button,input,textarea,a,script,iframe')).toBeNull()
  expect(navigate).not.toHaveBeenCalled()
})
it('opening native help and topics never navigates or changes the status', async () => {
  props.status.last_status = 'review_required'; props.status.recovery.mode = 'blocked'; props.busy = true
  await render(); const title = container.querySelector('[role="status"]').textContent
  const warning = container.querySelector('.sync-overview-warning').textContent
  const help = container.querySelector('[data-sync-help]')
  await disclose(help)
  await disclose(help.querySelector('[data-sync-help-topic="recovery"]'))
  expect(help.open).toBe(true); expect(help.querySelector('[data-sync-help-topic="recovery"]').open).toBe(true)
  expect(container.querySelector('[role="status"]').textContent).toBe(title)
  expect(container.querySelector('.sync-overview-warning').textContent).toBe(warning)
  expect(navigate).not.toHaveBeenCalled()
})
it('help open state and summary focus survive new snapshots without remounting', async () => {
  await render(); const help = container.querySelector('[data-sync-help]'), topic = help.querySelector('[data-sync-help-topic="operations"]')
  await disclose(help); await disclose(topic); topic.querySelector('summary').focus()
  props.health.failures = 1; props.busy = true; await render()
  expect(container.querySelector('[data-sync-help]')).toBe(help); expect(help.open).toBe(true); expect(topic.open).toBe(true)
  expect(document.activeElement).toBe(topic.querySelector('summary')); expect(navigate).not.toHaveBeenCalled()
})
it('help is independent of private settings, markup and missing status', async () => {
  props.settings.sync_endpoint = 'PRIVATE_HELP_ENDPOINT'; props.settings.sync_password = '<script>PRIVATE_HELP_PASSWORD</script>'
  props.status = null; await render()
  const help = container.querySelector('[data-sync-help]')
  expect(help.textContent).not.toMatch(/PRIVATE_HELP_|<script>/)
  expect(help.textContent).toContain('不检测当前连接'); expect(help.textContent).toContain('预演结果不是执行完成')
  expect(help.querySelector('script,img,a')).toBeNull(); expect(navigate).not.toHaveBeenCalled()
})
it('help remains available while disabled or waiting and does not unlock execution', async () => {
  props.settings.sync_enabled = false; props.busy = true; await render()
  await disclose(container.querySelector('[data-sync-help]'))
  expect(button('预演与执行').disabled).toBe(true); expect(container.textContent).toContain('正在等待操作结果')
  expect(navigate).not.toHaveBeenCalled()
})
it('multiple help panels do not share a disclosure group or duplicate identifiers', async () => {
  await act(async () => root.render(<><Panel {...props}/><Panel {...props}/></>))
  const panels = container.querySelectorAll('[data-sync-help]')
  await disclose(panels[0]); await disclose(panels[0].querySelector('[data-sync-help-topic="conflicts"]'))
  expect(panels[0].open).toBe(true); expect(panels[1].open).toBe(false)
  expect(panels[1].querySelector('[data-sync-help-topic="conflicts"]').open).toBe(false)
  expect(panels[0].querySelector('[id],[name]')).toBeNull()
})
