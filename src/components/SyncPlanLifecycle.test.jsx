import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import SyncCenterPanel from './SyncCenterPanel'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import { SYNC_PLAN_READ_TIMEOUT_MS } from '~/services/syncPlanRead.mjs'
import { makePlan } from '../../scripts/fixtures/sync-plan-view.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// Do NOT mock SyncActivityPanel: these tests exercise both real readers, the
// parent, activity transition delivery and the rendered explorer together.
let container, root, settings, status, activity, planRequest, runRequest, actEnvironment, electronAPI
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
const plan = id => makePlan([{ id, action: 'upload' }])
const active = kind => ({ active: true, id: 'a'.repeat(32), kind, phase: kind === 'plan' || kind === 'check' ? 'preflight' : 'applying', started_at: 1790400000, cancel_requested: false })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const calls = path => api.mock.calls.filter(([url]) => url === path)
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
const panel = () => container.querySelector('[aria-label="同步计划详情"]')
const mutations = () => api.mock.calls.filter(([url, init]) => ['POST', 'PUT', 'DELETE'].includes(init?.method) && url !== '/api/sync/plan')
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1790400000000)
  actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  electronAPI = window.electronAPI; delete window.electronAPI
  settings = { sync_enabled: true, sync_provider: 'local-lab', sync_endpoint: '', sync_username: '', sync_auto_enabled: false, sync_interval_minutes: 5 }
  status = { device_id: 'a', provider: 'local-lab', enabled: true, base_items: 2, open_conflicts: 0, remote_store_id: 'store', remote_revision: 'one', last_status: 'ok', last_error: '' }
  activity = { active: false }; planRequest = () => plan('initial'); runRequest = () => ({ plan: plan('run'), conflicts: 0 })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  api.mockReset()
  api.mockImplementation(async (path, init) => {
    if (path === '/api/settings') return { ...settings }
    if (path === '/api/sync/status') return { ...status }
    if (path === '/api/sync/conflicts') return []
    if (path === '/api/sync/activity') return { ...activity }
    if (path === '/api/sync/plan') return planRequest(init)
    if (path === '/api/sync/run') return runRequest(init)
    throw new Error('Unexpected endpoint: ' + path)
  })
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); await flush() })
  container.remove(); window.electronAPI = electronAPI
  globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment
  vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks()
})
async function render() { await act(async () => { root.render(<SyncCenterPanel/>); await flush() }) }
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
async function tick(ms) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); await flush() }) }
async function finish(pending, value) { await act(async () => { pending.resolve(value); await flush() }) }
function hangPreview() {
  const pending = deferred()
  planRequest = init => { pending.signal = init?.signal; return pending.promise }
  return pending
}

