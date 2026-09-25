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
    workspacePrepareRestore: vi.fn(),
    workspaceConfirmRestore: vi.fn(),
    workspaceCancelRestore: vi.fn(),
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
  appVersion: '4.183.0',
  size: 8192,
  sha256: 'a'.repeat(64),
  database: { files: 12, schemaVersion: 10, size: 4096, sha256: 'b'.repeat(64) },
  attachments: { count: 3, totalBytes: 2048 },
}
const restore = {
  id: 'c'.repeat(24),
  receiptSHA256: 'd'.repeat(64),
  package: { sha256: 'a'.repeat(64), size: 8192, createdAt: '2026-09-24T12:00:00.000Z', appVersion: '4.183.0' },
  database: { backupName: 'backup-manual-workspace-' + 'c'.repeat(24) + '.db', sha256: 'b'.repeat(64), size: 4096, files: 12, schemaVersion: 10 },
  attachments: { count: 3, totalBytes: 2048 },
}
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text)
async function render() { await act(async () => root.render(<WorkspacePackagePanel />)) }
async function click(node) { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() }) }

describe('workspace portable package panel', () => {
  it('exports only after an explicit click and renders verified counts', async () => {
    window.electronAPI.workspaceExport.mockResolvedValue({ success: true, path: 'E:/Safe/workspace.lnw', package: pack })
    await render(); expect(window.electronAPI.workspaceExport).not.toHaveBeenCalled()
    await click(button('导出工作区便携包'))
    expect(window.electronAPI.workspaceExport).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('逐文件 SHA-256 校验')
    expect(container.textContent).toContain('12 条记录')
    expect(container.textContent).toContain('附件：3 个')
  })
  it('inspects an existing package without claiming a restore', async () => {
    window.electronAPI.workspaceInspect.mockResolvedValue({ success: true, path: 'D:/portable.lnw', package: pack })
    await render(); await click(button('校验已有 .lnw'))
    expect(container.textContent).toContain('只读校验')
    expect(container.textContent).toContain('恢复采用两步确认')
    expect(container.textContent).not.toContain('工作区恢复完成')
  })
  it('preflights restore without modifying data and requires a second confirmation', async () => {
    window.electronAPI.workspacePrepareRestore.mockResolvedValue({ success: true, restore })
    await render(); await click(button('预检恢复 .lnw'))
    expect(window.electronAPI.workspacePrepareRestore).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('尚未修改当前工作区')
    expect(container.textContent).toContain('确认后应用会自动重启')
    expect(button('导出工作区便携包').disabled).toBe(true)
    expect(window.electronAPI.workspaceConfirmRestore).not.toHaveBeenCalled()
  })
  it('confirms only an issued restore id and reports restart semantics', async () => {
    window.electronAPI.workspacePrepareRestore.mockResolvedValue({ success: true, restore })
    window.electronAPI.workspaceConfirmRestore.mockResolvedValue({ success: true, restartRequired: true, restore })
    await render(); await click(button('预检恢复 .lnw')); await click(button('确认恢复并重启'))
    expect(window.electronAPI.workspaceConfirmRestore).toHaveBeenCalledWith(restore.id)
    expect(container.textContent).toContain('应用将自动重启')
    expect(container.querySelector('[aria-label="工作区恢复预检"]')).toBeNull()
  })
  it('cancels staged restore explicitly without reporting a restore', async () => {
    window.electronAPI.workspacePrepareRestore.mockResolvedValue({ success: true, restore })
    window.electronAPI.workspaceCancelRestore.mockResolvedValue({ success: true, canceled: true })
    await render(); await click(button('预检恢复 .lnw')); await click(button('取消恢复预检'))
    expect(window.electronAPI.workspaceCancelRestore).toHaveBeenCalledWith(restore.id)
    expect(container.textContent).toContain('当前工作区未改动')
    expect(container.textContent).not.toContain('已恢复')
  })
  it('cleans an unconfirmed staged restore when the panel unmounts', async () => {
    window.electronAPI.workspacePrepareRestore.mockResolvedValue({ success: true, restore })
    window.electronAPI.workspaceCancelRestore.mockResolvedValue({ success: true, canceled: true })
    await render(); await click(button('预检恢复 .lnw'))
    await act(async () => root.unmount())
    expect(window.electronAPI.workspaceCancelRestore).toHaveBeenCalledWith(restore.id)
    root = createRoot(container)
  })
  it('does not report a canceled native dialog as success', async () => {
    window.electronAPI.workspaceExport.mockResolvedValue({ success: false, canceled: true })
    await render(); await click(button('导出工作区便携包'))
    expect(container.textContent).toContain('已取消操作')
  })
  it('rejects malformed restore receipts in the renderer', async () => {
    window.electronAPI.workspacePrepareRestore.mockResolvedValue({ success: true, restore: { ...restore, receiptSHA256: 'bad' } })
    await render(); await click(button('预检恢复 .lnw'))
    expect(container.querySelector('[role="alert"]').textContent).toContain('预检回执不完整')
  })
  it('prevents repeat actions while a portable export is pending', async () => {
    let resolve
    window.electronAPI.workspaceExport.mockReturnValue(new Promise(r => { resolve = r }))
    await render(); await click(button('导出工作区便携包')); await click(button('导出工作区便携包'))
    expect(window.electronAPI.workspaceExport).toHaveBeenCalledTimes(1)
    expect(button('校验已有 .lnw').disabled).toBe(true)
    await act(async () => resolve({ success: true, path: 'E:/Safe/workspace.lnw', package: pack }))
  })
  it('opens the migrated user-data attachment directory explicitly', async () => {
    window.electronAPI.openAppFolder.mockResolvedValue({ success: true, path: 'D:/Data/uploads' })
    await render(); await click(button('打开附件目录'))
    expect(window.electronAPI.openAppFolder).toHaveBeenCalledWith('uploads')
  })
  it('keeps browser environments read-only and honest', async () => {
    delete window.electronAPI
    await render()
    expect(button('导出工作区便携包').disabled).toBe(true)
    expect(button('预检恢复 .lnw').disabled).toBe(true)
    expect(container.textContent).toContain('当前环境不支持创建或恢复桌面工作区便携包')
  })
})
