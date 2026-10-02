import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Panel from './SyncDiagnosticPanel'
let container, root, props, write, originalClipboard, originalAct
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text)
const area = () => container.querySelector('[aria-label="可复制的诊断摘要"]')
async function render(strict = false) { await act(async () => { const view = <Panel {...props}/>; root.render(strict ? <React.StrictMode>{view}</React.StrictMode> : view); await flush() }) }
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
beforeEach(() => {
  originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  write = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  props = { settings: { sync_enabled: true, sync_provider: 'webdav', sync_auto_enabled: false, sync_interval_minutes: 5 },
    status: { last_status: 'ok', last_sync_at: 1790499990, last_error: '', base_items: 20, open_conflicts: 0, recovery: { mode: 'idle', last_success_at: 1790499990 } },
    health: { loading: false, lastReadAt: 1790500000000, error: '', failures: 0 }, conflictCount: 0, busy: false, draftChanged: false, actionFailed: false }
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); await flush() })
  container.remove(); vi.useRealTimers(); vi.restoreAllMocks()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else delete navigator.clipboard
  globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct
})
it('mount does not generate or copy, including StrictMode replay', async () => {
  await render(true); expect(area()).toBeNull(); expect(write).not.toHaveBeenCalled()
  await click(button('生成诊断摘要')); expect(area().readOnly).toBe(true); expect(write).not.toHaveBeenCalled()
})
it('an explicit copy uses exactly the previewed text and no additional data', async () => {
  await render(); await click(button('生成诊断摘要')); const visible = area().value
  await click(button('复制诊断摘要'))
  expect(write).toHaveBeenCalledTimes(1); expect(write).toHaveBeenCalledWith(visible)
  expect(container.textContent).toContain('已复制当前显示的摘要')
})
it('private strings never enter the preview or clipboard', async () => {
  const marker = 'PRIVATE_SECRET_<img src=x onerror=alert(1)>'
  Object.assign(props.settings, { sync_endpoint: marker, sync_username: marker, sync_password: marker })
  Object.assign(props.status, { device_id: marker, remote_store_id: marker, last_error: marker, content: marker, title: marker })
  await render(); await click(button('生成诊断摘要')); await click(button('复制诊断摘要'))
  expect(area().value).not.toContain(marker); expect(write.mock.calls[0][0]).not.toContain(marker)
  expect(container.querySelector('img,script,iframe,a')).toBeNull()
})
it('captured report remains unchanged on refresh until explicitly regenerated', async () => {
  await render(); await click(button('生成诊断摘要')); const before = area().value
  props.status = { ...props.status, open_conflicts: 3 }; props.conflictCount = 3; await render()
  expect(area().value).toBe(before); expect(container.textContent).toContain('可见诊断字段已变化')
  await click(button('重新生成摘要')); expect(area().value).toContain('状态报告待处理数：3')
  expect(container.textContent).not.toContain('可见诊断字段已变化'); expect(write).not.toHaveBeenCalled()
})
it('A-B-A does not silently refresh a previous snapshot', async () => {
  await render(); await click(button('生成诊断摘要'))
  props.busy = true; await render(); props.busy = false; await render()
  expect(container.textContent).toContain('可见诊断字段已变化')
})
it('identical refreshed values leave the existing report and status alone', async () => {
  await render(); await click(button('生成诊断摘要')); props = structuredClone(props); await render()
  expect(container.textContent).not.toContain('可见诊断字段已变化'); expect(write).not.toHaveBeenCalled()
})
it('initial unavailability and read failure remain useful without inventing zeros', async () => {
  props.status = null; props.settings = null; props.health.lastReadAt = 0
  await render(); await click(button('生成诊断摘要'))
  expect(area().value).toContain('当前已读取列表数：未知'); expect(area().value).toContain('先在同步中心读取状态')
})
it('rejected copy is not replayed and offers explicit manual selection', async () => {
  write.mockRejectedValue(new Error('PRIVATE_FAILURE'))
  await render(); await click(button('生成诊断摘要')); await click(button('复制诊断摘要'))
  expect(write).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('复制未确认')
  expect(container.textContent).not.toContain('PRIVATE_FAILURE')
  await click(button('选择摘要')); expect(document.activeElement).toBe(area())
  expect(area().selectionStart).toBe(0); expect(area().selectionEnd).toBe(area().value.length)
})
it('unsupported or throwing clipboard access falls back without trapping the UI', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get() { throw new Error('denied') } })
  await render(); await click(button('生成诊断摘要')); await click(button('复制诊断摘要'))
  expect(container.textContent).toContain('复制未确认'); expect(button('复制诊断摘要').disabled).toBe(false)
})
it('duplicate click is single-flight and timeout does not claim the native copy was cancelled', async () => {
  vi.useFakeTimers(); let finish; write.mockImplementation(() => new Promise(r => { finish = r }))
  await render(); await click(button('生成诊断摘要')); const copy = button('复制诊断摘要')
  await act(async () => { copy.click(); copy.click(); await flush() })
  expect(write).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); await flush() })
  expect(container.textContent).toContain('先前复制请求仍可能完成')
  await act(async () => { finish(); await flush() })
  expect(container.textContent).not.toContain('已复制当前显示的摘要'); expect(write).toHaveBeenCalledTimes(1)
})
it('closing pending copy restores opener focus; late receipt cannot reopen or overwrite a new report', async () => {
  let finish; write.mockImplementation(() => new Promise(r => { finish = r }))
  await render(); await click(button('生成诊断摘要')); await click(button('复制诊断摘要'))
  await click(button('收起诊断摘要')); expect(area()).toBeNull(); expect(document.activeElement).toBe(button('生成诊断摘要'))
  await click(button('生成诊断摘要')); const current = area().value
  await act(async () => { finish(); await flush() })
  expect(area().value).toBe(current); expect(container.textContent).not.toContain('已复制当前显示的摘要')
})
it('unmount prevents late success from updating an abandoned view', async () => {
  let finish; write.mockImplementation(() => new Promise(r => { finish = r }))
  await render(); await click(button('生成诊断摘要')); await click(button('复制诊断摘要'))
  await act(async () => { root.unmount(); root = null; finish(); await flush() })
  expect(container.textContent).toBe(''); expect(write).toHaveBeenCalledTimes(1)
})

