import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import React, { useEffect, useMemo, useRef, useState } from 'react'

export class ImageGridNode extends DecoratorNode {
  __items
  __columns
  __gap

  static getType() {
    return 'image-grid'
  }

  static clone(node) {
    return new ImageGridNode(node.__items, node.__columns, node.__gap, node.__key)
  }

  static importJSON(serialized) {
    const { items, columns, gap } = serialized
    return new ImageGridNode(
      Array.isArray(items) ? items : [],
      Number(columns) || 3,
      Number(gap) || 8,
    )
  }

  exportJSON() {
    return {
      type: 'image-grid',
      version: 2,
      items: this.__items,
      columns: this.__columns,
      gap: this.__gap,
    }
  }

  constructor(items, columns = 3, gap = 8, key) {
    super(key)
    this.__items = Array.isArray(items) ? items : []
    this.__columns = columns
    this.__gap = gap
  }

  setColumns(columns) {
    const writable = this.getWritable()
    writable.__columns = columns
  }

  setGap(gap) {
    const writable = this.getWritable()
    writable.__gap = gap
  }

  setItems(items) {
    const writable = this.getWritable()
    writable.__items = items
  }

  createDOM(config) {
    const div = document.createElement('div')
    const className = config.theme.imageGrid
    if (className !== undefined) div.className = className
    return div
  }

  updateDOM() {
    return false
  }

  isInline() {
    return false
  }

  decorate() {
    return (
      <ImageGridComponent
        nodeKey={this.__key}
        items={this.__items}
        columns={this.__columns}
        gap={this.__gap}
      />
    )
  }
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    ...item,
    caption: item.caption ?? item.alt ?? '',
  }))
}

function ImageGridComponent({ nodeKey, items, columns, gap }) {
  const [editor] = useLexicalComposerContext()
  const [selected, setSelected] = useState(false)
  const [currentColumns, setCurrentColumns] = useState(columns || 3)
  const [currentGap, setCurrentGap] = useState(gap || 8)
  const [currentItems, setCurrentItems] = useState(() => normalizeItems(items))
  const wrapperRef = useRef(null)

  useEffect(() => setCurrentColumns(columns || 3), [columns])
  useEffect(() => setCurrentGap(gap || 8), [gap])
  useEffect(() => setCurrentItems(normalizeItems(items)), [items])

  useEffect(() => {
    if (!selected) return undefined
    const onPointerDown = event => {
      if (!wrapperRef.current?.contains(event.target)) setSelected(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [selected])

  const templateColumns = useMemo(
    () => `repeat(${Math.max(1, Math.min(4, currentColumns))}, minmax(0, 1fr))`,
    [currentColumns]
  )

  const updateNode = patch => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isImageGridNode(node)) return
      if (patch.columns !== undefined) node.setColumns(patch.columns)
      if (patch.gap !== undefined) node.setGap(patch.gap)
      if (patch.items !== undefined) node.setItems(patch.items)
    })
  }

  const changeColumns = next => {
    setCurrentColumns(next)
    updateNode({ columns: next })
  }

  const changeGap = next => {
    setCurrentGap(next)
    updateNode({ gap: next })
  }

  const changeCaption = (index, caption) => {
    const nextItems = currentItems.map((item, itemIndex) => (
      itemIndex === index ? { ...item, caption } : item
    ))
    setCurrentItems(nextItems)
    updateNode({ items: nextItems })
  }

  const removeItem = index => {
    const nextItems = currentItems.filter((_, itemIndex) => itemIndex !== index)

    if (nextItems.length === 0) {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isImageGridNode(node)) node.remove()
      })
      return
    }

    setCurrentItems(nextItems)
    updateNode({ items: nextItems })
  }

  const deleteGrid = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isImageGridNode(node)) node.remove()
    })
  }

  return (
    <figure
      ref={wrapperRef}
      className={`editor-image-grid-block${selected ? ' selected' : ''}`}
      onClick={() => setSelected(true)}
    >
      {selected && (
        <div className="editor-image-grid-toolbar" role="toolbar" aria-label="图片组工具">
          <span>列数</span>
          {[2, 3, 4].map(value => (
            <button
              type="button"
              key={value}
              className={currentColumns === value ? 'active' : ''}
              onClick={event => {
                event.stopPropagation()
                changeColumns(value)
              }}
            >
              {value}
            </button>
          ))}

          <span className="editor-image-toolbar-divider" />

          <span>间距</span>
          {[
            [4, '紧'],
            [8, '中'],
            [16, '松'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={currentGap === value ? 'active' : ''}
              onClick={event => {
                event.stopPropagation()
                changeGap(value)
              }}
            >
              {label}
            </button>
          ))}

          <span className="editor-image-toolbar-divider" />

          <button
            type="button"
            className="danger"
            onClick={event => {
              event.stopPropagation()
              deleteGrid()
            }}
          >
            删除图片组
          </button>
        </div>
      )}

      <div
        className="editor-image-grid-layout"
        style={{
          gridTemplateColumns: templateColumns,
          gap: currentGap,
        }}
      >
        {currentItems.map((item, index) => (
          <div key={`${item.src || item.alt || 'image'}-${index}`} className="editor-image-grid-card">
            <div className="editor-image-grid-media">
              <img
                src={item.src}
                alt={item.alt || item.caption || ''}
                loading="lazy"
                title={item.alt || item.caption || ''}
              />

              {selected && (
                <button
                  type="button"
                  className="editor-image-grid-remove"
                  onClick={event => {
                    event.stopPropagation()
                    removeItem(index)
                  }}
                  aria-label={`移除图片 ${index + 1}`}
                  title="从图片组移除"
                >
                  ×
                </button>
              )}
            </div>

            {(selected || item.caption) && (
              <input
                className="editor-image-grid-caption"
                value={item.caption || ''}
                onChange={event => changeCaption(index, event.target.value)}
                onClick={event => event.stopPropagation()}
                placeholder="图片说明…"
                aria-label={`图片 ${index + 1} 说明`}
              />
            )}
          </div>
        ))}
      </div>
    </figure>
  )
}

export function $createImageGridNode({ items, columns, gap }) {
  return new ImageGridNode(items, columns, gap)
}

export function $isImageGridNode(node) {
  return node instanceof ImageGridNode
}
