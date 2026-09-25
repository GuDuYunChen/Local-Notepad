import React, { useEffect, useRef, useState } from 'react'
import { formatBackupSize } from './backupCenterUtils'

function normalizePackage(result) {
  const value = result?.package
  if (result?.success !== true || !value || value.format !== 'local-notepad-workspace' || value.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.sha256 || '') ||
      !Number.isSafeInteger(value.size) || value.size < 1 ||
      !value.database || !Number.isSafeInteger(value.database.files) || value.database.files < 0 ||
      !Number.isInteger(value.database.schemaVersion) || value.database.schemaVersion < 1 || value.database.schemaVersion > 10 ||
      !value.attachments || !Number.isSafeInteger(value.attachments.count) || value.attachments.count < 0 ||
      !Number.isSafeInteger(value.attachments.totalBytes) || value.attachments.totalBytes < 0) {
    throw new Error('工作区便携包回执不完整，未将操作标记为成功')
  }
  return value
}
function normalizeRestore(result) {
  const value = result?.restore
  if (result?.success !== true || !value || !/^[a-f0-9]{24}$/.test(value.id || '') ||
      !/^[a-f0-9]{64}$/.test(value.receiptSHA256 || '') ||
      !value.package || !/^[a-f0-9]{64}$/.test(value.package.sha256 || '') ||
      !Number.isSafeInteger(value.package.size) || value.package.size < 1 ||
      !value.database || !/^[a-f0-9]{64}$/.test(value.database.sha256 || '') ||
      !Number.isSafeInteger(value.database.files) || value.database.files < 0 ||
      !Number.isInteger(value.database.schemaVersion) || value.database.schemaVersion < 1 || value.database.schemaVersion > 10 ||
      !value.attachments || !Number.isSafeInteger(value.attachments.count) || value.attachments.count < 0 ||
      !Number.isSafeInteger(value.attachments.totalBytes) || value.attachments.totalBytes < 0) {
    throw new Error('工作区恢复预检回执不完整，未安排恢复')
  }
  return value
}

