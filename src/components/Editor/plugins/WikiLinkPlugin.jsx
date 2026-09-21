import { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isTextNode,
} from 'lexical'
import { api, searchFiles } from '~/services/api'
import { $createWikiLinkNode, WikiLinkNode } from '../nodes/WikiLinkNode'
import {
  extractHeadingReferences,
  formatSectionPath,
  getRecentReferences,
  normalizeSectionPath,
  rememberReference,
} from '../utils/referenceUtils'
import './WikiLinkPlugin.css'

const MAX_RESULTS = 8
const MAX_SECTION_FILES = 5

function matchWikiQuery(text, offset) {
  const before = text.slice(0, offset)
  const match = before.match(/\[\[([^\]\n]{0,160})$/)
  if (!match) return null

  const query = match[1]
  const separatorIndex = query.indexOf('#')
  const hasSectionQuery = separatorIndex >= 0

  return {
    raw: match[0],
    query,
    noteQuery: hasSectionQuery ? query.slice(0, separatorIndex) : query,
    sectionQuery: hasSectionQuery ? query.slice(separatorIndex + 1) : '',
    hasSectionQuery,
    start: offset - match[0].length,
  }
}

function normalizeResults(list) {
  return (Array.isArray(list) ? list : [])
    .filter(file => !file.is_folder && !file.is_deleted && !file.title?.startsWith('__tpl__'))
    .map(file => ({
      id: file.id,
      title: file.title || '未命名',
      sectionPath: normalizeSectionPath(file.sectionPath),
      recent: Boolean(file.recent),
    }))
    .slice(0, MAX_RESULTS)
}

function resultKey(item) {
  return [
    String(item?.id || ''),
    ...normalizeSectionPath(item?.sectionPath),
  ].join('\u001f')
}

function mergeUniqueResults(...groups) {
  const seen = new Set()
  const merged = []

  for (const group of groups) {
    for (const item of normalizeResults(group)) {
      const key = resultKey(item)
      if (!item.id || seen.has(key)) continue
      seen.add(key)
      merged.push(item)
      if (merged.length >= MAX_RESULTS) return merged
    }
  }

  return merged
}

async function loadSectionResults(noteQuery, sectionQuery) {
  const normalizedNoteQuery = String(noteQuery || '').trim()
  const normalizedSectionQuery = String(sectionQuery || '').trim().toLocaleLowerCase()

  const list = normalizedNoteQuery
    ? await searchFiles(normalizedNoteQuery)
    : await api('/api/files?page=1&size=20&compact=1')

  const files = normalizeResults(list)
    .sort((a, b) => {
      const aExact = a.title.toLocaleLowerCase() === normalizedNoteQuery.toLocaleLowerCase()
      const bExact = b.title.toLocaleLowerCase() === normalizedNoteQuery.toLocaleLowerCase()
      return Number(bExact) - Number(aExact)
    })
    .slice(0, MAX_SECTION_FILES)

  const groups = await Promise.all(files.map(async file => {
    try {
      const full = await api('/api/files/' + file.id)
      return extractHeadingReferences(full?.content || '')
        .filter(section => {
          if (!normalizedSectionQuery) return true
          const haystack = section.path.join(' ').toLocaleLowerCase()
          return haystack.includes(normalizedSectionQuery)
        })
        .map(section => ({
          id: file.id,
          title: file.title,
          sectionPath: section.path,
        }))
    } catch {
      return []
    }
  }))

  return groups.flat().slice(0, MAX_RESULTS)
}

export function $insertWikiLinkAtSelection(file) {
  if (!file?.id) return false

  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

  const anchorNode = selection.anchor.getNode()
  if (!$isTextNode(anchorNode)) return false

  const match = matchWikiQuery(anchorNode.getTextContent(), selection.anchor.offset)
  if (!match) return false

  anchorNode.spliceText(match.start, match.raw.length, '', true)
  const currentSelection = $getSelection()
  if (!$isRangeSelection(currentSelection)) return false

  const sectionPath = normalizeSectionPath(file.sectionPath)
  $insertNodes([
    $createWikiLinkNode(file.id, file.title || '未命名', sectionPath),
    $createTextNode(' '),
  ])
  return true
}

export default function WikiLinkPlugin() {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [queryInfo, setQueryInfo] = useState({
    query: '',
    noteQuery: '',
    sectionQuery: '',
    hasSectionQuery: false,
  })
  const [results, setResults] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const requestRef = useRef(0)
  const menuRef = useRef(null)

  const close = useCallback(() => {
    setIsOpen(false)
    setQueryInfo({
      query: '',
      noteQuery: '',
      sectionQuery: '',
      hasSectionQuery: false,
    })
    setResults([])
    setSelectedIndex(0)
    requestRef.current += 1
  }, [])

  const insertLink = useCallback((file) => {
    let inserted = false
    editor.update(() => {
      inserted = $insertWikiLinkAtSelection(file)
    })

    if (inserted) {
      rememberReference(file)
      close()
      editor.focus()
    }
  }, [editor, close])

  useEffect(() => {
    if (!editor.hasNodes([WikiLinkNode])) {
      console.error('WikiLinkPlugin: WikiLinkNode 未注册')
      return undefined
    }

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          close()
          return
        }

        const anchorNode = selection.anchor.getNode()
        if (!$isTextNode(anchorNode)) {
          close()
          return
        }

        const match = matchWikiQuery(anchorNode.getTextContent(), selection.anchor.offset)
        if (!match) {
          close()
          return
        }

        const domSelection = window.getSelection()
        if (!domSelection || domSelection.rangeCount === 0) return

        const rect = domSelection.getRangeAt(0).getBoundingClientRect()
        setQueryInfo({
          query: match.query,
          noteQuery: match.noteQuery,
          sectionQuery: match.sectionQuery,
          hasSectionQuery: match.hasSectionQuery,
        })
        setIsOpen(true)
        setPosition({
          top: rect.bottom + 8,
          left: rect.left,
        })
      })
    })
  }, [editor, close])

  useEffect(() => {
    if (!isOpen) return undefined

    const requestId = ++requestRef.current
    const trimmedQuery = queryInfo.query.trim()
    const timer = window.setTimeout(async () => {
      try {
        let nextResults

        if (queryInfo.hasSectionQuery) {
          nextResults = await loadSectionResults(
            queryInfo.noteQuery,
            queryInfo.sectionQuery,
          )
        } else {
          const list = trimmedQuery
            ? await searchFiles(trimmedQuery)
            : await api('/api/files?page=1&size=20&compact=1')

          const recent = trimmedQuery
            ? []
            : getRecentReferences(MAX_RESULTS).map(item => ({
              ...item,
              recent: true,
            }))

          nextResults = mergeUniqueResults(recent, list)
        }

        if (requestRef.current !== requestId) return
        setResults(nextResults)
        setSelectedIndex(0)
      } catch (error) {
        if (requestRef.current === requestId) {
          console.error('WikiLink 搜索失败', error)
          setResults([])
        }
      }
    }, trimmedQuery ? 120 : 0)

    return () => window.clearTimeout(timer)
  }, [isOpen, queryInfo])

  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }

      if (results.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex(index => (index + 1) % results.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex(index => (index - 1 + results.length) % results.length)
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        insertLink(results[selectedIndex])
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, results, selectedIndex, insertLink, close])

  useEffect(() => {
    if (!isOpen || !menuRef.current) return

    const menuRect = menuRef.current.getBoundingClientRect()
    const margin = 12
    let top = position.top
    let left = position.left

    if (top + menuRect.height > window.innerHeight - margin) {
      top = Math.max(margin, position.top - menuRect.height - 24)
    }
    if (left + menuRect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - menuRect.width - margin)
    }

    menuRef.current.style.top = top + 'px'
    menuRef.current.style.left = left + 'px'
  }, [isOpen, position, results])

  if (!isOpen) return null

  const modeLabel = queryInfo.hasSectionQuery ? '链接章节' : '链接笔记'
  const queryLabel = queryInfo.hasSectionQuery
    ? (
      (queryInfo.noteQuery.trim() || '任意笔记') +
      ' # ' +
      (queryInfo.sectionQuery.trim() || '全部章节')
    )
    : (queryInfo.query ? ('搜索：' + queryInfo.query) : '最近引用优先')

  return (
    <div
      ref={menuRef}
      className="wiki-link-menu"
      role="listbox"
      aria-label={modeLabel}
    >
      <div className="wiki-link-menu-header">
        <span>{modeLabel}</span>
        <small>{queryLabel}</small>
      </div>

      {results.length === 0 ? (
        <div className="wiki-link-menu-empty">
          {queryInfo.hasSectionQuery ? '没有匹配的章节' : '没有匹配的笔记'}
        </div>
      ) : (
        results.map((file, index) => {
          const sectionLabel = formatSectionPath(file.sectionPath)

          return (
            <button
              type="button"
              key={resultKey(file)}
              className={'wiki-link-menu-item' + (index === selectedIndex ? ' selected' : '')}
              role="option"
              aria-selected={index === selectedIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => insertLink(file)}
            >
              <span className="wiki-link-menu-icon">
                {sectionLabel ? '§' : '↗'}
              </span>
              <span className="wiki-link-menu-copy">
                <span className="wiki-link-menu-title">
                  {file.title || '未命名'}
                  {file.recent && <em>最近</em>}
                </span>
                {sectionLabel && (
                  <small className="wiki-link-menu-section">{sectionLabel}</small>
                )}
              </span>
            </button>
          )
        })
      )}

      <div className="wiki-link-menu-footer">
        {queryInfo.hasSectionQuery
          ? '输入 [[笔记#章节 · ↑↓ 选择 · Enter 插入'
          : '输入 # 可继续选择章节 · ↑↓ 选择 · Enter 插入'}
      </div>
    </div>
  )
}

export { matchWikiQuery }
