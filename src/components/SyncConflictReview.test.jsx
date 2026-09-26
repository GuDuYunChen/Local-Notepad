import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import SyncConflictReview from './SyncConflictReview'
import { conflictScope } from '~/services/syncConflictReview.mjs'
import { conflictFixture, fileRecord, settingsFixture, statusFixture } from '../../scripts/fixtures/sync-conflict-review.mjs'

let container, root, conflict, scope, resolve, refresh, extra, originalAct
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const button = value => [...container.querySelectorAll('button')].find(node => node.textContent === value)
const checkbox = () => container.querySelector('input[type="checkbox"]')
const radio = index => container.querySelectorAll('input[type="radio"]')[index]
async function render() { await act(async () => { root.render(<SyncConflictReview conflict={conflict} scope={scope} onResolve={resolve} onRefresh={refresh} {...extra}/>); await flush() }) }
async function click(node) { expect(node).toBeTruthy(); await act(async () => { node.click(); await flush() }) }
beforeEach(() => {
  originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  conflict = conflictFixture(); scope = conflictScope(settingsFixture, statusFixture)
  resolve = vi.fn().mockResolvedValue(true); refresh = vi.fn().mockResolvedValue(true); extra = {}
})
afterEach(async () => {
  await act(async () => { root.unmount(); await flush() }); container.remove()
  globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct; vi.restoreAllMocks()
})

