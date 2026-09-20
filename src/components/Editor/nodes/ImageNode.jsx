import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import React, { useEffect, useRef, useState } from 'react'

export class ImageNode extends DecoratorNode {
  __src
  __alt
  __width
  __height
  __caption
  __originalSrc
  __align

  static getType() {
    return 'image'
  }

  static clone(node) {
    return new ImageNode(
      node.__src,
      node.__alt,
      node.__width,
      node.__height,
      node.__originalSrc,
      node.__caption,
      node.__align,
      node.__key,
    )
  }

  static importJSON(serializedNode) {
    const { src, alt, width, height, originalSrc, caption, align } = serializedNode
    return new ImageNode(
      src,
      alt,
      width,
      height,
      originalSrc,
      caption,
      align || 'center',
    )
  }

  exportJSON() {
    return {
      alt: this.__alt,
      height: this.__height,
      src: this.__src,
      originalSrc: this.__originalSrc,
      type: 'image',
      version: 2,
      width: this.__width,
      caption: this.__caption,
      align: this.__align,
    }
  }

  constructor(src, alt, width, height, originalSrc, caption, align = 'center', key) {
    super(key)
    this.__src = src
    this.__alt = alt
    this.__width = width || 640
    this.__height = height
    this.__originalSrc = originalSrc
    this.__caption = caption || alt || ''
    this.__align = align || 'center'
  }

  setWidth(width) {
    const writable = this.getWritable()
    writable.__width = width
  }

  setCaption(caption) {
    const writable = this.getWritable()
    writable.__caption = caption
  }

  setAlign(align) {
    const writable = this.getWritable()
    writable.__align = align
  }

  createDOM(config) {
    const span = document.createElement('span')
    const className = config.theme.image
    if (className !== undefined) span.className = className
    return span
  }

  updateDOM() {
    return false
  }

  isInline() {
    return false
  }

  decorate() {
    return (
      <ImageComponent
        nodeKey={this.__key}
        src={this.__src}
        alt={this.__alt}
        width={this.__width}
        height={this.__height}
        originalSrc={this.__originalSrc}
        caption={this.__caption}
        align={this.__align}
      />
    )
  }
}

function isValidImageUrl(url) {
  if (!url) return false
  if (url.startsWith('data:') || url.startsWith('blob:')) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function normalizeWidth(width) {
  if (width === '100%') return '100%'
  const numeric = Number(width)
  return Number.isFinite(numeric) && numeric > 0 ? `${numeric}px` : '640px'
}

function ImageComponent({ nodeKey, src, alt, width, height, originalSrc, caption, align }) {
  const [editor] = useLexicalComposerContext()
  const [selected, setSelected] = useState(false)
  const [currentWidth, setCurrentWidth] = useState(width || 640)
  const [currentAlign, setCurrentAlign] = useState(align || 'center')
  const [captionText, setCaptionText] = useState(caption || '')
  const wrapperRef = useRef(null)

  const safeSrc = isValidImageUrl(src) ? src : ''
  const safeOriginalSrc = isValidImageUrl(originalSrc) ? originalSrc : ''

  useEffect(() => setCurrentWidth(width || 640), [width])
  useEffect(() => setCurrentAlign(align || 'center'), [align])
  useEffect(() => setCaptionText(caption || ''), [caption])

  useEffect(() => {
    if (!selected) return undefined
    const onPointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setSelected(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [selected])

  const updateNode = (patch) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isImageNode(node)) return
      if (patch.width !== undefined) node.setWidth(patch.width)
      if (patch.caption !== undefined) node.setCaption(patch.caption)
      if (patch.align !== undefined) node.setAlign(patch.align)
    })
  }

  const changeWidth = (nextWidth) => {
    setCurrentWidth(nextWidth)
    updateNode({ width: nextWidth })
  }

  const changeAlign = (nextAlign) => {
    setCurrentAlign(nextAlign)
    updateNode({ align: nextAlign })
  }

  const changeCaption = (event) => {
    const next = event.target.value
    setCaptionText(next)
    updateNode({ caption: next })
  }

  const handleDownload = (event) => {
    event.preventDefault()
    event.stopPropagation()

    const downloadSrc = safeOriginalSrc || safeSrc
    if (!downloadSrc) return

    const anchor = document.createElement('a')
    anchor.href = downloadSrc
    anchor.download = alt || 'image'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  const handleDelete = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isImageNode(node)) node.remove()
    })
  }

  return (
    <figure
      ref={wrapperRef}
      className={`editor-image-block align-${currentAlign}${selected ? ' selected' : ''}`}
      onClick={() => setSelected(true)}
    >
      <div
        className="editor-image-stage"
        style={{ width: normalizeWidth(currentWidth), maxWidth: '100%' }}
      >
        {safeSrc ? (
          <img
            src={safeSrc}
            alt={alt}
            loading="lazy"
            title={alt || captionText}
            style={{
              width: '100%',
              height: height ? normalizeWidth(height) : 'auto',
            }}
          />
        ) : (
          <div className="image-placeholder">无效的图片链接</div>
        )}

        {selected && (
          <div className="editor-image-toolbar" role="toolbar" aria-label="图片工具">
            <div className="editor-image-toolbar-group" aria-label="图片尺寸">
              {[
                ['320', '小'],
                ['520', '中'],
                ['720', '大'],
                ['100%', '全宽'],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={String(currentWidth) === value ? 'active' : ''}
                  onClick={(event) => {
                    event.stopPropagation()
                    changeWidth(value)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <span className="editor-image-toolbar-divider" />

            <div className="editor-image-toolbar-group" aria-label="图片对齐">
              {[
                ['left', '左'],
                ['center', '中'],
                ['right', '右'],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={currentAlign === value ? 'active' : ''}
                  onClick={(event) => {
                    event.stopPropagation()
                    changeAlign(value)
                  }}
                  aria-label={`${label}对齐`}
                >
                  {label}
                </button>
              ))}
            </div>

            <span className="editor-image-toolbar-divider" />

            <button type="button" onClick={handleDownload}>下载</button>
            <button
              type="button"
              className="danger"
              onClick={(event) => {
                event.stopPropagation()
                handleDelete()
              }}
            >
              删除
            </button>
          </div>
        )}
      </div>

      {(selected || captionText) && (
        <input
          className="editor-image-caption-input"
          value={captionText}
          onChange={changeCaption}
          onClick={(event) => event.stopPropagation()}
          placeholder="添加图片说明…"
          aria-label="图片说明"
        />
      )}
    </figure>
  )
}

export function $createImageNode({ src, alt, width, height, originalSrc, caption, align = 'center' }) {
  return new ImageNode(src, alt, width, height, originalSrc, caption, align)
}

export function $isImageNode(node) {
  return node instanceof ImageNode
}
