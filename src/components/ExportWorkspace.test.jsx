// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExportWorkspace from './ExportWorkspace'

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const makePlan = (requestId = 'request-1') => ({
  planId: 'plan-1', requestId, format: 'markdown', source: 'saved', state: 'prepared', phase: 'prepared', busy: false,
  canStart: false, canRetry: false, canReveal: false, canChooseDirectory: true, destination: '',
  items: ['one', 'two'].map(id => ({ id, title: '笔记 ' + id, relativePath: id + '.md', preview: '已保存正文 ' + id, status: 'ready', message: '', warnings: [] })),
  counts: { total: 2, ready: 2, running: 0, succeeded: 0, failed: 0, cancelled: 0 },
})
const snapshot = (value, statuses, phase = 'settled') => {
  const next = structuredClone(value)
  next.phase = phase; next.busy = ['running', 'choosing', 'cancelling'].includes(phase)
  next.state = next.busy ? 'running' : statuses.every(status => status === 'succeeded') ? 'completed' : statuses.includes('cancelled') ? 'cancelled' : 'partial'
  next.items.forEach((item, index) => {
    item.status = statuses[index]
    if (item.status === 'succeeded') Object.assign(item, { outputPath: 'C:\\Exports\\batch\\' + item.relativePath, bytes: 20, sha256: 'a'.repeat(64) })
    if (item.status === 'failed') item.message = '附件读取失败，请检查本地附件后重试。'
  })
  next.counts = { total: 2, ...Object.fromEntries(['ready', 'running', 'succeeded', 'failed', 'cancelled'].map(status => [status, statuses.filter(value => value === status).length])) }
  next.canStart = !next.busy && statuses.some(status => ['ready', 'cancelled'].includes(status))
  next.canRetry = !next.busy && statuses.includes('failed'); next.canReveal = true
  return next
}

