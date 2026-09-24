import React, { useEffect, useRef, useState } from 'react'
import { searchPresets } from '~/services/searchPresets'
import { MAX_PRESET_BACKUP_BYTES, buildSearchPresetBackup, downloadSearchPresetBackup,
  planSearchPresetImport, applySearchPresetImport } from '~/services/searchPresetBackup'

const labels = { new: '将新增', existing: '本地已有', duplicate: '文件内重复' }
export default function SearchPresetTransfer({ store = searchPresets, disabled = false }) {
  const [plan, setPlan] = useState(null), [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const generation = useRef(0), input = useRef(null)
  useEffect(() => () => { generation.current++ }, [])
  const clear = () => { generation.current++; setPlan(null); setBusy(false); setNotice(''); setError(''); if (input.current) input.current.value = '' }
  const preflight = async event => {
    const file = event.target.files?.[0], token = ++generation.current
    setPlan(null); setNotice(''); setError('')
    if (!file) { setBusy(false); return }
    setBusy(true)
    try {
      if (file.size > MAX_PRESET_BACKUP_BYTES) throw new Error('备份文件超过 512 KiB')
      const raw = await file.text()
      if (token !== generation.current) return
      setPlan(planSearchPresetImport(raw, store))
    } catch (failure) { if (token === generation.current) setError(failure.message || '读取备份失败') }
    finally { if (token === generation.current) { setBusy(false); if (input.current) input.current.value = '' } }
  }
  return <section className="search-preset-transfer" aria-label="常用检索备份与导入">
    <p>JSON 只包含手动保存的名称、关键词和条件，不含正文或结果。文件含搜索词，请妥善保管；导入不会自动执行搜索。</p>
    <div className="search-presets-tools">
      <button type="button" disabled={disabled || busy} onClick={() => {
        setError(''); setNotice('')
        try { downloadSearchPresetBackup(buildSearchPresetBackup(store)); setNotice('已发起完整备份下载，请在浏览器或系统下载列表确认文件。') }
        catch (failure) { setError(failure.message) }
      }}>备份全部常用检索</button>
      <label>选择常用检索备份<input ref={input} type="file" accept=".json,application/json" aria-label="选择常用检索备份" disabled={disabled} onChange={preflight} /></label>
      {(plan || busy) && <button type="button" onClick={clear}>取消导入预检</button>}
    </div>
    {busy && <p role="status">正在读取备份，尚未写入任何检索…</p>}
    {plan && <div className="search-preset-import-preview">
      <p role="status">预检 {plan.total} 条：新增 {plan.newCount} 条，本地已有 {plan.existingCount} 条，文件内重复 {plan.fileDuplicateCount} 条。</p>
      <p>同名且全部条件相同视为重复，不覆盖旧条目。导入记录使用本次保存时间；目录标识保持原样，跨资料库应用前需检查目录。</p>
      <ul>{plan.rows.map((row, i) => <li key={i}><strong>{row.name}</strong><span>{labels[row.status]} · {row.query || '无关键词'}{row.folderId ? ' · 有目录限制' : ' · 全部目录'}</span></li>)}</ul>
      <button type="button" disabled={disabled || busy} onClick={() => {
        try {
          const result = applySearchPresetImport(plan, store)
          setPlan(null); setError(result.error)
          setNotice(`已新增 ${result.added} 条，跳过 ${result.skipped} 条，剩余 ${result.remaining} 条。${result.error ? '成功项保留，请重新选择文件预检。' : '当前检索条件与笔记未改变。'}`)
        } catch (failure) { setPlan(null); setError(failure.message) }
      }}>确认导入常用检索</button>
    </div>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {error && <p role="alert" className="global-search-notice">{error}</p>}
  </section>
}
