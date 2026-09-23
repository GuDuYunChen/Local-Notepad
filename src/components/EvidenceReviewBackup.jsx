import React, { useEffect, useRef, useState } from 'react'
import { reviewArchives } from '~/services/evidenceReviewArchives'
import { buildReviewBackup, downloadReviewBackup, planReviewBackupImport,
  importReviewBackup, MAX_REVIEW_BACKUP_LENGTH } from '~/services/evidenceReviewBackup'
import './EvidenceReviewBackup.css'

const statusLabel = { new: '将新增', existing: '本地已有，跳过', duplicate: '文件内重复，跳过' }

export default function EvidenceReviewBackup({ entries = [], storageError = '', scopeLabel = '当前范围' }) {
  const [reading, setReading] = useState(false)
  const [raw, setRaw] = useState(null)
  const [preview, setPreview] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [message, setMessage] = useState(null)
  const [page, setPage] = useState(1)
  const input = useRef(null)
  const previewHeading = useRef(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const consumed = useRef(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current += 1 }
  }, [])
  useEffect(() => { if (preview) previewHeading.current?.focus() }, [preview])

  const clear = () => {
    generation.current += 1
    setReading(false); setRaw(null); setPreview(null); setOutcome(null); setMessage(null); setPage(1)
    input.current?.previousElementSibling?.focus()
  }
  const preflight = value => {
    setOutcome(null); setMessage(null); setPreview(null); setPage(1)
    try { setPreview(planReviewBackupImport(value, reviewArchives)) }
    catch (error) { setMessage({ error: true, text: error.message || '预检失败；没有写入任何存档' }) }
  }
  const readFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const token = ++generation.current
    setReading(true); setRaw(null); setPreview(null); setOutcome(null); setMessage(null)
    try {
      // UTF-8 uses at most three bytes per UTF-16 code unit for valid JSON text.
      if (file.size > MAX_REVIEW_BACKUP_LENGTH * 3) throw new Error('备份文件过大；没有读取或导入存档')
      const value = await file.text()
      if (!mounted.current || token !== generation.current) return
      setRaw(value); preflight(value)
    } catch (error) {
      if (mounted.current && token === generation.current) setMessage({ error: true, text: error.message || '文件读取失败，没有导入存档' })
    } finally { if (mounted.current && token === generation.current) setReading(false) }
  }
  const confirm = () => {
    if (!preview || consumed.current === preview) return
    consumed.current = preview
    try {
      const result = importReviewBackup(preview, reviewArchives)
      setOutcome(result); setPreview(null); setMessage(null)
    } catch (error) {
      setPreview(null); setMessage({ error: true, text: error.message || '导入未开始，请重新预检' })
    }
  }
  const pages = Math.max(1, Math.ceil((preview?.items.length || 0) / 8))
  const currentPage = Math.min(page, pages)
  return <details className="evidence-review-backup">
    <summary>整包备份与导入预检</summary>
    <div className="evidence-review-backup-body">
      <p>一次备份{scopeLabel}的全部 {entries.length} 份存档，覆盖所有分页。仅包含已存档的核对记录与备注，不含正文、未存档进度或应用设置。</p>
      <div className="evidence-review-backup-tools">
        <button type="button" disabled={reading || Boolean(storageError) || !entries.length} onClick={() => {
          try {
            downloadReviewBackup(buildReviewBackup(entries, reviewArchives))
            setMessage({ error: false, text: `已发起 ${entries.length} 份存档备份下载，请确认文件实际保存。不会清空本地记录。` })
          } catch (error) { setMessage({ error: true, text: error.message || '备份失败，原记录未改动' }) }
        }}>备份当前范围全部存档</button>
        <button type="button" disabled={reading} onClick={() => input.current?.click()}>选择备份文件并预检</button>
        <input ref={input} type="file" accept=".json,application/json" aria-label="预检核对备份文件" hidden onChange={event => void readFile(event)} />
        {(reading || raw !== null) && <button type="button" onClick={clear}>{reading ? '取消读取' : '关闭导入预检'}</button>}
        {raw !== null && !reading && !preview && <button type="button" onClick={() => preflight(raw)}>重新预检此文件</button>}
      </div>
      <p>支持本功能导出的整包 JSON 和原有单份存档 JSON。选择文件只预览，不自动导入。重复判定比较历史保存时间和完整核对内容，不按文件名或存档 ID 猜测。</p>
      {reading && <p role="status">正在读取备份文件，尚未写入存档…</p>}
      {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {outcome && <div className="evidence-review-backup-result" role={outcome.error ? 'alert' : 'status'}>
        <strong>{outcome.complete ? '导入处理完成' : '导入已停止'}</strong>
        <p>已新增 {outcome.importedCount} 份，重复跳过 {outcome.skippedCount} 份，尚未导入 {outcome.remainingCount} 份。</p>
        {outcome.error && <p>{outcome.error}</p>}
        <p>已有存档与当前核对未被覆盖。新记录可在“全部本地存档”查看；未自动恢复核对。重试前请重新预检，已成功写入的相同记录会跳过。</p>
      </div>}
      {preview && <section className="evidence-review-backup-preview" aria-label="备份导入预检结果">
        <h4 ref={previewHeading} tabIndex={-1}>请核对导入范围</h4>
        <p role="status">文件共 {preview.items.length} 份；将新增 {preview.newCount} 份；重复跳过 {preview.skippedCount} 份；本地剩余 {preview.available} 个存档位置。</p>
        <p>请核对下方项目与实体。确认后仅新增独立存档，不创建正文或自动恢复核对；中途失败会停止并保留成功项，剩余可重试。</p>
        {!preview.fits && <p role="alert">容量不足，不能确认导入。请先备份并手动整理本地存档，再重新预检；不会自动删除旧记录。</p>}
        <button type="button" className="evidence-review-backup-confirm" disabled={reading || Boolean(storageError) || !preview.fits || !preview.newCount} onClick={confirm}>确认导入新增 {preview.newCount} 份</button>
        <ul aria-label="备份内存档清单">
          {preview.items.slice((currentPage - 1) * 8, currentPage * 8).map(item => <li key={item.index}>
            <div><strong>{item.archive.data.entityLabel || '未命名实体'}</strong><span>{statusLabel[item.status]}</span></div>
            <p>项目 {item.archive.data.projectId} · 实体 {item.archive.data.entityId} · {item.archive.data.chapters.length} 章</p>
            <time dateTime={item.archive.savedAt}>{new Date(item.archive.savedAt).toLocaleString('zh-CN', { hour12: false })}</time>
          </li>)}
        </ul>
        {pages > 1 && <nav aria-label="备份预检分页">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页预检</button>
          <span>{currentPage} / {pages}</span>
          <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页预检</button>
        </nav>}
        <p>确认时再次校验本地存档。批量写入不是整包事务：中途空间不足或出现变化时立即停止，已成功新增的记录保留，并显示实际新增与剩余数量。</p>
      </section>}
    </div>
  </details>
}