it('mount and opening comparison do not submit or choose a version', async () => {
  await render(); expect(resolve).not.toHaveBeenCalled(); await click(button('对照版本'))
  expect(container.textContent).toContain('本机正文'); expect(container.textContent).toContain('远端正文')
  expect(radio(0).checked).toBe(false); expect(radio(1).checked).toBe(false)
  expect(button('确认处理此冲突').disabled).toBe(true); expect(resolve).not.toHaveBeenCalled()
})
it('existing local shortcut opens comparison, requires acknowledgement and final confirmation', async () => {
  await render(); await click(button('保留本机'))
  expect(resolve).not.toHaveBeenCalled(); expect(radio(0).checked).toBe(true)
  expect(button('确认处理此冲突').disabled).toBe(true)
  await click(checkbox()); await click(button('确认处理此冲突'))
  expect(resolve).toHaveBeenCalledTimes(1)
  expect(resolve.mock.calls[0][1]).toBe('local'); expect(resolve.mock.calls[0][0].local_record.file.content).toBe('本机正文')
  expect(container.textContent).toContain('处理请求已完成'); expect(button('保留本机').disabled).toBe(true)
})
it('remote selection makes the write direction explicit and still requires confirmation', async () => {
  await render(); await click(button('采用远端'))
  expect(container.textContent).toContain('将以远端版本更新本机'); expect(resolve).not.toHaveBeenCalled()
  await click(checkbox()); await click(button('确认处理此冲突')); expect(resolve.mock.calls[0][1]).toBe('remote')
})
it('changing direction clears previously granted acknowledgement', async () => {
  await render(); await click(button('保留本机')); await click(checkbox()); expect(checkbox().checked).toBe(true)
  await click(radio(1)); expect(checkbox().checked).toBe(false); expect(button('确认处理此冲突').disabled).toBe(true)
})
it('closing comparison does not write and restores the original opener focus', async () => {
  await render(); const opener = button('保留本机'); await click(opener)
  expect(document.activeElement?.textContent).toBe('先对照，再确认处理')
  await click(button('收起对照')); expect(resolve).not.toHaveBeenCalled(); expect(document.activeElement).toBe(opener)
})
it('changed conflict keeps the old snapshot visibly stale and cannot reuse consent', async () => {
  await render(); await click(button('保留本机')); await click(checkbox())
  conflict = conflictFixture({ remote_hash: 'd'.repeat(64), remote_record: fileRecord('新的远端正文') }); await render()
  expect(button('确认处理此冲突').disabled).toBe(true); expect(container.textContent).toContain('旧对照不能提交')
  expect(container.querySelector('[aria-label="远端正文预览"]').textContent).toBe('远端正文')
  await click(button('重新对照')); expect(checkbox().checked).toBe(false); expect(radio(0).checked).toBe(false)
  expect(container.querySelector('[aria-label="远端正文预览"]').textContent).toBe('新的远端正文')
  expect(resolve).not.toHaveBeenCalled()
})
it('changed target invalidates an otherwise identical review', async () => {
  await render(); await click(button('采用远端')); await click(checkbox()); scope += 'changed'; await render()
  expect(button('确认处理此冲突').disabled).toBe(true); expect(container.textContent).toContain('同步目标已变化')
})
it('refresh reads only and clears acknowledgement rather than approving the new snapshot', async () => {
  await render(); await click(button('保留本机')); await click(checkbox()); await click(button('刷新冲突状态'))
  expect(refresh).toHaveBeenCalledTimes(1); expect(resolve).not.toHaveBeenCalled(); expect(checkbox().checked).toBe(false)
})
it('permanent and recycle-bin deletion are prominently distinguished', async () => {
  conflict.remote_record = { format: 'local-notepad-sync-record', version: 1, kind: 'file', id: 'n1', state: 'purged' }
  conflict.local_record.file.is_deleted = true
  await render(); await click(button('采用远端'))
  expect(container.textContent).toContain('已永久删除'); expect(container.textContent).toContain('在回收站')
  expect(container.textContent).toContain('所选版本是删除状态'); expect(resolve).not.toHaveBeenCalled()
})
it('missing side is unavailable instead of an implicitly blank document', async () => {
  conflict.local_record = null; conflict.local_hash = ''
  await render(); await click(button('保留本机'))
  expect(radio(0).disabled).toBe(true); expect(radio(0).checked).toBe(false)
  expect(container.textContent).toContain('缺失数据'); expect(button('确认处理此冲突').disabled).toBe(true)
})
it('malformed conflict is shown as an error and cannot open an actionable review', async () => {
  delete conflict.remote_hash; await render(); await click(button('保留本机'))
  expect(container.querySelector('[role="alert"]')).toBeTruthy(); expect(button('确认处理此冲突')).toBeUndefined()
  expect(resolve).not.toHaveBeenCalled()
})
it('hostile content and title render only as text, never as active HTML', async () => {
  conflict.local_record.file.title = '<svg onload="bad()">'
  conflict.local_record.file.content = '<img src=x onerror="bad()"><script>bad()</script>'
  await render(); await click(button('对照版本'))
  expect(container.textContent).toContain('<img src=x'); expect(container.querySelector('img,script,svg,iframe')).toBeNull()
})
it('double confirmation is single-flight and cannot change side while pending', async () => {
  let finish; resolve.mockImplementation(() => new Promise(r => { finish = r }))
  await render(); await click(button('保留本机')); await click(checkbox())
  const confirm = button('确认处理此冲突')
  await act(async () => { confirm.click(); confirm.click(); await flush() })
  expect(resolve).toHaveBeenCalledTimes(1); expect(button('核对并提交中…').disabled).toBe(true)
  expect(container.querySelector('fieldset').disabled).toBe(true)
  await act(async () => { finish(true); await flush() })
})
it('failure preserves the comparison, revokes consent and never retries automatically', async () => {
  resolve.mockRejectedValue(new Error('offline'))
  await render(); await click(button('采用远端')); await click(checkbox()); await click(button('确认处理此冲突'))
  expect(resolve).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('处理未确认')
  expect(checkbox().checked).toBe(false); expect(button('确认处理此冲突').disabled).toBe(true)
  expect(container.querySelector('[aria-label="远端正文预览"]').textContent).toBe('远端正文')
})
it('unmount revokes the guard used by the parent before a delayed read can write', async () => {
  let finish; resolve.mockImplementation(() => new Promise(r => { finish = r }))
  await render(); await click(button('保留本机')); await click(checkbox()); await click(button('确认处理此冲突'))
  const guard = resolve.mock.calls[0][2]; expect(guard()).toBe(true)
  await act(async () => { root.unmount(); await flush() }); root = createRoot(container)
  expect(guard()).toBe(false); await act(async () => { finish(false); await flush() })
})
it('disabled parent prevents opening or confirming a retained review', async () => {
  extra.disabled = true; await render(); expect(button('保留本机').disabled).toBe(true)
  extra.disabled = false; await render(); await click(button('保留本机')); await click(checkbox())
  extra.disabled = true; await render(); expect(button('确认处理此冲突').disabled).toBe(true); expect(resolve).not.toHaveBeenCalled()
})
it('large/partial previews disclose their limits without changing the source data', async () => {
  const content = '😀'.repeat(300000); conflict.local_record.file.content = content
  await render(); await click(button('对照版本'))
  expect(container.textContent).toContain('预览未包含全部内容'); expect(conflict.local_record.file.content).toBe(content)
})
