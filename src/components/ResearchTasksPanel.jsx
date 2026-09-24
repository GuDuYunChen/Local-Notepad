import React, { useCallback, useEffect, useRef, useState } from 'react'
import { researchTasks, RESEARCH_TASK_PREFIX, RESEARCH_PHASES } from '~/services/researchTasks'
import { downloadCollectionReviewReport } from '~/services/collectionReviewReport'
import './StudyCompilationPanel.css'

export default function ResearchTasksPanel({ active, onReceipt, service = researchTasks }) {
  const [entries, setEntries] = useState([]), [selection, setSelection] = useState(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [removing, setRemoving] = useState(false)
  const operation = useRef(null), live = useRef(false), current = useRef(null)
  current.current = { active, selection, confirmed, service }
  const refresh = useCallback(() => {
    try { setEntries(service.store.list()) }
    catch (e) { setError('研究任务读取失败，不能判断为空：' + e.message) }
  }, [service])
  useEffect(() => {
    live.current = true
    setBusy(false)
    if (active) refresh()
    return () => { live.current = false; operation.current?.abort(); operation.current = null }
  }, [active, refresh])
  useEffect(() => {
    const changed = () => {
      if (!live.current) return
      refresh()
      // Do not adopt new raw bytes into an already reviewed selection. The next
      // read/submit must match the exact version the user actually inspected.
      setConfirmed(false); setRemoving(false)
    }
    const storage = event => { if (event.key === null || event.key?.startsWith(RESEARCH_TASK_PREFIX)) changed() }
    const off = service.store.subscribe(changed)
    window.addEventListener('storage', storage); window.addEventListener('focus', changed)
    return () => { off(); window.removeEventListener('storage', storage); window.removeEventListener('focus', changed) }
  }, [service, refresh])
  const select = entry => {
    if (busy) return
    setConfirmed(false); setRemoving(false); setError(''); setMessage('')
    try { setSelection({ entry, task: service.store.read(entry) }) }
    catch (e) { setSelection({ entry, task: null }); setError(e.message) }
  }
  const perform = async send => {
    if (!selection?.task || operation.current || !active || (send && !confirmed)) return
    const controller = new AbortController(); operation.current = controller
    const expected = selection
    setBusy(true); setError(''); setMessage(''); setRemoving(false)
    // Confirmation is captured for this exact selected snapshot. Store-change
    // notifications during our own pending write may reset the checkbox, but
    // cannot change the ID or immutable payload already explicitly authorized.
    const options = { signal: controller.signal, isCurrent: () => live.current && current.current.active && current.current.selection === expected && current.current.service === service }
    try {
      const result = await (send ? service.submit(expected.entry, options) : service.check(expected.entry, options))
      if (!options.isCurrent() || controller.signal.aborted) return
      if (result.receipt) {
        const receipt = result.receipt
        if (receipt.state === 'available') {
          try { onReceipt?.({ status: 'confirmed', id: receipt.file_id, title: receipt.title, taskId: receipt.request_id,
            draft: { text: expected.task.preview.markdown, filename: expected.task.preview.title, type: 'text/markdown;charset=utf-8' } }) } catch { /* a parent view failure does not undo creation */ }
          setMessage('已查回此任务对应的笔记；可使用上方“打开新研究笔记”。没有覆盖当前正文。' + result.localWarning)
          window.dispatchEvent(new Event('library:refresh'))
        } else setMessage((receipt.state === 'deleted' ? '此任务创建的笔记在回收站。' : '此任务创建的笔记已不在当前数据库。') + '不会重新创建或覆盖。' + result.localWarning)
        try { setSelection({ entry: result.entry, task: service.store.read(result.entry) }) } catch { /* explicit refresh will restore current journal version */ }
      } else setMessage(result.localWarning)
    } catch (e) { if (live.current) setError(e.message) }
    finally {
      if (operation.current === controller) { operation.current = null; if (live.current) { setBusy(false); setConfirmed(false); refresh() } }
    }
  }
  const remove = async () => {
    if (!selection || busy || !removing || !active) return
    setBusy(true); setError('')
    try { await service.store.remove(selection.entry); setSelection(null); setRemoving(false); setMessage('已移除本地任务记录，没有删除任何正文或服务端回执。') }
    catch (e) { setError(e.message) }
    finally { setBusy(false); refresh() }
  }
  const download = () => {
    try {
      const task = service.store.read(selection.entry)
      downloadCollectionReviewReport({ text: task.preview.markdown, filename: task.preview.title, type: 'text/markdown;charset=utf-8' })
      setMessage('已发起完整研究草稿下载。文件包含已存私人批注；它不携带可重试的任务身份。')
    } catch (e) { setError(e.message) }
  }
  const task = selection?.task
  const stale = selection && !entries.some(entry => entry.key === selection.entry.key && entry.raw === selection.entry.raw)
  return <details className="study-compilation research-tasks" aria-label="研究草稿与创建记录">
    <summary>研究草稿与创建记录 · {entries.length} / 10</summary>
    <p>保存过的研究预览和创建任务在本机保留。查回只读取结果；创建或重试必须明确确认，始终使用同一任务身份。</p>
    <button type="button" disabled={!active || busy} onClick={() => { setError(''); refresh(); setSelection(null); setConfirmed(false); setRemoving(false) }}>刷新研究任务</button>
    {error && <p role="alert" className="study-hub-notice">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!entries.length && !error && <p>暂无已保存研究任务。请先生成研究预览，再保存草稿或确认创建。</p>}
    <div className="research-task-list">{entries.map(entry => <button type="button" key={entry.key} disabled={!active || busy}
      aria-pressed={selection?.entry.key === entry.key} onClick={() => select(entry)}>
      <strong>{entry.task?.preview.title || '不可读取的研究任务'}</strong>
      <span>{entry.task ? RESEARCH_PHASES[entry.task.phase] + ' · ' + entry.task.preview.count + ' 条批注' : entry.error}</span>
      <small>{entry.task ? new Date(entry.task.updatedAt).toLocaleString('zh-CN') : entry.key}</small>
    </button>)}</div>
    {selection && <section aria-label="已存研究任务预览" className="study-compilation-preview">
      {task && <>
        <h4>{task.preview.title}</h4><p className="study-compilation-boundary">任务：{task.id}<br />源快照：{task.preview.loadedAt} · 目标目录 ID：{task.preview.parentId || '根目录'}</p>
        <p>以下是保存时的完整历史草稿，不会自动混入最新批注或当前未保存内容。后续源资料变化不自动更新此草稿。</p>
        <div className="study-compilation-document" tabIndex={0} aria-label="历史研究草稿完整内容">
          <h4>研究目标</h4><p>{task.preview.goal || '（待填写）'}</p>
          {task.preview.groups.map(group => <section key={group.key}><h4>{group.title}</h4>{group.items.map(item => <article key={JSON.stringify([item.collectionId, item.id])}>
            <h5>{item.title}</h5><small>{item.collectionName} · {item.collectionId} · 笔记 ID：{item.id}</small><p>{item.note}</p>
          </article>)}</section>)}
          <h4>我的结论与下一步</h4><p>（创建后在新笔记中自行填写，未自动生成结论。）</p>
        </div>
        {stale && <p role="status">此任务记录已变化，请重新选择列表中的最新记录；旧预览不能提交。</p>}
        {!task.receipt && <label className="research-task-confirm"><input type="checkbox" checked={confirmed} disabled={!active || busy || stale} onChange={e => setConfirmed(e.target.checked)} />我已核对完整历史草稿及目录，明确以此内容创建或重试，不使用当前未保存批注。</label>}
        <div className="study-hub-actions">
          <button type="button" disabled={!active || busy || stale} onClick={() => void perform(false)}>查回此任务创建结果</button>
          {!task.receipt && <button type="button" disabled={!active || busy || stale || !confirmed} onClick={() => void perform(true)}>以同一任务创建或重试</button>}
          <button type="button" disabled={busy || stale} onClick={download}>下载已存研究草稿</button>
        </div>
      </>}
      {busy && <p role="status">正在处理研究任务，关闭面板不等于回滚已发出的写入。</p>}
      <button type="button" disabled={!active || busy || stale} onClick={() => setRemoving(true)}>移除本地研究任务记录</button>
      {removing && <div className="study-hub-notice" role="alert"><p>移除后将失去此任务的本地草稿和查回入口；不会删除正文。结果不确定的任务应先查回，避免重新整理成另一个任务后重复创建。</p>
        <button type="button" disabled={busy} onClick={() => void remove()}>确认只移除本地任务</button><button type="button" disabled={busy} onClick={() => setRemoving(false)}>取消移除研究任务</button>
      </div>}
    </section>}
    <p className="study-compilation-boundary">本地任务最多 10 份、每份 3 MiB，不自动清理；文件和存储未加密。前后端须配套升级。防重复限同一任务和同一数据库历史；更换或回退数据库、丢失任务身份后不能保证。任务不包含在正文数据库备份中。</p>
  </details>
}
