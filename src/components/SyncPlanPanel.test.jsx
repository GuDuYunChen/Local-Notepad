import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import SyncPlanPanel from './SyncPlanPanel'
import { captureSyncPlan, invalidateSyncPlan } from '~/services/syncPlanView.mjs'
import { makePlan, manyPlan } from '../../scripts/fixtures/sync-plan-view.mjs'
let container, root, actEnvironment
const at = 1790400000000
const capture = raw => captureSyncPlan(raw, 'preview', at)
beforeEach(() => {
  actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment
  vi.restoreAllMocks()
})
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
async function click(node) { expect(node).toBeTruthy(); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
async function render(snapshot, props = {}) { await act(async () => root.render(<SyncPlanPanel snapshot={snapshot} {...props}/>)) }
async function change(label, value) {
  await act(async () => {
    const node = container.querySelector('[aria-label="' + label + '"]')
    const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
it('is absent without a snapshot and never calls the supplied action on mount', async () => {
  const onPreview = vi.fn(); await render(null, { onPreview }); expect(container.textContent).toBe(''); expect(onPreview).not.toHaveBeenCalled()
})
it('shows precise summary, directional caveats and snapshot provenance', async () => {
  await render(capture(makePlan()))
  expect(container.textContent).toContain('预演快照（只读）'); expect(container.textContent).toContain('上传 1 · 下载 0 · 冲突 0 · 无变化 0')
  expect(container.textContent).toContain('执行同步会重新计算'); expect(container.textContent).toContain('方向不代表新增、编辑或删除')
  expect(container.textContent).toContain('笔记 / 文件夹'); expect(container.textContent).toContain('note-a')
})
it('can inspect first and last of 65 items without rendering more than 20 rows', async () => {
  await render(capture(manyPlan()))
  expect(container.querySelectorAll('li')).toHaveLength(20); expect(container.textContent).toContain('note-001')
  for (let i = 0; i < 3; i++) await click(button('下一页'))
  expect(container.querySelectorAll('li')).toHaveLength(5); expect(container.textContent).toContain('note-065')
  expect(container.textContent).toContain('第 4 / 4 页'); expect(button('下一页').disabled).toBe(true)
  await click(button('上一页')); expect(container.textContent).toContain('第 3 / 4 页')
})
it('filters all four directions and resets pagination when searching', async () => {
  const raw = manyPlan(); raw.items.push({ id: 'unchanged', action: 'noop' }); raw.noops++
  await render(capture(raw)); await click(button('下一页'))
  await change('同步计划搜索', 'note-065')
  expect(container.querySelectorAll('li')).toHaveLength(1); expect(container.textContent).toContain('第 1 / 1 页')
  await change('同步计划搜索', ''); await change('同步计划方向', 'noop')
  expect(container.textContent).toContain('unchanged'); expect(container.textContent).toContain('匹配 1 / 全部 66')
  await change('同步计划方向', 'all'); expect(container.textContent).toContain('匹配 66 / 全部 66')
})
it('makes missing details and invalid details visible without inventing an empty list', async () => {
  await render(capture({ ...makePlan(), items: undefined }))
  expect(container.textContent).toContain('仅为服务端汇总'); expect(container.querySelector('ul')).toBeNull()
  await render(capture({ ...makePlan(), uploads: 9 }))
  expect(container.querySelector('[role="alert"]')).toBeTruthy(); expect(container.textContent).not.toContain('上传 9')
  expect(container.textContent).not.toContain('未包含对象')
})
it('distinguishes no changed objects from an actually empty plan and a search miss', async () => {
  await render(capture(makePlan([{ id: 'unchanged', action: 'noop' }])))
  expect(container.textContent).toContain('没有变化或冲突')
  await change('同步计划方向', 'all'); await change('同步计划搜索', 'missing')
  expect(container.textContent).toContain('不代表整个计划为空')
  await change('同步计划搜索', ''); await render(capture({ ...makePlan([]), items: null }))
  expect(container.textContent).toContain('该次计划未包含对象')
})
it('renders hostile identifiers as inert text, never as markup or links', async () => {
  const id = '<img src=x onerror="alert(1)">'
  await render(capture(makePlan([{ id, action: 'upload' }])))
  expect(container.textContent).toContain(id); expect(container.querySelector('img,script,a')).toBeNull()
})
it('shows Unicode attachment filename and allows reading its exact opaque ID', async () => {
  const id = 'attachment:' + Buffer.from('资料😀.pdf').toString('hex')
  await render(capture(makePlan([{ id, action: 'download' }])))
  expect(container.textContent).toContain('资料😀.pdf'); expect(container.querySelector('summary').textContent).toBe('查看对象编号')
  expect(container.querySelector('code').textContent).toBe(id)
})
it('invalidation retains current page and the old captured content', async () => {
  const snapshot = capture(manyPlan())
  await render(snapshot); await click(button('下一页')); await render(invalidateSyncPlan(snapshot))
  expect(container.textContent).toContain('此计划已失效'); expect(container.textContent).toContain('第 2 / 4 页')
  expect(container.textContent).toContain('note-021')
})
it('labels run plan and first initialization as history rather than future work', async () => {
  await render(captureSyncPlan({ ...makePlan(), needs_init: true }, 'run', at))
  expect(container.textContent).toContain('执行时计划（历史）'); expect(container.textContent).toContain('不是剩余任务或实际写入数量')
  expect(container.textContent).toContain('该次计划读取时，远端尚未初始化'); expect(container.textContent).not.toContain('首次执行才会')
})
it('repreviews only through an explicit enabled button, with no side-selection controls', async () => {
  const onPreview = vi.fn(); const snapshot = capture(makePlan())
  await render(snapshot, { onPreview, disabled: true }); await click(button('重新预演')); expect(onPreview).not.toHaveBeenCalled()
  await render(snapshot, { onPreview }); await click(button('重新预演')); expect(onPreview).toHaveBeenCalledTimes(1)
  expect(button('执行同步')).toBeUndefined(); expect(container.querySelector('input[type="checkbox"]')).toBeNull()
})
