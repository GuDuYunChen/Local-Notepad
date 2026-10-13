import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { api } from '~/services/api'
import ConfirmDialog from './ConfirmDialog'
import { createDailyWorkspace, dailyCalendar, dailyDate, dailyDateKey, moveDailyMonth, readDailyIndex, validDailyDate } from '../services/dailyNotes.mjs'
import './DailyNotesPanel.css'

const sharedDailyWorkspace = createDailyWorkspace(api)
const PAGE_SIZE = 14
const dateLabel = key => dailyDate(key).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' })

export default function DailyNotesPanel({ onSelectFile, onClose, session = sharedDailyWorkspace }) {
  const [selectedDate, setSelectedDate] = useState(dailyDateKey)
  const [today, setToday] = useState(dailyDateKey)
  const [index, setIndex] = useState({ notes: [], conflicts: [] })
  const [loadState, setLoadState] = useState('loading')
  const [problem, setProblem] = useState('')
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState(null)
  const [jump, setJump] = useState(dailyDateKey)
  const generation = useRef(0), listOwner = useRef(null), ownedOperation = useRef(false), composing = useRef(false)
  const navigate = useRef(onSelectFile); navigate.current = onSelectFile
  const operation = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot)
  const days = useMemo(() => dailyCalendar(selectedDate), [selectedDate])
  const noteDates = useMemo(() => new Set(index.notes.map(note => note.title)), [index.notes])
  const conflicts = useMemo(() => new Set(index.conflicts), [index.conflicts])
  const filtered = useMemo(() => index.notes.filter(note => note.title.includes(query.trim())), [index.notes, query])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), currentPage = Math.min(page, pages)
  const notes = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const monthLabel = dailyDate(selectedDate).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  const previousMonth = moveDailyMonth(selectedDate, -1), nextMonth = moveDailyMonth(selectedDate, 1)

  const refresh = async () => {
    listOwner.current?.abort()
    const controller = new AbortController(), lifetime = generation.current
    listOwner.current = controller; setLoadState('loading'); setProblem('')
    try {
      const result = await readDailyIndex(api, controller.signal)
      if (controller.signal.aborted || generation.current !== lifetime || listOwner.current !== controller) return
      setIndex(result); setLoadState('ready')
    } catch (error) {
      if (controller.signal.aborted || generation.current !== lifetime || listOwner.current !== controller) return
      setIndex({ notes: [], conflicts: [] }); setLoadState('error')
      setProblem('读取每日笔记失败，不能据此认定没有记录。请检查本机服务后重试。')
    }
  }
  useEffect(() => {
    void refresh()
    const updateToday = () => setToday(dailyDateKey())
    const timer = window.setInterval(updateToday, 30000)
    window.addEventListener('focus', updateToday)
    return () => {
      generation.current++; listOwner.current?.abort()
      if (ownedOperation.current) session.cancel()
      window.clearInterval(timer); window.removeEventListener('focus', updateToday)
    }
  }, [session])
  const choose = date => { setSelectedDate(date); setJump(date) }
  const open = async (date, options = {}) => {
    if (operation.busy || ownedOperation.current) return
    if (typeof navigate.current !== 'function') { setProblem('编辑器通道尚未就绪，没有发起创建。'); return }
    if (!validDailyDate(date)) { setProblem('请选择有效的日历日期。'); return }
    choose(date); setProblem('')
    if (conflicts.has(date)) { setProblem('该日期存在同名文件夹或重复记录，请返回笔记列表处理，未覆盖任何内容。'); return }
    const lifetime = generation.current
    ownedOperation.current = true
    try {
      const result = await session.open(date, options)
      if (generation.current !== lifetime) return
      if (result.file) {
        window.dispatchEvent(new Event('library:refresh'))
        try { await navigate.current(result.file) } catch {
          if (generation.current === lifetime) setProblem('记录已经找到，但编辑器未能打开。请返回笔记列表打开该日期，不要重复创建。')
        }
      }
    } catch (error) {
      if (generation.current === lifetime && error?.code === 'unconfirmed-limit')
        setProblem('待核对日期已达到本次会话上限，请先核对现有记录；没有发起新的创建。')
    }
    finally { ownedOperation.current = false }
  }
  const close = () => { if (ownedOperation.current) session.cancel(); onClose?.() }
  const jumpToDate = () => {
    if (!validDailyDate(jump)) { setProblem('日期无效，请使用真实的年、月、日。'); return }
    setProblem(''); choose(jump)
  }
  const busy = operation.busy
  return <section className="daily-notes-panel" aria-label="每日笔记工作台">
    <header className="daily-notes-header daily-workspace-toolbar">
      <div className="daily-workspace-heading"><strong>每日笔记</strong><span>{monthLabel}</span></div>
      <div className="daily-notes-header-actions">
        <button type="button" className="btn small" disabled={busy || !previousMonth} aria-label="上个月" onClick={() => choose(previousMonth)}>‹</button>
        <button type="button" className="btn small daily-today-btn" disabled={busy} onClick={() => choose(dailyDateKey())}>今天</button>
        <button type="button" className="btn small" disabled={busy || !nextMonth} aria-label="下个月" onClick={() => choose(nextMonth)}>›</button>
        <button type="button" className="btn small close-panel-btn" onClick={close} title="返回笔记" aria-label="返回笔记">×</button>
      </div>
    </header>
    <div className="daily-workspace-body">
      <section className="calendar-card">
        <div className="daily-section-heading"><div><strong>选择日期</strong><span>已有记录直接打开；点击空日期创建一份根目录每日笔记。</span></div></div>
        <div className="daily-jump"><label>跳转日期<input type="date" aria-label="跳转日期" min="0001-01-01" max="9999-12-31" value={jump} disabled={busy} onChange={event => setJump(event.target.value)} /></label>
          <button type="button" className="btn small" disabled={busy} onClick={jumpToDate}>查看日期</button></div>
        {problem && <div className="daily-feedback error" role="alert">{problem}</div>}
        {operation.message && <div className={'daily-feedback ' + operation.kind} role={['error', 'uncertain'].includes(operation.kind) ? 'alert' : 'status'}>
          <p>{operation.message}</p>
          {busy && <button type="button" className="btn small" onClick={() => session.cancel()}>停止等待</button>}
          {!busy && operation.date && ['error', 'uncertain', 'empty', 'stopped'].includes(operation.kind) &&
            <button type="button" className="btn small" onClick={() => void open(operation.date, { inspectOnly: true })}>核对并打开记录</button>}
          {!busy && operation.kind === 'uncertain' && <button type="button" className="btn small" onClick={() => setConfirm(operation.date)}>重新创建该日记录…</button>}
        </div>}
        {operation.uncertain.length > 0 && <details className="daily-unconfirmed"><summary>待核对日期（{operation.uncertain.length}）</summary>
          {operation.uncertain.map(date => <button type="button" className="btn small" key={date} disabled={busy} onClick={() => void open(date, { inspectOnly: true })}>{date}</button>)}
          <p>这是本次应用会话的未确认创建记录；核对只读取，不重新创建。</p></details>}
        <div className="calendar-grid" aria-label={monthLabel}>
          {['日', '一', '二', '三', '四', '五', '六'].map(day => <div key={day} className="calendar-weekday">{day}</div>)}
          {days.map((day, index) => day ? <button type="button" key={day.key}
            className={`calendar-day${day.key === selectedDate ? ' selected' : ''}${day.key === today ? ' today' : ''}${noteDates.has(day.key) ? ' has-note' : ''}`}
            disabled={busy || loadState !== 'ready'} aria-current={day.key === today ? 'date' : undefined} aria-pressed={day.key === selectedDate}
            aria-label={`${day.key}${conflicts.has(day.key) ? ' 日期冲突' : noteDates.has(day.key) ? ' 已有笔记' : ' 创建每日笔记'}`}
            onClick={() => void open(day.key)}><span>{day.date}</span>{noteDates.has(day.key) && <span className="calendar-note-dot" aria-hidden="true" />}</button>
            : <div key={'empty-' + index} className="calendar-day empty" aria-hidden="true" />)}
        </div>
        <p className="daily-scope">按本机日期记录；仅将根目录中标题为有效 YYYY-MM-DD 的笔记列为每日笔记。子文件夹里的同名笔记不会被误打开或覆盖。</p>
      </section>
      <section className="daily-recent-card">
        <div className="daily-notes-list-header"><div><strong>最近记录</strong><span>打开后沿用编辑器原有的保存、草稿和退出保护。</span></div>
          <button type="button" className="icon-btn" onClick={() => void refresh()} disabled={busy || loadState === 'loading'} title="刷新" aria-label="刷新">↻</button></div>
        <label className="daily-search">查找日期<input aria-label="查找每日笔记" value={search} placeholder="例如 2026-10" disabled={busy}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={event => { composing.current = false; setQuery(event.currentTarget.value); setPage(1) }}
          onChange={event => { setSearch(event.target.value); if (!composing.current) { setQuery(event.target.value); setPage(1) } }} /></label>
        {loadState === 'loading' ? <div className="placeholder" role="status">加载中…</div> : loadState === 'error' ?
          <div className="daily-feedback error"><strong>列表尚未读取成功</strong><p>当前没有可用于判断存在与否的列表。</p><button type="button" className="btn" onClick={() => void refresh()}>重试读取每日笔记</button></div> :
          index.notes.length === 0 ? <div className="empty-state daily-empty-state"><div className="empty-title">还没有每日笔记</div><div className="empty-desc">从日历选择一天开始记录；不会自动创建今日笔记。</div></div> :
            filtered.length === 0 ? <div className="empty-state"><p>没有匹配日期的记录。</p><button type="button" className="btn" onClick={() => { setSearch(''); setQuery(''); setPage(1) }}>清除查找</button></div> : <>
              <ul className="daily-recent-list">{notes.map(note => <li key={note.id}><button type="button" className="daily-note-item" disabled={busy} onClick={() => void open(note.title, { inspectOnly: true })}>
                <span className="daily-note-date"><strong>{dateLabel(note.title)}</strong><small>{conflicts.has(note.title) ? '需要处理同名冲突' : '已有记录'}</small></span><span className="daily-note-title">{note.title}</span>
              </button></li>)}</ul>
              <nav className="daily-pagination" aria-label="每日笔记分页"><button type="button" className="btn small" disabled={busy || currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
                <span>{currentPage} / {pages} · 共 {filtered.length} 条</span><button type="button" className="btn small" disabled={busy || currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>
            </>}
      </section>
    </div>
    {confirm && <ConfirmDialog title="重新核对并创建每日笔记？" message={<><p>{confirm} 的上次创建结果尚未确认。</p><p>将先读取该日期。已有记录只打开，不覆盖；仍未找到时才重新请求创建。删除或移动过旧记录时，请先在笔记与回收站中核对。</p></>}
      onClose={() => setConfirm(null)} actions={[{ label: '取消', onClick: () => setConfirm(null) }, { label: '核对后创建并打开', kind: 'primary', onClick: () => { const date = confirm; setConfirm(null); void open(date, { acknowledgeUncertain: true }) } }]} />}
  </section>
}