export default function WorkspacePackagePanel() {
  const alive = useRef(false)
  const busyRef = useRef(false)
  const restoreRef = useRef(null)
  const [restorePreview, setRestorePreview] = useState(null)
  const [task, setTask] = useState({ busy: false, error: false, message: '', path: '', pack: null })

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      const pending = restoreRef.current
      if (pending && typeof window.electronAPI?.workspaceCancelRestore === 'function') {
        void window.electronAPI.workspaceCancelRestore(pending.id).catch(() => {})
      }
    }
  }, [])

  const clearRestore = () => { restoreRef.current = null; setRestorePreview(null) }
  const setRestore = value => { restoreRef.current = value; setRestorePreview(value) }
  const startTask = message => {
    busyRef.current = true
    setTask({ busy: true, error: false, message, path: '', pack: null })
  }
  const finishTask = value => {
    if (alive.current) setTask({ busy: false, error: false, path: '', pack: null, ...value })
    busyRef.current = false
  }
  const failTask = error => {
    if (alive.current) setTask({ busy: false, error: true, message: error?.message || '工作区便携包操作失败', path: '', pack: null })
    busyRef.current = false
  }

  const run = async method => {
    if (busyRef.current || restoreRef.current) return
    const bridge = window.electronAPI
    if (typeof bridge?.[method] !== 'function') return
    startTask(method === 'workspaceExport'
      ? '正在创建数据库快照、校验附件并写入工作区便携包…'
      : '正在只读校验工作区便携包…')
    try {
      const result = await bridge[method]()
      if (!alive.current) return
      if (result?.canceled) { finishTask({ message: '已取消操作；原数据和现有文件均未改动。' }); return }
      const pack = normalizePackage(result)
      finishTask({
        message: method === 'workspaceExport'
          ? '工作区便携包已创建并完成逐文件 SHA-256 校验。'
          : '工作区便携包结构、清单和逐文件 SHA-256 校验通过。',
        path: result.path || '',
        pack,
      })
    } catch (error) { failTask(error) }
  }

  const prepareRestore = async () => {
    if (busyRef.current || restoreRef.current) return
    const bridge = window.electronAPI
    if (typeof bridge?.workspacePrepareRestore !== 'function') return
    startTask('正在只读校验 .lnw、复检 SQLite，并暂存附件；当前数据不会被替换…')
    try {
      const result = await bridge.workspacePrepareRestore()
      if (!alive.current) return
      if (result?.canceled) { finishTask({ message: '已取消恢复预检；当前数据未改动。' }); return }
      const restore = normalizeRestore(result)
      setRestore(restore)
      finishTask({ message: '恢复预检通过，尚未替换任何当前数据。请核对范围后再确认。' })
    } catch (error) { failTask(error) }
  }

  const cancelRestore = async () => {
    const preview = restoreRef.current
    if (!preview || busyRef.current) return
    const bridge = window.electronAPI
    if (typeof bridge?.workspaceCancelRestore !== 'function') return
    startTask('正在清理本次恢复暂存，不改动当前工作区…')
    try {
      const result = await bridge.workspaceCancelRestore(preview.id)
      if (result?.success !== true) throw new Error(result?.message || '取消恢复失败')
      clearRestore()
      finishTask({ message: '已取消恢复预检并清理暂存；当前工作区未改动。' })
    } catch (error) { failTask(error) }
  }

  const confirmRestore = async () => {
    const preview = restoreRef.current
    if (!preview || busyRef.current) return
    const bridge = window.electronAPI
    if (typeof bridge?.workspaceConfirmRestore !== 'function') return
    startTask('正在复检恢复暂存并写入重启恢复标记…')
    try {
      const result = await bridge.workspaceConfirmRestore(preview.id)
      if (result?.success !== true || result.restartRequired !== true) {
        throw new Error(result?.message || '恢复确认失败，未安排重启')
      }
      clearRestore()
      finishTask({ message: '恢复已确认。应用将自动重启，在本地数据服务启动前替换数据；原工作区会永久保留用于回滚。' })
    } catch (error) { failTask(error) }
  }

  const openUploads = async () => {
    const bridge = window.electronAPI
    if (typeof bridge?.openAppFolder !== 'function' || busyRef.current || restoreRef.current) return
    busyRef.current = true
    try {
      const result = await bridge.openAppFolder('uploads')
      if (alive.current && result?.success !== true) {
        setTask({ busy: false, error: true, message: result?.message || '无法打开附件目录', path: '', pack: null })
      }
    } catch (error) {
      if (alive.current) setTask({ busy: false, error: true, message: error.message || '无法打开附件目录', path: '', pack: null })
    } finally { busyRef.current = false }
  }

  const desktopRestore = typeof window.electronAPI?.workspacePrepareRestore === 'function'
  return <section className="backup-center-workspace" aria-label="工作区便携包">
    <div className="backup-center-section-heading">
      <h3>工作区便携包</h3>
      <span>.lnw v1 · 已保存正文 + 附件</span>
    </div>
    <p>把<strong>经过 SQLite 完整性校验的数据库快照</strong>与当前 <code>uploads</code> 附件放进一个可搬运文件。每个条目和清单都使用 SHA-256 校验；不会读取符号链接，也不会静默跳过异常附件。</p>
    <div className="backup-center-actions">
      <button type="button" className="btn primary" disabled={task.busy || !!restorePreview || typeof window.electronAPI?.workspaceExport !== 'function'} onClick={() => void run('workspaceExport')}>导出工作区便携包</button>
      <button type="button" className="btn" disabled={task.busy || !!restorePreview || typeof window.electronAPI?.workspaceInspect !== 'function'} onClick={() => void run('workspaceInspect')}>校验已有 .lnw</button>
      <button type="button" className="btn" disabled={task.busy || !!restorePreview || !desktopRestore} onClick={() => void prepareRestore()}>预检恢复 .lnw</button>
      <button type="button" className="btn" disabled={task.busy || !!restorePreview || typeof window.electronAPI?.openAppFolder !== 'function'} onClick={() => void openUploads()}>打开附件目录</button>
    </div>
    <p className="backup-center-safety-hint">导出会先留下一个手动数据库快照，目标文件已存在时绝不覆盖。恢复采用两步确认：先只读预检和暂存，确认后自动重启，在后端启动前替换数据；恢复前的数据库、WAL、SHM 与附件目录会永久保留。</p>
    <p className="backup-center-safety-hint">若恢复后的数据库无法通过本地服务启动验证，应用会自动切回恢复前数据。未保存的编辑器草稿、窗口临时状态以及“核对存档”仍需分别保存。</p>

    {restorePreview && <div className="backup-center-restore-preview" role="group" aria-label="工作区恢复预检">
      <strong>恢复预检通过 · 尚未修改当前工作区</strong>
      <p>来源版本：{restorePreview.package.appVersion || '未知'} · 包大小 {formatBackupSize(restorePreview.package.size)}</p>
      <p>数据库：{restorePreview.database.files} 条记录 · schema {restorePreview.database.schemaVersion}</p>
      <p>附件：{restorePreview.attachments.count} 个 · {formatBackupSize(restorePreview.attachments.totalBytes)}</p>
      <p><strong>确认后应用会自动重启。</strong>请先保存当前编辑器草稿；草稿不在 .lnw 中。原工作区会移动到独立保留目录，不会被删除。</p>
      <div className="backup-center-actions">
        <button type="button" className="btn" disabled={task.busy} onClick={() => void cancelRestore()}>取消恢复预检</button>
        <button type="button" className="btn danger" disabled={task.busy} onClick={() => void confirmRestore()}>确认恢复并重启</button>
      </div>
    </div>}

    {task.message && <div className="backup-center-safety-result" role={task.error ? 'alert' : 'status'} aria-busy={task.busy}>
      <strong>{task.message}</strong>
      {task.path && <p>文件位置：<code>{task.path}</code></p>}
      {task.pack && <>
        <p>数据库：{task.pack.database.files} 条记录 · schema {task.pack.database.schemaVersion}</p>
        <p>附件：{task.pack.attachments.count} 个 · {formatBackupSize(task.pack.attachments.totalBytes)} · 包大小 {formatBackupSize(task.pack.size)}</p>
        <details><summary>查看便携包指纹</summary><code>SHA-256 {task.pack.sha256}</code></details>
      </>}
    </div>}
    {typeof window.electronAPI?.workspaceExport !== 'function' && <div className="backup-center-notice" role="status">
      <strong>当前环境不支持创建或恢复桌面工作区便携包</strong>
      <p>请在 Local-Notepad 桌面应用中使用此功能；浏览器环境不会尝试读取或替换本机数据库与附件目录。</p>
    </div>}
  </section>
}
