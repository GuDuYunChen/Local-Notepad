import { DecoratorNode } from 'lexical'
import React, { useState } from 'react'

export class ToggleNode extends DecoratorNode {
  __title
  __collapsed

  static getType() {
    return 'toggle'
  }

  static clone(node) {
    return new ToggleNode(node.__title, node.__collapsed, node.__key)
  }

  static importJSON(serializedNode) {
    const { title, collapsed } = serializedNode
    return new ToggleNode(title, collapsed)
  }

  exportJSON() {
    return {
      title: this.__title,
      collapsed: this.__collapsed,
      type: 'toggle',
      version: 1,
    }
  }

  constructor(title = '', collapsed = false, key) {
    super(key)
    this.__title = title
    this.__collapsed = collapsed
  }

  getTitle() {
    return this.__title
  }

  isCollapsed() {
    return this.__collapsed
  }

  setTitle(title) {
    const writable = this.getWritable()
    writable.__title = title
  }

  setCollapsed(collapsed) {
    const writable = this.getWritable()
    writable.__collapsed = collapsed
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
    return <ToggleComponent nodeKey={this.__key} title={this.__title} collapsed={this.__collapsed} />
  }
}

function ToggleComponent({ nodeKey, title, collapsed }) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed)
  const [editTitle, setEditTitle] = useState(title || '点击展开/折叠')

  return (
    <div className="toggle-block">
      <div className="toggle-header" onClick={() => setIsCollapsed(!isCollapsed)}>
        <span className={`toggle-arrow${isCollapsed ? '' : ' open'}`}>▶</span>
        <span className="toggle-title">{editTitle}</span>
      </div>
      {!isCollapsed && (
        <div className="toggle-content">
          <textarea
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="toggle-textarea"
            placeholder="输入折叠内容..."
            rows={4}
          />
        </div>
      )}
    </div>
  )
}

export function $createToggleNode({ title = '', collapsed = false } = {}) {
  return new ToggleNode(title, collapsed)
}

export function $isToggleNode(node) {
  return node instanceof ToggleNode
}
