import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getTrashView, summarizeTrashReport, trashDaysRemaining, formatTrashDeletedAt, TRASH_BATCH_LIMIT, TRASH_HISTORY_LIMIT } from '../services/trashWorkspace.mjs'

const STATUS = { succeeded: '已成功', unconfirmed: '结果未确认', 'not-started': '未执行', sending: '等待回执' }
function Confirmation({ plan, onCancel, onConfirm }) {
  const [typed, setTyped] = useState(''), box = useRef(null), cancel = useRef(null), previous = useRef(null)
  useLayoutEffect(() => {
    previous.current = document.activeElement
    cancel.current?.focus()
    return () => { if (previous.current?.isConnected && !previous.current.disabled) previous.current.focus() }
  }, [])
  const destructive = plan.action === 'delete'
  const keyDown = event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onCancel() }
    if (event.key === 'Tab') {
      const controls = [...box.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }
  return <div className="trash-workspace-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
    <section ref={box} role="dialog" aria-modal="true" aria-labelledby="trash-confirm-title" aria-describedby="trash-confirm-description" className="trash-workspace-dialog" onKeyDown={keyDown}>
      <h3 id="trash-confirm-title">{destructive ? '永久删除' : '恢复'} {plan.targets.length} 个回收站项目？</h3>
      <p id="trash-confirm-description">{destructive ? '永久删除无法撤销，请先确认已有需要的备份。' : '恢复到原位置。存在同名冲突或父文件夹不可用时，不会自动改名或覆盖。'}
        {' '}文件夹会连同其子项处理；这里的数量是顶层项目数，不是笔记总数。文件夹会按实际处理时的内容一起处理；确认后新增的子项也可能包含在内。</p>
      {plan.scope === 'snapshot' && <p className="trash-workspace-warning">仅删除这次确认中列出的项目。确认后新进入回收站的其他顶层项目不在范围内。</p>}
      <ul className="trash-workspace-confirm-targets">{plan.targets.map(row => <li key={row.id}>{row.is_folder ? '文件夹 · ' : '笔记 · '}{row.title || '未命名'}</li>)}</ul>
      <p className="trash-workspace-muted">操作前重新读取并核对所选项目。批量操作逐项执行，不是一次全部成功或全部回滚的事务；遇到未确认结果会停止后续操作。</p>
      {destructive && <label className="trash-workspace-typed">输入“永久删除”确认
        <input aria-label="输入永久删除确认" autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} />
      </label>}
      <div className="trash-workspace-dialog-actions">
        <button ref={cancel} type="button" className="btn" onClick={onCancel}>取消</button>
        <button type="button" className={`btn ${destructive ? 'danger' : 'primary'}`} disabled={destructive && typed !== '永久删除'} onClick={() => onConfirm(plan.key)}>
          {destructive ? '确认永久删除' : '确认恢复'}
        </button>
      </div>
    </section>
  </div>
}

