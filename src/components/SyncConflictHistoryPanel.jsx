import React, { useEffect, useId, useRef, useState } from 'react'
import { api } from '~/services/api'
import { appendConflictHistory, historyOutcome, historyTime, readConflictHistory } from '~/services/syncConflictHistory.mjs'
import './SyncConflictHistoryPanel.css'

const kinds = { file: '笔记或文件夹', tag: '标签', 'file-tag': '标签关联', attachment: '附件' }
function Stamp({ value }) {
  const iso = historyTime(value)
  return iso ? <time dateTime={iso}>{iso}</time> : '尚无记录'
}
export default function SyncConflictHistoryPanel() {
  const [filter, setFilter] = useState('all')
  const [snapshot, setSnapshot] = useState(null)
  const [phase, setPhase] = useState('unread')
  const current = useRef(null), sequence = useRef(0), live = useRef(false)
  const readButton = useRef(null), returnFocus = useRef(false), moreButton = useRef(null), list = useRef(null), returnListFocus = useRef(false)
  const titleID = useId(), feedbackID = useId()
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
    returnListFocus.current = append && moreButton.current === moreButton.current?.ownerDocument.activeElement
    const id = ++sequence.current
    current.current?.abort()
    const controller = new AbortController(); current.current = controller
    setPhase('loading')
    if (snapshot?.filter !== selected) setSnapshot(null)
    try {
      const page = await readConflictHistory(api, { filter: selected, cursor: previous?.nextCursor || '', signal: controller.signal })
      if (!live.current || sequence.current !== id || controller.signal.aborted) return
      setSnapshot(previous ? appendConflictHistory(previous, page) : page)
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
  const rows = snapshot?.filter === filter ? snapshot.items : []
  const result = phase === 'loading' ? '正在读取本机记录；不会执行同步。'
    : phase === 'error' ? '未能读取记录。' + (snapshot ? '下方保留上次读取结果，不代表当前状态。' : '尚无可核实的记录，不把读取失败当作没有记录。')
      : phase === 'stopped' ? '已停止等待记录读取；没有取消同步任务。' + (snapshot ? '下方仍为上次读取记录。' : '')
        : phase === 'unread' ? '尚未读取。展开本面板不会发起请求，请点击“读取记录”。'
          : rows.length ? `已读取 ${rows.length} 条记录；仅统计本次已加载内容，不代表全部历史。`
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
      {rows.length > 0 && <div ref={list} className="sync-conflict-history-scroll" tabIndex={0} role="region" aria-label="已读取冲突记录列表">
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
    </section>
  </details>
}
