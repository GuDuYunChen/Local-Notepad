import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import React, { useEffect, useRef, useState } from 'react'
import { UiButton, UiInput } from '~/components/ui/ControlKit'


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
  const isEditable = useLexicalEditable()
  const [isChecked, setIsChecked] = useState(Boolean(checked))
  const [editText, setEditText] = useState(text || '')
  const [isEditing, setIsEditing] = useState(!text)
  const todoElementRef = useRef(null)

  useEffect(() => {
    // Lexical uses Tab for indentation while its editable root owns focus.
    // F6 enters the first enabled Todo checkbox; native Tab then reaches the
    // adjacent text button without changing the saved Todo content.
    const block = todoElementRef.current
    const root = block?.closest('.editor-input[contenteditable="true"]')
    if (!root || !isEditable) return undefined
    const enter = event => {
      if (event.defaultPrevented || event.key !== 'F6' || event.altKey ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing ||
          event.target !== root || root.ownerDocument.activeElement !== root) return
      const first = block.querySelector('input.todo-checkbox[type="checkbox"]:not(:disabled)')
      if (!first || first !== root.querySelector('.todo-block input.todo-checkbox[type="checkbox"]:not(:disabled)') ||
          !first.isConnected) return
      first.focus()
      if (root.ownerDocument.activeElement !== first) return
      event.preventDefault()
      event.stopPropagation()
    }
    const preserveTodoTab = event => {
      if (event.key !== 'Tab' || event.defaultPrevented || event.isComposing) return
      if (event.target === block.querySelector('.todo-checkbox') ||
          event.target === block.querySelector('.todo-text-button')) event.stopPropagation()
    }
    root.addEventListener('keydown', enter, true)
    block.addEventListener('keydown', preserveTodoTab)
    return () => {
      root.removeEventListener('keydown', enter, true)
      block.removeEventListener('keydown', preserveTodoTab)
    }
  }, [isEditable])

  useEffect(() => {
    setIsChecked(Boolean(checked))
  }, [checked])

  useEffect(() => {
    setEditText(text || '')
  }, [text])

  const persist = (patch) => {
    if (!editor.isEditable()) return
    editor.update(() => {
      if (!editor.isEditable()) return
      const node = $getNodeByKey(nodeKey)
      if (!$isTodoNode(node)) return
      if (patch.checked !== undefined) node.setChecked(patch.checked)
      if (patch.text !== undefined) node.setText(patch.text)
    })
  }

  const handleToggle = () => {
    if (!editor.isEditable()) return
    const next = !isChecked
    setIsChecked(next)
    persist({ checked: next })
  }

  const handleTextChange = (event) => {
    if (!editor.isEditable()) return
    const next = event.target.value
    setEditText(next)
    persist({ text: next })
  }

  const finishEditing = () => {
    if (!editor.isEditable()) return
    setIsEditing(false)
    persist({ text: editText.trim() })
  }

  return (
    <div ref={todoElementRef} className={`todo-block${isChecked ? ' checked' : ''}`} title="按 F6 从编辑正文进入待办操作">
      <input data-ui-native="checkbox"
        type="checkbox"
        checked={isChecked}
        disabled={!isEditable}
        onChange={handleToggle}
        className="todo-checkbox"
        aria-label="切换待办状态"
      />

      {isEditing ? (
        <UiInput density="compact"
          type="text"
          value={editText}
          readOnly={!isEditable}
          onChange={handleTextChange}
          onBlur={finishEditing}
          onKeyDown={(event) => {
            if (!editor.isEditable()) return
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
          autoFocus={isEditable}
        />
      ) : (
        <UiButton density="compact"
          type="button"
          className="todo-text todo-text-button"
          onClick={() => { if (editor.isEditable()) setIsEditing(true) }}
          disabled={!isEditable}
          title={isEditable ? '点击编辑' : undefined}
        >
          {editText || '待办事项'}
        </UiButton>
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
