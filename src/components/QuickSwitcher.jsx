import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, searchFiles } from '~/services/api'
import { extractLexicalText } from '~/utils/lexicalText'

export function buildHighlightSegments(text, query) {
  const source = String(text || '')
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return [{ text: source, match: false }]

  const lowerSource = source.toLowerCase()
  const lowerQuery = normalizedQuery.toLowerCase()
  const index = lowerSource.indexOf(lowerQuery)
  if (index < 0) return [{ text: source, match: false }]

  const before = source.slice(0, index)
  const matched = source.slice(index, index + normalizedQuery.length)
  const after = source.slice(index + normalizedQuery.length)

  return [
    ...(before ? [{ text: before, match: false }] : []),
    { text: matched, match: true },
    ...(after ? [{ text: after, match: false }] : []),
  ]
}

export function getSearchMatchScope(file, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  if (!normalizedQuery) return file?.is_pinned ? 'pinned' : 'recent'

  const title = String(file?.title || '').toLowerCase()
  if (title.includes(normalizedQuery)) return 'title'

  const body = extractLexicalText(file?.content || '').toLowerCase()
  if (body.includes(normalizedQuery)) return 'content'

  return 'other'
}

function HighlightMatch({ text, query }) {
  return buildHighlightSegments(text, query).map((segment, index) => (
    segment.match
      ? <mark key={`m-${index}`} className="search-match">{segment.text}</mark>
      : <React.Fragment key={`t-${index}`}>{segment.text}</React.Fragment>
  ))
}

