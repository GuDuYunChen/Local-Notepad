import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import SyncConflictQueue from './SyncConflictQueue'
import SyncCenterPanel from './SyncCenterPanel'
import { conflictScope } from '~/services/syncConflictReview.mjs'
import { api } from '~/services/api'
import { queueFixture, queueAttachment, queueSettings, queueStatus } from '../../scripts/fixtures/sync-conflict-queue.mjs'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('~/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let root, container, conflicts, resolve, refresh, scope, env
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
const field = label => container.querySelector(`[aria-label="${label}"]`)
const rows = () => [...container.querySelectorAll('[data-conflict-id]')]
const checkbox = () => container.querySelector('input[type="checkbox"]')
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
async function change(label, value) {
  await act(async () => {
    const node = field(label), proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); await flush()
  })
}
async function render(props = {}) {
  await act(async () => { root.render(<SyncConflictQueue conflicts={conflicts} scope={scope} onResolve={resolve} onRefresh={refresh} {...props}/>); await flush() })
}
beforeEach(() => {
  env = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  conflicts = queueFixture(); resolve = vi.fn().mockResolvedValue(true); refresh = vi.fn().mockResolvedValue(true)
  scope = conflictScope(queueSettings, queueStatus)
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); await flush() })
  container.remove(); globalThis.IS_REACT_ACT_ENVIRONMENT = env; vi.restoreAllMocks(); vi.clearAllMocks()
})

describe('real queue and review components', () => {
  it('renders at most ten cards, reaches the tail and moves explicit pagination focus', async () => {
    await render(); expect(rows()).toHaveLength(10); expect(rows()[0].dataset.conflictId).toBe('conflict-001')
    await click(button('下一页冲突')); await click(button('下一页冲突'))
    expect(rows()).toHaveLength(5); expect(rows().at(-1).dataset.conflictId).toBe('conflict-025')
    expect(button('下一页冲突').disabled).toBe(true); expect(document.activeElement.textContent).toBe('冲突中心')
    expect(resolve).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  })
  it('searches a remote title and attachment filename and composes type filters', async () => {
    conflicts.push(queueAttachment()); await render()
    await change('搜索冲突', '远端笔记 025'); expect(rows()).toHaveLength(1); expect(rows()[0].dataset.conflictId).toBe('conflict-025')
    await change('冲突对象类型', 'attachment'); expect(rows()).toHaveLength(0)
    expect(container.textContent).toContain('不代表冲突已解决')
    await change('搜索冲突', '资料😀'); expect(rows()).toHaveLength(1)
    await click(button('清空筛选')); expect(rows()).toHaveLength(10); expect(field('搜索冲突').value).toBe('')
    expect(resolve).not.toHaveBeenCalled()
  })
  it('closing a reviewed page by browsing and coming back never revives acknowledgement', async () => {
    await render(); await click(button('保留本机')); await click(checkbox())
    expect(button('确认处理此冲突').disabled).toBe(false)
    await click(button('下一页冲突')); await click(button('上一页冲突'))
    expect(checkbox()).toBeNull()
    await click(button('保留本机')); expect(checkbox().checked).toBe(false)
    expect(button('确认处理此冲突').disabled).toBe(true); expect(resolve).not.toHaveBeenCalled()
  })
  it('even a filter retaining the same ID closes its old review and diff', async () => {
    await render(); await click(button('保留本机')); await click(checkbox()); await click(button('查看正文差异'))
    await change('搜索冲突', '001'); expect(rows()).toHaveLength(1); expect(checkbox()).toBeNull()
    await click(button('清空筛选')); await click(button('保留本机'))
    expect(checkbox().checked).toBe(false); expect(container.querySelector('table')).toBeNull()
  })
  it('unchanged refresh preserves an active review but an observed change stays invalid after A-B-A', async () => {
    await render(); await click(button('保留本机')); await click(checkbox())
    conflicts = structuredClone(conflicts); await render(); expect(checkbox().checked).toBe(true)
    const original = structuredClone(conflicts)
    conflicts[0].remote_hash = 'd'.repeat(64); conflicts = [...conflicts]; await render()
    conflicts = original; await render()
    expect(checkbox().checked).toBe(false); expect(button('确认处理此冲突').disabled).toBe(true)
  })
  it('blocks filtering and pagination while an explicit resolution is pending, including same-turn clicks', async () => {
    let finish; resolve.mockImplementation(() => new Promise(r => { finish = r }))
    await render(); await click(button('保留本机')); await click(checkbox())
    const confirm = button('确认处理此冲突'), next = button('下一页冲突')
    await act(async () => { confirm.click(); next.click(); confirm.click(); await flush() })
    expect(resolve).toHaveBeenCalledTimes(1); expect(rows()[0].dataset.conflictId).toBe('conflict-001')
    expect(field('搜索冲突').disabled).toBe(true); expect(next.disabled).toBe(true)
    await act(async () => { finish(false); await flush() })
    expect(field('搜索冲突').disabled).toBe(false); expect(checkbox().checked).toBe(false)
  })
  it('still requires the real per-card acknowledgement and passes the captured ID and side', async () => {
    await render(); await change('搜索冲突', '025'); await click(button('采用远端'))
    expect(resolve).not.toHaveBeenCalled(); await click(checkbox()); await click(button('确认处理此冲突'))
    expect(resolve).toHaveBeenCalledTimes(1); expect(resolve.mock.calls[0][0].id).toBe('conflict-025')
    expect(resolve.mock.calls[0][1]).toBe('remote'); expect(typeof resolve.mock.calls[0][2]).toBe('function')
  })
  it('unmount revokes a pending old review guard; completion cannot update a later queue', async () => {
    let finish; resolve.mockImplementation(() => new Promise(r => { finish = r }))
    await render(); await click(button('保留本机')); await click(checkbox()); await click(button('确认处理此冲突'))
    const guard = resolve.mock.calls[0][2]; expect(guard()).toBe(true)
    await act(async () => { root.unmount(); root = createRoot(container); await flush() })
    expect(guard()).toBe(false); await render()
    await act(async () => { finish(true); await flush() }); expect(checkbox()).toBeNull()
  })
  it('clamps a shrinking last page and does not jump back on refill', async () => {
    await render(); await click(button('下一页冲突')); await click(button('下一页冲突'))
    conflicts = conflicts.slice(0, 12); await render()
    expect(rows()).toHaveLength(2); expect(container.textContent).toContain('第 2 / 2 页')
    conflicts = queueFixture(); await render(); expect(rows()[0].dataset.conflictId).toBe('conflict-011')
    expect(container.textContent).toContain('第 2 / 3 页')
  })
  it('invalid duplicate IDs show an error without any choice controls', async () => {
    conflicts[1].id = conflicts[0].id; await render()
    expect(field('冲突队列').querySelector('[role="alert"]')).not.toBeNull()
    expect(button('保留本机')).toBeUndefined(); expect(resolve).not.toHaveBeenCalled()
  })
  it('unknown status is visible but not actionable, and bad-looking titles stay text', async () => {
    conflicts = [queueAttachment()]; delete conflicts[0].status; await render()
    expect(container.textContent).toContain('资料😀.pdf'); expect(container.textContent).toContain('已永久删除')
    expect(button('保留本机')).toBeUndefined()
    conflicts = queueFixture(1); conflicts[0].local_record.file.title = '<img src=x onerror=alert(1)>'
    await render(); expect(container.textContent).toContain('<img'); expect(container.querySelector('img,script,iframe')).toBeNull()
  })
  it('busy locks browsing; stale or unsaved state permits inspection but not handling', async () => {
    await render({ busy: true }); expect(field('搜索冲突').disabled).toBe(true)
    await render({ disabled: true }); expect(field('搜索冲突').disabled).toBe(false)
    await change('搜索冲突', '025'); expect(rows()).toHaveLength(1); expect(button('保留本机').disabled).toBe(true)
  })
  it('a genuine empty list is not described as a completed sync', async () => {
    conflicts = []; await render(); expect(container.textContent).toContain('不代表两端已经完成同步')
    expect(rows()).toHaveLength(0); expect(resolve).not.toHaveBeenCalled()
  })
})