for (const [state, mode, label] of [
  ['review_required', 'review_required', '写入结果待确认'],
  ['retry_wait', 'backoff', '预检暂缓，等待重试'],
  ['recovery_blocked', 'blocked', '恢复保护阻断，需处理'],
]) it(`exports the real backend state ${state} exactly as visibly labeled`, async () => {
  props.status = { ...props.status, last_status: state, recovery: { mode } }
  await render(); await click(button('生成诊断摘要'))
  const visible = area().value
  expect(visible).toContain('最近状态：' + label)
  expect(visible).not.toContain('最近状态：未知')
  expect(write).not.toHaveBeenCalled()
  await click(button('复制诊断摘要'))
  expect(write).toHaveBeenCalledTimes(1); expect(write).toHaveBeenCalledWith(visible)
})
it('preserves explicit uncertain-write guidance when recovery details are unavailable', async () => {
  props.status = { ...props.status, last_status: 'review_required', recovery: undefined }
  props.health = { ...props.health, error: 'PRIVATE_READ_ERROR', failures: 2 }
  props.busy = true; props.draftChanged = true; props.conflictCount = 3
  await render(); await click(button('生成诊断摘要'))
  expect(area().value).toContain('恢复状态：未知 / 未提供')
  expect(area().value).toContain('恢复详情缺失或不受支持')
  expect(area().value).toContain('不要反复执行或重新绑定')
  expect(area().value).not.toContain('PRIVATE_READ_ERROR')
  expect(area().value).not.toContain('下一步参考：可先预演')
  expect(write).not.toHaveBeenCalled()
})
it('keeps contradictory state fields visible without replacing either of them', async () => {
  props.status = { ...props.status, last_status: 'review_required', recovery: { mode: 'idle' } }
  await render(); await click(button('生成诊断摘要'))
  expect(area().value).toContain('最近状态：写入结果待确认')
  expect(area().value).toContain('恢复状态：空闲')
  expect(area().value).toContain('最近状态与恢复详情不一致')
  await click(button('复制诊断摘要'))
  expect(write.mock.calls[0][0]).toBe(area().value)
})
it('a change between supported recovery status codes marks the old summary until explicit regeneration', async () => {
  props.status = { ...props.status, last_status: 'retry_wait', recovery: undefined }
  await render(); await click(button('生成诊断摘要')); const before = area().value
  props.status = { ...props.status, last_status: 'review_required' }; await render()
  expect(area().value).toBe(before); expect(container.textContent).toContain('可见诊断字段已变化')
  expect(write).not.toHaveBeenCalled()
  await click(button('重新生成摘要'))
  expect(area().value).toContain('最近状态：写入结果待确认')
  expect(area().value).toContain('不要反复执行或重新绑定')
  expect(container.textContent).not.toContain('可见诊断字段已变化')
})
it('A-B-A recovery status changes cannot revive an old summary even with missing detail', async () => {
  props.status = { ...props.status, last_status: 'retry_wait', recovery: undefined }
  await render(); await click(button('生成诊断摘要')); const before = area().value
  props.status = { ...props.status, last_status: 'review_required' }; await render()
  props.status = { ...props.status, last_status: 'retry_wait' }; await render()
  expect(area().value).toBe(before); expect(container.textContent).toContain('可见诊断字段已变化')
  expect(write).not.toHaveBeenCalled()
})
it('unrecognized status text cannot become exported diagnostic content', async () => {
  props.status = { ...props.status, last_status: 'PRIVATE_STATUS_<script>bad()</script>', recovery: { mode: '__proto__' } }
  await render(); await click(button('生成诊断摘要')); await click(button('复制诊断摘要'))
  expect(area().value).toContain('最近状态：未知 / 未提供')
  expect(area().value).toContain('恢复状态：未知 / 未提供')
  expect(write.mock.calls[0][0]).not.toContain('PRIVATE_STATUS')
  expect(container.querySelector('script')).toBeNull()
})
