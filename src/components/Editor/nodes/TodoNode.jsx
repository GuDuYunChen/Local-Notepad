import { DecoratorNode } from 'lexical'
import React, { useState } from 'react'

export class TodoNode extends DecoratorNode {
  __checked
  __text

  static getType() {
    return 'todo'
  }

  static clone(node) {
    return new TodoNode(node.__checked, node.__text, node.__key)
  }

  static importJSON(serializedNode) {
    const { checked, text } = serializedNode
    return new TodoNode(checked, text)
  }

  exportJSON() {
    return {
      checked: this.__checked,
      text: this.__text,
      type: 'todo',
      version: 1,
    }
  }

  constructor(checked = false, text = '', key) {
    super(key)
    this.__checked = checked
    this.__text = text
  }

  getText() {
    return this.__text
  }

  getChecked() {
    return this.__checked
  }

  setChecked(checked) {
    const writable = this.getWritable()
    writable.__checked = checked
  }

  setText(text) {
    const writable = this.getWritable()
    writable.__text = text
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
    return <TodoComponent nodeKey={this.__key} checked={this.__checked} text={this.__text} />
  }
}

function TodoComponent({ nodeKey, checked, text }) {
  const [isChecked, setIsChecked] = useState(checked)
  const [editText, setEditText] = useState(text || '待办事项')
  const [isEditing, setIsEditing] = useState(false)

  const handleToggle = () => {
    setIsChecked(!isChecked)
  }

  const handleDoubleClick = () => {
    setIsEditing(true)
  }

  const handleBlur = () => {
    setIsEditing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      setIsEditing(false)
    }
    if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  return (
    <div className={`todo-block${isChecked ? ' checked' : ''}`}>
      <input
        type="checkbox"
        checked={isChecked}
        onChange={handleToggle}
        className="todo-checkbox"
        aria-label="切换待办状态"
      />
      {isEditing ? (
        <input
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="todo-input"
          autoFocus
        />
      ) : (
        <span className="todo-text" onDoubleClick={handleDoubleClick}>
          {editText || '待办事项'}
        </span>
      )}
    </div>
  )
}

export function $createTodoNode({ checked = false, text = '' } = {}) {
  return new TodoNode(checked, text)
}

export function $isTodoNode(node) {
  return node instanceof TodoNode
}