function ReceiptHistory({ records, locked, onRemove }) {
  const [expanded, setExpanded] = useState(null), [removing, setRemoving] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false), [message, setMessage] = useState('')
  const cancel = useRef(null), heading = useRef(null), returnToHeading = useRef(false)
  useLayoutEffect(() => { if (removing !== null) cancel.current?.focus() }, [removing])
  useLayoutEffect(() => {
    if (returnToHeading.current) { returnToHeading.current = false; heading.current?.focus() }
  }, [records])
  if (records.length === 0 && !message) return null
  const toggle = key => { setExpanded(value => value === key ? null : key); setRemoving(null); setAcknowledged(false); setMessage('') }
  const remove = (record, uncertain) => {
    if (locked || (uncertain && !acknowledged)) return
    if (!onRemove(record.key, uncertain && acknowledged)) { setMessage('记录未移除，请等待当前操作结束后核对。'); return }
    returnToHeading.current = true
    setRemoving(null); setExpanded(null); setAcknowledged(false)
    setMessage('仅移除了本地操作记录，没有撤销、重试或改变任何笔记操作。')
  }
  return <section className="trash-workspace-history" aria-label="已收起的操作记录">
    <h3 ref={heading} tabIndex={-1}>已收起的操作记录（{records.length}）</h3>
    <p className="trash-workspace-muted">只在本次应用运行期间保留，重启后不保留。最多保留 {TRASH_HISTORY_LIMIT} 份已收起记录；达到上限时仅移除最早且没有未确认结果的记录，未确认记录不会被自动丢弃。</p>
    {message && <p role="status">{message}</p>}
    <ul className="trash-workspace-history-list">{records.map(record => {
      const counts = summarizeTrashReport(record), uncertain = counts.unconfirmed > 0, open = expanded === record.key
      return <li key={record.key} data-history-key={record.key}>
        <button type="button" className="trash-workspace-history-toggle" aria-label={`查看${record.action === 'restore' ? '恢复' : '永久删除'}记录 #${record.key}`} aria-expanded={open} onClick={() => toggle(record.key)}>
          <strong>{record.action === 'restore' ? '恢复' : '永久删除'} #{record.key}</strong>
          <span>成功 {counts.succeeded} · 未确认 {counts.unconfirmed} · 未执行 {counts.notStarted}</span>
        </button>
        {open && <div className="trash-workspace-history-detail">
          <p>{record.message}</p>
          <ul className="trash-workspace-results">{record.rows.map(row => <li key={row.id} data-history-status={row.status}>
            <strong>{row.title || '未命名'}</strong><span>{STATUS[row.status]}</span><small>{row.note}</small>
          </li>)}</ul>
          {uncertain && <p className="trash-workspace-warning">这是当时未取得有效回执的记录，后来的操作或列表变化不能把它改写成成功；查看记录不会重发请求。</p>}
          {removing === record.key ? <div className="trash-workspace-history-remove" role="group" aria-label="移除操作记录确认">
            <p>移除后，本次运行中也不能再查看这份记录。这不会撤销或完成原来的操作。</p>
            {uncertain && <label><input type="checkbox" aria-label="理解未确认记录移除后不能找回" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} />我理解：结果仍未确认，移除记录不会撤销请求。</label>}
            <div className="trash-workspace-dialog-actions">
              <button ref={cancel} type="button" className="btn small" onClick={() => { setRemoving(null); setAcknowledged(false) }}>取消移除</button>
              <button type="button" className="btn small" disabled={locked || (uncertain && !acknowledged)} onClick={() => remove(record, uncertain)}>确认移除记录</button>
            </div>
          </div> : <button type="button" className="btn small" disabled={locked} onClick={() => { setRemoving(record.key); setAcknowledged(false) }}>移除此记录</button>}
        </div>}
      </li>
    })}</ul>
  </section>
}

