import React, { useEffect, useId, useRef, useState } from 'react'
import { readHistoryFile } from '~/services/syncHistoryFile.mjs'
import { describeHistoryTimeFilter } from '~/services/syncHistoryTime.mjs'
import { historyOutcome, historyTime } from '~/services/syncConflictHistory.mjs'
import './SyncHistoryFileViewer.css'

const PAGE_SIZE = 25
const kinds = { file: '笔记或文件夹', tag: '标签', 'file-tag': '标签关联', attachment: '附件' }
const statuses = { all: '全部历史类型', resolved: '已选边处理', superseded: '已失效' }
const choices = { all: '全部处理结果', local: '保留本机', remote: '采用远端', superseded: '已失效', unknown: '处理方式未核实' }
const fileLabel = file => [...String(file.name || '所选 JSON 文件').split(/[\\/]/).pop()].slice(0, 160).join('')
function Stamp({ value }) {
  const iso = historyTime(value)
  return iso ? <time dateTime={iso}>{iso}</time> : '时间缺失'
}
export default function SyncHistoryFileViewer() {
  const hintID = useId(), resultID = useId()
  const list = useRef(null)
  const chooseButton = useRef(null), input = useRef(null), generation = useRef(0), current = useRef(null), live = useRef(false)
  const [view, setView] = useState(null), [phase, setPhase] = useState('unread'), [notice, setNotice] = useState(''), [page, setPage] = useState(0)
  useEffect(() => {
    live.current = true
    return () => { live.current = false; generation.current++; current.current?.abort(); current.current = null }
  }, [])
  useEffect(() => { if (list.current) list.current.scrollTop = 0 }, [page, view])
  const select = async file => {
    if (!file) return // cancelling the picker does not discard a previous result
    const id = ++generation.current
    current.current?.abort()
    const controller = new AbortController(); current.current = controller
    setPhase('reading'); setNotice('正在读取所选文件；没有上传、导入或执行同步。')
    try {
      const report = await readHistoryFile(file, { signal: controller.signal })
      if (!live.current || id !== generation.current || controller.signal.aborted) return
      setView({ name: fileLabel(file), report }); setPage(0); setPhase('ready')
      setNotice(`文件格式检查通过，共 ${report.records.length} 条；仅供离线查看，未验证来源或当前状态。`)
    } catch (error) {
      if (!live.current || id !== generation.current || controller.signal.aborted) return
      setPhase('error'); setNotice(error.code ? error.message : '文件读取失败；没有改变工作区。')
    } finally { if (current.current === controller) current.current = null }
  }
  const stop = (event, clear = false) => {
    const ownsFocus = event.currentTarget === event.currentTarget.ownerDocument.activeElement
    generation.current++; current.current?.abort(); current.current = null
    if (clear) { setView(null); setPage(0); setPhase('unread'); setNotice('已清除查看结果；没有删除原文件或工作区数据。') }
    else { setPhase('stopped'); setNotice('已停止文件读取；没有取消同步或保存任务。') }
    if (ownsFocus) chooseButton.current?.focus({ preventScroll: true })
  }
  const report = view?.report
  const pages = report ? Math.ceil(report.records.length / PAGE_SIZE) : 0
  const start = page * PAGE_SIZE
  return <details className="sync-history-file" data-history-file-viewer>
    <summary>离线查看历史文件<span>只读 JSON · 不导入工作区</span></summary>
    <div className="sync-history-file-body">
      <p id={hintID}>选择本应用导出的历史 JSON v1 / v2 文件（最多 4 MiB、2000 条）。仅在当前窗口读取，不上传、不保存副本，不恢复笔记或修改冲突。</p>
      <div className="sync-history-file-controls">
        <input ref={input} hidden type="file" accept=".json,application/json" data-history-file-input aria-label="选择历史 JSON 文件"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void select(file) }}/>
        <button type="button" className="btn small" ref={chooseButton} data-history-file-choose aria-describedby={hintID} aria-controls={resultID}
          onClick={() => input.current?.click()}>选择历史 JSON 文件</button>
        {phase === 'reading' && <button type="button" className="btn small" data-history-file-stop onClick={event => stop(event)}>停止文件读取</button>}
        {(view || phase !== 'unread') && <button type="button" className="btn small" data-history-file-clear onClick={event => stop(event, true)}>清除查看结果</button>}
      </div>
      <p className="sync-history-file-notice" data-history-file-notice role="status" aria-live="polite">{notice || '尚未选择文件；展开此面板不会读取工作区或发起请求。'}</p>
      {view && <section id={resultID} data-history-file-result aria-label="离线历史文件内容">
        {phase !== 'ready' && <p className="sync-history-file-stale" data-history-file-stale>下方仍为上一次成功读取的文件，不是本次读取的新结果。</p>}
        <h5>文件：<bdi data-history-file-name>{view.name}</bdi></h5>
        <p data-history-file-scope>文件内有 {report.records.length} 条记录；文件声明当时已读取 {report.loadedCount} 条。{report.hasUnreadOlderRecords ? '导出时仍有更早记录未读取。' : '未读页标记以文件声明为准。'}不是全部历史或笔记备份。</p>
        <p>文件声明的导出时间（UTC）：<time data-history-file-time dateTime={report.exportedAtUTC}>{report.exportedAtUTC}</time></p>
        <p data-history-file-source>{report.sourceState === 'error' ? '文件注明：导出前最近一次读取失败，使用更早的读取结果。' : report.sourceState === 'stopped' ? '文件注明：导出前最近一次读取已停止，使用此前读取结果。' : '文件注明：导出时读取完成；不代表当前工作区或远端状态。'}</p>
        <details className="sync-history-file-filters"><summary>查看文件声明的筛选范围</summary>
          <p>{statuses[report.filters.recordStatus]} · {report.filters.objectType === 'all' ? '全部对象' : kinds[report.filters.objectType]} · {choices[report.filters.outcome]}</p>
          <p data-history-file-dates>{describeHistoryTimeFilter(report.filters.timeFilter)}</p>
          <p>{report.filters.textFilterApplied ? '导出时使用了文字筛选；文件没有保存查找词，无法重现完整查询。' : '文件声明未使用文字筛选。'}</p>
        </details>
        <p className="sync-history-file-warning">文件可被修改，格式检查不证明来源真实。“已失效”不等于已解决；这些记录不会与上方本机历史合并，也不证明当前两端一致。</p>
        <div ref={list} className="sync-history-file-list" tabIndex={0} role="region" aria-label="离线文件记录列表">
          <ol start={start + 1}>
            {report.records.slice(start, start + PAGE_SIZE).map(row => <li key={row.id} data-history-file-row>
              <strong><bdi>{row.title || kinds[row.kind]}</bdi></strong><small> {kinds[row.kind]} · 文件内的当前标题，仅供辨认</small>
              <p>{historyOutcome(row)}</p>
              <dl><div><dt>建立时间（UTC）</dt><dd><Stamp value={row.createdAt}/></dd></div>
                <div><dt>处理或失效时间（UTC）</dt><dd><Stamp value={row.resolvedAt}/></dd></div></dl>
              <details><summary>查看文件内标识</summary><p>对象：<bdi><code>{row.itemID}</code></bdi></p><p>记录：<bdi><code>{row.id}</code></bdi></p></details>
            </li>)}
          </ol>
        </div>
        <div className="sync-history-file-pages" role="group" aria-label="离线文件分页">
          <button type="button" className="btn small" data-history-file-prev aria-disabled={page === 0} onClick={() => setPage(n => Math.max(0, n - 1))}>上一页</button>
          <span data-history-file-page role="status">第 {page + 1} / {pages} 页，本页第 {start + 1}–{Math.min(start + PAGE_SIZE, report.records.length)} 条</span>
          <button type="button" className="btn small" data-history-file-next aria-disabled={page + 1 >= pages} onClick={() => setPage(n => Math.min(pages - 1, n + 1))}>下一页</button>
        </div>
      </section>}
    </div>
  </details>
}
