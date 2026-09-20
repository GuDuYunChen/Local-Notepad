import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import React, { useEffect, useState } from 'react'

export class ToggleNode extends DecoratorNode {
  __title
  __content
  __collapsed

  static getType() {
    return 'toggle'
  }

  static clone(node) {
    return new ToggleNode(node.__title, node.__content, node.__collapsed, node.__key)
  }

  static importJSON(serializedNode) {
    const { title, content, collapsed } = serializedNode
    return new ToggleNode(title || '', content || '', Boolean(collapsed))
  }

  exportJSON() {
    return {
      title: this.__title,
      content: this.__content,
      collapsed: this.__collapsed,
      type: 'toggle',
      version: 2,
    }
  }

  constructor(title = '', content = '', collapsed = false, key) {
    super(key)
    this.__title = title
    this.__content = content
    this.__collapsed = collapsed
  }

  getTitle() {
    return this.__title
  }

  getContent() {
    return this.__content
  }

  isCollapsed() {
    return this.__collapsed
  }

  setTitle(title) {
    const writable = this.getWritable()
    writable.__title = title
  }

  setContent(content) {
    const writable = this.getWritable()
    writable.__content = content
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
    return (
      <ToggleComponent
        nodeKey={this.__key}
        title={this.__title}
        content={this.__content}
        collapsed={this.__collapsed}
      />
    )
  }
}

function ToggleComponent({ nodeKey, title, content, collapsed }) {
  const [editor] = useLexicalComposerContext()
  const [isCollapsed, setIsCollapsed] = useState(Boolean(collapsed))
  const [editTitle, setEditTitle] = useState(title || '')
  const [editContent, setEditContent] = useState(content || '')

  useEffect(() => setIsCollapsed(Boolean(collapsed)), [collapsed])
  useEffect(() => setEditTitle(title || ''), [title])
  useEffect(() => setEditContent(content || ''), [content])

  const persist = (patch) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isToggleNode(node)) return
      if (patch.title !== undefined) node.setTitle(patch.title)
      if (patch.content !== undefined) node.setContent(patch.content)
      if (patch.collapsed !== undefined) node.setCollapsed(patch.collapsed)
    })
  }

  const toggleCollapsed = () => {
    const next = !isCollapsed
    setIsCollapsed(next)
    persist({ collapsed: next })
  }

  return (
    <div className="toggle-block">
      <div className="toggle-header">
        <button
          type="button"
          className="toggle-arrow-button"
          onClick={toggleCollapsed}
          aria-label={isCollapsed ? '展开折叠块' : '收起折叠块'}
          aria-expanded={!isCollapsed}
        >
          <span className={`toggle-arrow${isCollapsed ? '' : ' open'}`}>▶</span>
        </button>

        <input
          className="toggle-title-input"
          value={editTitle}
          onChange={(event) => {
            const next = event.target.value
            setEditTitle(next)
            persist({ title: next })
          }}
          placeholder="折叠标题"
          aria-label="折叠块标题"
        />
      </div>

      {!isCollapsed && (
        <div className="toggle-content">
          <textarea
            value={editContent}
            onChange={(event) => {
              const next = event.target.value
              setEditContent(next)
              persist({ content: next })
            }}
            className="toggle-textarea"
            placeholder="输入折叠内容…"
            rows={4}
          />
        </div>
      )}
    </div>
  )
}

export function $createToggleNode({ title = '', content = '', collapsed = false } = {}) {
  return new ToggleNode(title, content, collapsed)
}

export function $isToggleNode(node) {
  return node instanceof ToggleNode
}
