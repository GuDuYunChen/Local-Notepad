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
