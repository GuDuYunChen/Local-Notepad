import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { evidenceReview } from '~/services/evidenceReviewSession'
import { reviewArchives, REVIEW_ARCHIVE_PREFIX } from '~/services/evidenceReviewArchives'
import { downloadEvidenceReviewReport } from '~/services/evidenceReviewReport'
import useBackupDialogFocus from '~/hooks/useBackupDialogFocus'
import EvidenceReviewArchives from './EvidenceReviewArchives'
import { formatBackupDate, formatBackupSize, readDatabaseBackupList, reviewBackupCoverage } from './backupCenterUtils'
import './BackupPanel.css'

function DatabaseBackups() {
  const [result, setResult] = useState({ status: 'loading', backups: [], directory: '', latestPath: '', error: '' })
  const [folder, setFolder] = useState({ busy: false, error: '' })
  const generation = useRef(0)
  const alive = useRef(false)
  const folderBusy = useRef(false)
  const operation = useRef(false)
  const [task, setTask] = useState({ busy: false, message: '', error: false })
  const [verified, setVerified] = useState({})
  const load = useCallback(async () => {
    const token = ++generation.current
    setVerified({})
    const bridge = window.electronAPI
    if (typeof bridge?.backupList !== 'function') {
      setResult({ status: 'unavailable', backups: [], directory: '', latestPath: '', error: '' }); return
    }
    setResult({ status: 'loading', backups: [], directory: '', latestPath: '', error: '' })
    try {
      const value = readDatabaseBackupList(await bridge.backupList())
      if (alive.current && token === generation.current) setResult({ ...value, status: 'ready', error: '' })
    } catch (error) {
      if (alive.current && token === generation.current) {
        setResult({ status: 'error', backups: [], directory: '', latestPath: '', error: error.message || '读取失败，请重试' })
      }
    }
  }, [])
  useEffect(() => {
    alive.current = true; void load()
    return () => { alive.current = false; generation.current += 1 }
  }, [load])
  const openFolder = async () => {
    if (folderBusy.current) return
    const bridge = window.electronAPI
    if (typeof bridge?.backupOpenFolder !== 'function') return
    folderBusy.current = true; setFolder({ busy: true, error: '' })
    try {
      const response = await bridge.backupOpenFolder()
      if (response?.success !== true) throw new Error(response?.message || '无法打开备份文件夹')
    } catch (error) {
      if (alive.current) setFolder({ busy: false, error: error.message || '无法打开备份文件夹，请重试' })
    } finally {
      folderBusy.current = false
      if (alive.current) setFolder(previous => ({ ...previous, busy: false }))
    }
  }
  const runSafety = async (method, name) => {
    if (operation.current) return
    const bridge = window.electronAPI
    if (typeof bridge?.[method] !== 'function') return
    operation.current = true
    setTask({ busy: true, error: false, message: method === 'backupCreate' ? '正在创建并校验数据库快照…' :
      method === 'backupExport' ? '正在校验并另存备份…' : '正在进行 SQLite 完整性校验…' })
    try {
      const result = await bridge[method](name)
      if (!alive.current) return
      if (result?.canceled) { setTask({ busy: false, error: false, message: '已取消另存；没有覆盖任何文件。' }); return }
      if (result?.success !== true) throw new Error(result?.message || '数据库操作未完成')
      const info = result.backup
      if (!info || !/^[a-f0-9]{64}$/.test(info.sha256) || !Number.isSafeInteger(info.files) || info.files < 0 ||
        !Number.isInteger(info.schemaVersion) || info.schemaVersion < 1 || info.schemaVersion > 9 ||
        (name && info.name !== name) || (method === 'backupExport' && !result.path)) {
        throw new Error('校验回执不完整，未将本次操作标记为成功')
      }
      if (method === 'backupCreate') await load()
      if (!alive.current) return
      setVerified(previous => ({ ...previous, [info.name]: info }))
      setTask({ busy: false, error: false, message: method === 'backupCreate' ?
        '新备份已创建并通过完整性校验；已保存的正文已包含，未保存草稿、外部附件与核对存档不包含。' :
        method === 'backupExport' ? '备份已写入所选位置，并确认 SHA-256 与源文件一致。' :
        'SQLite 完整性与版本检查通过；这不代表外部附件完整或所有正文符合预期。',
        path: result.path || '', hash: info.sha256 })
    } catch (error) {
      if (alive.current) {
        if (name) setVerified(previous => { const next = { ...previous }; delete next[name]; return next })
        setTask({ busy: false, error: true, message: error.message || '操作失败，原数据未改动' })
      }
    } finally { operation.current = false }
  }
  return <section className="backup-center-database" aria-label="正文数据库备份">
    <div className="backup-center-section-heading">
      <h3>正文数据库备份</h3>
      <span>手动与自动快照 · 校验后另存</span>
    </div>
    <p>保存数据库内的笔记、项目等数据。<strong>不包含核对存档、未保存正文草稿、外部附件文件或窗口内的核对进度。</strong></p>
    <div className="backup-actions consumer-backup-actions">
      <button type="button" className="btn primary" disabled={task.busy || typeof window.electronAPI?.backupCreate !== 'function'}
        onClick={() => void runSafety('backupCreate')}>立即创建备份</button>
      <button type="button" className="btn primary" onClick={() => void openFolder()}
        disabled={folder.busy || typeof window.electronAPI?.backupOpenFolder !== 'function'}>
        {folder.busy ? '正在打开…' : '打开备份文件夹'}
      </button>
      <button type="button" className="btn" onClick={() => void load()} disabled={task.busy || result.status === 'loading'}>
        {result.status === 'loading' ? '刷新中…' : '刷新列表'}
      </button>
    </div>
    <p className="backup-center-safety-hint">先保存正文再创建备份。手动快照不参与自动淘汰；另存可保留到其他目录或设备，不覆盖已有文件。</p>
    {task.message && <div className="backup-center-safety-result" role={task.error ? 'alert' : 'status'} aria-busy={task.busy}>
      <strong>{task.message}</strong>
      {task.path && <p>文件位置：<code>{task.path}</code></p>}
      {task.hash && <details><summary>查看文件指纹</summary><code>SHA-256 {task.hash}</code></details>}
    </div>}
    {folder.error && <p role="alert" className="backup-center-warning">{folder.error}</p>}
    {result.status === 'unavailable' && <div className="backup-center-notice" role="status">
      <strong>当前环境不支持读取桌面数据库备份</strong>
      <p>请在桌面应用中查看 .db 文件。仍可切换到“核对存档”管理当前浏览器中的记录；这不表示数据库备份不存在。</p>
    </div>}
    {result.status === 'error' && <div className="backup-center-warning" role="alert">
      <strong>数据库备份读取失败</strong><p>{result.error}。未将读取失败当作“没有备份”，原数据未改动。</p>
    </div>}
    {result.directory && <div className="backup-directory"><span>保存位置</span><code>{result.directory}</code></div>}
    <div className="backup-list" aria-busy={result.status === 'loading'}>
      {result.status === 'loading' && <p role="status">正在读取备份…</p>}
      {result.status === 'ready' && <>
        <p role="status">已读取 {result.backups.length} 份数据库备份。列表可读不代表已验证文件可恢复。</p>
        {!result.backups.length ? <div className="backup-center-notice">
          <strong>暂时还没有数据库备份</strong><p>当前目录没有可列出的 .db 备份。可稍后刷新，并检查桌面应用中的存储诊断。</p>
        </div> : <ul className="backup-items">
          {result.backups.map(backup => <li key={backup.path} className="backup-item">
            <div className="backup-name">{backup.name}{backup.path === result.latestPath && <span className="backup-latest">最新记录</span>}</div>
            <div className="backup-meta">{formatBackupSize(backup.size)} · {formatBackupDate(backup.date)} · {backup.name.startsWith('backup-manual-') ? '手动保留' : '自动备份'}</div>
            {verified[backup.name] && <p className="backup-verified">已通过完整性校验 · {verified[backup.name].files} 条记录（含目录及回收站）· 数据版本 {verified[backup.name].schemaVersion}</p>}
            <div className="backup-center-actions">
              <button type="button" className="btn" disabled={task.busy || typeof window.electronAPI?.backupInspect !== 'function'}
                aria-label={'校验备份 ' + backup.name} onClick={() => void runSafety('backupInspect', backup.name)}>校验完整性</button>
              <button type="button" className="btn" disabled={task.busy || typeof window.electronAPI?.backupExport !== 'function'}
                aria-label={'另存备份 ' + backup.name} onClick={() => void runSafety('backupExport', backup.name)}>另存备份</button>
            </div>
          </li>)}
        </ul>}
      </>}
    </div>
    <details className="backup-center-restore-guide">
      <summary tabIndex={0}>恢复前需要注意什么？</summary>
      <p>此处不在运行中覆盖数据库。启动时发现数据库损坏，应用会先校验候选备份，将原 .db、WAL 和 SHM 文件保留在 recovery-preserved 目录后再恢复；没有合格备份时保持原文件不变。遇到未完成恢复标记会停止启动，避免创建空数据库。</p>
      <p>自动快照保留最近 100 份，手动快照不自动清理。需要手动回退版本时，先另存当前数据、核对存档与附件，并完全退出应用再处理；本窗口不提供运行中回退。单独 .db 不包含外部附件或核对存档。</p>
    </details>
  </section>
}

