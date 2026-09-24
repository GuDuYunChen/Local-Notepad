import React, { useEffect, useRef, useState } from 'react'
import { collectionPackages, MAX_COLLECTION_PACKAGE_BYTES } from '~/services/collectionPackage'
import { downloadCollectionReviewReport } from '~/services/collectionReviewReport'
import './CollectionPackageTransfer.css'

const ACTIONS = {
  create: '新增独立资料集与配套阅读记录',
  resume: '继续上次中断的恢复，复用已暂存的阅读记录',
  complete: '为已有恢复副本补齐缺失的阅读记录',
  existing: '本机已有恢复副本，保留其当前阅读记录，不重复写入',
}
export default function CollectionPackageTransfer({ entry, disabled = false, onImported,
  service = collectionPackages, download = downloadCollectionReviewReport }) {
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const operation = useRef(null), live = useRef(true), trigger = useRef(null), restoreFocus = useRef(false)
  const latest = useRef(null); latest.current = { key: entry?.key, raw: entry?.raw, disabled }
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(false); setPreview(null) }
  useEffect(() => { live.current = true; return () => { live.current = false; operation.current?.abort(); operation.current = null } }, [])
  useEffect(() => { cancel(); setError('') }, [entry?.key, entry?.raw, disabled])
  useEffect(() => {
    if (restoreFocus.current && !preview && !busy && !disabled) { restoreFocus.current = false; trigger.current?.focus() }
  }, [preview, busy, disabled])
  const execute = async task => {
    if (disabled || operation.current) return
    const controller = new AbortController(); operation.current = controller
    const key = entry?.key, raw = entry?.raw
    const current = () => live.current && operation.current === controller && !controller.signal.aborted &&
      !latest.current.disabled && latest.current.key === key && latest.current.raw === raw
    setBusy(true); setError(''); setMessage('')
    try { await task({ signal: controller.signal, isCurrent: current }, current) }
    catch (failure) { if (current()) setError(failure?.message || '便携备份操作失败，请保留原文件后重试') }
    finally { if (current()) { operation.current = null; setBusy(false) } }
  }
  const prepare = file => {
    if (!file) return
    setPreview(null)
    void execute(async (options, current) => {
      if (file.size > MAX_COLLECTION_PACKAGE_BYTES) throw new Error('便携备份文件超过 4 MiB，未读取或恢复')
      const raw = await file.text()
      if (!current()) return
      const result = await service.prepareImport(raw, options)
      if (current()) { setPreview(result); setMessage('预检完成，尚未写入；请核对名称、篇数和批注范围。') }
    })
  }
  return <details className="collection-package-transfer">
    <summary>资料集便携备份与恢复</summary>
    <p>一个 JSON 配套保存所选资料集、已保存的阅读状态、批注与书签。未保存批注草稿、正文、附件及其他资料集不在其中；需要留存的批注请先保存。</p>
    <div className="collection-package-tools">
      <button type="button" disabled={disabled || busy || !!preview || !entry?.collection} onClick={() => void execute(async (options, current) => {
        const text = await service.exportPackage(entry, options)
        if (!current()) return
        download({ text, filename: `Local-Notepad-资料集便携备份-${entry.collection.id}.json`, type: 'application/json;charset=utf-8' })
        setMessage('已发起配套 JSON 下载，请核对保存位置；只包含已保存的记录，不是正文备份。')
      })}>备份资料集及阅读记录</button>
      <label>选择便携备份文件<input ref={trigger} type="file" accept=".json,application/json" aria-label="选择资料集便携备份" disabled={disabled || busy || !!preview} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; prepare(file)
      }} /></label>
    </div>
    <p>预检后才恢复，不按同名覆盖。相同配套备份重复恢复会识别已有副本，并保留本机后续修改。文件最多 4 MiB；校验和用于检查文件一致性，不是发送者身份认证。</p>
    {busy && <p role="status">正在校验或恢复… <button type="button" onClick={() => { cancel(); setMessage('已取消操作，未继续恢复；原文件与旧记录保留。') }}>取消便携备份操作</button></p>}
    {error && <p role="alert" className="collection-package-notice">{error}</p>}
    {message && <p role="status" className="collection-package-notice">{message}</p>}
    {preview && <div className="collection-package-preview" role="group" aria-label="便携备份恢复预检">
      <h4>{preview.pack.collection.name}</h4>
      <p>资料 {preview.counts.items} 篇 · 已读 {preview.counts.read} · 待复看 {preview.counts.revisit} · 有批注 {preview.counts.notes} 篇</p>
      <p>{preview.pack.study === null ? '此文件不含已保存阅读记录，恢复后从未读开始。' : '配套阅读记录已通过校验；书签：' + (preview.counts.bookmark || '无')}</p>
      <p>备份时间：{new Date(preview.pack.exportedAt).toLocaleString('zh-CN')}</p>
      <strong>{ACTIONS[preview.action]}</strong>
      <p>不创建正文，也未检查原笔记是否存在。本机缺少正文时，应另外迁移正文数据库。恢复分步写入，若中断，请保留同一文件重新预检继续，不会把部分恢复当成成功。</p>
      <div className="collection-package-tools">
        <button type="button" disabled={busy || disabled} onClick={() => { restoreFocus.current = true; setPreview(null); setMessage('已取消恢复预检，未写入。') }}>取消便携备份恢复</button>
        <button type="button" disabled={busy || disabled} onClick={() => void execute(async (options, current) => {
          const result = await service.confirmImport(preview, options)
          if (!current()) return
          setPreview(null)
          setMessage(result.action === 'existing' ? '已有恢复副本，未重复新增或覆盖后续批注。' : '配套恢复完成，资料集与已保存阅读记录均可使用；原记录和正文未覆盖。')
          // Parent view errors must not misreport a committed restore as a storage failure.
          try { onImported?.(result.collection) } catch { setMessage('配套恢复已完成，请刷新资料集列表查看。') }
        })}>确认恢复便携备份</button>
      </div>
    </div>}
  </details>
}
