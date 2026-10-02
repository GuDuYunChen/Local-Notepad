import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Queue from './SyncConflictQueue'
import { queueFixture, queueSettings, queueStatus } from '../../scripts/fixtures/sync-conflict-queue.mjs'
import { conflictScope } from '~/services/syncConflictReview.mjs'

let root, container, conflicts, resolve, refresh, props, actEnvironment
const scope = conflictScope(queueSettings, queueStatus)
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
const field = label => container.querySelector('[aria-label="' + label + '"]')
function dispatchChange(node, value) {
  const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
  node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
}
async function render(strict = false) {
  await act(async () => {
    const queue = <Queue conflicts={conflicts} scope={scope} onResolve={resolve} onRefresh={refresh} {...props}/>
    root.render(strict ? <React.StrictMode>{queue}</React.StrictMode> : queue); await flush()
  })
}
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
async function change(label, value) { await act(async () => { dispatchChange(field(label), value); await flush() }) }
async function ready() {
  await click(button('保留本机')); await click(container.querySelector('input[type="checkbox"]'))
  expect(button('确认处理此冲突').disabled).toBe(false)
  return button('确认处理此冲突')
}
beforeEach(() => {
  actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  conflicts = queueFixture(25); resolve = vi.fn().mockResolvedValue(true); refresh = vi.fn().mockResolvedValue(true); props = {}
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() }); container.remove()
  globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment; vi.restoreAllMocks()
})

const changes = [
  ['order', null, () => dispatchChange(field('冲突查看顺序'), 'oldest')],
  ['search', null, () => dispatchChange(field('搜索冲突'), '001')],
  ['kind', null, () => dispatchChange(field('冲突对象类型'), 'file')],
  ['risk', null, () => dispatchChange(field('冲突关注项'), 'attention')],
  ['clear', () => change('搜索冲突', '0'), () => button('清空筛选').click()],
  ['next', null, () => button('下一页冲突').click()],
  ['last', null, () => button('末页冲突').click()],
  ['previous', () => click(button('下一页冲突')), () => button('上一页冲突').click()],
  ['first', () => click(button('末页冲突')), () => button('首页冲突').click()],
]
for (const [name, setup, browse] of changes) it(`REGRESSION_BROWSE: ${name} first must revoke old confirmation before React commits`, async () => {
  conflicts[0].local_record.file.is_deleted = true
  await render(); await setup?.(); const oldConfirm = await ready()
  // Deliberately no flush between the two real DOM events.
  await act(async () => { browse(); oldConfirm.click(); await flush() })
  expect(resolve, 'REGRESSION_BROWSE: a revoked old card reached the resolver').not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  expect(container.querySelector('[aria-label="冲突版本对照"]')).toBeNull()
})
it('A-B-A in one batch cannot revive a captured confirmation', async () => {
  await render(); const oldConfirm = await ready()
  await act(async () => {
    dispatchChange(field('冲突查看顺序'), 'oldest'); dispatchChange(field('冲突查看顺序'), 'server')
    oldConfirm.click(); await flush()
  })
  expect(resolve).not.toHaveBeenCalled(); expect(field('冲突查看顺序').value).toBe('server')
  await click(button('保留本机'))
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(false)
  expect(button('确认处理此冲突').disabled).toBe(true)
})
it('an explicit new review after navigation submits the correct sorted record once', async () => {
  await render(); await ready(); await change('冲突查看顺序', 'oldest')
  const confirm = await ready(); await click(confirm)
  expect(resolve).toHaveBeenCalledTimes(1); expect(resolve.mock.calls[0][0].id).toBe('conflict-025')
  expect(resolve.mock.calls[0][1]).toBe('local')
})
it('an identical refresh does not revoke still-valid confirmation', async () => {
  await render(); await ready(); conflicts = structuredClone(conflicts); await render()
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true)
  await click(button('确认处理此冲突')); expect(resolve).toHaveBeenCalledTimes(1)
})
it('submission first keeps the original request and blocks subsequent same-turn navigation', async () => {
  let finish; resolve.mockImplementation(() => new Promise(r => { finish = r }))
  await render(); const confirm = await ready(), selector = field('冲突查看顺序')
  await act(async () => { confirm.click(); dispatchChange(selector, 'oldest'); await flush() })
  expect(resolve).toHaveBeenCalledTimes(1); expect(resolve.mock.calls[0][0].id).toBe('conflict-001')
  expect(selector.value).toBe('server'); expect(selector.disabled).toBe(true)
  await act(async () => { finish(false); await flush() })
  expect(button('确认处理此冲突').disabled).toBe(true)
  expect(resolve).toHaveBeenCalledTimes(1)
})
it('StrictMode effect replay still permits a new explicit review and submission', async () => {
  await render(true); await change('冲突查看顺序', 'oldest'); await click(await ready())
  expect(resolve).toHaveBeenCalledTimes(1); expect(resolve.mock.calls[0][0].id).toBe('conflict-025')
})
it('stale display can still be browsed read-only without acquiring a write capability', async () => {
  props.disabled = true; await render(); await change('冲突查看顺序', 'oldest')
  expect(field('冲突查看顺序').value).toBe('oldest'); expect(button('保留本机').disabled).toBe(true)
  expect(resolve).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
})
