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
import './WikiLinkPlugin.css'

const MAX_RESULTS = 8

function matchWikiQuery(text, offset) {
  const before = text.slice(0, offset)
  const match = before.match(/\[\[([^\]\n]{0,100})$/)
  if (!match) return null

  return {
    raw: match[0],
    query: match[1],
    start: offset - match[0].length,
  }
}

function normalizeResults(list) {
  return (Array.isArray(list) ? list : [])
    .filter(file => !file.is_folder && !file.is_deleted && !file.title?.startsWith('__tpl__'))
    .slice(0, MAX_RESULTS)
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

  $insertNodes([
    $createWikiLinkNode(file.id, file.title || '未命名'),
    $createTextNode(' '),
  ])
  return true
}

export default function WikiLinkPlugin() {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const requestRef = useRef(0)
  const menuRef = useRef(null)

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
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
        setQuery(match.query)
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
    const timer = window.setTimeout(async () => {
      try {
        const trimmed = query.trim()
        const list = trimmed
          ? await searchFiles(trimmed)
          : await api('/api/files?page=1&size=20&compact=1')

        if (requestRef.current !== requestId) return
        setResults(normalizeResults(list))
        setSelectedIndex(0)
      } catch (error) {
        if (requestRef.current === requestId) {
          console.error('WikiLink 搜索失败', error)
          setResults([])
        }
      }
    }, query.trim() ? 120 : 0)

    return () => window.clearTimeout(timer)
  }, [isOpen, query])

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

    menuRef.current.style.top = `${top}px`
    menuRef.current.style.left = `${left}px`
  }, [isOpen, position, results])

  if (!isOpen) return null

  return (
    <div
      ref={menuRef}
      className="wiki-link-menu"
      role="listbox"
      aria-label="链接笔记"
    >
      <div className="wiki-link-menu-header">
        <span>链接笔记</span>
        <small>{query ? `搜索：${query}` : '最近笔记'}</small>
      </div>

      {results.length === 0 ? (
        <div className="wiki-link-menu-empty">没有匹配的笔记</div>
      ) : (
        results.map((file, index) => (
          <button
            type="button"
            key={file.id}
            className={`wiki-link-menu-item${index === selectedIndex ? ' selected' : ''}`}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => insertLink(file)}
          >
            <span className="wiki-link-menu-icon">↗</span>
            <span className="wiki-link-menu-title">{file.title || '未命名'}</span>
          </button>
        ))
      )}

      <div className="wiki-link-menu-footer">↑↓ 选择 · Enter 插入 · Esc 关闭</div>
    </div>
  )
}

export { matchWikiQuery }
