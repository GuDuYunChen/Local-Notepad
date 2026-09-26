import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import { createSyncStatusReader, mergeSyncDraft, syncHealthLabel, syncStatusLabel } from '~/services/syncStatusReader.mjs'
import './SyncCenterPanel.css'
import './SyncHealth.css'

const describePlan = plan => plan
  ? `上传 ${plan.uploads || 0} · 下载 ${plan.downloads || 0} · 冲突 ${plan.conflicts || 0} · 无变化 ${plan.noops || 0}` : ''
const recordLabel = (record, fallback) => {
  if (record?.state === 'purged') return '已永久删除'
  if (record?.kind === 'attachment') return record?.attachment?.name || fallback || '附件'
  if (record?.kind === 'tag') return record?.tag?.name ? ('标签：' + record.tag.name) : (fallback || '标签')
  if (record?.kind === 'file-tag') {
    const link = record?.file_tag
    return link ? ('标签关联：' + link.file_id + ' ↔ ' + link.tag_id) : (fallback || '标签关联')
  }
  return record?.file?.title || fallback || '未知对象'
}
const providerName = provider => provider === 'webdav' ? 'WebDAV' : '本地实验室'
const timeLabel = value => {
  if (!Number.isFinite(value) || value <= 0) return '暂无记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '暂无记录' : date.toLocaleString('zh-CN', { hour12: false })
}
const emptySecret = () => ({ available: false, stored: false, managed: false, backend: '' })

