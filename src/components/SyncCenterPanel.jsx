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

  const refresh = useCallback(async () => {
    try {
      const [nextSettings, nextStatus, nextConflicts] = await Promise.all([
        api('/api/settings'),
        api('/api/sync/status'),
        api('/api/sync/conflicts'),
      ])
      if (!alive.current) return
      setSettings(nextSettings)
      setStatus(nextStatus)
      setConflicts(Array.isArray(nextConflicts) ? nextConflicts : [])
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

  const saveWebDAV = () => {
    const patch = {
      sync_enabled: true,
      sync_provider: 'webdav',
      sync_endpoint: webdav.endpoint.trim(),
      sync_username: webdav.username.trim(),
    }
    if (webdav.password !== '') patch.sync_password = webdav.password
    return updateSettings('webdav', patch, 'WebDAV 已保存并启用')
  }

  const pause = () => updateSettings('settings', { sync_enabled: false }, '已暂停同步')

  const updateAuto = (enabled, interval = settings?.sync_interval_minutes || 5) =>
    updateSettings('auto', {
      sync_auto_enabled: enabled,
      sync_interval_minutes: Number(interval),
    }, enabled ? '已开启自动同步' : '已暂停自动同步')

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

  return <section className="settings-card consumer-settings-section sync-center-card">
    <div className="settings-card-header">
      <div>
        <h3>同步中心</h3>
        <p>Phase 2C · WebDAV 自动同步与冲突保护</p>
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
          placeholder={settings?.sync_password_set ? '已保存；留空保持不变' : '输入 WebDAV 密码'}
          onChange={event => setWebdav(value => ({ ...value, password: event.target.value }))}/></label>
        {settings?.sync_password_set && <small className="sync-secret-state">密码已保存；输入新密码会替换，留空保持不变。</small>}
        <small>密码不会通过设置读取接口回显；当前版本保存在本机 SQLite 中，请保护系统账户与工作区备份。</small>
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
          {busy === 'webdav' ? '保存中…' : (enabled && isWebDAV ? '保存 WebDAV 设置' : '保存并启用 WebDAV')}
        </button>
      </div>
    </div>

    <div className="settings-row">
      <div><strong>设备身份</strong><span className="sync-device-id">{status?.device_id || '正在读取…'}</span></div>
      {enabled && <button className="btn" disabled={!!busy} onClick={() => void pause()}>
        {busy === 'settings' ? '更新中…' : '暂停同步'}
      </button>}
    </div>

    {enabled && <>
      <div className="sync-center-metrics">
        <div><strong>{status?.base_items ?? 0}</strong><span>已建立基线</span></div>
        <div><strong>{status?.open_conflicts ?? conflicts.length}</strong><span>待处理冲突</span></div>
        <div><strong>{status?.last_status || 'never'}</strong><span>最近状态</span></div>
      </div>
      {status?.base_items > 0 && <div className="sync-rebind-notice">
        <div><strong>切换 provider 或 WebDAV 地址？</strong><span>先重新绑定，避免把旧远端身份误带到新目标。此操作只重置同步元数据，并会暂停自动同步直到你重新开启。</span></div>
        <button className="btn" disabled={!!busy} onClick={() => void rebind()}>{busy === 'rebind' ? '重置中…' : '重新绑定远端'}</button>
      </div>}
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
