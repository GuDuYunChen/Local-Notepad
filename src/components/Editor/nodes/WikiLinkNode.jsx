import { DecoratorNode } from 'lexical'
import React, { useEffect, useRef, useState } from 'react'
import { api, getBacklinks } from '~/services/api'
import { extractLexicalText } from '~/utils/lexicalText'
import {
  formatSectionPath,
  formatWikiReferenceText,
  normalizeSectionPath,
  rememberReference,
  resolveSectionReference,
} from '../utils/referenceUtils'

const previewCache = new Map()

export class WikiLinkNode extends DecoratorNode {
  __id
  __title
  __sectionPath

  static getType() {
    return 'wiki-link'
  }

  static clone(node) {
    return new WikiLinkNode(node.__id, node.__title, node.__sectionPath, node.__key)
  }

  static importJSON(serializedNode) {
    return new WikiLinkNode(
      serializedNode.id,
      serializedNode.title,
      normalizeSectionPath(serializedNode.sectionPath)
    )
  }

  constructor(id, title, sectionPath = [], key) {
    super(key)
    this.__id = id
    this.__title = title
    this.__sectionPath = normalizeSectionPath(sectionPath)
  }

  exportJSON() {
    return {
      type: 'wiki-link',
      version: 1,
      id: this.__id,
      title: this.__title,
      sectionPath: this.__sectionPath,
    }
  }

  getId() {
    return this.__id
  }

  getTitle() {
    return this.__title
  }

  getSectionPath() {
    return [...this.__sectionPath]
  }

  getTextContent() {
    return formatWikiReferenceText(this.__title, this.__sectionPath)
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
    return (
      <WikiLinkView
        id={this.__id}
        title={this.__title}
        sectionPath={this.__sectionPath}
      />
    )
  }
}

function WikiLinkView({ id, title, sectionPath = [] }) {
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
      const [file, backlinks] = await Promise.all([
        api(`/api/files/${id}`),
        getBacklinks(id).catch(() => []),
      ])

      const text = extractLexicalText(file?.content || '')
        .replace(/\s+/g, ' ')
        .trim()

      const resolvedTitle = file?.title || title || '未命名'
      const sectionHealth = resolveSectionReference(
        file?.content || '',
        normalizedSectionPath,
      )

      const next = {
        title: resolvedTitle,
        excerpt: text.slice(0, 180) || '这篇笔记还没有正文内容。',
        updatedAt: file?.updated_at || 0,
        backlinkCount: Array.isArray(backlinks) ? backlinks.length : 0,
        titleChanged: Boolean(file?.title && file.title !== title),
        sectionMissing: normalizedSectionPath.length > 0 && !sectionHealth.valid,
        sectionRepairable: Boolean(sectionHealth.repairable),
        suggestedSectionPath: sectionHealth.nextPath || normalizedSectionPath,
      }

      previewCache.set(id, next)
      setPreview(next)
    } catch (error) {
      console.error('加载 Wiki 链接预览失败', error)
      setPreview({
        title: title || '笔记',
        excerpt: '目标笔记不存在、已删除或暂时无法读取。',
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
    rememberReference({ id, title, sectionPath: normalizedSectionPath })
    window.dispatchEvent(new CustomEvent('wikiLink:open', {
      detail: {
        id,
        title,
        headingPath: normalizedSectionPath,
      },
    }))
  }

  const normalizedSectionPath = normalizeSectionPath(sectionPath)
  const sectionLabel = formatSectionPath(normalizedSectionPath)
  const updatedLabel = preview?.updatedAt
    ? new Date(preview.updatedAt * 1000).toLocaleDateString('zh-CN')
    : ''

  return (
    <span
      className={
        'wiki-link' +
        (preview?.unavailable
          ? ' broken'
          : (preview?.titleChanged || preview?.sectionMissing)
            ? ' stale'
            : '')
      }
      role="link"
      tabIndex={0}
      title={sectionLabel ? ('打开：' + title + ' › ' + sectionLabel) : ('打开笔记：' + title)}
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
      {sectionLabel && (
        <small className="wiki-link-section">› {normalizedSectionPath[normalizedSectionPath.length - 1]}</small>
      )}

      {previewOpen && (
        <span
          className="wiki-link-preview"
          role="tooltip"
          onMouseEnter={() => {
            if (timerRef.current) window.clearTimeout(timerRef.current)
          }}
          onMouseLeave={hidePreview}
        >
          <span className="wiki-link-preview-kicker">
            {preview?.unavailable
              ? '失效引用'
              : preview?.titleChanged || preview?.sectionMissing
                ? '引用需要修复'
                : sectionLabel
                  ? '关联章节'
                  : '关联笔记'}
          </span>
          <strong>{preview?.title || title}</strong>
          {sectionLabel && (
            <span className="wiki-link-preview-section">{sectionLabel}</span>
          )}
          {preview?.titleChanged && (
            <span className="wiki-link-preview-health">
              当前标题：{preview.title}
            </span>
          )}
          {preview?.sectionMissing && (
            <span className="wiki-link-preview-health">
              {preview.sectionRepairable
                ? '章节已移动，可在“引用”面板安全修复'
                : '章节不存在或匹配不唯一'}
            </span>
          )}
          <span className={`wiki-link-preview-excerpt${preview?.unavailable ? ' unavailable' : ''}`}>
            {loading && !preview ? '正在读取预览…' : (preview?.excerpt || '正在读取预览…')}
          </span>
          <span className="wiki-link-preview-footer">
            <span>
              {preview?.backlinkCount
                ? `${preview.backlinkCount} 个反向链接`
                : updatedLabel
                  ? `更新于 ${updatedLabel}`
                  : '点击打开完整笔记'}
            </span>
            <span aria-hidden="true">↗</span>
          </span>
        </span>
      )}
    </span>
  )
}

export function $createWikiLinkNode(id, title, sectionPath = []) {
  return new WikiLinkNode(id, title, sectionPath)
}

export function $isWikiLinkNode(node) {
  return node instanceof WikiLinkNode
}
