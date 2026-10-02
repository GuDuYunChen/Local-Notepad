import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Queue from './SyncConflictQueue'
import { queueFixture, queueSettings, queueStatus } from '../../scripts/fixtures/sync-conflict-queue.mjs'
import { tombstone } from '../../scripts/fixtures/sync-conflict-risk.mjs'
import { conflictScope } from '~/services/syncConflictReview.mjs'
let root, container, conflicts, resolve, refresh, props, actEnvironment
const scope = conflictScope(queueSettings, queueStatus)
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
const field = label => container.querySelector('[aria-label="' + label + '"]')
const cards = () => [...container.querySelectorAll('[data-conflict-id]')].map(node => node.dataset.conflictId)
async function render() { await act(async () => { root.render(<Queue conflicts={conflicts} scope={scope} onResolve={resolve} onRefresh={refresh} {...props}/>); await flush() }) }
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
function dispatchChange(node, value) {
  const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
  node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
}
async function change(label, value) { await act(async () => { dispatchChange(field(label), value); await flush() }) }
beforeEach(() => {
  actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  conflicts = queueFixture(25); resolve = vi.fn().mockResolvedValue(true); refresh = vi.fn().mockResolvedValue(true); props = {}
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() }); container.remove()
  globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment; vi.restoreAllMocks()
})
it('preserves server order on mount, with honest chronology and no automatic operation', async () => {
  await render(); expect(field('冲突查看顺序').value).toBe('server')
  expect(cards()[0]).toBe('conflict-001'); expect(cards()).toHaveLength(10)
  expect(container.textContent).toContain('不代表正文更新或版本优劣')
  expect(container.textContent).toContain('UTC'); expect(resolve).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})
it('attention-first brings flagged records forward but preserves all records and full-list counts', async () => {
  conflicts[12].remote_record = tombstone(conflicts[12].remote_record)
  conflicts[24].local_record.file.is_deleted = true
  await render(); await change('冲突查看顺序', 'attention')
  expect(cards().slice(0, 3)).toEqual(['conflict-013', 'conflict-025', 'conflict-001'])
  expect(container.textContent).toContain('当前列表 25 条'); expect(field('冲突关注项').textContent).toContain('含回收站（1）')
  expect(resolve).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})
it('newest and oldest are selectable without turning timestamp order into version choice', async () => {
  await render(); await change('冲突查看顺序', 'oldest'); expect(cards()[0]).toBe('conflict-025')
  await change('冲突查看顺序', 'newest'); expect(cards()[0]).toBe('conflict-001')
  expect(container.querySelector('[aria-label="冲突版本对照"]')).toBeNull(); expect(resolve).not.toHaveBeenCalled()
})
it('sorting displays missing dates honestly and puts them after known dates in either direction', async () => {
  conflicts = queueFixture(3); conflicts[0].created_at = null
  await render(); await change('冲突查看顺序', 'oldest')
  expect(cards()).toEqual(['conflict-003', 'conflict-002', 'conflict-001'])
  expect(container.textContent).toContain('时间未提供或无效')
  await change('冲突查看顺序', 'newest'); expect(cards()).toEqual(['conflict-002', 'conflict-003', 'conflict-001'])
})
it('edge navigation reaches the final item in one action and returns focus to the heading', async () => {
  await render(); expect(button('首页冲突').disabled).toBe(true)
  await click(button('末页冲突')); expect(cards()).toHaveLength(5); expect(cards().at(-1)).toBe('conflict-025')
  expect(document.activeElement.textContent).toBe('冲突中心'); expect(button('末页冲突').disabled).toBe(true)
  await click(button('首页冲突')); expect(cards()[0]).toBe('conflict-001')
  expect(resolve).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})
