import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, searchFiles } from '~/services/api'

function extractPlainText(content) {
  if (!content) return ''

  try {
    const state = JSON.parse(content)
    const collect = (node) => {
      if (!node) return ''
      if (node.type === 'text') return node.text || ''
      if (!Array.isArray(node.children)) return ''
      return node.children.map(collect).join(' ')
    }
    return collect(state?.root).replace(/\s+/g, ' ').trim()
  } catch {
    return String(content).replace(/\s+/g, ' ').trim()
  }
}

function buildPreview(content, query) {
  const text = extractPlainText(content)
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

export default function QuickSwitcher({ open, onClose, onSelectFile }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!open) return undefined

    setQuery('')
    setActiveIndex(0)
    requestRef.current += 1
    const requestId = requestRef.current
    setLoading(true)

    api('/api/files?size=200')
      .then(list => {
        if (requestRef.current !== requestId) return
        setResults(normalizeRecentFiles(list))
      })
      .catch(() => {
        if (requestRef.current === requestId) setResults([])
      })
      .finally(() => {
        if (requestRef.current === requestId) setLoading(false)
      })

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    const timer = window.setTimeout(async () => {
      const requestId = ++requestRef.current
      setLoading(true)

      try {
        const hasQuery = Boolean(query.trim())
        const list = hasQuery
          ? await searchFiles(query.trim())
          : await api('/api/files?size=200')

        if (requestRef.current !== requestId) return
        setResults(hasQuery ? normalizeFiles(list) : normalizeRecentFiles(list))
        setActiveIndex(0)
      } catch (error) {
        if (requestRef.current === requestId) {
          console.error('快速搜索失败', error)
          setResults([])
        }
      } finally {
        if (requestRef.current === requestId) setLoading(false)
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [open, query])

  const visibleResults = useMemo(() => results.slice(0, 20), [results])

  useEffect(() => {
    if (activeIndex >= visibleResults.length) {
      setActiveIndex(Math.max(0, visibleResults.length - 1))
    }
  }, [activeIndex, visibleResults.length])

  if (!open) return null

  const choose = (file) => {
    if (!file) return
    onSelectFile?.(file)
    onClose?.()
  }

  const handleKeyDown = (event) => {
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
          />
          <kbd>Ctrl K</kbd>
        </div>

        <div className="quick-switcher-meta">
          <span>{query.trim() ? '搜索结果' : '最近笔记'}</span>
          <span>{loading ? '搜索中…' : `${visibleResults.length} 项`}</span>
        </div>

        <div className="quick-switcher-results" role="listbox" aria-label="搜索结果">
          {!loading && visibleResults.length === 0 ? (
            <div className="quick-switcher-empty">
              <strong>{query.trim() ? '没有找到匹配的笔记' : '还没有可打开的笔记'}</strong>
              <span>{query.trim() ? '换一个关键词试试。' : '先创建一篇笔记，然后就能在这里快速打开。'}</span>
            </div>
          ) : (
            visibleResults.map((file, index) => (
              <button
                type="button"
                key={file.id}
                className={`quick-switcher-result${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(file)}
                role="option"
                aria-selected={index === activeIndex}
              >
                <span className="quick-switcher-result-main">
                  <span className="quick-switcher-result-title">
                    {file.is_pinned && <span aria-label="已置顶">★</span>}
                    {file.title}
                  </span>
                  <span className="quick-switcher-result-preview">{buildPreview(file.content, query)}</span>
                </span>
                <span className="quick-switcher-result-time">{formatRelativeTime(file.updated_at)}</span>
              </button>
            ))
          )}
        </div>

        <footer className="quick-switcher-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </footer>
      </section>
    </div>
  )
}
