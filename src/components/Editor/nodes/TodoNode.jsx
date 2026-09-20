import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import React, { useEffect, useState } from 'react'

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
    return new TodoNode(Boolean(checked), text || '')
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
  const [editor] = useLexicalComposerContext()
  const [isChecked, setIsChecked] = useState(Boolean(checked))
  const [editText, setEditText] = useState(text || '')
  const [isEditing, setIsEditing] = useState(!text)

  useEffect(() => {
    setIsChecked(Boolean(checked))
  }, [checked])

  useEffect(() => {
    setEditText(text || '')
  }, [text])

  const persist = (patch) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isTodoNode(node)) return
      if (patch.checked !== undefined) node.setChecked(patch.checked)
      if (patch.text !== undefined) node.setText(patch.text)
    })
  }

  const handleToggle = () => {
    const next = !isChecked
    setIsChecked(next)
    persist({ checked: next })
  }

  const handleTextChange = (event) => {
    const next = event.target.value
    setEditText(next)
    persist({ text: next })
  }

  const finishEditing = () => {
    setIsEditing(false)
    persist({ text: editText.trim() })
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
          onChange={handleTextChange}
          onBlur={finishEditing}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setEditText(text || '')
              event.currentTarget.blur()
            }
          }}
          className="todo-input"
          placeholder="待办事项"
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="todo-text todo-text-button"
          onClick={() => setIsEditing(true)}
          title="点击编辑"
        >
          {editText || '待办事项'}
        </button>
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