it('changing order resets the page and closes old acknowledged reviews, even after order A-B-A', async () => {
  await render(); await click(button('末页冲突')); await click(button('保留本机'))
  await click(container.querySelector('input[type="checkbox"]')); expect(button('确认处理此冲突').disabled).toBe(false)
  await change('冲突查看顺序', 'oldest')
  expect(container.querySelector('[aria-label="冲突版本对照"]')).toBeNull(); expect(container.textContent).toContain('第 1 / 3 页')
  await change('冲突查看顺序', 'server'); await click(button('末页冲突')); await click(button('保留本机'))
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(false)
  expect(button('确认处理此冲突').disabled).toBe(true); expect(resolve).not.toHaveBeenCalled()
})
it('a same-turn sort after submission is blocked before React rerenders', async () => {
  let finish; resolve.mockImplementation(() => new Promise(r => { finish = r }))
  await render(); await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  const selector = field('冲突查看顺序')
  await act(async () => { button('确认处理此冲突').click(); dispatchChange(selector, 'oldest'); await flush() })
  expect(selector.value).toBe('server'); expect(selector.disabled).toBe(true); expect(button('末页冲突').disabled).toBe(true)
  expect(resolve).toHaveBeenCalledTimes(1); expect(resolve.mock.calls[0][0].id).toBe('conflict-001')
  await act(async () => { finish(false); await flush() })
})
it('busy locks sort and edge controls while stale display still permits read-only ordering', async () => {
  props.busy = true; await render()
  expect(field('冲突查看顺序').disabled).toBe(true); expect(button('末页冲突').disabled).toBe(true)
  props.busy = false; props.disabled = true; await render(); await change('冲突查看顺序', 'oldest')
  expect(cards()[0]).toBe('conflict-025'); expect(button('保留本机').disabled).toBe(true)
  expect(resolve).not.toHaveBeenCalled()
})
it('clearing filters keeps the explicit view order and returns to the first page', async () => {
  await render(); await change('冲突查看顺序', 'oldest'); await change('搜索冲突', '001')
  expect(cards()).toEqual(['conflict-001']); await click(button('清空筛选'))
  expect(field('冲突查看顺序').value).toBe('oldest'); expect(cards()[0]).toBe('conflict-025')
  expect(container.textContent).toContain('第 1 / 3 页'); expect(resolve).not.toHaveBeenCalled()
})
it('unchanged refresh keeps explicit order and valid consent for the same visible record', async () => {
  conflicts = queueFixture(2); await render(); await change('冲突查看顺序', 'oldest')
  await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  conflicts = structuredClone(conflicts); await render()
  expect(field('冲突查看顺序').value).toBe('oldest'); expect(container.querySelector('input[type="checkbox"]').checked).toBe(true)
  expect(button('确认处理此冲突').disabled).toBe(false); expect(resolve).not.toHaveBeenCalled()
})
it('sorted rows pass the actual original conflict and original side to the resolver', async () => {
  const original = JSON.stringify(conflicts)
  await render(); await change('冲突查看顺序', 'oldest'); await click(button('采用远端'))
  await click(container.querySelector('input[type="checkbox"]')); await click(button('确认处理此冲突'))
  expect(resolve).toHaveBeenCalledTimes(1); expect(resolve.mock.calls[0][0].id).toBe('conflict-025')
  expect(resolve.mock.calls[0][0].remote_record.file.content).toBe('远端正文 025'); expect(resolve.mock.calls[0][1]).toBe('remote')
  expect(JSON.stringify(conflicts)).toBe(original)
})
it('empty and single-page results disable both edge controls without claiming convergence', async () => {
  conflicts = []; await render(); expect(button('首页冲突').disabled).toBe(true); expect(button('末页冲突').disabled).toBe(true)
  expect(container.textContent).toContain('不代表两端已经完成同步')
  conflicts = queueFixture(1); await render(); await change('搜索冲突', 'missing')
  expect(button('末页冲突').disabled).toBe(true); expect(container.textContent).toContain('不代表冲突已解决')
})
it('a shrinking then refilling sorted list does not silently jump back to a removed page', async () => {
  await render(); await change('冲突查看顺序', 'oldest'); await click(button('末页冲突'))
  conflicts = queueFixture(2); await render(); expect(container.textContent).toContain('第 1 / 1 页')
  conflicts = queueFixture(25); await render(); expect(container.textContent).toContain('第 1 / 3 页')
  expect(cards()[0]).toBe('conflict-025'); expect(resolve).not.toHaveBeenCalled()
})
it('unknown lifecycle sorted to the beginning remains non-actionable', async () => {
  conflicts = queueFixture(2); conflicts[1].status = 'resolved'
  await render(); await change('冲突查看顺序', 'attention')
  const first = container.querySelector('[data-conflict-id]')
  expect(first.dataset.conflictId).toBe('conflict-002'); expect(first.querySelector('button')).toBeNull()
  expect(first.textContent).toContain('记录未确认处于待处理状态'); expect(resolve).not.toHaveBeenCalled()
})
