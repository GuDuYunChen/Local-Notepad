import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspacePackagePanel from './WorkspacePackagePanel'

let container, root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  window.electronAPI = {
    workspaceExport: vi.fn(),
    workspaceInspect: vi.fn(),
    openAppFolder: vi.fn(),
  }
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.electronAPI
  vi.restoreAllMocks()
})

const pack = {
  format: 'local-notepad-workspace',
  version: 1,
  createdAt: '2026-09-24T12:00:00.000Z',
  appVersion: '4.182.0',
  size: 8192,
  sha256: 'a'.repeat(64),
  database: { files: 12, schemaVersion: 10, size: 4096, sha256: 'b'.repeat(64) },
  attachments: { count: 3, totalBytes: 2048 },
}
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text)
async function render() { await act(async () => root.render(<WorkspacePackagePanel />)) }
async function click(node) { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() }) }

describe('workspace portable package panel', () => {
  it('exports only after an explicit click and renders verified counts', async () => {
    window.electronAPI.workspaceExport.mockResolvedValue({ success: true, path: 'E:/Safe/workspace.lnw', package: pack })
    await render()
    expect(window.electronAPI.workspaceExport).not.toHaveBeenCalled()
    await click(button('导出工作区便携包'))
    expect(window.electronAPI.workspaceExport).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('逐文件 SHA-256 校验')
    expect(container.textContent).toContain('12 条记录')
    expect(container.textContent).toContain('schema 10')
    expect(container.textContent).toContain('附件：3 个')
    expect(container.textContent).toContain('E:/Safe/workspace.lnw')
  })

  it('inspects an existing package without claiming a restore', async () => {
    window.electronAPI.workspaceInspect.mockResolvedValue({ success: true, path: 'D:/portable.lnw', package: pack })
    await render()
    await click(button('校验已有 .lnw'))
    expect(window.electronAPI.workspaceInspect).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('只读校验')
    expect(container.textContent).toContain('当前版本只提供导出与只读校验')
    expect(container.textContent).not.toContain('已恢复')
  })

  it('does not report a canceled native dialog as success', async () => {
    window.electronAPI.workspaceExport.mockResolvedValue({ success: false, canceled: true })
    await render()
    await click(button('导出工作区便携包'))
    expect(container.textContent).toContain('已取消操作')
    expect(container.textContent).not.toContain('已创建并完成')
  })

  it('rejects malformed success receipts in the renderer', async () => {
    window.electronAPI.workspaceInspect.mockResolvedValue({ success: true, package: { ...pack, sha256: 'bad' } })
    await render()
    await click(button('校验已有 .lnw'))
    expect(container.querySelector('[role="alert"]').textContent).toContain('回执不完整')
  })

  it('prevents repeat actions while a portable export is pending', async () => {
    let resolve
    window.electronAPI.workspaceExport.mockReturnValue(new Promise(r => { resolve = r }))
    await render()
    await click(button('导出工作区便携包'))
    await click(button('导出工作区便携包'))
    expect(window.electronAPI.workspaceExport).toHaveBeenCalledTimes(1)
    expect(button('校验已有 .lnw').disabled).toBe(true)
    await act(async () => resolve({ success: true, path: 'E:/Safe/workspace.lnw', package: pack }))
  })

  it('opens the migrated user-data attachment directory explicitly', async () => {
    window.electronAPI.openAppFolder.mockResolvedValue({ success: true, path: 'D:/Data/uploads' })
    await render()
    await click(button('打开附件目录'))
    expect(window.electronAPI.openAppFolder).toHaveBeenCalledWith('uploads')
  })

  it('keeps browser environments read-only and honest', async () => {
    delete window.electronAPI
    await render()
    expect(button('导出工作区便携包').disabled).toBe(true)
    expect(container.textContent).toContain('当前环境不支持创建桌面工作区便携包')
  })
})
