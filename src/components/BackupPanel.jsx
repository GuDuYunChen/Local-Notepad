import React, { useState, useEffect } from 'react'
import { message } from 'antd'

export default function BackupPanel({ open, onClose }) {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      loadBackups()
    }
  }, [open])

  async function loadBackups() {
    setLoading(true)
    try {
      const backupDir = await getBackupDir()
      const res = await window.electronAPI.backupList(backupDir)
      if (res.success) {
        setBackups(res.backups || [])
      } else {
        message.error('加载备份列表失败')
      }
    } catch (e) {
      message.error('加载备份列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function getBackupDir() {
    const home = process.env.HOME || process.env.USERPROFILE
    if (process.platform === 'win32') {
      return `${home}\\AppData\\Roaming\\Notepad\\backups`
    } else if (process.platform === 'darwin') {
      return `${home}/Library/Application Support/Notepad/backups`
    } else {
      return `${home}/.notepad/backups`
    }
  }

  async function handleBackup() {
    try {
      const targetDir = await window.electronAPI.openDirectoryDialog()
      if (!targetDir) return
      
      const res = await window.electronAPI.backupCreate(targetDir)
      if (res.success) {
        message.success('备份成功')
        await loadBackups()
      } else {
        message.error('备份失败: ' + (res.message || '未知错误'))
      }
    } catch (e) {
      message.error('备份失败')
    }
  }

  async function handleRestore(backupPath) {
    if (!window.confirm('确定要恢复此备份吗？当前数据将被覆盖。')) return
    
    try {
      const res = await window.electronAPI.backupRestore(backupPath)
      if (res.success) {
        message.success('恢复成功，应用将重启')
        setTimeout(() => window.location.reload(), 1000)
      } else {
        message.error('恢复失败: ' + (res.message || '未知错误'))
      }
    } catch (e) {
      message.error('恢复失败')
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal backup-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">备份与恢复</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="backup-actions">
            <button className="btn primary" onClick={handleBackup}>创建备份</button>
          </div>
          <div className="backup-list">
            {loading ? (
              <div className="placeholder">加载中…</div>
            ) : backups.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💾</div>
                <div className="empty-title">暂无备份</div>
                <div className="empty-desc">点击"创建备份"开始备份数据库</div>
              </div>
            ) : (
              <ul className="backup-items">
                {backups.map(backup => (
                  <li key={backup.path} className="backup-item">
                    <div className="backup-info">
                      <div className="backup-name">{backup.name}</div>
                      <div className="backup-meta">
                        {formatSize(backup.size)} · {formatDate(backup.date)}
                      </div>
                    </div>
                    <button className="btn small" onClick={() => handleRestore(backup.path)}>恢复</button>
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
  try {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN')
  } catch {
    return dateStr
  }
}
