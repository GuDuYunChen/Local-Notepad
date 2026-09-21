import { DecoratorNode } from 'lexical'
import React, { useEffect, useState } from 'react'

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

function fileExtension(name) {
  const raw = String(name || '')
  const index = raw.lastIndexOf('.')
  return index >= 0 ? raw.slice(index + 1).toLowerCase() : ''
}

function fileTypeLabel(name, mime) {
  const ext = fileExtension(name).toUpperCase()
  if (ext && ext.length <= 5) return ext
  if (mime?.includes('pdf')) return 'PDF'
  if (mime?.includes('zip')) return 'ZIP'
  return 'FILE'
}

export function getAttachmentPreviewType(name, mime) {
  const ext = fileExtension(name)
  const normalizedMime = String(mime || '').toLowerCase()

  if (normalizedMime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return 'image'
  }

  if (normalizedMime.includes('pdf') || ext === 'pdf') {
    return 'pdf'
  }

  if (
    normalizedMime.startsWith('text/') ||
    ['txt', 'md', 'markdown', 'json', 'csv', 'log', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'ini'].includes(ext)
  ) {
    return 'text'
  }

  return null
}

function AttachmentComponent({ src, name, size, mime }) {
  const [downloading, setDownloading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [textPreview, setTextPreview] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewType = getAttachmentPreviewType(name, mime)

  useEffect(() => {
    if (!previewOpen) return undefined

    const onKeyDown = event => {
      if (event.key === 'Escape') setPreviewOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [previewOpen])

  useEffect(() => {
    if (!previewOpen || previewType !== 'text' || !src || textPreview) return undefined

    let alive = true
    setPreviewLoading(true)

    fetch(src)
      .then(response => {
        if (!response.ok) throw new Error('读取附件失败')
        return response.text()
      })
      .then(text => {
        if (!alive) return
        const limit = 300000
        setTextPreview(text.length > limit ? `${text.slice(0, limit)}\n\n… 内容过长，预览已截断` : text)
      })
      .catch(error => {
        if (!alive) return
        console.error('读取文本附件预览失败', error)
        setTextPreview('暂时无法读取这个文本附件。')
      })
      .finally(() => {
        if (alive) setPreviewLoading(false)
      })

    return () => { alive = false }
  }, [previewOpen, previewType, src, textPreview])

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
    <>
      <div className="attachment-block">
        <div className="attachment-type" aria-hidden="true">{fileTypeLabel(name, mime)}</div>

        <div className="attachment-info">
          <strong title={name}>{name || '附件'}</strong>
          <span>{[formatSize(size), mime].filter(Boolean).join(' · ') || '本地附件'}</span>
        </div>

        <div className="attachment-actions">
          {previewType && (
            <button
              type="button"
              className="attachment-preview-button"
              onClick={() => setPreviewOpen(true)}
              disabled={!src}
            >
              预览
            </button>
          )}

          <button
            type="button"
            className="attachment-download"
            onClick={download}
            disabled={!src || downloading}
          >
            {downloading ? '下载中…' : '下载'}
          </button>
        </div>
      </div>

      {previewOpen && previewType && (
        <div
          className="attachment-preview-overlay"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setPreviewOpen(false)
          }}
        >
          <section
            className="attachment-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`预览 ${name || '附件'}`}
          >
            <header className="attachment-preview-header">
              <div>
                <strong>{name || '附件'}</strong>
                <span>{[formatSize(size), mime].filter(Boolean).join(' · ')}</span>
              </div>

              <div className="attachment-preview-header-actions">
                <button type="button" onClick={download} disabled={downloading}>
                  {downloading ? '下载中…' : '下载'}
                </button>
                <button
                  type="button"
                  className="attachment-preview-close"
                  onClick={() => setPreviewOpen(false)}
                  aria-label="关闭预览"
                  title="关闭"
                >
                  ×
                </button>
              </div>
            </header>

            <div className={`attachment-preview-body ${previewType}`}>
              {previewType === 'image' ? (
                <img src={src} alt={name || '附件预览'} />
              ) : previewType === 'pdf' ? (
                <iframe
                  src={src}
                  title={name || 'PDF 预览'}
                  className="attachment-pdf-preview"
                />
              ) : (
                <pre className="attachment-text-preview">
                  {previewLoading && !textPreview ? '正在读取预览…' : textPreview}
                </pre>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}

export function $createAttachmentNode({ src = '', name = '附件', size = 0, mime = '' } = {}) {
  return new AttachmentNode(src, name, size, mime)
}

export function $isAttachmentNode(node) {
  return node instanceof AttachmentNode
}
