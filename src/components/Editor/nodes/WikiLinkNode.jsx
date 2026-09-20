import { DecoratorNode } from 'lexical'
import React, { useEffect, useRef, useState } from 'react'
import { api } from '~/services/api'
import { extractLexicalText } from '~/utils/lexicalText'

const previewCache = new Map()

export class WikiLinkNode extends DecoratorNode {
  __id
  __title

  static getType() {
    return 'wiki-link'
  }

  static clone(node) {
    return new WikiLinkNode(node.__id, node.__title, node.__key)
  }

  static importJSON(serializedNode) {
    return new WikiLinkNode(serializedNode.id, serializedNode.title)
  }

  constructor(id, title, key) {
    super(key)
    this.__id = id
    this.__title = title
  }

  exportJSON() {
    return {
      type: 'wiki-link',
      version: 1,
      id: this.__id,
      title: this.__title,
    }
  }

  getId() {
    return this.__id
  }

  getTitle() {
    return this.__title
  }

  getTextContent() {
    return `[[${this.__title}]]`
  }

  isInline() {
    return true
  }

  createDOM() {
    return document.createElement('span')
  }

  updateDOM() {
    return false
  }

  decorate() {
    return <WikiLinkView id={this.__id} title={this.__title} />
  }
}

function WikiLinkView({ id, title }) {
  const cached = previewCache.get(id)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState(cached || null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  const loadPreview = async () => {
    if (!id || preview || loading) return

    setLoading(true)
    try {
      const file = await api(`/api/files/${id}`)
      const text = extractLexicalText(file?.content || '')
        .replace(/\s+/g, ' ')
        .trim()

      const next = {
        title: file?.title || title || '未命名',
        excerpt: text.slice(0, 180) || '这篇笔记还没有正文内容。',
        updatedAt: file?.updated_at || 0,
      }

      previewCache.set(id, next)
      setPreview(next)
    } catch (error) {
      console.error('加载 Wiki 链接预览失败', error)
      setPreview({
        title: title || '笔记',
        excerpt: '暂时无法读取这篇笔记的预览。',
        unavailable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const showPreview = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setPreviewOpen(true)
      void loadPreview()
    }, 220)
  }

  const hidePreview = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setPreviewOpen(false), 100)
  }

  const openTarget = event => {
    event.preventDefault()
    event.stopPropagation()
    setPreviewOpen(false)
    window.dispatchEvent(new CustomEvent('wikiLink:open', {
      detail: { id, title },
    }))
  }

  const updatedLabel = preview?.updatedAt
    ? new Date(preview.updatedAt * 1000).toLocaleDateString('zh-CN')
    : ''

  return (
    <span
      className="wiki-link"
      role="link"
      tabIndex={0}
      title={`打开笔记：${title}`}
      onMouseEnter={showPreview}
      onMouseLeave={hidePreview}
      onFocus={showPreview}
      onBlur={hidePreview}
      onMouseDown={event => event.preventDefault()}
      onClick={openTarget}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') openTarget(event)
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 4h10l2 2v14H6z" />
        <path d="M9 9h6M9 13h6M9 17h4" />
      </svg>
      <span>{title}</span>

      {previewOpen && (
        <span
          className="wiki-link-preview"
          role="tooltip"
          onMouseEnter={() => {
            if (timerRef.current) window.clearTimeout(timerRef.current)
          }}
          onMouseLeave={hidePreview}
        >
          <span className="wiki-link-preview-kicker">关联笔记</span>
          <strong>{preview?.title || title}</strong>
          <span className={`wiki-link-preview-excerpt${preview?.unavailable ? ' unavailable' : ''}`}>
            {loading && !preview ? '正在读取预览…' : (preview?.excerpt || '正在读取预览…')}
          </span>
          <span className="wiki-link-preview-footer">
            <span>{updatedLabel ? `更新于 ${updatedLabel}` : '点击打开完整笔记'}</span>
            <span aria-hidden="true">↗</span>
          </span>
        </span>
      )}
    </span>
  )
}

export function $createWikiLinkNode(id, title) {
  return new WikiLinkNode(id, title)
}

export function $isWikiLinkNode(node) {
  return node instanceof WikiLinkNode
}
