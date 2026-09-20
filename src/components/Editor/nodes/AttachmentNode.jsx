import { DecoratorNode } from 'lexical'
import React, { useState } from 'react'

export class AttachmentNode extends DecoratorNode {
  __src
  __name
  __size
  __mime

  static getType() {
    return 'attachment'
  }

  static clone(node) {
    return new AttachmentNode(node.__src, node.__name, node.__size, node.__mime, node.__key)
  }

  static importJSON(serializedNode) {
    return new AttachmentNode(
      serializedNode.src || '',
      serializedNode.name || '附件',
      Number(serializedNode.size) || 0,
      serializedNode.mime || ''
    )
  }

  exportJSON() {
    return {
      type: 'attachment',
      version: 1,
      src: this.__src,
      name: this.__name,
      size: this.__size,
      mime: this.__mime,
    }
  }

  constructor(src = '', name = '附件', size = 0, mime = '', key) {
    super(key)
    this.__src = src
    this.__name = name
    this.__size = size
    this.__mime = mime
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
    return (
      <AttachmentComponent
        src={this.__src}
        name={this.__name}
        size={this.__size}
        mime={this.__mime}
      />
    )
  }
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileTypeLabel(name, mime) {
  const ext = String(name || '').split('.').pop()?.toUpperCase()
  if (ext && ext.length <= 5) return ext
  if (mime?.includes('pdf')) return 'PDF'
  if (mime?.includes('zip')) return 'ZIP'
  return 'FILE'
}

function AttachmentComponent({ src, name, size, mime }) {
  const [downloading, setDownloading] = useState(false)

  const download = async () => {
    if (!src || downloading) return

    setDownloading(true)
    try {
      const response = await fetch(src)
      if (!response.ok) throw new Error('下载失败')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = name || 'attachment'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (error) {
      console.error('附件下载失败', error)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="attachment-block">
      <div className="attachment-type" aria-hidden="true">{fileTypeLabel(name, mime)}</div>
      <div className="attachment-info">
        <strong title={name}>{name || '附件'}</strong>
        <span>{[formatSize(size), mime].filter(Boolean).join(' · ') || '本地附件'}</span>
      </div>
      <button
        type="button"
        className="attachment-download"
        onClick={download}
        disabled={!src || downloading}
      >
        {downloading ? '下载中…' : '下载'}
      </button>
    </div>
  )
}

export function $createAttachmentNode({ src = '', name = '附件', size = 0, mime = '' } = {}) {
  return new AttachmentNode(src, name, size, mime)
}

export function $isAttachmentNode(node) {
  return node instanceof AttachmentNode
}
