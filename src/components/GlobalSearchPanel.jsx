import React, { useEffect, useRef, useState } from 'react'
import useBackupDialogFocus from '~/hooks/useBackupDialogFocus'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { toast } from '~/services/toast'
import { searchLibrary, searchTitleSegments, prepareSearchLocation, SEARCH_KINDS, SEARCH_SOURCES } from '~/services/globalSearch'
import SearchCollectionsPanel from './SearchCollectionsPanel'
import useSearchCollections from '~/hooks/useSearchCollections'
import SearchPresetsPanel from './SearchPresetsPanel'
import SearchResultExportPanel from './SearchResultExportPanel'
import useSearchResultExport from '~/hooks/useSearchResultExport'
import { createSearchReturnContext, restoreSearchReturnFilters } from '~/services/searchReturn'
import { applySearchPresetFilters } from '~/services/searchPresets'
import './GlobalSearchPanel.css'

const defaults = () => ({ query: '', source: 'all', folderId: '', pinned: false, matchCase: false, days: '0', since: 0, sort: 'relevance', page: 1, revision: '' })
const date = value => value > 0 ? new Date(value * 1000).toLocaleString('zh-CN') : '修改时间未知'
function Highlight({ title, query, matchCase }) {
  return searchTitleSegments(title, query, matchCase).map((part, i) => part.match ? <mark key={i}>{part.text}</mark> : <React.Fragment key={i}>{part.text}</React.Fragment>)
}
function SnippetText({ value }) {
  return <p>{value.leading && '…'}{value.before}<mark>{value.match}</mark>{value.after}{value.trailing && '…'}</p>
}
function DialogFrame({ onClose, inputRef, children }) {
  const overlay = useRef(null), dialog = useRef(null)
  useBackupDialogFocus(overlay, dialog, inputRef, onClose)
  return <div ref={overlay} className="global-search-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="global-search-panel" role="dialog" aria-modal="true" aria-labelledby="global-search-title">{children}</section>
  </div>
}

