import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Queue from './SyncConflictQueue'
import { queueFixture, queueSettings, queueStatus } from '../../scripts/fixtures/sync-conflict-queue.mjs'
import { riskFixture, tombstone } from '../../scripts/fixtures/sync-conflict-risk.mjs'
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
  conflicts = riskFixture(); resolve = vi.fn().mockResolvedValue(true); refresh = vi.fn().mockResolvedValue(true); props = {}
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() }); container.remove()
  globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment; vi.restoreAllMocks()
})
it('labels side-specific deletion, recycling and missing snapshots before opening reviews', async () => {
  await render()
  expect(container.textContent).toContain('远端：永久删除'); expect(container.textContent).toContain('本机：在回收站')
  expect(container.textContent).toContain('版本快照缺失（不等于删除）'); expect(container.textContent).toContain('本机：状态待核实')
  expect(container.querySelector('[aria-label="冲突版本对照"]')).toBeNull()
  expect(resolve).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})
it('shows overlapping counts with an explicit caveat and combines all three filters', async () => {
  await render(); expect(field('冲突关注项').textContent).toContain('含永久删除（3）')
  expect(field('冲突关注项').textContent).toContain('含回收站（2）')
  expect(container.textContent).toContain('各类关注项可能重叠')
  await change('冲突关注项', 'permanent'); await change('冲突对象类型', 'attachment'); await change('搜索冲突', '资料😀')
  expect(cards()).toEqual(['attachment-conflict'])
  expect(field('冲突关注项').textContent).toContain('含永久删除（3）')
  expect(resolve).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})
it('clears every condition together and resets page without handling a conflict', async () => {
  await render(); await change('冲突关注项', 'permanent'); await change('冲突对象类型', 'attachment')
  expect(cards()).toHaveLength(1); await click(button('清空筛选'))
  expect(field('冲突关注项').value).toBe('all'); expect(field('冲突对象类型').value).toBe('all'); expect(cards()).toHaveLength(7)
  expect(button('清空筛选').disabled).toBe(true); expect(resolve).not.toHaveBeenCalled()
})
it('changing concern revokes a previous review even when the same record is still visible', async () => {
  conflicts = [riskFixture()[1]]; await render(); await click(button('保留本机'))
  await click(container.querySelector('input[type="checkbox"]')); expect(button('确认处理此冲突').disabled).toBe(false)
  await change('冲突关注项', 'permanent'); expect(container.querySelector('[aria-label="冲突版本对照"]')).toBeNull()
  await change('冲突关注项', 'all'); await click(button('保留本机'))
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(false)
  expect(button('确认处理此冲突').disabled).toBe(true); expect(resolve).not.toHaveBeenCalled()
})
it('an unchanged refresh retains valid explicit consent instead of behaving like user browsing', async () => {
  conflicts = [riskFixture()[1]]; await render(); await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  conflicts = structuredClone(conflicts); await render()
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true)
  expect(button('确认处理此冲突').disabled).toBe(false); expect(resolve).not.toHaveBeenCalled()
})
it('pending submission blocks a same-turn risk-filter change and preserves the original review', async () => {
  let finish; resolve.mockImplementation(() => new Promise(r => { finish = r }))
  conflicts = [riskFixture()[1]]; await render(); await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  const selector = field('冲突关注项')
  await act(async () => { button('确认处理此冲突').click(); dispatchChange(selector, 'missing'); await flush() })
  expect(resolve).toHaveBeenCalledTimes(1); expect(selector.value).toBe('all'); expect(selector.disabled).toBe(true)
  expect(cards()).toEqual(['conflict-002'])
  await act(async () => { finish(false); await flush() })
})
it('stale or unsaved state still permits inspection but never re-enables resolution', async () => {
  props.disabled = true; await render(); await change('冲突关注项', 'permanent')
  expect(cards()).toHaveLength(3); expect(button('保留本机').disabled).toBe(true)
  expect(resolve).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})
it('busy state disables concern controls just like existing type/search controls', async () => {
  props.busy = true; await render(); expect(field('冲突关注项').disabled).toBe(true)
  expect(field('冲突对象类型').disabled).toBe(true); expect(field('搜索冲突').disabled).toBe(true)
})
it('filtered pagination reaches the final risky record and resets on another filter', async () => {
  conflicts = queueFixture(25); conflicts.forEach(c => { c.remote_record = tombstone(c.remote_record) })
  await render(); await change('冲突关注项', 'permanent'); await click(button('下一页冲突')); await click(button('下一页冲突'))
  expect(cards()).toHaveLength(5); expect(cards().at(-1)).toBe('conflict-025')
  await change('冲突关注项', 'missing'); expect(cards()).toHaveLength(0)
  expect(container.textContent).toContain('没有匹配的冲突，不代表冲突已解决')
  expect(container.textContent).toContain('第 1 / 1 页'); expect(resolve).not.toHaveBeenCalled()
})
it('refreshed metadata recomputes concern counts and cannot resurrect a missing review', async () => {
  conflicts = queueFixture(1); await render(); await change('冲突关注项', 'permanent'); expect(cards()).toHaveLength(0)
  conflicts = [{ ...conflicts[0], remote_record: tombstone(conflicts[0].remote_record) }]; await render()
  expect(cards()).toHaveLength(1); expect(field('冲突关注项').textContent).toContain('含永久删除（1）')
  expect(container.querySelector('[aria-label="冲突版本对照"]')).toBeNull(); expect(resolve).not.toHaveBeenCalled()
})
it('unknown lifecycle status remains non-actionable even through concern filtering', async () => {
  conflicts = queueFixture(1); conflicts[0].status = 'resolved'; await render(); await change('冲突关注项', 'unknown')
  expect(cards()).toHaveLength(1); expect(button('保留本机')).toBeUndefined()
  expect(container.textContent).toContain('记录未确认处于待处理状态'); expect(resolve).not.toHaveBeenCalled()
})
it('risk browsing cannot change the object or direction passed to the existing explicit resolver', async () => {
  conflicts = [riskFixture()[1]]; const original = JSON.stringify(conflicts)
  await render(); await change('冲突关注项', 'permanent'); await click(button('采用远端'))
  expect(resolve).not.toHaveBeenCalled(); await click(container.querySelector('input[type="checkbox"]')); await click(button('确认处理此冲突'))
  expect(resolve).toHaveBeenCalledTimes(1); expect(resolve.mock.calls[0][0].id).toBe('conflict-002')
  expect(resolve.mock.calls[0][1]).toBe('remote'); expect(JSON.stringify(conflicts)).toBe(original)
})
