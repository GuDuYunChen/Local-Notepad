import React, { useState } from 'react'
import { MAX_SEARCH_EXPORT_ITEMS } from '~/services/searchResultExport'

export default function SearchResultExportPanel({ collection, response, ready }) {
  const [name, setName] = useState('')
  const { entries, busy, progress, message } = collection
  return <details className="search-result-export">
    <summary>结果清单与导出 · 已选 {entries.length} 篇{busy ? ' · 正在准备…' : ''}</summary>
    <div className="search-result-export-tools">
      <button type="button" disabled={!ready || busy || !response?.items.length} onClick={collection.choosePage}>加入本页结果</button>
      <button type="button" disabled={!ready || busy || !entries.length} onClick={collection.removePage}>移除本页选择</button>
      <button type="button" disabled={busy || !entries.length} onClick={collection.clear}>清空选择</button>
      <label>格式<select aria-label="检索清单导出格式" value={collection.format} disabled={busy} onChange={event => collection.setFormat(event.target.value)}>
        <option value="markdown">Markdown 阅读清单</option><option value="json">JSON 结构化清单</option>
      </select></label>
      <label className="check"><input type="checkbox" checked={collection.includeSnippets} disabled={busy}
        onChange={event => collection.setIncludeSnippets(event.target.checked)} />附带命中节选（可能含私人内容）</label>
    </div>
    <div className="search-result-export-tools">
      <button type="button" disabled={!ready || busy || !entries.length} onClick={() => void collection.start('selected')}>导出所选 {entries.length} 篇</button>
      <button type="button" disabled={!ready || busy || !response?.total || response.total > MAX_SEARCH_EXPORT_ITEMS} onClick={() => void collection.start('all')}>导出全部 {ready ? response.total : '…'} 篇结果</button>
      {busy && <button type="button" onClick={collection.cancel}>取消导出</button>}
    </div>
    <div className="search-result-export-tools">
      <label>资料集名称<input aria-label="资料集名称" value={name} maxLength={96} disabled={busy}
        placeholder="例如：青崖镇设定资料" onChange={event => setName(event.target.value)} /></label>
      <button type="button" disabled={!ready || busy || !entries.length || !name.trim()} onClick={() => void collection.start('selected', name)}>保存所选为资料集</button>
      <button type="button" disabled={!ready || busy || !response?.total || response.total > MAX_SEARCH_EXPORT_ITEMS || !name.trim()} onClick={() => void collection.start('all', name)}>保存全部为资料集</button>
    </div>
    <p>资料集仅手动保存元数据，不包含正文或节选。同名保存新增独立记录，不自动覆盖。可在顶部“本地资料集”中查看、复查及备份。</p>
    <p>可在右侧预览加入单篇，或跨页加入整页。每次最多 {MAX_SEARCH_EXPORT_ITEMS} 篇、8 MiB；超限请缩小范围，不会截断导出。选择只在当前窗口保留，条件或数据变化后清空。</p>
    <p>默认只有标题、目录、笔记标识与命中数量。勾选后每篇最多附 3 段节选，不含完整正文；此清单不是笔记备份。</p>
    {progress && <div role="status"><progress aria-label="检索清单准备进度" max={progress.total} value={progress.completed} /> {progress.phase === 'verify' ? '正在完成最后版本复验…' : `已读取 ${progress.completed} / ${progress.total} 页`}</div>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </details>
}
