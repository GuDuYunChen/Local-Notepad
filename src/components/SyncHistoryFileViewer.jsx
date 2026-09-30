import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { readHistoryFile } from '~/services/syncHistoryFile.mjs'
import { describeHistoryTimeFilter } from '~/services/syncHistoryTime.mjs'
import { historyOutcome, historyTime } from '~/services/syncConflictHistory.mjs'
import { limitHistoryQuery } from '~/services/syncHistorySearch.mjs'
import { HISTORY_FILE_FILTER_ALL, selectHistoryFilePage } from '~/services/syncHistoryFileSelection.mjs'
import './SyncHistoryFileViewer.css'

const kinds = { file: '笔记或文件夹', tag: '标签', 'file-tag': '标签关联', attachment: '附件' }
const statuses = { all: '全部历史类型', resolved: '已选边处理', superseded: '已失效' }
const choices = { all: '全部处理结果', local: '保留本机', remote: '采用远端', superseded: '已失效', unknown: '处理方式未核实' }
const fileLabel = file => [...String(file.name || '所选 JSON 文件').split(/[\\/]/).pop()].slice(0, 160).join('')
function Stamp({ value }) {
  const iso = historyTime(value)
  return iso ? <time dateTime={iso}>{iso}</time> : '时间缺失'
}
export default function SyncHistoryFileViewer() {
  const hintID = useId(), resultID = useId(), searchHintID = useId(), matchesID = useId()
  const list = useRef(null), queryInput = useRef(null), compositionActive = useRef(false)
  const chooseButton = useRef(null), input = useRef(null), generation = useRef(0), current = useRef(null), live = useRef(false)
  const [view, setView] = useState(null), [phase, setPhase] = useState('unread'), [notice, setNotice] = useState(''), [page, setPage] = useState(0)
  const [filters, setFilters] = useState(HISTORY_FILE_FILTER_ALL)
  const [queryDraft, setQueryDraft] = useState(''), [composing, setComposing] = useState(false)
  const applyFilters = next => {
    if (next.query === filters.query && next.kind === filters.kind && next.outcome === filters.outcome) return
    setFilters(next); setPage(0)
  }
  const applyQuery = value => {
    const query = limitHistoryQuery(value)
    setQueryDraft(query); applyFilters({ ...filters, query })
  }
  const finishComposition = event => {
    if (!compositionActive.current) return
    compositionActive.current = false; setComposing(false); applyQuery(event.currentTarget.value)
  }
  const resetSelection = () => {
    compositionActive.current = false; setComposing(false); setQueryDraft('')
    setFilters(HISTORY_FILE_FILTER_ALL); setPage(0)
  }
  useEffect(() => {
    live.current = true
    return () => { live.current = false; generation.current++; current.current?.abort(); current.current = null }
  }, [])
  useEffect(() => { if (list.current) list.current.scrollTop = 0 }, [page, view, filters])
  const select = async file => {
    if (!file) return // cancelling the picker does not discard a previous result
    const id = ++generation.current
    current.current?.abort()
    const controller = new AbortController(); current.current = controller
    setPhase('reading'); setNotice('正在读取所选文件；没有上传、导入或执行同步。')
    try {
      const report = await readHistoryFile(file, { signal: controller.signal })
      if (!live.current || id !== generation.current || controller.signal.aborted) return
      setView({ name: fileLabel(file), report }); resetSelection(); setPhase('ready')
      setNotice(`文件格式检查通过，共 ${report.records.length} 条；仅供离线查看，未验证来源或当前状态。`)
    } catch (error) {
      if (!live.current || id !== generation.current || controller.signal.aborted) return
      setPhase('error'); setNotice(error.code ? error.message : '文件读取失败；没有改变工作区。')
    } finally { if (current.current === controller) current.current = null }
  }
  const stop = (event, clear = false) => {
    const ownsFocus = event.currentTarget === event.currentTarget.ownerDocument.activeElement
    generation.current++; current.current?.abort(); current.current = null
    if (clear) { setView(null); resetSelection(); setPhase('unread'); setNotice('已清除查看结果；没有删除原文件或工作区数据。') }
    else { setPhase('stopped'); setNotice('已停止文件读取；没有取消同步或保存任务。') }
    if (ownsFocus) chooseButton.current?.focus({ preventScroll: true })
  }
  const report = view?.report
  const selection = useMemo(() => report ? selectHistoryFilePage(report.records, filters, page) : null, [report, filters, page])
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
        <fieldset className="sync-history-file-search" aria-describedby={searchHintID} data-history-file-search>
          <legend>查找文件内记录</legend>
          <p id={searchHintID}>查找本文件全部记录的标题、对象或记录标识，不限于当前页；不搜索正文，不读取本机历史。选字确认后最多 128 个字符。</p>
          <div className="sync-history-file-search-fields">
            <label className="sync-history-file-search-query">查找文字
              <input ref={queryInput} type="search" data-history-file-query aria-label="在离线文件全部记录中查找"
                aria-controls={matchesID} value={queryDraft} placeholder="输入文件内的标题或标识" autoComplete="off" spellCheck={false}
                onCompositionStart={() => { compositionActive.current = true; setComposing(true) }}
                onCompositionEnd={finishComposition} onBlur={finishComposition}
                onChange={event => {
                  if (compositionActive.current || event.nativeEvent.isComposing) {
                    compositionActive.current = true; setComposing(true); setQueryDraft(event.target.value)
                  } else applyQuery(event.target.value)
                }}/>
            </label>
            <label>对象类型<select data-history-file-kind aria-label="筛选离线文件对象类型" value={filters.kind}
              onChange={event => applyFilters({ ...filters, kind: event.target.value })}>
              <option value="all">全部对象</option>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>当时的处理结果<select data-history-file-outcome aria-label="筛选离线文件处理结果" value={filters.outcome}
              onChange={event => applyFilters({ ...filters, outcome: event.target.value })}>
              {Object.entries(choices).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            {(queryDraft || filters.query || filters.kind !== 'all' || filters.outcome !== 'all') &&
              <button type="button" className="btn small" data-history-file-filter-clear onClick={event => {
                const ownsFocus = event.currentTarget === event.currentTarget.ownerDocument.activeElement
                resetSelection(); if (ownsFocus) queryInput.current?.focus({ preventScroll: true })
              }}>清除文件内筛选</button>}
          </div>
        </fieldset>
        <p id={matchesID} data-history-file-matches role="status" aria-live="polite">
          {composing && <span data-history-file-composing>输入法文字尚未确认，仍按原文件内查找条件显示。</span>}
          当前匹配 {selection.matched} 条 / 文件内共 {selection.total} 条；只改变查看结果，不改变文件声明的导出范围。
        </p>
        <div ref={list} className="sync-history-file-list" tabIndex={0} role="region" aria-label="离线文件记录列表">
          {!selection.matched && <p data-history-file-empty>本文件中没有符合当前条件的记录；不是本机或全部历史没有记录。可清除文件内筛选。</p>}
          <ol start={selection.from || 1}>
            {selection.rows.map(row => <li key={row.id} data-history-file-row>
              <strong><bdi>{row.title || kinds[row.kind]}</bdi></strong><small> {kinds[row.kind]} · 文件内的当前标题，仅供辨认</small>
              <p>{historyOutcome(row)}</p>
              <dl><div><dt>建立时间（UTC）</dt><dd><Stamp value={row.createdAt}/></dd></div>
                <div><dt>处理或失效时间（UTC）</dt><dd><Stamp value={row.resolvedAt}/></dd></div></dl>
              <details><summary>查看文件内标识</summary><p>对象：<bdi><code>{row.itemID}</code></bdi></p><p>记录：<bdi><code>{row.id}</code></bdi></p></details>
            </li>)}
          </ol>
        </div>
        <div className="sync-history-file-pages" role="group" aria-label="离线文件分页">
          <button type="button" className="btn small" data-history-file-prev aria-disabled={selection.page === 0} onClick={() => { if (selection.page > 0) setPage(selection.page - 1) }}>上一页</button>
          <span data-history-file-page role="status">{selection.matched ? <>第 {selection.page + 1} / {selection.pages} 页，本页第 {selection.from}–{selection.to} 条</> : '没有匹配记录，暂无可翻页内容'}</span>
          <button type="button" className="btn small" data-history-file-next aria-disabled={selection.page + 1 >= selection.pages} onClick={() => { if (selection.page + 1 < selection.pages) setPage(selection.page + 1) }}>下一页</button>
        </div>
      </section>}
    </div>
  </details>
}
