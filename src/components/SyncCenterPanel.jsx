import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import './SyncCenterPanel.css'

const describePlan = plan => plan
  ? `上传 ${plan.uploads || 0} · 下载 ${plan.downloads || 0} · 冲突 ${plan.conflicts || 0} · 无变化 ${plan.noops || 0}`
  : ''

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

export default function SyncCenterPanel() {
  const alive = useRef(false)
  const operation = useRef(false)
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState(null)
  const [plan, setPlan] = useState(null)
  const [conflicts, setConflicts] = useState([])
  const [busy, setBusy] = useState('')
  const [webdav, setWebdav] = useState({ endpoint: '', username: '', password: '' })
  const [secretStatus, setSecretStatus] = useState({ available: false, stored: false, managed: false, backend: '' })

  const refresh = useCallback(async () => {
    try {
      const secretPromise = typeof window.electronAPI?.webdavSecretStatus === 'function'
        ? window.electronAPI.webdavSecretStatus()
        : Promise.resolve({ success: false, available: false, stored: false, managed: false, backend: '' })
      const [nextSettings, nextStatus, nextConflicts, nextSecret] = await Promise.all([
        api('/api/settings'),
        api('/api/sync/status'),
        api('/api/sync/conflicts'),
        secretPromise,
      ])
      if (!alive.current) return
      setSettings(nextSettings)
      setStatus(nextStatus)
      setConflicts(Array.isArray(nextConflicts) ? nextConflicts : [])
      setSecretStatus(nextSecret && typeof nextSecret === 'object' ? nextSecret : { available: false, stored: false, managed: false, backend: '' })
      setWebdav(current => ({
        endpoint: nextSettings?.sync_endpoint || '',
        username: nextSettings?.sync_username || '',
        password: current.password,
      }))
    } catch (error) {
      if (alive.current) toast.error(error?.message || '读取同步状态失败')
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
      operation.current = false
    }
  }, [refresh])

  useEffect(() => {
    if (!settings?.sync_auto_enabled) return undefined
    const timer = window.setInterval(() => { void refresh() }, 15000)
    return () => window.clearInterval(timer)
  }, [refresh, settings?.sync_auto_enabled])

  const exclusive = async (key, task) => {
    if (operation.current) return
    operation.current = true
    setBusy(key)
    try {
      await task()
    } catch (error) {
      if (alive.current) toast.error(error?.message || '同步操作失败')
    } finally {
      operation.current = false
      if (alive.current) setBusy('')
    }
  }

  const updateSettings = (key, patch, message) => exclusive(key, async () => {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })
    if (!alive.current) return
    setPlan(null)
    await refresh()
    if (alive.current) toast.success(message)
  })

  const enableLab = () => updateSettings('settings', {
    sync_enabled: true,
    sync_provider: 'local-lab',
  }, '已启用本地同步实验室')

  const saveWebDAV = () => exclusive('webdav', async () => {
    const password = webdav.password
    if (password && typeof window.electronAPI?.webdavSecretSave !== 'function') {
      throw new Error('当前环境无法使用系统安全存储，请在桌面应用中保存 WebDAV 密码')
    }
    if (password && secretStatus?.available !== true) {
      throw new Error('系统安全存储不可用，未修改 WebDAV 配置')
    }
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          sync_enabled: false,
          sync_auto_enabled: false,
          sync_provider: 'webdav',
          sync_endpoint: webdav.endpoint.trim(),
          sync_username: webdav.username.trim(),
        }),
      })
      if (password) {
        const secret = await window.electronAPI.webdavSecretSave(password)
        if (secret?.success !== true || secret?.stored !== true) throw new Error(secret?.message || '系统安全存储未保存 WebDAV 密码')
        await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({ sync_password: secret.restartRequired ? password : '' }),
        })
        setWebdav(current => ({ ...current, password: '' }))
      }
      await api('/api/sync/check', { method: 'POST', body: '{}' })
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ sync_enabled: true }) })
      if (!alive.current) return
      setPlan(null)
      await refresh()
      if (alive.current) toast.success(password ? 'WebDAV 已验证并启用；密码已迁移到系统保护存储' : 'WebDAV 已验证并启用')
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
    setWebdav(current => ({ ...current, password: '' }))
    await refresh()
    if (alive.current) toast.success('已清除 WebDAV 密码')
  })

  const pause = () => updateSettings('settings', { sync_enabled: false }, '已暂停同步')

  const updateAuto = (enabled, interval = settings?.sync_interval_minutes || 5) => exclusive('auto', async () => {
    await api('/api/sync/auto', {
      method: 'POST',
      body: JSON.stringify({ enabled, interval_minutes: Number(interval) }),
    })
    if (!alive.current) return
    await refresh()
    if (alive.current) toast.success(enabled ? '连接验证通过，已开启自动同步' : '已暂停自动同步')
  })

  const rebind = () => {
    if (!window.confirm('重新绑定只会清除本机同步基线、旧远端身份和未决冲突状态，不会删除笔记、附件或远端数据。继续吗？')) return
    return exclusive('rebind', async () => {
      const next = await api('/api/sync/rebind', { method: 'POST', body: '{}' })
      if (!alive.current) return
      setPlan(null)
      setStatus(next)
      setConflicts([])
      setSettings(current => current ? ({ ...current, sync_auto_enabled: false }) : current)
      toast.success('已重新绑定同步目标并暂停自动同步；请先预演同步')
    })
  }

  const checkConnection = () => exclusive('check', async () => {
    const result = await api('/api/sync/check', { method: 'POST', body: '{}' })
    if (!alive.current) return
    const detail = result?.initialized
      ? `远端可用 · 第 ${result.generation || 0} 代 · ${result.items || 0} 个对象`
      : '远端可用 · 尚未初始化，同步前不会写入任何探针'
    toast.success(detail)
  })

  const preview = () => exclusive('plan', async () => {
    const next = await api('/api/sync/plan', { method: 'POST', body: '{}' })
    if (!alive.current) return
    setPlan(next)
    toast.success('同步预演完成；没有写入远端或本机正文')
  })

  const synchronize = () => exclusive('run', async () => {
    const result = await api('/api/sync/run', { method: 'POST', body: '{}' })
    if (!alive.current) return
    setPlan(result?.plan || null)
    await refresh()
    if (alive.current) toast.success(result?.conflicts ? '同步完成，有冲突需要人工处理' : '同步完成')
  })

  const resolve = (id, choice) => exclusive(id + ':' + choice, async () => {
    await api('/api/sync/conflicts/' + encodeURIComponent(id) + '/resolve', {
      method: 'POST',
      body: JSON.stringify({ choice }),
    })
    await refresh()
    if (alive.current) toast.success(choice === 'local' ? '已保留本机版本' : '已采用远端版本')
  })

  const openLab = () => exclusive('folder', async () => {
    const result = await window.electronAPI?.openAppFolder?.('syncLab')
    if (result && result.success === false) throw new Error(result.message || '打开模拟远端失败')
  })

  const enabled = settings?.sync_enabled === true
  const provider = settings?.sync_provider || 'local-lab'
  const isLab = provider === 'local-lab'
  const isWebDAV = provider === 'webdav'
  const hasSecureSecret = secretStatus?.stored === true
  const hasLegacySecret = settings?.sync_password_set === true
  const hasAnySecret = hasSecureSecret || hasLegacySecret

  return <section className="settings-card consumer-settings-section sync-center-card">
    <div className="settings-card-header">
      <div>
        <h3>同步中心</h3>
        <p>Phase 2E · WebDAV 验证后启用</p>
      </div>
      <span className={'settings-status-pill ' + (enabled ? 'ok' : 'neutral')}>
        {enabled ? ('已启用 · ' + providerName(provider)) : '未启用'}
      </span>
    </div>

    <div className="sync-center-explainer">
      <strong>WebDAV 只替换传输层，不改变冲突规则。</strong>
      <span>笔记、文件夹、标签、标签关联和附件继续使用同一套 manifest、SHA-256 与三方合并。正文和附件都不会按时间戳静默覆盖；冲突仍需明确选择。</span>
    </div>

    <div className="sync-provider-grid">
      <div className={'sync-provider-card ' + (enabled && isLab ? 'active' : '')}>
        <strong>本地实验室</strong>
        <span>用于离线验证同步协议，不连接云端。</span>
        <button className="btn" disabled={!!busy || !settings} onClick={() => void enableLab()}>
          {busy === 'settings' ? '更新中…' : (enabled && isLab ? '已启用' : '启用本地实验室')}
        </button>
      </div>
      <div className={'sync-provider-card ' + (enabled && isWebDAV ? 'active' : '')}>
        <strong>WebDAV</strong>
        <span>支持自建 WebDAV、NAS 与兼容服务。公网端点必须使用 HTTPS。</span>
        <label>端点<input aria-label="WebDAV 端点" value={webdav.endpoint} disabled={!!busy}
          placeholder="https://dav.example.com/local-notepad"
          onChange={event => setWebdav(value => ({ ...value, endpoint: event.target.value }))}/></label>
        <label>用户名<input aria-label="WebDAV 用户名" value={webdav.username} disabled={!!busy}
          autoComplete="username"
          onChange={event => setWebdav(value => ({ ...value, username: event.target.value }))}/></label>
        <label>密码<input aria-label="WebDAV 密码" type="password" value={webdav.password} disabled={!!busy}
          autoComplete="new-password"
          placeholder={hasAnySecret ? '已保存；留空保持不变' : '输入 WebDAV 密码'}
          onChange={event => setWebdav(value => ({ ...value, password: event.target.value }))}/></label>
        {hasSecureSecret && <small className="sync-secret-state secure">密码已由操作系统保护存储持有，不写入新的 SQLite / .lnw 工作区备份。</small>}
        {!hasSecureSecret && hasLegacySecret && <small className="sync-secret-state warning">检测到旧版工作区密码；留空保持不变。重新输入一次密码并保存，即可迁移到系统保护存储并清理 SQLite 明文。</small>}
        {!secretStatus?.available && typeof window.electronAPI?.webdavSecretStatus === 'function' &&
          <small className="sync-secret-state warning">当前系统安全存储不可用；不会把新密码伪装成安全凭据。Linux basic_text 降级也会被拒绝。</small>}
        {secretStatus?.managed === false && typeof window.electronAPI?.webdavSecretStatus === 'function' &&
          <small className="sync-secret-state warning">开发模式后端不由 Electron 管理；新密码需要兼容 DB 副本才能立即生效。</small>}
        {hasAnySecret && <button className="btn small" disabled={!!busy} onClick={() => void clearWebDAVPassword()}>
          {busy === 'secret' ? '清除中…' : '清除已保存密码'}
        </button>}
        {isWebDAV && webdav.endpoint.trim() && <button className="btn" disabled={!!busy} onClick={() => void checkConnection()}>
          {busy === 'check' ? '检查中…' : '测试连接（只读）'}
        </button>}
        {enabled && isWebDAV && <div className="sync-auto-controls">
          <div>
            <strong>自动同步</strong>
            <span>{settings?.sync_auto_enabled ? '已开启；有未处理冲突时会自动暂停。' : '关闭时仍可手动预演和同步。'}</span>
          </div>
          <label>间隔
            <select aria-label="自动同步间隔" value={settings?.sync_interval_minutes || 5} disabled={!!busy}
              onChange={event => void updateAuto(settings?.sync_auto_enabled === true, event.target.value)}>
              <option value="1">1 分钟</option>
              <option value="5">5 分钟</option>
              <option value="15">15 分钟</option>
              <option value="30">30 分钟</option>
              <option value="60">60 分钟</option>
            </select>
          </label>
          <button className="btn" disabled={!!busy} onClick={() => void updateAuto(settings?.sync_auto_enabled !== true)}>
            {busy === 'auto' ? '更新中…' : (settings?.sync_auto_enabled ? '暂停自动同步' : '开启自动同步')}
          </button>
        </div>}
        <button className="btn primary" disabled={!!busy || !settings || !webdav.endpoint.trim()} onClick={() => void saveWebDAV()}>
          {busy === 'webdav' ? '验证中…' : (enabled && isWebDAV ? '保存并重新验证 WebDAV' : '保存、验证并启用 WebDAV')}
        </button>
      </div>
    </div>

    <div className="settings-row">
      <div><strong>设备身份</strong><span className="sync-device-id">{status?.device_id || '正在读取…'}</span></div>
      {enabled && <button className="btn" disabled={!!busy} onClick={() => void pause()}>
        {busy === 'settings' ? '更新中…' : '暂停同步'}
      </button>}
    </div>

    {status?.base_items > 0 && <div className="sync-rebind-notice">
      <div><strong>切换 provider 或 WebDAV 地址？</strong><span>先重新绑定，避免把旧远端身份误带到新目标。此操作只重置同步元数据，并会暂停自动同步直到你重新开启。</span></div>
      <button className="btn" disabled={!!busy} onClick={() => void rebind()}>{busy === 'rebind' ? '重置中…' : '重新绑定远端'}</button>
    </div>}

    {enabled && <>
      <div className="sync-center-metrics">
        <div><strong>{status?.base_items ?? 0}</strong><span>已建立基线</span></div>
        <div><strong>{status?.open_conflicts ?? conflicts.length}</strong><span>待处理冲突</span></div>
        <div><strong>{status?.last_status || 'never'}</strong><span>最近状态</span></div>
      </div>
      <div className="settings-action-row consumer-settings-actions">
        <button className="btn" disabled={!!busy} onClick={() => void preview()}>{busy === 'plan' ? '预演中…' : '预演同步'}</button>
        <button className="btn primary" disabled={!!busy} onClick={() => void synchronize()}>{busy === 'run' ? '同步中…' : '执行同步'}</button>
        {isLab && <button className="btn" disabled={!!busy || typeof window.electronAPI?.openAppFolder !== 'function'} onClick={() => void openLab()}>打开模拟远端</button>}
      </div>
      {plan && <div className="sync-plan-summary" role="status">
        <strong>最近同步计划</strong><span>{describePlan(plan)}</span>
        {plan.needs_init && <small>首次执行会创建新的远端仓库身份。</small>}
      </div>}
      {status?.last_error && <p className="sync-center-error" role="alert">{status.last_error}</p>}
      {conflicts.length > 0 && <div className="sync-conflict-list">
        <div className="sync-conflict-heading"><strong>冲突中心</strong><span>不会自动覆盖，必须明确选择</span></div>
        {conflicts.map(conflict => <article className="sync-conflict-item" key={conflict.id}>
          <div>
            <strong>{recordLabel(conflict.local_record, conflict.item_id)}</strong>
            <span>本机：{recordLabel(conflict.local_record, '不存在')} · 远端：{recordLabel(conflict.remote_record, '不存在')}</span>
          </div>
          <div className="sync-conflict-actions">
            <button className="btn small" disabled={!!busy} onClick={() => void resolve(conflict.id, 'remote')}>采用远端</button>
            <button className="btn small primary" disabled={!!busy} onClick={() => void resolve(conflict.id, 'local')}>保留本机</button>
          </div>
        </article>)}
      </div>}
    </>}
  </section>
}