export default function SyncCenterPanel() {
  const alive = useRef(false)
  const operation = useRef(false)
  const reader = useRef(null)
  const dirty = useRef({ endpoint: false, username: false })
  const autoEnabled = useRef(false)
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState(null)
  const [plan, setPlan] = useState(null)
  const [conflicts, setConflicts] = useState([])
  const [busy, setBusy] = useState('')
  const [webdav, setWebdav] = useState({ endpoint: '', username: '', password: '' })
  const [secretStatus, setSecretStatus] = useState(emptySecret)
  const [health, setHealth] = useState({ loading: true, error: '', failures: 0, lastReadAt: 0, retryAt: 0 })
  const [actionError, setActionError] = useState('')
  const [connectionCheck, setConnectionCheck] = useState(null)
  const savedTarget = useRef('')

  useEffect(() => {
    alive.current = true
    const current = createSyncStatusReader({
      load: async signal => {
        const secretPromise = typeof window.electronAPI?.webdavSecretStatus === 'function'
          ? window.electronAPI.webdavSecretStatus() : Promise.resolve(emptySecret())
        const [nextSettings, nextStatus, nextConflicts, nextSecret] = await Promise.all([
          api('/api/settings', { signal }), api('/api/sync/status', { signal }),
          api('/api/sync/conflicts', { signal }), secretPromise,
        ])
        if (!nextSettings || typeof nextSettings !== 'object' || !nextStatus || typeof nextStatus !== 'object' || !Array.isArray(nextConflicts)) {
          throw new Error('同步状态响应无效')
        }
        return { nextSettings, nextStatus, nextConflicts, nextSecret }
      },
      shouldPoll: () => autoEnabled.current,
      onHealth: setHealth,
      onSnapshot: ({ nextSettings, nextStatus, nextConflicts, nextSecret }) => {
        const target = JSON.stringify([nextSettings.sync_provider, nextSettings.sync_endpoint, nextSettings.sync_username])
        if (savedTarget.current && savedTarget.current !== target) setConnectionCheck(null)
        savedTarget.current = target
        autoEnabled.current = nextSettings.sync_enabled === true && nextSettings.sync_auto_enabled === true
        setSettings(nextSettings)
        setStatus(nextStatus)
        setConflicts(nextConflicts)
        setSecretStatus(nextSecret && typeof nextSecret === 'object' ? nextSecret : emptySecret())
        setWebdav(value => mergeSyncDraft(value, nextSettings, dirty.current))
      },
    })
    reader.current = current
    void current.refresh()
    return () => {
      alive.current = false
      current.dispose()
      if (reader.current === current) reader.current = null
    }
  }, [])

  const refresh = useCallback(() => reader.current?.refresh({ allowPaused: true }) ?? Promise.resolve(false), [])
  const refreshAfterChange = async message => {
    const fresh = await refresh()
    if (!alive.current) return
    if (fresh) toast.success(message)
    else toast.error('操作已完成，但状态刷新失败；请点击“刷新状态”确认结果')
  }
  const exclusive = async (key, task) => {
    if (operation.current) return
    operation.current = true
    reader.current?.setPaused(true)
    setBusy(key)
    setActionError('')
    if (key !== 'check' && key !== 'folder') setConnectionCheck(null)
    try { await task() } catch (error) {
      if (alive.current) {
        const message = error?.message || '同步操作失败'
        setActionError(message)
        toast.error(message)
      }
    } finally {
      operation.current = false
      if (alive.current) {
        setBusy('')
        reader.current?.setPaused(false)
      }
    }
  }
  const updateSettings = (key, patch, message) => exclusive(key, async () => {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })
    if (!alive.current) return
    setPlan(null)
    await refreshAfterChange(message)
  })
  const enableLab = () => updateSettings('settings', { sync_enabled: true, sync_provider: 'local-lab' }, '已启用本地同步实验室')
  const saveWebDAV = () => exclusive('webdav', async () => {
    const password = webdav.password
    if (password && typeof window.electronAPI?.webdavSecretSave !== 'function') throw new Error('当前环境无法使用系统安全存储，请在桌面应用中保存 WebDAV 密码')
    if (password && secretStatus?.available !== true) throw new Error('系统安全存储不可用，未修改 WebDAV 配置')
    try {
      await api('/api/settings', {
        method: 'PUT', body: JSON.stringify({ sync_enabled: false, sync_auto_enabled: false, sync_provider: 'webdav',
          sync_endpoint: webdav.endpoint.trim(), sync_username: webdav.username.trim() }),
      })
      if (password) {
        const secret = await window.electronAPI.webdavSecretSave(password)
        if (secret?.success !== true || secret?.stored !== true) throw new Error(secret?.message || '系统安全存储未保存 WebDAV 密码')
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ sync_password: secret.restartRequired ? password : '' }) })
        if (alive.current) setWebdav(current => ({ ...current, password: '' }))
      }
      await api('/api/sync/check', { method: 'POST', body: '{}' })
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ sync_enabled: true }) })
      if (!alive.current) return
      dirty.current = { endpoint: false, username: false }
      setPlan(null)
      await refreshAfterChange(password ? 'WebDAV 已验证并启用；密码已迁移到系统保护存储' : 'WebDAV 已验证并启用')
    } catch (error) {
      if (alive.current) await refresh()
      throw error
    }
  })
  const clearWebDAVPassword = () => exclusive('secret', async () => {
    if (secretStatus.stored && typeof window.electronAPI?.webdavSecretClear === 'function') {
      const result = await window.electronAPI.webdavSecretClear()
      if (result?.success !== true) throw new Error(result?.message || '清除系统 WebDAV 密码失败')
    }
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ sync_password: '' }) })
    if (alive.current) setWebdav(current => ({ ...current, password: '' }))
    await refreshAfterChange('已清除 WebDAV 密码')
  })
  const pause = () => updateSettings('settings', { sync_enabled: false }, '已暂停同步')
  const updateAuto = (enabled, interval = settings?.sync_interval_minutes || 5) => exclusive('auto', async () => {
    await api('/api/sync/auto', { method: 'POST', body: JSON.stringify({ enabled, interval_minutes: Number(interval) }) })
    await refreshAfterChange(enabled ? '连接验证通过，已开启自动同步' : '已暂停自动同步')
  })
  const rebind = () => {
    if (!window.confirm('重新绑定只会清除本机同步基线、旧远端身份和未决冲突状态，不会删除笔记、附件或远端数据。继续吗？')) return
    return exclusive('rebind', async () => {
      const next = await api('/api/sync/rebind', { method: 'POST', body: '{}' })
      if (!alive.current) return
      setPlan(null)
      setStatus(next)
      setConflicts([])
      autoEnabled.current = false
      setSettings(current => current ? ({ ...current, sync_auto_enabled: false }) : current)
      toast.success('已重新绑定同步目标并暂停自动同步；请先预演同步')
    })
  }
  const checkConnection = () => exclusive('check', async () => {
    setConnectionCheck(null)
    const result = await api('/api/sync/check', { method: 'POST', body: '{}' })
    if (!alive.current) return
    const detail = result?.initialized
      ? `远端可用 · 第 ${result.generation || 0} 代 · ${result.items || 0} 个对象`
      : '远端可用 · 尚未初始化，同步前不会写入任何探针'
    setConnectionCheck({ detail, at: Date.now() })
    toast.success(detail)
  })
  const preview = () => exclusive('plan', async () => {
    const next = await api('/api/sync/plan', { method: 'POST', body: '{}' })
    if (!alive.current) return
    setPlan(next)
    toast.success('同步预演完成；没有写入远端或本机正文')
  })
  const synchronize = () => {
    const uncertain = ['applying', 'review_required'].includes(status?.recovery?.mode)
    if (uncertain && !window.confirm('上次同步可能已写入远端或本机。请先核查两端数据；继续会重新读取远端并尝试同步，不会自动回滚。确认手动重试吗？')) return
    return exclusive('run', async () => {
      try {
        const result = await api('/api/sync/run', { method: 'POST', body: uncertain ? JSON.stringify({ acknowledge_uncertain: true }) : '{}' })
        if (!alive.current) return
        setPlan(result?.plan || null)
        await refreshAfterChange(result?.conflicts ? '同步完成，有冲突需要人工处理' : '同步完成')
      } catch (error) {
        if (alive.current) await refresh()
        throw error
      }
    })
  }
  const resolve = (id, choice) => exclusive(id + ':' + choice, async () => {
    await api('/api/sync/conflicts/' + encodeURIComponent(id) + '/resolve', { method: 'POST', body: JSON.stringify({ choice }) })
    await refreshAfterChange(choice === 'local' ? '已保留本机版本' : '已采用远端版本')
  })
  const openLab = () => exclusive('folder', async () => {
    const result = await window.electronAPI?.openAppFolder?.('syncLab')
    if (result && result.success === false) throw new Error(result.message || '打开模拟远端失败')
  })
  const editDraft = (field, value) => {
    if (field !== 'password') dirty.current[field] = true
    setWebdav(current => ({ ...current, [field]: value }))
    setConnectionCheck(null)
  }
  const enabled = settings?.sync_enabled === true
  const provider = settings?.sync_provider || 'local-lab'
  const isLab = provider === 'local-lab'
  const isWebDAV = provider === 'webdav'
  const hasSecureSecret = secretStatus?.stored === true
  const hasLegacySecret = settings?.sync_password_set === true
  const hasAnySecret = hasSecureSecret || hasLegacySecret
  const draftChanged = dirty.current.endpoint || dirty.current.username || webdav.password !== ''

  return <section className="settings-card consumer-settings-section sync-center-card">
    <div className="settings-card-header">
      <div><h3>同步中心</h3><p>同步健康状态 · 验证后启用 WebDAV</p></div>
      <span className={'settings-status-pill ' + (enabled ? 'ok' : 'neutral')}>{enabled ? ('已启用 · ' + providerName(provider)) : '未启用'}</span>
    </div>
    <div className="sync-health" aria-label="同步健康状态">
      <div className="sync-health-heading">
        <strong role="status">{syncHealthLabel(settings, status, health.error)}</strong>
        <button className="btn small" disabled={!!busy || health.loading} onClick={() => void refresh()}>{health.loading ? '刷新中…' : '刷新状态'}</button>
      </div>
      <span>最近同步尝试：{timeLabel(Number(status?.last_sync_at) * 1000)} · {syncStatusLabel(status?.last_status)}</span>
      <span>状态读取时间：{timeLabel(health.lastReadAt)}</span>
      {status?.recovery && <div className="sync-health-warning" role="status" aria-label="同步任务恢复状态">
        <strong>{status.recovery.mode === 'backoff' ? '同步预检暂缓' : ['applying', 'review_required'].includes(status.recovery.mode) ? '写入结果待确认' : status.recovery.mode === 'blocked' ? '自动同步需要处理' : '同步任务记录'}</strong>
        <span>最近确认成功：{timeLabel(Number(status.recovery.last_success_at) * 1000)}</span>
        {status.recovery.next_attempt_at > 0 && <span>同步最早重试时间：{timeLabel(Number(status.recovery.next_attempt_at) * 1000)}。刷新状态不会提前重试。</span>}
        {['applying', 'review_required'].includes(status.recovery.mode) && <span>任务可能仍在执行，或上次中断后结果尚未确认。自动同步不会重跑；请核查两端数据，再点击“执行同步”明确确认。</span>}
        {status.recovery.mode === 'blocked' && <span>请修复连接配置或远端问题后手动执行同步。只读连接检查不会解除写入结果待确认状态。</span>}
      </div>}
      {health.error && <div className="sync-health-warning" role="status">
        <span>{health.error}。连续读取失败 {health.failures} 次。</span>
        {health.retryAt > 0 && <span>下次状态读取：{timeLabel(health.retryAt)}；也可手动刷新。</span>}
        <small>这里只重试读取状态，不执行同步，也不会自动选择冲突版本。</small>
      </div>}
      {actionError && <p className="sync-center-error" role="alert">{actionError}</p>}
      {connectionCheck && <div className="sync-health-check" role="status">
        <strong>{connectionCheck.detail}</strong><span>检查时间：{timeLabel(connectionCheck.at)}；这是只读检查，不代表写入权限或持续在线。</span>
      </div>}
    </div>
    <div className="sync-center-explainer">
      <strong>WebDAV 只替换传输层，不改变冲突规则。</strong>
      <span>笔记、文件夹、标签、标签关联和附件继续使用同一套 manifest、SHA-256 与三方合并。正文和附件都不会按时间戳静默覆盖；冲突仍需明确选择。</span>
    </div>
    <div className="sync-provider-grid">
      <div className={'sync-provider-card ' + (enabled && isLab ? 'active' : '')}>
        <strong>本地实验室</strong><span>用于离线验证同步协议，不连接云端。</span>
        <button className="btn" disabled={!!busy || !settings} onClick={() => void enableLab()}>{busy === 'settings' ? '更新中…' : (enabled && isLab ? '已启用' : '启用本地实验室')}</button>
      </div>
      <div className={'sync-provider-card ' + (enabled && isWebDAV ? 'active' : '')}>
        <strong>WebDAV</strong><span>支持自建 WebDAV、NAS 与兼容服务。公网端点必须使用 HTTPS。</span>
        <label>端点<input aria-label="WebDAV 端点" value={webdav.endpoint} disabled={!!busy} placeholder="https://dav.example.com/local-notepad" onChange={event => editDraft('endpoint', event.target.value)}/></label>
        <label>用户名<input aria-label="WebDAV 用户名" value={webdav.username} disabled={!!busy} autoComplete="username" onChange={event => editDraft('username', event.target.value)}/></label>
        <label>密码<input aria-label="WebDAV 密码" type="password" value={webdav.password} disabled={!!busy} autoComplete="new-password" placeholder={hasAnySecret ? '已保存；留空保持不变' : '输入 WebDAV 密码'} onChange={event => editDraft('password', event.target.value)}/></label>
        {draftChanged && <small className="sync-draft-notice">有尚未保存的配置；状态刷新不会覆盖输入，请保存并验证后再测试连接。</small>}
        {hasSecureSecret && <small className="sync-secret-state secure">密码已由操作系统保护存储持有，不写入新的 SQLite / .lnw 工作区备份。</small>}
        {!hasSecureSecret && hasLegacySecret && <small className="sync-secret-state warning">检测到旧版工作区密码；留空保持不变。重新输入一次密码并保存，即可迁移到系统保护存储并清理 SQLite 明文。</small>}
        {!secretStatus?.available && typeof window.electronAPI?.webdavSecretStatus === 'function' && <small className="sync-secret-state warning">当前系统安全存储不可用；不会把新密码伪装成安全凭据。Linux basic_text 降级也会被拒绝。</small>}
        {secretStatus?.managed === false && typeof window.electronAPI?.webdavSecretStatus === 'function' && <small className="sync-secret-state warning">开发模式后端不由 Electron 管理；新密码需要兼容 DB 副本才能立即生效。</small>}
        {hasAnySecret && <button className="btn small" disabled={!!busy} onClick={() => void clearWebDAVPassword()}>{busy === 'secret' ? '清除中…' : '清除已保存密码'}</button>}
        {isWebDAV && settings?.sync_endpoint?.trim() && <button className="btn" disabled={!!busy || draftChanged} onClick={() => void checkConnection()}>{busy === 'check' ? '检查中…' : '测试连接（只读）'}</button>}
        {enabled && isWebDAV && <div className="sync-auto-controls">
          <div><strong>自动同步</strong><span>{settings?.sync_auto_enabled ? '已开启；有未处理冲突时会自动暂停。' : '关闭时仍可手动预演和同步。'}</span></div>
          <label>间隔<select aria-label="自动同步间隔" value={settings?.sync_interval_minutes || 5} disabled={!!busy || draftChanged} onChange={event => void updateAuto(settings?.sync_auto_enabled === true, event.target.value)}>
            {[1, 5, 15, 30, 60].map(value => <option key={value} value={value}>{value} 分钟</option>)}
          </select></label>
          <button className="btn" disabled={!!busy || (draftChanged && !settings?.sync_auto_enabled)} onClick={() => void updateAuto(settings?.sync_auto_enabled !== true)}>{busy === 'auto' ? '更新中…' : (settings?.sync_auto_enabled ? '暂停自动同步' : '开启自动同步')}</button>
        </div>}
        <button className="btn primary" disabled={!!busy || !settings || !webdav.endpoint.trim()} onClick={() => void saveWebDAV()}>{busy === 'webdav' ? '验证中…' : (enabled && isWebDAV ? '保存并重新验证 WebDAV' : '保存、验证并启用 WebDAV')}</button>
      </div>
    </div>
    <div className="settings-row">
      <div><strong>设备身份</strong><span className="sync-device-id">{status?.device_id || '正在读取…'}</span></div>
      {enabled && <button className="btn" disabled={!!busy} onClick={() => void pause()}>{busy === 'settings' ? '更新中…' : '暂停同步'}</button>}
    </div>
    {status?.base_items > 0 && <div className="sync-rebind-notice">
      <div><strong>切换 provider 或 WebDAV 地址？</strong><span>先重新绑定，避免把旧远端身份误带到新目标。此操作只重置同步元数据，并会暂停自动同步直到你重新开启。</span></div>
      <button className="btn" disabled={!!busy} onClick={() => void rebind()}>{busy === 'rebind' ? '重置中…' : '重新绑定远端'}</button>
    </div>}
    {enabled && <>
      <div className="sync-center-metrics">
        <div><strong>{status?.base_items ?? 0}</strong><span>已建立基线</span></div>
        <div><strong>{status?.open_conflicts ?? conflicts.length}</strong><span>待处理冲突</span></div>
        <div><strong>{syncStatusLabel(status?.last_status)}</strong><span>最近状态</span></div>
      </div>
      <div className="settings-action-row consumer-settings-actions">
        <button className="btn" disabled={!!busy} onClick={() => void preview()}>{busy === 'plan' ? '预演中…' : '预演同步'}</button>
        <button className="btn primary" disabled={!!busy} onClick={() => void synchronize()}>{busy === 'run' ? '同步中…' : '执行同步'}</button>
        {isLab && <button className="btn" disabled={!!busy || typeof window.electronAPI?.openAppFolder !== 'function'} onClick={() => void openLab()}>打开模拟远端</button>}
      </div>
      {plan && <div className="sync-plan-summary" role="status"><strong>最近同步计划</strong><span>{describePlan(plan)}</span>{plan.needs_init && <small>首次执行会创建新的远端仓库身份。</small>}</div>}
      {status?.last_error && <p className="sync-center-error" role="alert">{status.last_error}</p>}
      {conflicts.length > 0 && <div className="sync-conflict-list">
        <div className="sync-conflict-heading"><strong>冲突中心</strong><span>不会自动覆盖，必须明确选择</span></div>
        {conflicts.map(conflict => <article className="sync-conflict-item" key={conflict.id}>
          <div><strong>{recordLabel(conflict.local_record, conflict.item_id)}</strong><span>本机：{recordLabel(conflict.local_record, '不存在')} · 远端：{recordLabel(conflict.remote_record, '不存在')}</span></div>
          <div className="sync-conflict-actions">
            <button className="btn small" disabled={!!busy} onClick={() => void resolve(conflict.id, 'remote')}>采用远端</button>
            <button className="btn small primary" disabled={!!busy} onClick={() => void resolve(conflict.id, 'local')}>保留本机</button>
          </div>
        </article>)}
      </div>}
    </>}
  </section>
}
