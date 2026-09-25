import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
import './SyncCenterPanel.css'

const describePlan = plan => plan
  ? `上传 ${plan.uploads || 0} · 下载 ${plan.downloads || 0} · 冲突 ${plan.conflicts || 0} · 无变化 ${plan.noops || 0}`
  : ''

const recordLabel = (record, fallback) =>
  record?.state === 'purged' ? '已永久删除' : (record?.file?.title || fallback || '未知对象')

export default function SyncCenterPanel() {
  const alive = useRef(false)
  const operation = useRef(false)
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState(null)
  const [plan, setPlan] = useState(null)
  const [conflicts, setConflicts] = useState([])
  const [busy, setBusy] = useState('')

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

  const updateLab = enabled => exclusive('settings', async () => {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        sync_enabled: enabled,
        sync_provider: enabled ? 'local-lab' : (settings?.sync_provider || 'local-lab'),
      }),
    })
    if (!alive.current) return
    setPlan(null)
    await refresh()
    if (alive.current) toast.success(enabled ? '已启用本地同步实验室' : '已暂停同步')
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

  const enabled = settings?.sync_enabled === true && settings?.sync_provider === 'local-lab'

  return <section className="settings-card consumer-settings-section sync-center-card">
    <div className="settings-card-header">
      <div>
        <h3>同步实验室</h3>
        <p>Phase 2A · Local-first 三方同步协议</p>
      </div>
      <span className={'settings-status-pill ' + (enabled ? 'ok' : 'neutral')}>{enabled ? '已启用' : '未启用'}</span>
    </div>

    <div className="sync-center-explainer">
      <strong>先验证同步正确性，不把实验室伪装成正式云同步。</strong>
      <span>当前只同步笔记、文件夹及删除状态；附件、标签尚未纳入。双方同时修改同一对象时进入冲突中心，不按时间戳自动选赢家。</span>
    </div>

    <div className="settings-row">
      <div><strong>设备身份</strong><span className="sync-device-id">{status?.device_id || '正在读取…'}</span></div>
      <button className="btn" disabled={!!busy || !settings} onClick={() => void updateLab(!enabled)}>
        {busy === 'settings' ? '更新中…' : (enabled ? '暂停实验室' : '启用实验室')}
      </button>
    </div>

    {enabled && <>
      <div className="sync-center-metrics">
        <div><strong>{status?.base_items ?? 0}</strong><span>已建立基线</span></div>
        <div><strong>{status?.open_conflicts ?? conflicts.length}</strong><span>待处理冲突</span></div>
        <div><strong>{status?.last_status || 'never'}</strong><span>最近状态</span></div>
      </div>
      <div className="settings-action-row consumer-settings-actions">
        <button className="btn" disabled={!!busy} onClick={() => void preview()}>{busy === 'plan' ? '预演中…' : '预演同步'}</button>
        <button className="btn primary" disabled={!!busy} onClick={() => void synchronize()}>{busy === 'run' ? '同步中…' : '执行同步'}</button>
        <button className="btn" disabled={!!busy || typeof window.electronAPI?.openAppFolder !== 'function'} onClick={() => void openLab()}>打开模拟远端</button>
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