describe('complete local document export workspace', () => {
  let host, root, opener, native, current, onClose, onReselect
  const query = selector => host.querySelector(selector)
  const button = label => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === label)
  const reply = () => ({ success: true, plan: structuredClone(current) })
  const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()) }
  const mount = async () => { await act(async () => root.render(<ExportWorkspace ids={['one', 'two']} onClose={onClose} onReselect={onReselect} />)) }
  const prepare = async () => { await click(query('[data-local-export-prepare]')) }
  const choose = async () => { await click(query('[data-local-export-choose]')) }
  beforeEach(() => {
    vi.useFakeTimers(); globalThis.IS_REACT_ACT_ENVIRONMENT = true
    opener = document.createElement('button'); opener.textContent = '导出入口'; document.body.append(opener); opener.focus()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    onClose = vi.fn(() => root.render(null)); onReselect = vi.fn()
    current = makePlan()
    native = {
      exportWorkspacePrepare: vi.fn(async input => { current = { ...makePlan(input.requestId), format: input.format }; return reply() }),
      exportWorkspaceChooseDirectory: vi.fn(async () => { current = { ...current, destination: 'C:\\Exports', canStart: true }; return reply() }),
      exportWorkspaceStart: vi.fn(async input => { current = snapshot(current, ['running', 'ready'], 'running'); current.requestId = input.requestId; return reply() }),
      exportWorkspaceRetry: vi.fn(async input => { current = snapshot(current, ['succeeded', 'running'], 'running'); current.requestId = input.requestId; return reply() }),
      exportWorkspaceStatus: vi.fn(async () => reply()),
      exportWorkspaceCancel: vi.fn(async () => { current = snapshot(current, ['succeeded', 'cancelled']); return reply() }),
      exportWorkspaceReveal: vi.fn(async () => reply()), exportWorkspaceRelease: vi.fn(async () => ({ success: true })),
    }
    window.electronAPI = native
  })
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); opener.remove()
    delete window.electronAPI; vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  it('explains the saved source and reads only after an explicit preview request', async () => {
    await mount(); expect(native.exportWorkspacePrepare).not.toHaveBeenCalled(); expect(host.textContent).toContain('不会保存或改动当前编辑草稿')
    await prepare(); expect(native.exportWorkspacePrepare).toHaveBeenCalledWith({ requestId: expect.any(String), ids: ['one', 'two'], format: 'markdown' })
    expect(query('[data-local-export-item="one"] pre').textContent).toBe('已保存正文 one')
    expect(native.exportWorkspaceStart).not.toHaveBeenCalled()
  })
  it('offers a clear desktop requirement without attempting native I/O', async () => {
    delete window.electronAPI; await mount(); expect(host.textContent).toContain('需要桌面客户端'); expect(query('[data-local-export-prepare]').disabled).toBe(true)
    await click(button('关闭')); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('retains the chosen content and format after a failed preview', async () => {
    native.exportWorkspacePrepare.mockResolvedValueOnce({ success: false, message: '笔记 two 读取失败' })
    await mount(); await click(query('input[value="docx"]')); await prepare()
    expect(host.textContent).toContain('笔记 two 读取失败'); expect(query('input[value="docx"]').checked).toBe(true)
    await prepare(); expect(native.exportWorkspacePrepare).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['one', 'two'], format: 'docx' }))
  })
  it('keeps the preview after a cancelled directory picker and permits a fresh choice', async () => {
    await mount(); await prepare()
    native.exportWorkspaceChooseDirectory.mockImplementationOnce(async () => ({ ...reply(), cancelled: true }))
    await choose(); expect(host.textContent).toContain('当前选择和预览均已保留'); expect(query('[data-local-export-item="one"]')).toBeTruthy()
    expect(query('[data-local-export-start]').disabled).toBe(true)
    await choose(); expect(query('[data-local-export-start]').disabled).toBe(false)
    expect(native.exportWorkspacePrepare).toHaveBeenCalledTimes(1)
  })
  it('releases an unused preview before changing formats', async () => {
    await mount(); await prepare(); await click(query('input[value="docx"]'))
    expect(native.exportWorkspaceRelease).toHaveBeenCalledWith({ planId: 'plan-1' }); expect(query('[data-local-export-item="one"]')).toBeNull()
    await prepare(); expect(current.format).toBe('docx')
  })
  it('sends one preparation while a double click is still awaiting the same read', async () => {
    const pending = deferred(); native.exportWorkspacePrepare.mockImplementation(input => { current = makePlan(input.requestId); return pending.promise })
    await mount(); await click(query('[data-local-export-prepare]')); await click(query('[data-local-export-prepare]'))
    expect(native.exportWorkspacePrepare).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(reply()))
  })
  it('reuses the same preparation request identity after a renderer timeout', async () => {
    const pending = deferred()
    native.exportWorkspacePrepare.mockImplementationOnce(input => {
      current = makePlan(input.requestId)
      return pending.promise
    })
    await mount()
    await prepare()
    const originalId = native.exportWorkspacePrepare.mock.calls[0][0].requestId
    await act(async () => { await vi.advanceTimersByTimeAsync(65000) })
    expect(host.textContent).toContain('等待桌面导出响应超时')
    expect(button('查回预览')).toBeTruthy()
    expect(native.exportWorkspaceCancel).not.toHaveBeenCalled()

    current = makePlan(originalId)
    await act(async () => pending.resolve(reply()))
    await click(button('查回预览'))
    expect(native.exportWorkspacePrepare).toHaveBeenCalledTimes(2)
    expect(native.exportWorkspacePrepare.mock.calls[1][0].requestId).toBe(originalId)
    expect(query('[data-local-export-item="one"]')).toBeTruthy()
    expect(button('关闭').disabled).toBe(false)
  })
  it('reuses the same preparation identity after the native response connection is lost', async () => {
    native.exportWorkspacePrepare.mockRejectedValueOnce(new Error('响应连接中断'))
    await mount()
    await prepare()
    const originalId = native.exportWorkspacePrepare.mock.calls[0][0].requestId
    expect(host.textContent).toContain('响应连接中断')
    expect(button('查回预览')).toBeTruthy()
    expect(native.exportWorkspaceCancel).not.toHaveBeenCalled()
    await click(button('查回预览'))
    expect(native.exportWorkspacePrepare).toHaveBeenCalledTimes(2)
    expect(native.exportWorkspacePrepare.mock.calls[1][0].requestId).toBe(originalId)
    expect(query('[data-local-export-item="one"]')).toBeTruthy()
    expect(button('关闭').disabled).toBe(false)
  })
  it('can cancel preparation using its original request identity', async () => {
    const pending = deferred(); native.exportWorkspacePrepare.mockImplementation(() => pending.promise)
    await mount(); await prepare(); await click(button('停止读取'))
    expect(native.exportWorkspaceCancel).toHaveBeenCalledWith(expect.objectContaining({ requestId: native.exportWorkspacePrepare.mock.calls[0][0].requestId }))
    await act(async () => pending.resolve({ success: false, message: '已停止读取' }))
    expect(query('[data-local-export-prepare]').disabled).toBe(false)
  })
  it('adopts per-item terminal results and retries only the failed operation', async () => {
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]'))
    current = snapshot(current, ['succeeded', 'failed']); await click(query('[data-local-export-status]'))
    expect(query('[data-local-export-item="one"]').dataset.status).toBe('succeeded')
    expect(host.textContent).toContain('附件读取失败'); expect(query('[data-local-export-retry]').disabled).toBe(false)
    await click(query('[data-local-export-retry]'))
    expect(native.exportWorkspaceStart).toHaveBeenCalledTimes(1); expect(native.exportWorkspaceRetry).toHaveBeenCalledTimes(1)
    current = snapshot(current, ['succeeded', 'succeeded']); await click(query('[data-local-export-status]'))
    expect(host.textContent).toContain('已导出 2'); expect(button('完成')).toBeTruthy()
  })
  it('keeps completed receipts when cancelling and explicitly continues remaining files', async () => {
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]'))
    expect(button('关闭').disabled).toBe(true); await click(query('[data-local-export-cancel]'))
    expect(query('[data-local-export-item="one"]').dataset.status).toBe('succeeded')
    expect(query('[data-local-export-item="two"]').dataset.status).toBe('cancelled')
    expect(query('[data-local-export-continue]')).toBeTruthy()
    native.exportWorkspaceStart.mockImplementationOnce(async () => { current = snapshot(current, ['succeeded', 'running'], 'running'); return reply() })
    await click(query('[data-local-export-continue]')); expect(native.exportWorkspaceStart).toHaveBeenCalledTimes(2)
    expect(native.exportWorkspaceRetry).not.toHaveBeenCalled()
  })
  it('does not replay a start whose response was lost; it first reads the native result', async () => {
    native.exportWorkspaceStart.mockRejectedValueOnce(new Error('响应连接中断'))
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]'))
    expect(button('关闭').disabled).toBe(true); expect(query('[data-local-export-start]').disabled).toBe(true)
    current = snapshot(current, ['succeeded', 'succeeded']); await click(query('[data-local-export-status]'))
    expect(button('完成').disabled).toBe(false); expect(native.exportWorkspaceStart).toHaveBeenCalledTimes(1)
  })
  it('stops an accepted start by plan identity when its new request identity was lost with the reply', async () => {
    native.exportWorkspaceStart.mockImplementationOnce(async input => {
      current = snapshot(current, ['running', 'ready'], 'running'); current.requestId = input.requestId
      throw new Error('开始请求已受理，但响应连接中断')
    })
    native.exportWorkspaceCancel.mockImplementationOnce(async input => {
      // Match the real adapter: a supplied stale request ID refuses cancellation.
      if (input.planId !== current.planId || (input.requestId && input.requestId !== current.requestId)) {
        return { success: false, code: 'export-not-found', message: '该导出操作已经结束或已被替换' }
      }
      current = snapshot(current, ['running', 'ready'], 'cancelling')
      return reply()
    })
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]'))
    expect(current.requestId).not.toBe(native.exportWorkspacePrepare.mock.calls[0][0].requestId)
    expect(button('关闭').disabled).toBe(true)
    await click(query('[data-local-export-cancel]'))
    expect(native.exportWorkspaceCancel).toHaveBeenLastCalledWith({ planId: 'plan-1' })
    expect(query('[data-local-export-workspace]').dataset.phase).toBe('cancelling')
    expect(button('关闭').disabled).toBe(true)
    current = snapshot(current, ['cancelled', 'cancelled'])
    await click(query('[data-local-export-status]'))
    expect(query('[data-local-export-continue]')).toBeTruthy()
    expect(button('关闭').disabled).toBe(false)
    expect(native.exportWorkspaceStart).toHaveBeenCalledTimes(1)
  })
  it('surfaces a native plan error from an explicit status response before any item starts', async () => {
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]'))
    const problem = '导出目录无法读取或创建，请检查权限及磁盘状态。'
    current = { ...snapshot(current, ['ready', 'ready']), code: 'invalid-destination', message: problem }
    await click(query('[data-local-export-status]'))
    expect(query('[data-local-export-feedback]').textContent).toContain(problem)
    expect([...host.querySelectorAll('[data-local-export-item]')].every(item => item.dataset.status === 'ready')).toBe(true)
    expect(button('关闭').disabled).toBe(false)
  })
  it('surfaces a polled terminal timeout even when all items are still ready', async () => {
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]'))
    const problem = '本次导出操作超过 60 秒，已停止；请减少所选内容后重试'
    current = { ...snapshot(current, ['ready', 'ready']), state: 'cancelled', code: 'export-timeout', message: problem }
    await act(async () => vi.advanceTimersByTimeAsync(750))
    expect(native.exportWorkspaceStatus).toHaveBeenCalledTimes(1)
    expect(query('[data-local-export-feedback]').textContent).toContain(problem)
    expect([...host.querySelectorAll('[data-local-export-item]')].every(item => item.dataset.status === 'ready')).toBe(true)
    expect(button('关闭').disabled).toBe(false)
  })
  it('honours a native directory lock even if cancellation left every item ready', async () => {
    await mount(); await prepare(); await choose()
    current = { ...snapshot(current, ['ready', 'ready']), state: 'cancelled', canChooseDirectory: false,
      exportDirectory: 'C:\\Exports\\Notepad-export-created' }
    await click(query('[data-local-export-status]'))
    expect(query('[data-local-export-choose]').disabled).toBe(true)
    await click(query('[data-local-export-choose]'))
    expect(native.exportWorkspaceChooseDirectory).toHaveBeenCalledTimes(1)
    expect(query('[data-local-export-start]').disabled).toBe(false)
  })
  it('rejects a foreign plan response without replacing the confirmed current preview', async () => {
    await mount(); await prepare(); await choose()
    native.exportWorkspaceStatus.mockResolvedValueOnce({ success: true, plan: { ...current, planId: 'foreign' } })
    await click(query('[data-local-export-status]')); expect(host.textContent).toContain('回执不完整或身份不匹配')
    expect(query('[data-local-export-item="one"]')).toBeTruthy(); expect(query('[data-local-export-start]').disabled).toBe(true)
    await click(query('[data-local-export-status]')); expect(query('[data-local-export-start]').disabled).toBe(false)
  })
  it('stops automatic reads after one polling error until the user asks to reconcile', async () => {
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]'))
    native.exportWorkspaceStatus.mockRejectedValueOnce(new Error('暂时无法查回'))
    await act(async () => vi.advanceTimersByTimeAsync(750)); await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(native.exportWorkspaceStatus).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('暂时无法查回')
    current = snapshot(current, ['succeeded', 'succeeded']); await click(query('[data-local-export-status]'))
    expect(button('完成')).toBeTruthy(); expect(native.exportWorkspaceStart).toHaveBeenCalledTimes(1)
  })
  it('stops status polling once all native file operations have settled', async () => {
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]'))
    current = snapshot(current, ['succeeded', 'succeeded']); await act(async () => vi.advanceTimersByTimeAsync(750))
    await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(native.exportWorkspaceStatus).toHaveBeenCalledTimes(1)
  })
  it('ignores late preparation after unmount and releases its native plan', async () => {
    const pending = deferred(); native.exportWorkspacePrepare.mockImplementation(input => { current = makePlan(input.requestId); return pending.promise })
    await mount(); await prepare(); await act(async () => root.render(null))
    expect(native.exportWorkspaceCancel).toHaveBeenCalledWith(expect.objectContaining({ requestId: current.requestId }))
    await act(async () => pending.resolve(reply())); expect(host.textContent).toBe('')
    expect(native.exportWorkspaceRelease).toHaveBeenCalledWith({ planId: 'plan-1' })
  })
  it('cancels and releases an active native plan when the workbench is unmounted', async () => {
    await mount(); await prepare(); await choose(); await click(query('[data-local-export-start]')); await act(async () => root.render(null))
    expect(native.exportWorkspaceCancel).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-1' }))
    expect(native.exportWorkspaceRelease).toHaveBeenCalledWith({ planId: 'plan-1' })
  })
  it('renders titles and previews as inert text', async () => {
    native.exportWorkspacePrepare.mockImplementation(async input => { current = makePlan(input.requestId); current.items[0].title = '<img src=x onerror=alert(1)>'; current.items[0].preview = '<script>window.bad=1</script>'; return reply() })
    await mount(); await prepare(); expect(host.querySelector('img, script')).toBeNull(); expect(host.textContent).toContain('<script>window.bad=1</script>')
  })
  it('keeps Escape within IME composition and restores the original focus after closing', async () => {
    await mount(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(onClose).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(opener)
  })
  it('keeps keyboard focus within the workbench', async () => {
    await mount(); button('关闭').focus()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(query('[aria-label="关闭导出工作台"]'))
  })
})
