import { useEffect, useRef, useState } from 'react'
import { collectionName, searchCollections } from '~/services/searchCollections'
import { collectSearchResultReport, downloadSearchResultReport, searchExportFilterKey, MAX_SEARCH_EXPORT_ITEMS } from '~/services/searchResultExport'

export default function useSearchResultExport({ open, ready, filters, response, opening }) {
  const [selection, setSelection] = useState({ key: '', entries: [] })
  const [format, setFormat] = useState('markdown')
  const [includeSnippets, setIncludeSnippets] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const operation = useRef(null)
  // Invalid/overlong query drafts must not crash the whole workbench.
  let filterKey
  try { filterKey = searchExportFilterKey(filters) } catch { filterKey = '' }
  const key = ready && response ? filterKey + ':' + response.revision : ''
  const entries = key && selection.key === key ? selection.entries : []
  const selectedIds = new Set(entries.map(entry => entry.id))
  const active = useRef(null)
  active.current = { open, ready, opening, key }

  const cancel = () => {
    if (!operation.current) return
    operation.current.abort(); operation.current = null
    setBusy(false); setProgress(null); setMessage('已取消导出，选择仍保留；没有下载部分文件。')
  }
  useEffect(() => {
    if (key && selection.key !== key) {
      if (selection.entries.length) setMessage('检索条件或资料库版本已变化，旧选择已清空，请按新结果重新选择。')
      setSelection({ key, entries: [] })
    }
  }, [key])
  useEffect(() => {
    if (!open || !ready || opening) cancel()
    return () => {
      if (operation.current) { operation.current.abort(); operation.current = null; setBusy(false); setProgress(null) }
    }
  }, [open, ready, opening, key])
  const choose = items => {
    if (!ready || busy || !key) return
    const next = new Map(entries.map(entry => [entry.id, entry]))
    for (const item of items) next.set(item.id, { id: item.id, page: response.page, contentSHA256: item.content_sha256 })
    if (next.size > MAX_SEARCH_EXPORT_ITEMS) { setMessage(`最多选择 ${MAX_SEARCH_EXPORT_ITEMS} 篇，原选择未改变。`); return }
    setSelection({ key, entries: [...next.values()] }); setMessage('')
  }
  const toggle = item => {
    if (!ready || busy) return
    if (!selectedIds.has(item.id)) choose([item])
    else { setSelection({ key, entries: entries.filter(entry => entry.id !== item.id) }); setMessage('') }
  }
  const clear = () => { if (!busy) { setSelection({ key, entries: [] }); setMessage('') } }
  const removePage = () => {
    if (!ready || busy) return
    const ids = new Set(response.items.map(item => item.id))
    setSelection({ key, entries: entries.filter(entry => !ids.has(entry.id)) }); setMessage('')
  }
  const start = async (mode, saveAs) => {
    if (!open || !ready || opening || operation.current || !key) return
    let name
    try { if (saveAs !== undefined) name = collectionName(saveAs) } catch (failure) { setMessage(failure.message); return }
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setProgress(null); setMessage('')
    const isCurrent = () => operation.current === controller && !controller.signal.aborted && active.current.open && active.current.ready && !active.current.opening && active.current.key === key
    try {
      const report = await collectSearchResultReport(filters, response, { mode, selection: entries, includeSnippets: name ? false : includeSnippets,
        signal: controller.signal, onProgress: value => { if (isCurrent()) setProgress(value) } })
      if (!isCurrent()) return
      if (name) {
        searchCollections.save(name, report)
        setMessage(`已保存资料集“${name}” · ${report.count} 篇；不含正文节选，可在“本地资料集”中重开。`)
      } else {
        const filename = downloadSearchResultReport(report, format)
        setMessage(`已发起 ${report.count} 篇结果清单下载：${filename}。请在下载目录核对文件；笔记未修改。`)
      }
    } catch (failure) {
      if (isCurrent()) setMessage(failure.message || '导出未完成，请重试；没有下载部分清单。')
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); setProgress(null) }
    }
  }
  return { entries, selectedIds, format, setFormat, includeSnippets, setIncludeSnippets, message, busy, progress,
    choosePage: () => choose(response.items), removePage, toggle, clear, start, cancel }
}