export default function TrashWorkspacePanel({ store, onClose, onRestored }) {
  const [state, setState] = useState(store.snapshot)
  const [query, setQuery] = useState(''), [searchInput, setSearchInput] = useState(''), composing = useRef(false)
  const [type, setType] = useState('all'), [sort, setSort] = useState('newest'), [page, setPage] = useState(1)
  const [selection, setSelection] = useState(() => new Set()), [localError, setLocalError] = useState('')
  const [now, setNow] = useState(Date.now), allBox = useRef(null), closeRef = useRef(null), focusReturn = useRef(null)
  const onRestoredRef = useRef(onRestored); onRestoredRef.current = onRestored
  useEffect(() => {
    const disconnect = store.connect(() => setState(store.snapshot()))
    setState(store.snapshot())
    const current = store.snapshot()
    if (current.phase === 'idle' && current.pending === 0) void store.refresh()
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => { clearInterval(timer); disconnect() }
  }, [store])
  // StrictMode can disconnect/reconnect while the first read is in flight.
  // Its obsolete reply is discarded by the store; start one new read once the
  // slot is released. Errors/stale results still require an explicit refresh.
  useEffect(() => {
    if (state.loadState === 'idle' && state.phase === 'idle' && state.pending === 0) void store.refresh()
  }, [state, store])
  useEffect(() => {
    const ids = store.takeRestored()
    if (ids.length && onRestoredRef.current) {
      try { Promise.resolve(onRestoredRef.current(ids)).catch(() => store.reportRefreshError()) }
      catch { store.reportRefreshError() }
    }
  }, [state, store])
  useEffect(() => {
    if (state.loadState !== 'ready') return
    const valid = new Set(state.items.map(row => row.id))
    setSelection(prev => {
      const next = new Set([...prev].filter(id => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [state.items, state.loadState])
  useLayoutEffect(() => {
    if (!state.plan && focusReturn.current) {
      const target = focusReturn.current; focusReturn.current = null
      if (target.isConnected && !target.disabled) target.focus(); else closeRef.current?.focus()
    }
  }, [state.plan])
  let view, searchError = ''
  try { view = getTrashView(state.items, { query, type, sort, page, now }) }
  catch (error) { searchError = error.message; view = getTrashView(state.items, { query: '', type, sort, page, now }) }
  const locked = state.phase !== 'idle' || state.pending > 0 || state.loadState === 'loading'
  const canAct = !locked && state.loadState === 'ready' && !searchError
  const pageIDs = view.rows.map(row => row.id), pageSelected = pageIDs.filter(id => selection.has(id)).length
  const visibleSet = new Set(view.rows.map(row => row.id)), hiddenSelected = [...selection].filter(id => !visibleSet.has(id)).length
  useLayoutEffect(() => { if (allBox.current) allBox.current.indeterminate = pageSelected > 0 && pageSelected < pageIDs.length }, [pageSelected, pageIDs.length])
  const changeFilters = fn => { store.cancelPlan(); setPage(1); fn() }
  const toggle = (id, checked) => {
    store.cancelPlan()
    setSelection(prev => { const next = new Set(prev); checked ? next.add(id) : next.delete(id); return next })
  }
  const makePlan = (action, ids, scope) => {
    setLocalError(''); focusReturn.current = document.activeElement
    try { store.plan(action, ids, scope) } catch (error) { setLocalError(error.message) }
  }
  const close = () => { store.stop(); store.cancelPlan(); onClose?.() }
  const counts = summarizeTrashReport(state.report)
  const folders = state.items.filter(row => row.is_folder).length
  return <div className="trash-panel trash-workspace" data-trash-workspace>
    <header className="trash-toolbar">
      <div><strong>回收站</strong><p>找回误删内容，确认后再永久清理。文件夹操作包含其子项。</p></div>
      <div className="trash-toolbar-actions">
        <button type="button" className="btn small" disabled={locked} onClick={() => void store.refresh()}>刷新</button>
        <button ref={closeRef} type="button" className="icon-btn" onClick={close} aria-label="返回笔记" title="返回笔记">×</button>
      </div>
    </header>
    <div className="trash-workspace-body">
      <section className="trash-workspace-overview" aria-label="回收站概览">
        <div><strong>{state.loadState === 'idle' || state.loadState === 'error' ? '—' : state.items.length}</strong><span>顶层项目</span></div>
        <div><strong>{state.loadState === 'error' ? '—' : state.items.length - folders}</strong><span>笔记</span></div>
        <div><strong>{state.loadState === 'error' ? '—' : folders}</strong><span>文件夹</span></div>
        <p>通常保留 30 天，实际清理时机由本机服务决定。日期未知不估算清理时间。</p>
      </section>
      {(state.error || state.notificationError || state.historyError || localError) && <div role="alert" className="trash-workspace-error">
        {state.error && <p>{state.error}</p>}{state.historyError && <p>{state.historyError}</p>}{state.notificationError && <p>{state.notificationError}</p>}{localError && <p>{localError}</p>}
        {state.loadState !== 'ready' && <button type="button" className="btn small" disabled={locked} onClick={() => void store.refresh()}>重新读取</button>}
      </div>}
      {state.report && <section className="trash-workspace-report" aria-label="本次操作结果">
        <div className="trash-workspace-section-heading"><h3>{state.report.action === 'restore' ? '恢复' : '永久删除'}记录</h3>
          {state.phase === 'checking' || state.phase === 'writing' ? <button type="button" className="btn small" disabled={state.stopRequested} onClick={store.stop}>{state.stopRequested ? '已请求停止后续操作' : '停止后续操作'}</button> :
            <button type="button" className="btn small" disabled={locked} onClick={store.clearReport}>收起记录</button>}
        </div>
        <p role="status" aria-live="polite">{state.report.message}{!state.report.complete && ` 已成功 ${counts.succeeded} / ${state.report.rows.length} 项。`}</p>
        <p className="trash-workspace-muted">停止或离开页面只停止尚未发送的请求，已发送请求不能据此认定撤销。未确认结果不自动重试；刷新只读取现状，不会重发操作。</p>
        <ul className="trash-workspace-results">{state.report.rows.map(row => <li key={row.id} data-status={row.status}>
          <strong>{row.title || '未命名'}</strong><span>{STATUS[row.status]}</span><small>{row.note}</small>
        </li>)}</ul>
        {counts.unconfirmed > 0 && <p className="trash-workspace-warning">未确认不等于失败或已回滚。请刷新核对；项目从回收站消失也不能单独证明它已恢复还是永久删除。</p>}
      </section>}
      <ReceiptHistory records={state.history} locked={locked} onRemove={store.removeHistory} />
      <div className="trash-workspace-filters">
        <label>查找已删除项目<input aria-label="查找已删除项目" type="search" value={searchInput} placeholder="按标题查找，不搜索正文" aria-invalid={!!searchError} aria-describedby={searchError ? 'trash-search-error' : undefined}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={e => { composing.current = false; changeFilters(() => setQuery(e.currentTarget.value)) }}
          onChange={e => { setSearchInput(e.target.value); if (!composing.current) changeFilters(() => setQuery(e.target.value)) }} /></label>
        <label>类型<select aria-label="回收站类型" value={type} onChange={e => changeFilters(() => setType(e.target.value))}>
          <option value="all">全部类型</option><option value="note">笔记</option><option value="folder">文件夹</option><option value="soon">3 天内到期</option></select></label>
        <label>排序<select aria-label="回收站排序" value={sort} onChange={e => changeFilters(() => setSort(e.target.value))}>
          <option value="newest">最近删除优先</option><option value="oldest">最早删除优先</option><option value="title">标题顺序</option></select></label>
        {(query || type !== 'all' || sort !== 'newest') && <button type="button" className="btn small" onClick={() => changeFilters(() => { setQuery(''); setSearchInput(''); setType('all'); setSort('newest') })}>清除筛选</button>}
      </div>
      {searchError && <p role="alert" id="trash-search-error" className="trash-workspace-error">{searchError} 请输入较短的搜索词；未截断中文候选。</p>}
      {state.items.length > 0 && !searchError && <div className="trash-bulkbar">
        <label className="trash-select-all"><input ref={allBox} type="checkbox" aria-label="全选当前页" disabled={!canAct || pageIDs.length === 0}
          checked={pageIDs.length > 0 && pageSelected === pageIDs.length} onChange={e => {
            store.cancelPlan(); const checked = e.target.checked
            setSelection(prev => { const next = new Set(prev); pageIDs.forEach(id => checked ? next.add(id) : next.delete(id)); return next })
          }} /><span>当前页 {view.rows.length} 项 · 已选 {selection.size} 项{hiddenSelected > 0 ? `（含其他页或筛选外 ${hiddenSelected} 项）` : ''}</span></label>
        <div className="trash-bulk-actions">
          <button type="button" className="btn small" disabled={!selection.size || !canAct} onClick={() => makePlan('restore', [...selection])}>恢复所选</button>
          <button type="button" className="btn small danger" disabled={!selection.size || !canAct} onClick={() => makePlan('delete', [...selection])}>永久删除所选</button>
          {!!selection.size && <button type="button" className="btn small" disabled={locked} onClick={() => { store.cancelPlan(); setSelection(new Set()) }}>取消选择</button>}
          <button type="button" className="btn small danger subtle" disabled={!canAct || state.items.length > TRASH_BATCH_LIMIT} onClick={() => makePlan('delete', state.items.map(row => row.id), 'snapshot')}>清空回收站</button>
        </div>
      </div>}
      {state.items.length > TRASH_BATCH_LIMIT && <p className="trash-workspace-muted">一次最多处理 {TRASH_BATCH_LIMIT} 个顶层项目，请分批选择；不会自动循环清空后续项目。</p>}
      {state.loadState === 'loading' && <p role="status">正在读取回收站…</p>}
      {state.loadState === 'ready' && state.items.length === 0 && <div className="empty-state trash-empty"><div className="trash-empty-mark" aria-hidden="true">✓</div><h3>回收站是空的</h3><p>已成功读取当前列表，没有可显示的已删除项目。</p><button type="button" className="btn" onClick={close}>返回笔记</button></div>}
      {state.loadState !== 'loading' && state.items.length > 0 && !searchError && (view.total === 0 ? <div className="empty-state"><h3>没有匹配的项目</h3><p>只是当前筛选没有结果，不代表回收站为空。</p></div> : <>
        <div className="trash-list" role="list" aria-label="已删除项目">{view.rows.map(row => <article key={row.id} role="listitem" className={`trash-item${selection.has(row.id) ? ' selected' : ''}`} data-trash-id={row.id}>
          <label className="trash-item-select"><input type="checkbox" aria-label={`选择 ${row.title || '未命名'}`} checked={selection.has(row.id)} disabled={!canAct} onChange={e => toggle(row.id, e.target.checked)} /></label>
          <div className={`trash-item-icon${row.is_folder ? ' folder' : ''}`} aria-hidden="true">{row.is_folder ? '▣' : '▤'}</div>
          <div className="trash-item-main"><div className="trash-item-title">{row.title || '未命名'}</div><div className="trash-item-meta"><span>{row.is_folder ? '文件夹（含子项）' : '笔记'}</span><span>{formatTrashDeletedAt(row.deleted_at)}</span></div></div>
          <div className={`trash-retention${row.deleted_at > 0 && trashDaysRemaining(row.deleted_at, now) <= 3 ? ' urgent' : ''}`}>
            {row.deleted_at <= 0 ? <span>清理日期未知</span> : trashDaysRemaining(row.deleted_at, now) === 0 ? <span>已到保留期限</span> : <><strong>{trashDaysRemaining(row.deleted_at, now)}</strong><span>天内到期</span></>}
          </div>
          <div className="trash-item-actions"><button type="button" className="btn small" disabled={!canAct} onClick={() => makePlan('restore', [row.id])}>恢复</button><button type="button" className="btn small danger subtle" disabled={!canAct} onClick={() => makePlan('delete', [row.id])}>永久删除</button></div>
        </article>)}</div>
        <nav className="trash-workspace-pages" aria-label="回收站分页"><span>匹配 {view.total} / {state.items.length} 项 · 第 {view.page} / {view.pages} 页</span><button type="button" className="btn small" disabled={view.page <= 1} onClick={() => { store.cancelPlan(); setPage(view.page - 1) }}>上一页</button><button type="button" className="btn small" disabled={view.page >= view.pages} onClick={() => { store.cancelPlan(); setPage(view.page + 1) }}>下一页</button></nav>
      </>)}
    </div>
    {state.plan && <Confirmation key={state.plan.key} plan={state.plan} onCancel={() => store.cancelPlan()} onConfirm={key => { void store.confirm(key) }} />}
  </div>
}
