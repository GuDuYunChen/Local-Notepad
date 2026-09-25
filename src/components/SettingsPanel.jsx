import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ThemeToggle from './ThemeToggle'
import LibraryReferenceHealthPanel from './LibraryReferenceHealthPanel'
import SyncCenterPanel from './SyncCenterPanel'
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

function StatusPill({ tone = 'neutral', children }) {
  return <span className={`settings-status-pill ${tone}`}>{children}</span>
}

export default function SettingsPanel({
  onClose,
  onOpenBackup,
  onOpenShortcuts,
  onOpenFile,
}) {
  const [server, setServer] = useState(null)
  const [appInfo, setAppInfo] = useState(null)
  const [latency, setLatency] = useState(null)
  const [loading, setLoading] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

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
  const dataStatusTone = !server ? 'neutral' : (healthOK ? 'ok' : 'warn')
  const dataStatusLabel = !server ? '正在检查' : (healthOK ? '本地数据正常' : '需要检查')

  return (
    <div className="settings-panel">
      <header className="settings-toolbar">
        <div>
          <strong>设置</strong>
          <p>常用选项和本地数据都集中在这里。</p>
        </div>
        <div className="settings-toolbar-actions">
          <button className="icon-btn" onClick={onClose} title="返回笔记" aria-label="返回笔记">×</button>
        </div>
      </header>

      <div className="settings-content consumer-settings-content">
        <section className="settings-card consumer-settings-section">
          <div className="settings-card-header">
            <h3>外观</h3>
          </div>
          <div className="settings-row">
            <div>
              <strong>主题</strong>
              <span>选择你更习惯的浅色或深色界面。</span>
            </div>
            <ThemeToggle />
          </div>
        </section>

        <section className="settings-card consumer-settings-section">
          <div className="settings-card-header">
            <h3>数据与备份</h3>
            <StatusPill tone={dataStatusTone}>{dataStatusLabel}</StatusPill>
          </div>

          <div className="consumer-data-summary">
            <div><strong>{server?.active_notes ?? '—'}</strong><span>篇笔记</span></div>
            <div><strong>{server?.trash_items ?? '—'}</strong><span>项在回收站</span></div>
            <div><strong>{server?.backup_count ?? '—'}</strong><span>个备份</span></div>
          </div>

          <div className="settings-row">
            <div>
              <strong>最近备份</strong>
              <span>{formatTimestamp(server?.latest_backup_at)}</span>
            </div>
            <button className="btn" onClick={onOpenBackup}>备份与恢复</button>
          </div>

          <div className="settings-path-row">
            <div>
              <strong>数据位置</strong>
              <code title={server?.data_dir || ''}>{server?.data_dir || '—'}</code>
            </div>
            <button className="btn small" disabled={!server?.data_dir} onClick={() => void openFolder('data')}>
              打开
            </button>
          </div>

          <div className="settings-action-row consumer-settings-actions">
            <button className="btn" onClick={() => void openFolder('backups')} disabled={!server?.backup_dir}>
              打开备份文件夹
            </button>
            <button className="btn" onClick={() => void openFolder('uploads')} disabled={!server?.upload_dir}>
              打开附件文件夹
            </button>
          </div>
        </section>

        <SyncCenterPanel />

        <section className="settings-card consumer-settings-section">
          <div className="settings-card-header">
            <h3>知识库引用</h3>
          </div>
          <LibraryReferenceHealthPanel onOpenFile={onOpenFile} />
        </section>

        <section className="settings-card consumer-settings-section">
          <div className="settings-card-header">
            <h3>关于记事本</h3>
          </div>

          <div className="settings-row">
            <div>
              <strong>版本</strong>
              <span>{appInfo?.version ? `记事本 ${appInfo.version}` : '正在读取版本信息…'}</span>
            </div>
            <StatusPill tone="neutral">{appInfo ? (appInfo.packaged ? '桌面版' : '开发模式') : '读取中'}</StatusPill>
          </div>

          <div className="settings-row">
            <div>
              <strong>快捷键</strong>
              <span>查看搜索、保存、专注模式等快捷操作。</span>
            </div>
            <button className="btn" onClick={onOpenShortcuts}>查看</button>
          </div>

          <button
            type="button"
            className="settings-advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(prev => !prev)}
          >
            <span>{advancedOpen ? '收起高级诊断' : '高级诊断'}</span>
            <span aria-hidden="true">{advancedOpen ? '⌃' : '⌄'}</span>
          </button>

          {advancedOpen && (
            <div className="settings-advanced-panel">
              <div className="settings-advanced-header">
                <div>
                  <strong>本机诊断信息</strong>
                  <span>仅用于排查问题，不会上传。</span>
                </div>
                <div className="settings-toolbar-actions">
                  <button className="btn small" onClick={() => void refresh()} disabled={loading}>
                    {loading ? '刷新中…' : '刷新'}
                  </button>
                  <button className="btn small" onClick={() => void copyDiagnostics()}>复制诊断信息</button>
                </div>
              </div>

              <div className="settings-metric-grid advanced">
                <div className="settings-metric"><span>数据库完整性</span><strong>{server?.integrity || '—'}</strong></div>
                <div className="settings-metric"><span>后端响应</span><strong>{Number.isFinite(latency) ? `${Math.round(latency)} ms` : '—'}</strong></div>
                <div className="settings-metric"><span>数据库大小</span><strong>{server ? formatDiagnosticBytes(server.database_size) : '—'}</strong></div>
                <div className="settings-metric"><span>SQLite Journal</span><strong>{server?.journal_mode?.toUpperCase?.() || '—'}</strong></div>
                <div className="settings-metric"><span>Foreign Keys</span><strong>{server ? (server.foreign_keys ? 'ON' : 'OFF') : '—'}</strong></div>
                <div className="settings-metric"><span>Busy Timeout</span><strong>{server ? `${server.busy_timeout} ms` : '—'}</strong></div>
                <div className="settings-metric"><span>Electron</span><strong>{appInfo?.electron || '—'}</strong></div>
                <div className="settings-metric"><span>Chrome</span><strong>{appInfo?.chrome || '—'}</strong></div>
                <div className="settings-metric"><span>Node</span><strong>{appInfo?.node || '—'}</strong></div>
              </div>

              <div className="settings-path-row advanced">
                <div>
                  <strong>数据库文件</strong>
                  <code title={server?.database_path || ''}>{server?.database_path || '—'}</code>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )}
