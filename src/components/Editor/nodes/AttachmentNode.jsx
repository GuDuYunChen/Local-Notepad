import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import React, { useEffect, useRef, useState } from 'react'
import { uploadFile } from '../utils/fileUpload'

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

  setFile({ src, name, size, mime }) {
    const writable = this.getWritable()
    if (src !== undefined) writable.__src = src
    if (name !== undefined) writable.__name = name
    if (size !== undefined) writable.__size = size
    if (mime !== undefined) writable.__mime = mime
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
        nodeKey={this.__key}
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

  if (
    ext === 'docx' ||
    normalizedMime.includes('wordprocessingml.document')
  ) {
    return 'word'
  }

  if (
    ['xlsx', 'xls'].includes(ext) ||
    normalizedMime.includes('spreadsheetml.sheet') ||
    normalizedMime.includes('ms-excel')
  ) {
    return 'sheet'
  }

  return null
}

function AttachmentComponent({ nodeKey, src, name, size, mime }) {
  const [editor] = useLexicalComposerContext()
  const [downloading, setDownloading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [textPreview, setTextPreview] = useState('')
  const [sheetPreview, setSheetPreview] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const replaceInputRef = useRef(null)
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

  useEffect(() => {
    if (!previewOpen || !src) return undefined
    if (!['word', 'sheet'].includes(previewType)) return undefined
    if (previewType === 'word' && textPreview) return undefined
    if (previewType === 'sheet' && sheetPreview.length) return undefined

    let alive = true
    setPreviewLoading(true)

    const load = async () => {
      const response = await fetch(src)
      if (!response.ok) throw new Error('读取附件失败')
      const arrayBuffer = await response.arrayBuffer()

      if (previewType === 'word') {
        const mammothModule = await import('mammoth')
        const mammoth = mammothModule.default || mammothModule
        const result = await mammoth.extractRawText({ arrayBuffer })
        const text = String(result?.value || '').trim()
        const limit = 300000
        if (alive) {
          setTextPreview(text.length > limit ? `${text.slice(0, limit)}\n\n… 内容过长，预览已截断` : (text || '文档没有可预览的正文内容。'))
        }
        return
      }

      const xlsxModule = await import('xlsx')
      const XLSX = xlsxModule.default || xlsxModule
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' })
      const firstSheetName = workbook.SheetNames?.[0]
      const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null
      const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) : []
      const limitedRows = rows.slice(0, 200).map(row => row.slice(0, 40).map(cell => String(cell ?? '')))
      if (alive) setSheetPreview(limitedRows)
    }

    load()
      .catch(error => {
        if (!alive) return
        console.error('读取 Office 附件预览失败', error)
        if (previewType === 'word') setTextPreview('暂时无法读取这个 Word 附件。')
        else setSheetPreview([['暂时无法读取这个表格附件。']])
      })
      .finally(() => {
        if (alive) setPreviewLoading(false)
      })

    return () => { alive = false }
  }, [previewOpen, previewType, src, textPreview, sheetPreview.length])


  const replaceAttachment = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 100 * 1024 * 1024) {
      console.warn('替换附件超过 100 MB，已取消')
      event.target.value = ''
      return
    }

    setReplacing(true)
    try {
      const result = await uploadFile(file)
      if (!result?.url) return

      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if (!$isAttachmentNode(node)) return
        node.setFile({
          src: result.url,
          name: file.name,
          size: file.size,
          mime: file.type || '',
        })
      })

      setTextPreview('')
      setSheetPreview([])
      setPreviewOpen(false)
    } catch (error) {
      console.error('替换附件失败', error)
    } finally {
      setReplacing(false)
      event.target.value = ''
    }
  }

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
          <button
            type="button"
            className="attachment-replace-button"
            onClick={() => replaceInputRef.current?.click()}
            disabled={replacing}
          >
            {replacing ? '替换中…' : '替换'}
          </button>
          <input ref={replaceInputRef} type="file" hidden onChange={replaceAttachment} />
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
              ) : previewType === 'sheet' ? (
                <div className="attachment-sheet-preview">
                  {previewLoading && !sheetPreview.length ? (
                    <div className="attachment-preview-loading">正在读取表格…</div>
                  ) : (
                    <table>
                      <tbody>
                        {sheetPreview.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} title={cell}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
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