describe('sync center uses queue without changing the network contract', () => {
  let offline
  beforeEach(() => {
    offline = false
    api.mockImplementation(async (url, init) => {
      if (url === '/api/sync/activity') return null
      if (offline && !init?.method) throw new Error('offline')
      if (url === '/api/settings') return { ...queueSettings }
      if (url === '/api/sync/status') return { ...queueStatus, open_conflicts: conflicts.length }
      if (url === '/api/sync/conflicts') return [...conflicts]
      if (url.endsWith('/resolve')) return null
      return null
    })
  })
  const mountCenter = async () => act(async () => { root.render(<SyncCenterPanel/>); await flush() })
  const posts = () => api.mock.calls.filter(([, init]) => init?.method === 'POST')
  it('reads the real conflict list then filters locally; final confirmation posts only its exact ID', async () => {
    await mountCenter(); const initial = api.mock.calls.length
    await change('搜索冲突', '025'); expect(api.mock.calls.length).toBe(initial)
    await click(button('保留本机')); expect(posts()).toHaveLength(0)
    await click(checkbox()); await click(button('确认处理此冲突'))
    expect(posts()).toEqual([['/api/sync/conflicts/conflict-025/resolve', { method: 'POST', body: '{"choice":"local"}' }]])
  })
  it('the original server reread refuses a changed conflict after queue selection', async () => {
    await mountCenter(); await change('搜索冲突', '025'); await click(button('保留本机')); await click(checkbox())
    conflicts = structuredClone(conflicts); conflicts[24].remote_hash = 'e'.repeat(64)
    await click(button('确认处理此冲突')); expect(posts()).toHaveLength(0)
    expect(container.textContent).toContain('冲突或同步目标已变化')
  })
  it('a failed status refresh disables resolution while retaining searchable prior labels', async () => {
    await mountCenter(); offline = true; await click(button('刷新状态'))
    await change('搜索冲突', '025'); expect(rows()).toHaveLength(1)
    expect(button('保留本机').disabled).toBe(true); expect(posts()).toHaveLength(0)
  })
})
