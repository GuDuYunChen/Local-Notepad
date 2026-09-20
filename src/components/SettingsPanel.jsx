import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ThemeToggle from './ThemeToggle'
import { api } from '~/services/api'
import { toast } from '~/services/toast'

export function formatDiagnosticBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTimestamp(ts) {
  if (!ts) return '暂无'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function diagnosticsToText(server, app, latencyMs) {
  const lines = [
    'Local Notepad 诊断信息',
    `应用版本: ${app?.version || '未知'}`,
    `运行环境: ${app?.platform || '未知'} ${app?.arch || ''}`.trim(),
    `Electron: ${app?.electron || '未知'}`,
    `Chrome: ${app?.chrome || '未知'}`,
    `Node: ${app?.node || '未知'}`,
    `已打包: ${app?.packaged ? '是' : '否'}`,
    `后端响应: ${Number.isFinite(latencyMs) ? `${Math.round(latencyMs)} ms` : '未知'}`,
    `数据库完整性: ${server?.integrity || '未知'}`,
    `Journal Mode: ${server?.journal_mode || '未知'}`,
    `Foreign Keys: ${server?.foreign_keys ? 'ON' : 'OFF'}`,
    `Busy Timeout: ${server?.busy_timeout ?? '未知'} ms`,
    `数据库大小: ${formatDiagnosticBytes(server?.database_size)}`,
    `活动笔记: ${server?.active_notes ?? '未知'}`,
    `文件夹: ${server?.active_folders ?? '未知'}`,
    `回收站: ${server?.trash_items ?? '未知'}`,
    `备份数量: ${server?.backup_count ?? '未知'}`,
    `最近备份: ${formatTimestamp(server?.latest_backup_at)}`,
    `数据目录: ${server?.data_dir || '未知'}`,
    `数据库: ${server?.database_path || '未知'}`,
    `备份目录: ${server?.backup_dir || '未知'}`,
    `上传目录: ${server?.upload_dir || '未知'}`,
  ]
  return lines.join('\n')
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand?.('copy')
  textarea.remove()
}

function StatusPill({ ok, children }) {
  return <span className={`settings-status-pill${ok ? ' ok' : ' warn'}`}>{children}</span>
}

export default function SettingsPanel({
  onClose,
  onOpenBackup,
  onOpenShortcuts,
}) {
  const [server, setServer] = useState(null)
  const [appInfo, setAppInfo] = useState(null)
  const [latency, setLatency] = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const startedAt = performance.now()
    try {
      const [serverInfo, desktopInfo] = await Promise.all([
        api('/api/diagnostics'),
        window.electronAPI?.appDiagnostics?.() || Promise.resolve(null),
      ])
      setLatency(performance.now() - startedAt)
      setServer(serverInfo)
      setAppInfo(desktopInfo?.success ? desktopInfo : desktopInfo)
    } catch (error) {
      console.error('读取诊断信息失败', error)
      toast.error(error.message || '读取诊断信息失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const diagnosticText = useMemo(
    () => diagnosticsToText(server, appInfo, latency),
    [server, appInfo, latency]
  )

  const openFolder = async (kind) => {
    try {
      const result = await window.electronAPI?.openAppFolder?.(kind)
      if (!result?.success) {
        throw new Error(result?.message || '打开目录失败')
      }
    } catch (error) {
      console.error('打开目录失败', kind, error)
      toast.error(error.message || '打开目录失败')
    }
  }

  const copyDiagnostics = async () => {
    try {
      await copyText(diagnosticText)
      toast.success('诊断信息已复制')
    } catch (error) {
      console.error('复制诊断信息失败', error)
      toast.error('复制失败')
    }
  }

  const healthOK = server?.status === 'ok' && server?.integrity === 'ok'

  return (
    <div className="settings-panel">
      <header className="settings-toolbar">
        <div>
          <strong>设置</strong>
          <p>调整常用选项，并查看这台电脑上的本地数据状态。</p>
        </div>
        <div className="settings-toolbar-actions">
          <button className="btn small" onClick={() => void refresh()} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
          <button className="icon-btn" onClick={onClose} title="返回笔记" aria-label="返回笔记">×</button>
        </div>
      </header>

      <div className="settings-content">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>外观与常用功能</h3>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <strong>主题</strong>
              <span>浅色 / 深色主题保存在本地数据库。</span>
            </div>
            <ThemeToggle />
          </div>
          <div className="settings-action-row">
            <button className="btn" onClick={onOpenShortcuts}>查看快捷键</button>
            <button className="btn" onClick={onOpenBackup}>备份与恢复</button>
            <button className="btn" onClick={() => void copyDiagnostics()}>复制诊断信息</button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>关于记事本</h3>
            </div>
            <StatusPill ok={Boolean(appInfo)}>桌面运行时</StatusPill>
          </div>
          <div className="settings-metric-grid">
            <div className="settings-metric"><span>应用版本</span><strong>{appInfo?.version || '—'}</strong></div>
            <div className="settings-metric"><span>平台</span><strong>{appInfo ? `${appInfo.platform} / ${appInfo.arch}` : '—'}</strong></div>
            <div className="settings-metric"><span>Electron</span><strong>{appInfo?.electron || '—'}</strong></div>
            <div className="settings-metric"><span>Chrome</span><strong>{appInfo?.chrome || '—'}</strong></div>
            <div className="settings-metric"><span>Node</span><strong>{appInfo?.node || '—'}</strong></div>
            <div className="settings-metric"><span>环境</span><strong>{appInfo ? (appInfo.packaged ? '已打包' : '开发模式') : '—'}</strong></div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>数据状态</h3>
            </div>
            <StatusPill ok={healthOK}>{healthOK ? '正常' : '需要检查'}</StatusPill>
          </div>

          <div className="settings-metric-grid">
            <div className="settings-metric"><span>SQLite quick_check</span><strong>{server?.integrity || '—'}</strong></div>
            <div className="settings-metric"><span>后端响应</span><strong>{Number.isFinite(latency) ? `${Math.round(latency)} ms` : '—'}</strong></div>
            <div className="settings-metric"><span>Journal</span><strong>{server?.journal_mode?.toUpperCase?.() || '—'}</strong></div>
            <div className="settings-metric"><span>Foreign Keys</span><strong>{server ? (server.foreign_keys ? 'ON' : 'OFF') : '—'}</strong></div>
            <div className="settings-metric"><span>Busy Timeout</span><strong>{server ? `${server.busy_timeout} ms` : '—'}</strong></div>
            <div className="settings-metric"><span>数据库大小</span><strong>{server ? formatDiagnosticBytes(server.database_size) : '—'}</strong></div>
          </div>

          <div className="settings-stat-strip">
            <div><strong>{server?.active_notes ?? '—'}</strong><span>笔记</span></div>
            <div><strong>{server?.active_folders ?? '—'}</strong><span>文件夹</span></div>
            <div><strong>{server?.trash_items ?? '—'}</strong><span>回收站</span></div>
            <div><strong>{server?.backup_count ?? '—'}</strong><span>备份</span></div>
          </div>

          <div className="settings-backup-summary">
            <span>最近备份</span>
            <strong>{formatTimestamp(server?.latest_backup_at)}</strong>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>存储位置</h3>
            </div>
          </div>

          {[
            ['data', '数据目录', server?.data_dir],
            ['backups', '备份目录', server?.backup_dir],
            ['uploads', '附件目录', server?.upload_dir],
          ].map(([kind, label, value]) => (
            <div className="settings-path-row" key={kind}>
              <div>
                <strong>{label}</strong>
                <code title={value || ''}>{value || '—'}</code>
              </div>
              <button className="btn small" disabled={!value} onClick={() => void openFolder(kind)}>
                打开
              </button>
            </div>
          ))}

          <div className="settings-path-row">
            <div>
              <strong>数据库文件</strong>
              <code title={server?.database_path || ''}>{server?.database_path || '—'}</code>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
