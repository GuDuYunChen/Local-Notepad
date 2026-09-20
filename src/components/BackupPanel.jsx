import React, { useEffect, useState } from 'react'
import { toast } from '~/services/toast'

export default function BackupPanel({ open, onClose }) {
  const [backups, setBackups] = useState([])
  const [backupDir, setBackupDir] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) void loadBackups()
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) onClose?.()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, loading, onClose])

  async function loadBackups() {
    setLoading(true)
    try {
      const res = await window.electronAPI?.backupList?.()
      if (res?.success) {
        setBackups(res.backups || [])
        setBackupDir(res.directory || '')
      } else {
        toast.error('加载备份列表失败：' + (res?.message || '未知错误'))
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
        toast.error('打开备份目录失败：' + (res?.message || '未知错误'))
      }
    } catch (error) {
      console.error(error)
      toast.error('打开备份目录失败')
    }
  }

  if (!open) return null

  return (
    <div
      className="modal-overlay consumer-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose?.()
      }}
    >
      <section
        className="modal consumer-modal backup-modal consumer-backup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-dialog-title"
      >
        <header className="selector-modal-header">
          <div>
            <h2 className="modal-title" id="backup-dialog-title">备份与恢复</h2>
            <div className="modal-message">查看本机自动备份，出现问题时更安心。</div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            disabled={loading}
            aria-label="关闭"
            title="关闭"
          >
            ×
          </button>
        </header>

        <div className="backup-actions consumer-backup-actions">
          <button type="button" className="btn primary" onClick={openBackupFolder}>
            打开备份文件夹
          </button>
          <button type="button" className="btn" onClick={loadBackups} disabled={loading}>
            {loading ? '刷新中…' : '刷新列表'}
          </button>
        </div>

        <div className="backup-guidance consumer-backup-guidance">
          应用会定期自动生成本地备份，并保留最近 100 份。需要恢复时，请先完全退出应用，再用备份文件替换当前数据。
        </div>

        {backupDir && (
          <div className="backup-directory" title={backupDir}>
            <span>保存位置</span>
            <code>{backupDir}</code>
          </div>
        )}

        <div className="backup-list">
          {loading ? (
            <div className="placeholder">正在读取备份…</div>
          ) : backups.length === 0 ? (
            <div className="empty-state consumer-backup-empty">
              <div className="empty-title">暂时还没有备份</div>
              <div className="empty-desc">应用运行一段时间后会自动生成，不需要手动操作。</div>
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
      </section>
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
