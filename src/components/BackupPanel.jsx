import React, { useEffect, useState } from 'react'
import { toast } from '~/services/toast'

export default function BackupPanel({ open, onClose }) {
  const [backups, setBackups] = useState([])
  const [backupDir, setBackupDir] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) void loadBackups()
  }, [open])

  async function loadBackups() {
    setLoading(true)
    try {
      const res = await window.electronAPI?.backupList?.()
      if (res?.success) {
        setBackups(res.backups || [])
        setBackupDir(res.directory || '')
      } else {
        toast.error('加载备份列表失败: ' + (res?.message || '未知错误'))
      }
    } catch (error) {
      console.error(error)
      toast.error('加载备份列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function openBackupFolder() {
    try {
      const res = await window.electronAPI?.backupOpenFolder?.()
      if (!res?.success) {
        toast.error('打开备份目录失败: ' + (res?.message || '未知错误'))
      }
    } catch (error) {
      console.error(error)
      toast.error('打开备份目录失败')
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal backup-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="template-eyebrow">Safety & Recovery</div>
            <h2 className="modal-title">自动备份</h2>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="modal-body">
          <div className="backup-actions">
            <button className="btn primary" onClick={openBackupFolder}>打开备份目录</button>
            <button className="btn" onClick={loadBackups} disabled={loading}>刷新</button>
          </div>

          <div className="backup-guidance">
            应用启动时会检查备份，并每 8 小时使用 SQLite 热备份生成一次数据库副本，最多保留最近 100 份。
            为避免 WAL 数据不一致，当前界面不执行在线恢复；需要恢复时请先完全退出应用，再使用备份文件进行离线恢复。
          </div>

          {backupDir && (
            <div className="backup-directory" title={backupDir}>
              <span>备份目录</span>
              <code>{backupDir}</code>
            </div>
          )}

          <div className="backup-list">
            {loading ? (
              <div className="placeholder">加载中…</div>
            ) : backups.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💾</div>
                <div className="empty-title">暂无自动备份</div>
                <div className="empty-desc">首次启动或距离上次备份满 8 小时后会自动生成</div>
              </div>
            ) : (
              <ul className="backup-items">
                {backups.map((backup, index) => (
                  <li key={backup.path} className="backup-item">
                    <div className="backup-info">
                      <div className="backup-name">
                        {backup.name}
                        {index === 0 && <span className="backup-latest">最新</span>}
                      </div>
                      <div className="backup-meta">
                        {formatSize(backup.size)} · {formatDate(backup.date)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr || '时间未知'
  return date.toLocaleString('zh-CN')
}