// Remains mounted after first use so filters survive a result -> editor -> search
// round-trip. Closing cancels requests and releases result snippets, not the draft.
export default function GlobalSearchPanel({ open, onClose, onOpenFile, seed, onOpened, returnRequest }) {
  const [mode, setMode] = useState('search')
  const collectionTabRef = useRef(null), searchTabRef = useRef(null)
  const [filters, setFilters] = useState(defaults)
  const [response, setResponse] = useState(null)
  const [folders, setFolders] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [returnNotice, setReturnNotice] = useState('')
  const appliedReturn = useRef(null)
  const [refresh, setRefresh] = useState(0)
  const inputRef = useRef(null), listRef = useRef(null)
  const generation = useRef(0), operation = useRef(null), responseKey = useRef('')
  const seedRef = useRef(seed), wasOpen = useRef(open)
  const pageLanding = useRef(null), listScroll = useRef({ page: 1, top: 0 })
  const requestKey = JSON.stringify(filters)
  const current = useRef({ open, onClose, onOpenFile, onOpened })
  current.current = { open, onClose, onOpenFile, onOpened }

  useEffect(() => {
    if (!seed || seedRef.current === seed) return
    seedRef.current = seed
    setMode('search')
    setFilters({ ...defaults(), query: String(seed.query || '') })
  }, [seed])
  // Initial seed is supplied by the quick switcher when entering for the first time.
  useEffect(() => { if (seed?.query) setFilters({ ...defaults(), query: String(seed.query) }) }, [])

  useEffect(() => {
    const reopening = open && !wasOpen.current
    wasOpen.current = open
    if (reopening && (!returnRequest || appliedReturn.current === returnRequest)) setFilters(previous => previous.days === '0' ? previous : applySearchPresetFilters(previous))
  }, [open])

  useEffect(() => {
    if (!open || !returnRequest || appliedReturn.current === returnRequest) return
    appliedReturn.current = returnRequest
    setMode('search')
    try {
      const context = returnRequest.context
      const next = restoreSearchReturnFilters(context)
      pageLanding.current = null
      listScroll.current = { page: context.page, top: context.scrollTop }
      setSelectedId(context.documentId); setReturnNotice(''); setOpenError('')
      setFilters(next); setRefresh(value => value + 1)
    } catch (failure) { setReturnNotice(failure.message) }
  }, [open, returnRequest])

  useEffect(() => {
    const token = ++generation.current
    const controller = new AbortController()
    if (!open) { setResponse(null); setStatus('loading'); setOpenError(''); return }
    if (mode !== 'search') return () => controller.abort()
    setStatus('loading'); setError('')
    const timer = setTimeout(async () => {
      try {
        const data = await searchLibrary(filters, controller.signal)
        if (controller.signal.aborted || token !== generation.current) return
        responseKey.current = requestKey
        setResponse(data); setFolders(data.folders); setStatus('ready')
        const landing = pageLanding.current
        pageLanding.current = null
        if (filters.anchorId) {
          setReturnNotice(data.anchor_found ? '已按笔记标识找回原结果，排序与命中以本次已保存数据为准。' : '原笔记已不在当前检索结果中，可能被修改、移动或删除；没有自动扩大范围。')
        }
        setSelectedId(previous => filters.anchorId ? (data.anchor_found ? filters.anchorId : data.items[0]?.id || '') : landing === 'last' ? data.items.at(-1)?.id || '' : landing === 'first' ? data.items[0]?.id || '' : data.items.some(item => item.id === previous) ? previous : data.items[0]?.id || '')
      } catch (failure) {
        if (controller.signal.aborted || token !== generation.current) return
        setResponse(null); setStatus('error'); setError(failure.message || '检索未完成，请重试')
      }
    }, filters.query.trim() ? 200 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, mode, requestKey, refresh])

  useEffect(() => {
    if (!open && operation.current) { operation.current.abort(); operation.current = null; setOpening(false) }
    return () => { if (operation.current) { operation.current.abort(); operation.current = null } }
  }, [open])

  const update = patch => { pageLanding.current = null; listScroll.current = { page: 1, top: 0 }; setOpenError(''); setReturnNotice(''); setFilters(previous => ({ ...previous, ...patch, page: 1, revision: '', anchorId: '' })) }
  const retry = () => { setReturnNotice(''); pageLanding.current = null; listScroll.current = { page: 1, top: 0 }; setFilters(previous => applySearchPresetFilters(previous)); setRefresh(value => value + 1) }
  const ready = status === 'ready' && responseKey.current === requestKey
  const selected = ready ? response?.items.find(item => item.id === selectedId) : null
  const collection = useSearchResultExport({ open, ready: ready && mode === 'search', filters, response, opening })
  const archives = useSearchCollections({ active: open && mode === 'collections' && !opening })
  useEffect(() => {
    if (!open || !ready || !listRef.current) return
    const saved = listScroll.current
    listRef.current.scrollTop = saved.page === response.page ? saved.top : 0
    if (filters.anchorId && response.anchor_found) {
      const index = response.items.findIndex(item => item.id === filters.anchorId)
      const button = listRef.current.querySelectorAll('[data-search-result]')[index]
      button?.focus({ preventScroll: true })
      button?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [open, ready, response])
  const close = () => {
    // Reopening refreshes the same filters/page against a new committed snapshot.
    setFilters(previous => ({ ...previous, revision: '' })); onClose?.()
  }
  const openResult = async (item, snippet, archived = false) => {
    if ((!ready && !archived) || operation.current || !onOpenFile || !item) return
    if (archived && !archives.canOpen(item)) return
    const controller = new AbortController(); operation.current = controller
    setOpening(true); setOpenError('')
    try {
      const target = snippet ? await prepareSearchLocation(item, snippet, controller.signal) : null
      if (controller.signal.aborted || !current.current.open) return
      const context = archived ? null : createSearchReturnContext(item, filters, response, listRef.current?.scrollTop ?? listScroll.current.top)
      const accepted = await current.current.onOpenFile(item.id)
      if (controller.signal.aborted || !current.current.open) return
      if (accepted === false) { setOpenError('已取消打开，原草稿与检索条件均已保留。'); return }
      if (archived || context) current.current.onOpened?.(context)
      if (target) evidenceNavigation.start(item.id, target, () => toast.warning('笔记尚未就绪，定位已取消；请重新检索后定位'))
      setFilters(previous => ({ ...previous, revision: '' })); current.current.onClose?.()
    } catch (failure) {
      if (!controller.signal.aborted && current.current.open) setOpenError(failure.message || '无法打开笔记，请重试')
    } finally {
      if (operation.current === controller) { operation.current = null; setOpening(false) }
    }
  }
  const changePage = (page, landing = 'first') => {
    if (!ready) return
    pageLanding.current = landing; listScroll.current = { page, top: 0 }
    setReturnNotice(''); setFilters(previous => ({ ...previous, page, revision: response.revision, anchorId: '' }))
  }
  const selectedIndex = ready ? response.items.findIndex(item => item.id === selectedId) : -1
  const moveResult = direction => {
    if (!ready || selectedIndex < 0) return
    const index = selectedIndex + direction
    if (index < 0 && response.page > 1) changePage(response.page - 1, 'last')
    else if (index >= response.items.length && response.page < response.pages) changePage(response.page + 1, 'first')
    else if (response.items[index]) selectResult(response.items[index])
  }
  const selectResult = (item, focus = false) => {
    setSelectedId(item.id)
    if (focus) listRef.current?.querySelectorAll('[data-search-result]')[response.items.indexOf(item)]?.focus()
  }
  if (!open) return null
  // Unmount the focus trap while App's existing save/discard/cancel guard is open.
  if (opening) return <div className="global-search-opening" role="status">正在打开笔记；如有未保存内容，请先处理保存确认。</div>
  return <DialogFrame onClose={close} inputRef={mode === 'search' ? inputRef : collectionTabRef}>
    <header className="global-search-header">
      <div><h2 id="global-search-title">全局检索</h2><p>在所有已保存笔记中查找，先看上下文，再回到正文。</p></div>
      <button type="button" onClick={close} aria-label="关闭全局检索">×</button>
    </header>
    <div className="global-search-tabs" role="tablist" aria-label="检索工作区">
      {[['search', '检索结果', searchTabRef], ['collections', '本地资料集', collectionTabRef]].map(([id, title, ref]) =>
        <button key={id} ref={ref} type="button" role="tab" id={'search-tab-' + id} aria-selected={mode === id}
          aria-controls={'search-mode-' + id} tabIndex={mode === id ? 0 : -1}
          onClick={() => setMode(id)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 'search' : event.key === 'End' ? 'collections' : mode === 'search' ? 'collections' : 'search'
            setMode(next); (next === 'search' ? searchTabRef : collectionTabRef).current?.focus()
          }}>{title}</button>)}
    </div>
    <div className="global-search-mode" role="tabpanel" id="search-mode-search" aria-labelledby="search-tab-search" hidden={mode !== 'search'}>
    <div className="global-search-query">
      <input ref={inputRef} aria-label="全局检索关键词" placeholder="输入词语或完整短语；留空浏览笔记" value={filters.query}
        onChange={event => update({ query: event.target.value })}
        onKeyDown={event => {
          if (event.nativeEvent?.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter') { event.preventDefault(); retry() }
          if (event.key === 'ArrowDown' && ready && response.items.length) { event.preventDefault(); selectResult(response.items[0], true) }
        }} />
      <button type="button" className="primary" onClick={retry}>搜索 / 刷新</button>
    </div>
    <div className="global-search-filters">
      <label>查找范围<select aria-label="检索目录范围" value={filters.folderId} onChange={event => update({ folderId: event.target.value })}>
        <option value="">全部目录与项目</option>
        {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
        {filters.folderId && !folders.some(folder => folder.id === filters.folderId) && <option value={filters.folderId}>原目录不可用</option>}
      </select></label>
      <label>命中位置<select aria-label="检索命中位置" value={filters.source} onChange={event => update({ source: event.target.value })}>
        {Object.entries(SEARCH_SOURCES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>修改时间<select aria-label="检索修改时间" value={filters.days} onChange={event => update({ days: event.target.value, since: Number(event.target.value) ? Math.floor(Date.now() / 1000) - Number(event.target.value) * 86400 : 0 })}>
        <option value="0">不限时间</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option>
      </select></label>
      <label>排序<select aria-label="检索结果排序" value={filters.sort} onChange={event => update({ sort: event.target.value })}>
        <option value="relevance">标题优先</option><option value="updated">最近修改</option><option value="title">标题顺序</option>
      </select></label>
      <label className="check"><input type="checkbox" checked={filters.pinned} onChange={event => update({ pinned: event.target.checked })} />仅置顶</label>
      <label className="check"><input type="checkbox" checked={filters.matchCase} onChange={event => update({ matchCase: event.target.checked })} />区分大小写</label>
      <button type="button" onClick={() => { setFilters(defaults()); setOpenError('') }}>重置</button>
    </div>
    <SearchPresetsPanel filters={filters} onApply={next => { update(next); setRefresh(value => value + 1) }} />
    <SearchResultExportPanel collection={collection} response={response} ready={ready} />
    <div className="global-search-summary" role="status" aria-live="polite">
      {status === 'error' ? '检索未完成，不能据此判断没有结果' : !ready ? '正在检索本地已保存内容…' :
        `${response.total} 篇笔记${response.query ? ' · 正文共 ' + response.total_occurrences + ' 处命中' : ''} · 当前范围 ${response.scanned} 篇`}
      {ready && Number.isSafeInteger(response.cache_hits) && Number.isSafeInteger(response.parsed) && <small> · 本次复用 {response.cache_hits} 篇解析，新解析 {response.parsed} 篇（仍核验当前正文）</small>}
    </div>
    {error && <div className="global-search-notice" role="alert"><p>{error}</p><button type="button" onClick={retry}>重新检索</button></div>}
    {returnNotice && <div className="global-search-notice" role="status">{returnNotice}</div>}
    {openError && <div className="global-search-notice" role="alert">{openError}</div>}
    {ready && response.unsupported > 0 && <div className="global-search-notice" role="status">有 {response.unsupported} 篇正文格式未能解析；标题仍可检索，正文结果可能不完整。原文未修改。</div>}
    <div className="global-search-content" aria-busy={!ready && status !== 'error'}>
      <div className="global-search-result-column">
        <div ref={listRef} className="global-search-results" role="listbox" aria-label="全局检索结果" onScroll={event => { if (ready) listScroll.current = { page: response.page, top: event.currentTarget.scrollTop } }}
          onKeyDown={event => {
            if (event.isComposing || !ready || !response.items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const index = response.items.findIndex(item => item.id === selectedId)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? response.items.length - 1 : Math.max(0, Math.min(response.items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
            selectResult(response.items[next], true)
          }}>
          {ready && response.items.map(item => <button type="button" data-search-result key={item.id} role="option" aria-selected={item.id === selectedId}
            tabIndex={item.id === selectedId ? 0 : -1} onClick={() => selectResult(item)}>
            <span className="global-search-result-title">{collection.selectedIds.has(item.id) && <span aria-label="已加入导出清单">✓ </span>}{item.is_pinned && <span aria-label="已置顶">★ </span>}<Highlight title={item.title} query={response.query} matchCase={filters.matchCase} /></span>
            <span className="global-search-result-path">{item.folder_path}</span>
            <span className="global-search-result-meta">{item.title_match ? '标题命中 · ' : ''}{item.body_count ? '正文 ' + item.body_count + ' 处 · ' : ''}{date(item.updated_at)}</span>
          </button>)}
          {ready && !response.total && <div className="global-search-empty"><strong>当前范围没有匹配的笔记</strong><p>试试缩短关键词，或重置目录、时间和置顶筛选。</p></div>}
          {!ready && status !== 'error' && <div className="global-search-empty">正在准备结果…</div>}
        </div>
        {ready && response.total > 0 && <nav className="global-search-pagination" aria-label="全局检索分页">
          <button type="button" disabled={response.page <= 1} onClick={() => changePage(response.page - 1)}>上一页</button>
          <span>第 {response.page} / {response.pages} 页 · 每页 {response.page_size} 篇</span>
          <button type="button" disabled={response.page >= response.pages} onClick={() => changePage(response.page + 1)}>下一页</button>
        </nav>}
      </div>
      <section className="global-search-preview" aria-label="检索上下文预览">
        {selected ? <>
          <nav className="global-search-result-navigation" aria-label="连续查看检索结果">
            <button type="button" disabled={response.page === 1 && selectedIndex === 0} onClick={() => moveResult(-1)}>上一结果</button>
            <span>第 {(response.page - 1) * response.page_size + selectedIndex + 1} / {response.total} 篇</span>
            <button type="button" disabled={response.page === response.pages && selectedIndex === response.items.length - 1} onClick={() => moveResult(1)}>下一结果</button>
          </nav>
          <header><small>{selected.folder_path}</small><h3><Highlight title={selected.title} query={response.query} matchCase={filters.matchCase} /></h3>
            <button type="button" className="primary" disabled={!onOpenFile} onClick={() => void openResult(selected)}>打开笔记</button>
            <button type="button" className="search-result-collect" disabled={collection.busy} aria-pressed={collection.selectedIds.has(selected.id)} onClick={() => collection.toggle(selected)}>{collection.selectedIds.has(selected.id) ? '移出导出清单' : '加入导出清单'}</button></header>
          {selected.snippets.map((snippet, index) => <article className="global-search-snippet" key={selected.id + ':' + index}>
            <small>{SEARCH_KINDS[snippet.kind]} · 节选 {index + 1}</small><SnippetText value={snippet} />
            {snippet.kind === 'body' ? <button type="button" disabled={!onOpenFile} onClick={() => void openResult(selected, snippet)}>定位第 {index + 1} 处</button> : <small>打开笔记后查看此类内容；不模拟字符定位。</small>}
          </article>)}
          {selected.body_count > selected.snippets.length && <p className="global-search-help">另有 {selected.body_count - selected.snippets.length} 处命中，打开笔记后可用 Ctrl + F 继续查找。</p>}
          {!selected.snippets.length && <p className="global-search-help">{response.query ? '此笔记仅标题命中。' : '输入关键词后，这里会展示正文上下文。'}</p>}
          <p className="global-search-help">普通文字定位会校验正文版本。打开笔记仍经过现有保存确认；取消后返回本页，草稿不丢失。</p>
        </> : <div className="global-search-empty">选择左侧结果查看上下文</div>}
      </section>
    </div>
    <footer className="global-search-footer">字面短语检索，不执行正则或逻辑运算符。仅已保存笔记，不含回收站、模板、外部附件文件内容及未保存草稿。未手动保存的检索条件仅在当前窗口保留。</footer>
    </div>
    <div className="global-search-mode" role="tabpanel" id="search-mode-collections" aria-labelledby="search-tab-collections" hidden={mode !== 'collections'}>
      {openError && mode === 'collections' && <p className="global-search-notice" role="alert">{openError}</p>}
      <SearchCollectionsPanel model={archives} onOpenFile={onOpenFile ? item => openResult(item, null, true) : null} />
    </div>
  </DialogFrame>
}
