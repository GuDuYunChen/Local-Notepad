import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import React, { useEffect, useState } from 'react'

export class EmbedNode extends DecoratorNode {
  __url
  __title

  static getType() {
    return 'embed'
  }

  static clone(node) {
    return new EmbedNode(node.__url, node.__title, node.__key)
  }

  static importJSON(serializedNode) {
    const { url, title } = serializedNode
    return new EmbedNode(url || '', title || '')
  }

  exportJSON() {
    return {
      url: this.__url,
      title: this.__title,
      type: 'embed',
      version: 1,
    }
  }

  constructor(url = '', title = '', key) {
    super(key)
    this.__url = url
    this.__title = title
  }

  getUrl() {
    return this.__url
  }

  getTitle() {
    return this.__title
  }

  setUrl(url) {
    const writable = this.getWritable()
    writable.__url = url
  }

  setTitle(title) {
    const writable = this.getWritable()
    writable.__title = title
  }

  createDOM() {
    return document.createElement('div')
  }

  updateDOM() {
    return false
  }

  isInline() {
    return false
  }

  decorate() {
    return <EmbedComponent nodeKey={this.__key} url={this.__url} title={this.__title} />
  }
}

function EmbedComponent({ nodeKey, url, title }) {
  const [editor] = useLexicalComposerContext()
  const [editUrl, setEditUrl] = useState(url || '')
  const [editTitle, setEditTitle] = useState(title || '')
  const [isEditing, setIsEditing] = useState(!url)

  useEffect(() => setEditUrl(url || ''), [url])
  useEffect(() => setEditTitle(title || ''), [title])

  const persist = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isEmbedNode(node)) return
      node.setUrl(editUrl.trim())
      node.setTitle(editTitle.trim())
    })
  }

  const handleSave = () => {
    if (!editUrl.trim()) return
    persist()
    setIsEditing(false)
  }

  const ALLOWED_EMBED_DOMAINS = [
    'www.youtube.com',
    'youtube.com',
    'youtu.be',
    'player.bilibili.com',
    'www.bilibili.com',
    'bilibili.com',
    'player.vimeo.com',
    'open.spotify.com',
    'www.slideshare.net',
    'docs.google.com',
    'drive.google.com',
  ]

  const getEmbedUrl = (inputUrl) => {
    if (!inputUrl) return ''
    try {
      const normalized = inputUrl.startsWith('//') ? 'https:' + inputUrl : inputUrl
      const parsed = new URL(normalized)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''

      const youtubeMatch = normalized.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)
      if (youtubeMatch) return `https://www.youtube.com/embed/${youtubeMatch[1]}`

      const bilibiliMatch = normalized.match(/bilibili\.com\/video\/([a-zA-Z0-9]+)/)
      if (bilibiliMatch) {
        return `https://player.bilibili.com/player.html?bvid=${bilibiliMatch[1]}`
      }

      if (ALLOWED_EMBED_DOMAINS.includes(parsed.hostname)) return normalized
      return ''
    } catch {
      return ''
    }
  }

  const embedUrl = getEmbedUrl(editUrl)

  if (isEditing) {
    return (
      <div className="embed-block embed-editing">
        <input
          type="url"
          value={editUrl}
          onChange={(event) => setEditUrl(event.target.value)}
          placeholder="粘贴 YouTube、Bilibili 或其他支持的链接"
          className="embed-input"
        />
        <input
          type="text"
          value={editTitle}
          onChange={(event) => setEditTitle(event.target.value)}
          placeholder="标题（可选）"
          className="embed-input"
        />
        <div className="embed-edit-actions">
          {url && (
            <button type="button" className="btn" onClick={() => {
              setEditUrl(url || '')
              setEditTitle(title || '')
              setIsEditing(false)
            }}>
              取消
            </button>
          )}
          <button type="button" onClick={handleSave} className="embed-save-btn" disabled={!editUrl.trim()}>
            保存
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="embed-block">
      {editTitle && <div className="embed-title">{editTitle}</div>}
      {embedUrl ? (
        <iframe
          src={embedUrl}
          className="embed-iframe"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title={editTitle || '嵌入内容'}
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        />
      ) : (
        <div className="embed-placeholder">这个链接暂不支持嵌入显示</div>
      )}
      <button type="button" onClick={() => setIsEditing(true)} className="embed-edit-btn" aria-label="编辑嵌入内容">
        编辑嵌入
      </button>
    </div>
  )
}

export function $createEmbedNode({ url = '', title = '' } = {}) {
  return new EmbedNode(url, title)
}

export function $isEmbedNode(node) {
  return node instanceof EmbedNode
}