function BackupCenter({ onClose }) {
  const [tab, setTab] = useState('database')
  const [shelf, setShelf] = useState(() => reviewArchives.list())
  const [notice, setNotice] = useState(null)
  const session = useSyncExternalStore(evidenceReview.subscribe, evidenceReview.getSnapshot, () => null)
  const coverage = useMemo(() => reviewBackupCoverage(session, shelf), [session, shelf])
  const overlay = useRef(null), dialog = useRef(null), heading = useRef(null)
  useBackupDialogFocus(overlay, dialog, heading, onClose)
  useEffect(() => {
    const refresh = () => setShelf(reviewArchives.list())
    const unsubscribe = reviewArchives.subscribe(refresh)
    const onStorage = event => { if (event.key === null || event.key?.startsWith(REVIEW_ARCHIVE_PREFIX)) refresh() }
    window.addEventListener('storage', onStorage); window.addEventListener('focus', refresh)
    refresh()
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', refresh) }
  }, [])
  const selectTab = id => { setTab(id); setNotice(null); setShelf(reviewArchives.list()) }
  const tabKey = event => {
    const ids = ['database', 'reviews']
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const id = event.key === 'Home' ? ids[0] : event.key === 'End' ? ids[1] : ids[1 - ids.indexOf(tab)]
    selectTab(id); dialog.current?.querySelector('#backup-tab-' + id)?.focus()
  }
  return <div className="modal-overlay consumer-modal-overlay backup-center-overlay" ref={overlay} role="presentation"
    onMouseDown={event => { if (event.target === event.currentTarget && dialog.current?.querySelectorAll('[role="dialog"]').length === 0) onClose?.() }}>
    <section className="modal consumer-modal backup-modal consumer-backup-modal backup-center-modal" ref={dialog}
      role="dialog" aria-modal="true" aria-labelledby="backup-dialog-title">
      <header className="selector-modal-header">
        <div><h2 className="modal-title" id="backup-dialog-title" ref={heading} tabIndex={-1}>备份与恢复</h2>
          <div className="modal-message">两类数据，分别备份。这里统一管理，不会自动合并为一个完整应用备份。</div></div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭备份中心" title="关闭">×</button>
      </header>
      <div className="backup-center-tabs" role="tablist" aria-label="备份数据类型">
        {[['database', '正文数据库', '笔记与项目 · .db'], ['reviews', '核对存档', '已存档进度与备注 · JSON']].map(([id, label, hint]) =>
          <button key={id} type="button" role="tab" id={'backup-tab-' + id} aria-controls={'backup-panel-' + id}
            aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={tabKey} onClick={() => selectTab(id)}>
            <strong>{label}</strong><span>{hint}</span>
          </button>)}
      </div>
      <div className="backup-center-body">
        {session && <section className="backup-center-active" aria-label="当前核对保存状态">
          <strong>{coverage.state === 'saved' ? '当前核对记录与本地存档一致' : coverage.state === 'unknown' ? '暂不能确认当前核对是否已存档' : '当前核对有尚未存档的记录'}</strong>
          <p>{session.entityLabel || '当前实体'} · {session.chapters.length} 章。{coverage.state === 'saved' ?
            '此状态仅核对本地快照，不代表 JSON 已下载或正文已保存。' : '先保存本地存档，再导出 JSON，才能将最新核对进度包含在备份中。'}</p>
          <div className="backup-center-actions">
            <button type="button" className="btn primary" disabled={coverage.state === 'saved'} onClick={() => {
              const current = evidenceReview.getSnapshot(); if (!current) return
              try { reviewArchives.save(current); setNotice({ text: '已保存当前核对快照；请到“核对存档”导出 JSON 留存。' }) }
              catch (error) { setNotice({ error: true, text: error.message || '存档失败，当前核对记录仍保留' }) }
            }}>保存本地存档</button>
            <button type="button" className="btn" onClick={() => {
              const current = evidenceReview.getSnapshot(); if (!current) return
              try { downloadEvidenceReviewReport(current); setNotice({ text: '已发起本轮 Markdown 清单下载；清单不能用于恢复存档，请确认文件实际保存。' }) }
              catch (error) { setNotice({ error: true, text: error.message || '清单导出失败，记录仍保留' }) }
            }}>导出本轮清单</button>
          </div>
          <small>此处保存核对记录，不会保存编辑器中的正文草稿；关闭备份中心也不会结束当前核对。</small>
        </section>}
        {notice && <p className="backup-center-notice" role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
        <section id="backup-panel-database" role="tabpanel" aria-labelledby="backup-tab-database" hidden={tab !== 'database'}>
          {tab === 'database' && <DatabaseBackups />}
        </section>
        <section id="backup-panel-reviews" role="tabpanel" aria-labelledby="backup-tab-reviews" hidden={tab !== 'reviews'}>
          {tab === 'reviews' && <>
            <div className="backup-center-section-heading"><h3>所有项目的核对存档</h3><span>独立快照 · 手动保存</span></div>
            {shelf.error ? <p role="alert" className="backup-center-warning">{shelf.error}。无法确认存档数量，不代表记录为空。</p> :
              <p className="backup-center-counts" role="status">本地共 {coverage.total} 份 · 可读取 {coverage.readable} 份 · 不可读取 {coverage.unreadable} 份 · 剩余 {coverage.available} 个位置</p>}
            <p>管理、对比或整包导出各项目的存档。恢复核对仍需回到对应项目与实体，不能在此跨项目覆盖当前工作。</p>
            <EvidenceReviewArchives embedded onShelfChange={setShelf} />
          </>}
        </section>
      </div>
      <footer className="backup-center-footer">切换页签或关闭窗口会取消尚未确认的文件预检，不会删除存档或本轮备注。</footer>
    </section>
  </div>
}

export default function BackupPanel({ open, onClose }) {
  // Closing unmounts readers and invalidates pending replies before a later reopen.
  return open ? <BackupCenter onClose={onClose} /> : null
}
