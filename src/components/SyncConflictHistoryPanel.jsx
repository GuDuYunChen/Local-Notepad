import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { api } from '~/services/api'
import { appendConflictHistory, historyOutcome, historyTime, readConflictHistory } from '~/services/syncConflictHistory.mjs'
import { limitHistoryQuery, selectHistoryRecords } from '~/services/syncHistorySearch.mjs'
import './SyncConflictHistoryPanel.css'
import SyncHistoryExport from './SyncHistoryExport'
import SyncHistorySummary from './SyncHistorySummary'
import SyncHistoryTimeFilter from './SyncHistoryTimeFilter'
import { HISTORY_TIME_ALL, sameHistoryTimeFilter } from '~/services/syncHistoryTime.mjs'

const kinds = { file: '笔记或文件夹', tag: '标签', 'file-tag': '标签关联', attachment: '附件' }
function Stamp({ value }) {
  const iso = historyTime(value)
  return iso ? <time dateTime={iso}>{iso}</time> : '尚无记录'
}
export default function SyncConflictHistoryPanel() {
  const [filter, setFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState(HISTORY_TIME_ALL)
  const [timeReset, setTimeReset] = useState(0), [hasTimeDraft, setHasTimeDraft] = useState(false)
  const [snapshot, setSnapshot] = useState(null)
  const [phase, setPhase] = useState('unread')
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [outcome, setOutcome] = useState('all')
  // Candidate text belongs to the input method until composition finishes.
  // Keep it intact and separate from the bounded, committed search condition.
  const [queryDraft, setQueryDraft] = useState(''), [isComposing, setIsComposing] = useState(false)
  const compositionActive = useRef(false)
  const searchInput = useRef(null)
  const applyQuery = value => {
    const next = limitHistoryQuery(value)
    setQueryDraft(next); setQuery(next)
  }
  const finishComposition = event => {
    if (!compositionActive.current) return // ignore a late end after explicit clear
    compositionActive.current = false; setIsComposing(false)
    applyQuery(event.currentTarget.value)
  }
  const current = useRef(null), sequence = useRef(0), live = useRef(false)
  const readButton = useRef(null), returnFocus = useRef(false), moreButton = useRef(null), list = useRef(null), returnListFocus = useRef(false)
  const titleID = useId(), feedbackID = useId(), searchHintID = useId(), searchResultID = useId()
  useEffect(() => {
    live.current = true
    return () => { live.current = false; sequence.current += 1; current.current?.abort() }
  }, [])
  useEffect(() => {
    if (phase === 'stopped' && returnFocus.current) { returnFocus.current = false; readButton.current?.focus({ preventScroll: true }) }
    if (phase === 'ready' && returnListFocus.current) {
      returnListFocus.current = false
      if (!snapshot?.hasMore) list.current?.focus({ preventScroll: true })
    }
  }, [phase, snapshot])
  const read = async (selected = filter, append = false) => {
    const previous = append ? snapshot : null
    if (append && (!previous?.hasMore || previous.filter !== selected)) return
    const focusOrigin = append ? moreButton.current : null
    returnListFocus.current = false
    const id = ++sequence.current
    current.current?.abort()
    const controller = new AbortController(); current.current = controller
    setPhase('loading')
    if (snapshot?.filter !== selected) setSnapshot(null)
    try {
      const page = await readConflictHistory(api, { filter: selected, cursor: previous?.nextCursor || '', signal: controller.signal })
      if (!live.current || sequence.current !== id || controller.signal.aborted) return
      const next = previous ? appendConflictHistory(previous, page) : page
      // Decide at completion, not request start: the user may have moved to
      // another control while waiting. Never pull focus back from that choice.
      returnListFocus.current = !!focusOrigin && !next.hasMore &&
        focusOrigin === focusOrigin.ownerDocument.activeElement &&
        focusOrigin.closest('[data-sync-conflict-history]')?.open === true
      setSnapshot(next)
      setPhase('ready')
    } catch {
      if (live.current && sequence.current === id && !controller.signal.aborted) setPhase('error')
    } finally {
      if (current.current === controller) current.current = null
    }
  }
  const stop = event => {
    returnFocus.current = event.currentTarget === event.currentTarget.ownerDocument.activeElement
    sequence.current += 1; current.current?.abort(); current.current = null; setPhase('stopped')
  }
  const loadedRows = snapshot?.filter === filter ? snapshot.items : []
  const selection = useMemo(() => selectHistoryRecords(loadedRows, { query, kind, outcome, timeFilter }), [loadedRows, query, kind, outcome, timeFilter])
  const rows = selection.items
  const searchMessage = (isComposing ? '输入法文字尚未确认，暂按原查找条件显示。' : '') + (!snapshot ? '尚未读取记录；查找和本地筛选不会发起请求。'
    : `当前显示 ${selection.matched} 条 / 已读取 ${selection.loaded} 条。` +
      (!rows.length && selection.narrowed ? (snapshot.hasMore
        ? '已读取记录中没有匹配项；更早记录尚未读取，可继续读取更早记录。'
        : '本次已读取记录中没有匹配项，可调整或清除本地筛选。') : '仅针对本次已读取内容，不是全部历史的搜索结果。'))
  const result = phase === 'loading' ? '正在读取本机记录；不会执行同步。'
    : phase === 'error' ? '未能读取记录。' + (snapshot ? '下方保留上次读取结果，不代表当前状态。' : '尚无可核实的记录，不把读取失败当作没有记录。')
      : phase === 'stopped' ? '已停止等待记录读取；没有取消同步任务。' + (snapshot ? '下方仍为上次读取记录。' : '')
        : phase === 'unread' ? '尚未读取。展开本面板不会发起请求，请点击“读取记录”。'
          : loadedRows.length ? `已读取 ${loadedRows.length} 条记录；仅统计本次已加载内容，不代表全部历史。`
            : '本次读取没有符合筛选条件的记录；不代表当前没有未决冲突。'
  return <details className="sync-conflict-history" data-sync-conflict-history>
    <summary id={titleID}>冲突处理记录<span>查看已选边或已失效的记录</span></summary>
    <section className="sync-conflict-history-body" aria-labelledby={titleID}>
      <p className="sync-conflict-history-note">仅包含本机工作区已有的已处理与已失效记录，可能跨越旧同步目标；不代表当前远端状态，也不是全部同步操作日志。查看不会恢复版本、重新解决冲突或执行同步。</p>
      <div className="sync-conflict-history-controls">
        <label>记录类型<select aria-label="冲突记录类型" value={filter} onChange={event => {
          const next = event.target.value; setFilter(next); void read(next)
        }}>
          <option value="all">全部历史记录</option><option value="resolved">已选边处理</option><option value="superseded">已失效</option>
        </select></label>
        <button type="button" className="btn small" data-history-read ref={readButton} aria-controls={feedbackID} aria-disabled={phase === 'loading'}
          onClick={() => { if (phase !== 'loading') void read() }}>{snapshot ? '重新读取记录' : '读取记录'}</button>
        {phase === 'loading' && <button type="button" className="btn small" data-history-stop onClick={stop}>停止读取</button>}
      </div>
      <p className="sync-conflict-history-feedback" id={feedbackID} role="status" aria-live="polite">{result}</p>
      <fieldset className="sync-history-search" aria-describedby={searchHintID}>
        <legend>筛选已读取记录</legend>
        <p id={searchHintID}>按当前标题、对象或记录标识查找；不搜索正文，也不会自动读取更早记录。输入法确认后最多 128 个字符。</p>
        <div className="sync-history-search-fields">
          <label className="sync-history-search-query">查找文字
            <input ref={searchInput} type="search" value={queryDraft} data-history-query aria-label="在已读取记录中查找"
              aria-controls={searchResultID} placeholder="输入标题或标识" autoComplete="off" spellCheck={false}
              onCompositionStart={() => { compositionActive.current = true; setIsComposing(true) }}
              onCompositionEnd={finishComposition} onBlur={finishComposition}
              onChange={event => {
                if (compositionActive.current || event.nativeEvent.isComposing) {
                  compositionActive.current = true; setIsComposing(true)
                  setQueryDraft(event.target.value)
                } else applyQuery(event.target.value)
              }}/>
          </label>
          <label>对象类型<select value={kind} data-history-kind aria-label="筛选记录对象类型" onChange={event => setKind(event.target.value)}>
            <option value="all">全部对象</option><option value="file">笔记或文件夹</option><option value="tag">标签</option>
            <option value="file-tag">标签关联</option><option value="attachment">附件</option>
          </select></label>
          <label>当时的处理结果<select value={outcome} data-history-outcome aria-label="筛选记录处理结果" onChange={event => setOutcome(event.target.value)}>
            <option value="all">全部结果</option><option value="local">保留本机</option><option value="remote">采用远端</option>
            <option value="superseded">已失效</option><option value="unknown">处理方式未核实</option>
          </select></label>
          {(queryDraft || query || kind !== 'all' || outcome !== 'all' || timeFilter.mode !== 'all' || hasTimeDraft) && <button type="button" className="btn small" data-history-clear onClick={event => {
            const ownsFocus = event.currentTarget === event.currentTarget.ownerDocument.activeElement
            compositionActive.current = false; setIsComposing(false)
            applyQuery(''); setKind('all'); setOutcome('all')
            setTimeFilter(HISTORY_TIME_ALL); setTimeReset(n => n + 1); setHasTimeDraft(false)
            if (ownsFocus) searchInput.current?.focus({ preventScroll: true })
          }}>清除本地筛选</button>}
        </div>
        <SyncHistoryTimeFilter value={timeFilter} resetVersion={timeReset} onDraftChange={setHasTimeDraft}
          onApply={next => setTimeFilter(previous => sameHistoryTimeFilter(previous, next) ? previous : next)}/>
      </fieldset>
      <p className="sync-conflict-history-feedback" id={searchResultID} data-history-search-feedback role="status" aria-live="polite">{searchMessage}</p>
      {snapshot && <SyncHistorySummary rows={rows} phase={phase} hasMore={snapshot.hasMore} composing={isComposing}/>}
      {snapshot && <div ref={list} className="sync-conflict-history-scroll" tabIndex={0} role="region" aria-label="已读取冲突记录列表">
        {rows.length === 0 && <p className="sync-conflict-history-note">{selection.narrowed ? '当前筛选没有匹配的已读取记录。' : '本次读取没有历史记录。'}</p>}
        <ol className="sync-conflict-history-list">
          {rows.map(row => <li key={row.id} data-history-row>
            <div className="sync-conflict-history-row-heading"><strong><bdi>{row.title || kinds[row.kind]}</bdi></strong>
              <span className="sync-conflict-history-badge">{row.status === 'resolved' ? '已选边' : '已失效'}</span></div>
            {row.title && <small>当前笔记标题，仅用于辨认，不是历史正文。</small>}
            <p className="sync-conflict-history-outcome">{historyOutcome(row)}</p>
            <dl><div><dt>建立时间 · UTC</dt><dd><Stamp value={row.createdAt}/></dd></div>
              <div><dt>处理或失效时间 · UTC</dt><dd><Stamp value={row.resolvedAt}/></dd></div></dl>
            <details><summary>查看记录标识</summary><p>对象：<bdi><code>{row.itemID}</code></bdi></p><p>记录：<bdi><code>{row.id}</code></bdi></p></details>
          </li>)}
        </ol>
      </div>}
      {snapshot?.hasMore && <button type="button" className="btn small" data-history-more ref={moreButton} aria-disabled={phase === 'loading'}
        onClick={() => { if (phase !== 'loading') void read(filter, true) }}>读取更早记录</button>}
      {snapshot && <p className="sync-conflict-history-note">按处理或失效时间从新到旧排列；新产生的记录需重新读取。已失效不等于已解决，历史选边不保证现在仍是该版本。</p>}
      <SyncHistoryExport snapshot={snapshot} query={query} kind={kind} outcome={outcome}
        phase={phase} composing={isComposing} matched={selection.matched} timeFilter={timeFilter}/>
    </section>
  </details>
}