function buildPreview(content, query) {
  const text = extractLexicalText(content).replace(/\s+/g, ' ').trim()
  if (!text) return '空白笔记'

  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return text.slice(0, 120)

  const index = text.toLowerCase().indexOf(normalizedQuery)
  if (index < 0) return text.slice(0, 120)

  const start = Math.max(0, index - 42)
  const end = Math.min(text.length, index + normalizedQuery.length + 74)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function formatRelativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts * 1000
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`

  return new Date(ts * 1000).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

function normalizeFiles(list) {
  return (Array.isArray(list) ? list : [])
    .filter(file => !file.is_folder && !file.is_deleted && !file.title?.startsWith('__tpl__'))
}

function normalizeRecentFiles(list) {
  return normalizeFiles(list).sort((a, b) => {
    const pinnedDiff = Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned))
    if (pinnedDiff !== 0) return pinnedDiff
    return (b.updated_at || 0) - (a.updated_at || 0)
  })
}

export default function QuickSwitcher({ open, onClose, onSelectFile, onOpenSearchWorkspace }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const resultsRef = useRef(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!open) return undefined

    setQuery('')
    setResults([])
    setActiveIndex(0)
    setLoading(true)

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [open])

  useEffect(() => {
    if (!open) {
      requestRef.current += 1
      return undefined
    }

    const hasQuery = Boolean(query.trim())
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')

    const runSearch = async () => {
      try {
        const list = hasQuery
          ? await searchFiles(query.trim())
          : await api('/api/files?size=200')

        if (requestRef.current !== requestId) return
        if (!Array.isArray(list)) throw new Error('搜索回执不完整，请更新后端后重试')
        setResults(hasQuery ? normalizeFiles(list) : normalizeRecentFiles(list))
        setActiveIndex(0)
      } catch (error) {
        if (requestRef.current === requestId) {
          console.error('快速搜索失败', error)
          setError(error.message || '读取失败，请重试')
          setResults([])
        }
      } finally {
        if (requestRef.current === requestId) setLoading(false)
      }
    }

    if (!hasQuery) {
      void runSearch()
      return undefined
    }

    const timer = window.setTimeout(() => {
      void runSearch()
    }, 180)

    return () => window.clearTimeout(timer)
  }, [open, query, retry])

  const visibleResults = useMemo(() => results.slice(0, 20), [results])

  useEffect(() => {
    if (activeIndex >= visibleResults.length) {
      setActiveIndex(Math.max(0, visibleResults.length - 1))
    }
  }, [activeIndex, visibleResults.length])

  useEffect(() => {
    const active = resultsRef.current?.querySelector(
      `[data-result-index="${activeIndex}"]`
    )
    active?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, visibleResults.length])

  if (!open) return null

  const choose = (file) => {
    if (!file || loading) return
    onSelectFile?.(file)
    onClose?.()
  }

  const handleKeyDown = (event) => {
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (visibleResults.length) {
        setActiveIndex(index => (index + 1) % visibleResults.length)
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (visibleResults.length) {
        setActiveIndex(index => (index - 1 + visibleResults.length) % visibleResults.length)
      }
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      choose(visibleResults[activeIndex])
    }
  }

  return (
    <div
      className="quick-switcher-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <section className="quick-switcher" role="dialog" aria-modal="true" aria-label="快速搜索笔记">
        <div className="quick-switcher-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索标题或正文…"
            aria-label="搜索标题或正文"
            aria-controls="quick-switcher-results"
            aria-activedescendant={visibleResults[activeIndex] ? `quick-result-${visibleResults[activeIndex].id}` : undefined}
            aria-autocomplete="list"
          />
          <kbd>Ctrl K</kbd>
        </div>

        <div className="quick-switcher-meta" role="status" aria-live="polite">
          <span>{query.trim() ? '搜索结果' : '最近笔记'}</span>
          <span>{loading ? '搜索中…' : error ? '读取失败' : `${visibleResults.length} 项`}</span>
        </div>

        <div
          id="quick-switcher-results"
          ref={resultsRef}
          className="quick-switcher-results"
          role="listbox"
          aria-label="搜索结果"
        >
          {error ? (<div className="quick-switcher-empty" role="alert"><strong>快速搜索未完成</strong><span>{error}</span><button type="button" className="btn small" onClick={() => setRetry(value => value + 1)}>重试快速搜索</button></div>) : !loading && visibleResults.length === 0 ? (
            <div className="quick-switcher-empty">
              <strong>{query.trim() ? '没有找到匹配的笔记' : '还没有可打开的笔记'}</strong>
              <span>{query.trim() ? '换一个关键词试试。' : '先创建一篇笔记，然后就能在这里快速打开。'}</span>
            </div>
          ) : (
            visibleResults.map((file, index) => {
              const scope = getSearchMatchScope(file, query)
              const scopeLabel = {
                title: '标题命中',
                content: '正文命中',
                pinned: '已置顶',
                recent: '最近',
              }[scope]

              return (
                <button
                  type="button"
                  disabled={loading}
                  id={`quick-result-${file.id}`}
                  data-result-index={index}
                  key={file.id}
                  className={`quick-switcher-result${index === activeIndex ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(file)}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <span className="quick-switcher-result-main">
                    <span className="quick-switcher-result-title-row">
                      <span className="quick-switcher-result-title">
                        {file.is_pinned && <span aria-label="已置顶">★</span>}
                        <HighlightMatch text={file.title} query={query} />
                      </span>
                      {scopeLabel && <span className={`quick-switcher-match-badge ${scope}`}>{scopeLabel}</span>}
                    </span>
                    <span className="quick-switcher-result-preview">
                      <HighlightMatch text={buildPreview(file.content, query)} query={query} />
                    </span>
                  </span>
                  <span className="quick-switcher-result-time">{formatRelativeTime(file.updated_at)}</span>
                </button>
              )
            })
          )}
        </div>

        {onOpenSearchWorkspace && <div className="quick-switcher-meta"><button type="button" className="btn small" onClick={() => onOpenSearchWorkspace(query)}>完整检索与筛选</button><span>快速结果最多展示 20 项</span></div>}
        <footer className="quick-switcher-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </footer>
      </section>
    </div>
  )
}
