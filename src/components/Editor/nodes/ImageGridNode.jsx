import { DecoratorNode } from 'lexical'
import React from 'react'

export class ImageGridNode extends DecoratorNode {
  __items
  __columns
  __gap

  static getType() { return 'image-grid' }

  static clone(node) {
    return new ImageGridNode(node.__items, node.__columns, node.__gap, node.__key)
  }

  static importJSON(serialized) {
    const { items, columns, gap } = serialized
    return new ImageGridNode(items || [], columns || 3, gap || 8)
  }

  exportJSON() {
    return { type: 'image-grid', version: 1, items: this.__items, columns: this.__columns, gap: this.__gap }
  }

  constructor(items, columns = 3, gap = 8, key) {
    super(key)
    this.__items = items || []
    this.__columns = columns
    this.__gap = gap
  }

  createDOM(config) {
    const span = document.createElement('span')
    const theme = config.theme
    const className = theme.imageGrid
    if (className !== undefined) span.className = className
    return span
  }

  updateDOM() { return false }

  decorate() {
    return <ImageGridComponent items={this.__items} columns={this.__columns} gap={this.__gap} />
  }
}

function ImageGridComponent({ items, columns, gap }) {
  return (
    <div className="editor-image-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap }}>
      {items.map((i, idx) => (
        <div key={idx} className="editor-image-grid-item" style={{ width: '100%', aspectRatio: '4 / 3', overflow: 'hidden' }}>
          <img src={i.src} alt={i.alt} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} title={i.alt} />
          <div className="editor-image-caption" style={{ fontSize: 12, color: '#666', marginTop: 4, textAlign: 'center' }}>{i.alt}</div>
        </div>
      ))}
    </div>
  )
}

export function $createImageGridNode({ items, columns, gap }) {
  return new ImageGridNode(items, columns, gap)
}

export function $isImageGridNode(node) { return node instanceof ImageGridNode }

