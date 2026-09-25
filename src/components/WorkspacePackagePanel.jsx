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

export default function WorkspacePackagePanel() {
  const alive = useRef(false)
  const busyRef = useRef(false)
  const [task, setTask] = useState({ busy: false, error: false, message: '', path: '', pack: null })

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const run = async method => {
    if (busyRef.current) return
    const bridge = window.electronAPI
    if (typeof bridge?.[method] !== 'function') return
    busyRef.current = true
    setTask({ busy: true, error: false, message: method === 'workspaceExport' ?
      '正在创建数据库快照、校验附件并写入工作区便携包…' :
      '正在只读校验工作区便携包…', path: '', pack: null })
    try {
      const result = await bridge[method]()
      if (!alive.current) return
      if (result?.canceled) {
        setTask({ busy: false, error: false, message: '已取消操作；原数据和现有文件均未改动。', path: '', pack: null })
        return
      }
      const pack = normalizePackage(result)
      setTask({
        busy: false,
        error: false,
        message: method === 'workspaceExport' ?
          '工作区便携包已创建并完成逐文件 SHA-256 校验。' :
          '工作区便携包结构、清单和逐文件 SHA-256 校验通过。',
        path: result.path || '',
        pack,
      })
    } catch (error) {
      if (alive.current) setTask({ busy: false, error: true, message: error.message || '工作区便携包操作失败', path: '', pack: null })
    } finally {
      busyRef.current = false
    }
  }

  const openUploads = async () => {
    const bridge = window.electronAPI
    if (typeof bridge?.openAppFolder !== 'function' || busyRef.current) return
    busyRef.current = true
    try {
      const result = await bridge.openAppFolder('uploads')
      if (alive.current && result?.success !== true) {
        setTask({ busy: false, error: true, message: result?.message || '无法打开附件目录', path: '', pack: null })
      }
    } catch (error) {
      if (alive.current) setTask({ busy: false, error: true, message: error.message || '无法打开附件目录', path: '', pack: null })
    } finally {
      busyRef.current = false
    }
  }

  return <section className="backup-center-workspace" aria-label="工作区便携包">
    <div className="backup-center-section-heading">
      <h3>工作区便携包</h3>
      <span>.lnw v1 · 已保存正文 + 附件</span>
    </div>
    <p>把<strong>经过 SQLite 完整性校验的数据库快照</strong>与当前 <code>uploads</code> 附件放进一个可搬运文件。每个条目和清单都使用 SHA-256 校验；不会读取符号链接，也不会静默跳过异常附件。</p>
    <div className="backup-center-actions">
      <button type="button" className="btn primary"
        disabled={task.busy || typeof window.electronAPI?.workspaceExport !== 'function'}
        onClick={() => void run('workspaceExport')}>导出工作区便携包</button>
      <button type="button" className="btn"
        disabled={task.busy || typeof window.electronAPI?.workspaceInspect !== 'function'}
        onClick={() => void run('workspaceInspect')}>校验已有 .lnw</button>
      <button type="button" className="btn"
        disabled={task.busy || typeof window.electronAPI?.openAppFolder !== 'function'}
        onClick={() => void openUploads()}>打开附件目录</button>
    </div>
    <p className="backup-center-safety-hint">导出会先留下一个手动数据库快照，再生成便携包；目标文件已存在时绝不覆盖。当前版本只提供导出与只读校验，不在应用运行中自动替换数据库或附件。</p>
    <p className="backup-center-safety-hint">未保存的编辑器草稿、窗口临时状态以及“核对存档”仍需分别保存；它们不会被伪装成已包含的数据。</p>
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
      <strong>当前环境不支持创建桌面工作区便携包</strong>
      <p>请在 Local-Notepad 桌面应用中使用此功能；浏览器环境不会尝试读取本机数据库或附件目录。</p>
    </div>}
  </section>
}