it('REGRESSION_PLAN_TIMEOUT: releases a hung preview and retains stale previous evidence', async () => {
  await render(); await click(button('预演同步')); const pending = hangPreview()
  await click(button('重新预演')); await tick(SYNC_PLAN_READ_TIMEOUT_MS - 1)
  expect(button('预演中…')).toBeTruthy()
  await tick(1)
  expect(button('预演同步'), 'REGRESSION_PLAN_TIMEOUT: hung read never released the operation lock').toBeTruthy()
  expect(button('预演同步').disabled).toBe(false); expect(button('停止等待预演')).toBeUndefined()
  expect(container.textContent).toContain('同步预演等待超时')
  expect(panel().textContent).toContain('initial'); expect(panel().textContent).toContain('此计划已失效')
  expect(pending.signal.aborted).toBe(true); expect(calls('/api/sync/plan')).toHaveLength(2)
  expect(mutations()).toHaveLength(0)
  await finish(pending, plan('too-late'))
  expect(panel().textContent).not.toContain('too-late'); expect(toast.success).toHaveBeenCalledTimes(1)
})
it('REGRESSION_PLAN_SETTLED: does not lose a write-capable completion while awaiting a preview reply', async () => {
  activity = active('auto-sync'); await render(); const pending = hangPreview()
  await click(button('预演同步')); const before = calls('/api/settings').length
  activity = { active: false }; await click(button('刷新任务状态'))
  // The parent reader remains paused; invalidation must not require another
  // status read and the refresh must be deferred, not discarded.
  expect(calls('/api/settings')).toHaveLength(before)
  await finish(pending, plan('captured-before-completion'))
  expect(panel().textContent, 'REGRESSION_PLAN_SETTLED: task completion was dropped while parent was busy').toContain('此计划已失效')
  expect(calls('/api/settings').length).toBeGreaterThan(before)
  expect(mutations()).toHaveLength(0); expect(calls('/api/sync/plan')).toHaveLength(1)
})
for (const kind of ['plan', 'check']) it(`a completed ${kind} read does not by itself invalidate its own new snapshot`, async () => {
  await render(); const pending = hangPreview(); await click(button('预演同步'))
  activity = active(kind); await click(button('刷新任务状态'))
  await finish(pending, plan('read-only-result'))
  activity = { active: false }; await click(button('刷新任务状态'))
  expect(panel().textContent).toContain('read-only-result'); expect(panel().textContent).not.toContain('此计划已失效')
  expect(mutations()).toHaveLength(0)
})
for (const kind of ['sync', 'resolve']) it(`${kind} completion while idle still invalidates existing evidence`, async () => {
  activity = active(kind); await render(); await click(button('预演同步'))
  activity = { active: false }; await click(button('刷新任务状态'))
  expect(panel().textContent).toContain('此计划已失效'); expect(mutations()).toHaveLength(0)
})
it('manual stop aborts only the preview wait, not another active sync task', async () => {
  activity = active('auto-sync'); await render(); const pending = hangPreview()
  await click(button('预演同步')); await click(button('停止等待预演'))
  expect(pending.signal.aborted).toBe(true); expect(button('预演同步').disabled).toBe(false)
  expect(container.textContent).toContain('已停止等待同步预演')
  expect(container.querySelector('[aria-label="当前同步任务"]').textContent).toContain('自动同步')
  expect(calls('/api/sync/cancel')).toHaveLength(0); expect(mutations()).toHaveLength(0)
  expect(window.confirm).not.toHaveBeenCalled()
  await finish(pending, plan('cancelled-result')); expect(panel()).toBeNull()
})
it('a late cancelled reply cannot replace a newer explicitly requested preview', async () => {
  await render(); const old = hangPreview(); await click(button('预演同步'))
  await click(button('停止等待预演')); planRequest = () => plan('newer')
  await click(button('预演同步')); await finish(old, plan('older'))
  expect(panel().textContent).toContain('newer'); expect(panel().textContent).not.toContain('older')
  expect(panel().textContent).not.toContain('此计划已失效')
  expect(toast.success).toHaveBeenCalledTimes(1); expect(calls('/api/sync/plan')).toHaveLength(2)
})
it('late transport rejection after manual stop is handled without a second message or retry', async () => {
  await render(); const pending = hangPreview(); await click(button('预演同步'))
  await click(button('停止等待预演')); const errors = toast.error.mock.calls.length
  await act(async () => { pending.reject(new Error('late network failure')); await flush() })
  expect(toast.error).toHaveBeenCalledTimes(errors); expect(calls('/api/sync/plan')).toHaveLength(1)
  expect(container.textContent).not.toContain('late network failure')
})
it('unmount aborts the read and removes timers even if the API ignores abort', async () => {
  await render(); const pending = hangPreview(); await click(button('预演同步'))
  await act(async () => { root.unmount(); root = null; await flush() })
  expect(pending.signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  await finish(pending, plan('unmounted')); expect(container.textContent).toBe('')
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  expect(mutations()).toHaveLength(0)
})
it('a new mount does not inherit the old read lock or revive its response', async () => {
  await render(); const old = hangPreview(); await click(button('预演同步'))
  await act(async () => { root.unmount(); await flush() }); root = createRoot(container)
  planRequest = () => plan('new-instance'); await render(); await click(button('预演同步'))
  await finish(old, plan('old-instance'))
  expect(panel().textContent).toContain('new-instance'); expect(panel().textContent).not.toContain('old-instance')
})
it('failed previews unlock the controls and keep the previous snapshot for inspection', async () => {
  await render(); await click(button('预演同步'))
  planRequest = () => { throw new Error('preview unavailable') }
  await click(button('重新预演'))
  expect(button('预演同步').disabled).toBe(false); expect(panel().textContent).toContain('initial')
  expect(panel().textContent).toContain('此计划已失效'); expect(calls('/api/sync/plan')).toHaveLength(2)
  expect(mutations()).toHaveLength(0)
})
it('duplicate preview clicks remain single-flight with a separate stop-wait control', async () => {
  await render(); const pending = hangPreview(); await click(button('预演同步'))
  await click(button('预演中…')); expect(calls('/api/sync/plan')).toHaveLength(1)
  await click(button('停止等待预演')); await finish(pending, plan('ignored'))
  expect(panel()).toBeNull(); expect(mutations()).toHaveLength(0)
})
it('the preview deadline and stop-wait action never apply to an executing write', async () => {
  const pending = deferred(); runRequest = () => pending.promise
  await render(); await click(button('执行同步')); await tick(SYNC_PLAN_READ_TIMEOUT_MS + 1)
  expect(button('同步中…')).toBeTruthy(); expect(button('停止等待预演')).toBeUndefined()
  expect(api).toHaveBeenCalledWith('/api/sync/run', { method: 'POST', body: '{}' })
  expect(calls('/api/sync/run')).toHaveLength(1); expect(toast.error).not.toHaveBeenCalled()
  await finish(pending, { plan: plan('actual-run'), conflicts: 0 })
  expect(panel().textContent).toContain('执行时计划（历史）')
})
