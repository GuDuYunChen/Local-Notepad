import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import SyncConflictReview from './SyncConflictReview'
import { conflictFixture, fileRecord, settingsFixture, statusFixture } from '../../scripts/fixtures/sync-conflict-review.mjs'
import { conflictScope } from '~/services/syncConflictReview.mjs'
let container, root, onResolve, onRefresh, actEnvironment
const scope = conflictScope(settingsFixture, statusFixture)
const fixture = (a = '前\n甲\n中\n乙\n尾', b = '前\nA\n中\nB\n尾', extra = {}) => conflictFixture({ local_record: fileRecord(a), remote_record: fileRecord(b), ...extra })
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
const table = () => container.querySelector('[aria-label="正文差异行"]')
const panel = () => container.querySelector('[aria-label="正文差异定位"]')
const input = type => container.querySelector(`input[type="${type}"]`)
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
beforeEach(() => {
  actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  onResolve = vi.fn(async () => true); onRefresh = vi.fn(async () => true)
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); await flush() })
  container.remove(); globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment; vi.restoreAllMocks()
})
async function render(conflict = fixture(), target = scope, disabled = false) {
  await act(async () => { root.render(<SyncConflictReview conflict={conflict} scope={target} disabled={disabled} onResolve={onResolve} onRefresh={onRefresh}/>); await flush() })
}
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
async function expand(conflict = fixture()) {
  await render(conflict); await click(button('对照版本')); await click(button('查看正文差异'))
}
it('only computes and shows differences after an explicit click; opening never chooses a version', async () => {
  await render(); expect(panel()).toBeNull()
  await click(button('对照版本')); expect(table()).toBeNull()
  expect(button('查看正文差异').getAttribute('aria-expanded')).toBe('false')
  await click(button('查看正文差异'))
  expect(table()).not.toBeNull(); expect(button('收起正文差异').getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0)
  expect(input('checkbox').checked).toBe(false); expect(onResolve).not.toHaveBeenCalled(); expect(onRefresh).not.toHaveBeenCalled()
})
it('navigates to the next exact group, moves keyboard focus and never authorizes submission', async () => {
  await expand(); expect(table().textContent).toContain('甲'); expect(button('上一处差异').disabled).toBe(true)
  await click(button('下一处差异'))
  expect(table().textContent).toContain('乙'); expect(table().textContent).not.toContain('甲')
  expect(document.activeElement.textContent).toBe('第 2 / 2 处差异')
  expect(button('下一处差异').disabled).toBe(true); expect(button('确认处理此冲突').disabled).toBe(true)
  await click(button('上一处差异')); expect(table().textContent).toContain('甲'); expect(onResolve).not.toHaveBeenCalled()
})
it('closing and reopening the difference view resets navigation without replacing the review', async () => {
  await expand(); await click(button('下一处差异')); await click(button('收起正文差异'))
  expect(table()).toBeNull(); expect(document.activeElement).toBe(button('查看正文差异'))
  expect(container.querySelector('[aria-label="本机正文预览"]')).not.toBeNull()
  await click(button('查看正文差异')); expect(table().textContent).toContain('甲'); expect(onResolve).not.toHaveBeenCalled()
})
it('large groups paginate all rows with accurate ranges and a bounded DOM', async () => {
  await expand(fixture('', '新增\n'.repeat(155)))
  expect(table().querySelectorAll('tbody tr')).toHaveLength(60)
  expect(panel().textContent).toContain('第 1–60 条差异行，共 155 条')
  await click(button('下一页差异行')); await click(button('下一页差异行'))
  expect(table().querySelectorAll('tbody tr')).toHaveLength(35)
  expect(panel().textContent).toContain('第 121–155 条差异行，共 155 条')
  expect(table().querySelector('tbody tr:last-child td:nth-child(2)').textContent).toBe('155')
  expect(button('下一页差异行').disabled).toBe(true); expect(onResolve).not.toHaveBeenCalled()
})
it('labels line-ending-only differences and preserves whitespace in the actual pre nodes', async () => {
  await expand(fixture('  a\r\n', '  a\n'))
  expect([...table().querySelectorAll('pre')].map(node => node.textContent)).toEqual(['  a', '  a'])
  expect(table().textContent).toContain('换行 CRLF'); expect(table().textContent).toContain('换行 LF')
})
it('renders hostile markup as text, not executable HTML or clickable links', async () => {
  await expand(fixture('<img src=x onerror=alert(1)>', '<script>alert(2)</script>'))
  expect(table().querySelector('img,script,a,iframe')).toBeNull()
  expect(table().textContent).toContain('<img src=x onerror=alert(1)>')
})
it('keeps format-only differences explicit rather than claiming equal versions', async () => {
  const rich = format => JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: '相同文字', format }] }] } })
  await expand(fixture(rich(0), rich(1)))
  expect(table()).toBeNull(); expect(panel().textContent).toContain('可见文本相同，但正文原始数据不同')
  expect(button('确认处理此冲突').disabled).toBe(true)
})
it('does not label partial projections as a complete comparison or as zero differences', async () => {
  await expand(fixture('同'.repeat(12001) + '甲', '同'.repeat(12001) + '乙'))
  expect(table()).toBeNull(); expect(panel().textContent).toContain('本次不比较截取片段')
  expect(panel().textContent).not.toContain('共 0 处'); expect(button('下一处差异')).toBeUndefined()
})
it('does not offer text-diff controls for folders or missing versions', async () => {
  await render(fixture('', '', { local_record: fileRecord('', { is_folder: true }), remote_record: fileRecord('', { is_folder: true }) }))
  await click(button('对照版本')); expect(panel()).toBeNull()
  await render(fixture('', '存在', { local_record: null, local_hash: '' })); await click(button('重新对照'))
  expect(panel()).toBeNull(); expect(container.textContent).toContain('此端没有可供选择的版本')
})
it('an observed change keeps the old diff read-only and cannot revive consent after A-B-A', async () => {
  const original = fixture()
  await expand(original); await click(input('radio')); await click(input('checkbox'))
  expect(button('确认处理此冲突').disabled).toBe(false)
  await render(fixture('新正文', '新远端'))
  expect(panel().textContent).toContain('已失效的对照快照'); expect(table().textContent).toContain('甲')
  expect(button('确认处理此冲突').disabled).toBe(true); expect(input('checkbox').checked).toBe(false)
  await render(original); await click(button('下一处差异'))
  expect(button('确认处理此冲突').disabled).toBe(true); expect(onResolve).not.toHaveBeenCalled()
})
it('an explicit new review of the same ID drops all old difference content and navigation', async () => {
  await expand(); await click(button('下一处差异'))
  await render(fixture('新的本机', '新的远端'))
  await click(button('重新对照')); expect(table()).toBeNull()
  await click(button('查看正文差异'))
  expect(table().textContent).toContain('新的本机'); expect(table().textContent).not.toContain('乙')
  expect(panel().textContent).toContain('第 1 / 1 处差异'); expect(input('checkbox').checked).toBe(false)
})
it('difference navigation cannot bypass disabled state, scope revocation or the original submit path', async () => {
  const original = fixture()
  await expand(original); await click(input('radio')); await click(input('checkbox'))
  await render(original, scope, true); await click(button('下一处差异')); await click(button('确认处理此冲突'))
  expect(onResolve).not.toHaveBeenCalled()
  await render(original, scope, false); await click(button('确认处理此冲突'))
  expect(onResolve).toHaveBeenCalledTimes(1)
  expect(onResolve.mock.calls[0][0].local_record.file.content).toBe(original.local_record.file.content)
  expect(onResolve.mock.calls[0][1]).toBe('local')
})
it('changing the saved target makes the visible difference snapshot stale without sending a write', async () => {
  const original = fixture(); await expand(original)
  await render(original, conflictScope({ ...settingsFixture, sync_provider: 'webdav', sync_endpoint: 'https://example.test' }, statusFixture))
  expect(panel().textContent).toContain('已失效的对照快照'); expect(button('确认处理此冲突').disabled).toBe(true)
  expect(onResolve).not.toHaveBeenCalled()
})
it('different conflict cards keep navigation and expanded state independent', async () => {
  await act(async () => { root.render(<><SyncConflictReview conflict={fixture()} scope={scope} onResolve={onResolve}/><SyncConflictReview conflict={fixture('第二本机', '第二远端', { id: 'c2' })} scope={scope} onResolve={onResolve}/></>); await flush() })
  const articles = container.querySelectorAll('article')
  for (const article of articles) {
    await click([...article.querySelectorAll('button')].find(node => node.textContent === '对照版本'))
    await click([...article.querySelectorAll('button')].find(node => node.textContent === '查看正文差异'))
  }
  await click(button('下一处差异'))
  expect(articles[0].querySelector('table').textContent).toContain('乙')
  expect(articles[1].querySelector('table').textContent).toContain('第二本机')
  expect(new Set([...container.querySelectorAll('[aria-controls]')].map(node => node.getAttribute('aria-controls'))).size).toBe(2)
  expect(onResolve).not.toHaveBeenCalled()
})
