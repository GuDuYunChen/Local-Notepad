import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import React, { useEffect, useState } from 'react'

const CALLOUT_ICONS = ['💡', '⚠️', 'ℹ️', '✅', '❌', '📌', '🔔', '💬']

export class CalloutNode extends DecoratorNode {
  __icon
  __text

  static getType() {
    return 'callout'
  }

  static clone(node) {
    return new CalloutNode(node.__icon, node.__text, node.__key)
  }

  static importJSON(serializedNode) {
    const { icon, text } = serializedNode
    return new CalloutNode(icon || '💡', text || '')
  }

  exportJSON() {
    return {
      icon: this.__icon,
      text: this.__text,
      type: 'callout',
      version: 1,
    }
  }

  constructor(icon = '💡', text = '', key) {
    super(key)
    this.__icon = icon
    this.__text = text
  }

  getIcon() {
    return this.__icon
  }

  getText() {
    return this.__text
  }

  setIcon(icon) {
    const writable = this.getWritable()
    writable.__icon = icon
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
    return <CalloutComponent nodeKey={this.__key} icon={this.__icon} text={this.__text} />
  }
}

function CalloutComponent({ nodeKey, icon, text }) {
  const [editor] = useLexicalComposerContext()
  const isEditable = useLexicalEditable()
  const [currentIcon, setCurrentIcon] = useState(icon || '💡')
  const [editText, setEditText] = useState(text || '')
  const [showIconPicker, setShowIconPicker] = useState(false)

  useEffect(() => setCurrentIcon(icon || '💡'), [icon])
  useEffect(() => setEditText(text || ''), [text])

  const persist = (patch) => {
    if (!editor.isEditable()) return
    editor.update(() => {
      if (!editor.isEditable()) return
      const node = $getNodeByKey(nodeKey)
      if (!$isCalloutNode(node)) return
      if (patch.icon !== undefined) node.setIcon(patch.icon)
      if (patch.text !== undefined) node.setText(patch.text)
    })
  }

  const handleIconSelect = (nextIcon) => {
    if (!editor.isEditable()) return
    setCurrentIcon(nextIcon)
    setShowIconPicker(false)
    persist({ icon: nextIcon })
  }

  const handleTextChange = (event) => {
    if (!editor.isEditable()) return
    const next = event.target.value
    setEditText(next)
    persist({ text: next })
  }

  return (
    <div className="callout-block">
      <div className="callout-header">
        <button
          type="button"
          className="callout-icon-btn"
          onClick={() => { if (editor.isEditable()) setShowIconPicker(prev => !prev) }}
          disabled={!isEditable}
          aria-label="选择提示图标"
          aria-expanded={showIconPicker && isEditable}
        >
          {currentIcon}
        </button>

        {showIconPicker && isEditable && (
          <div className="callout-icon-picker">
            {CALLOUT_ICONS.map(item => (
              <button
                type="button"
                key={item}
                className="callout-icon-option"
                onClick={() => handleIconSelect(item)}
                aria-label={`选择图标 ${item}`}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="callout-content">
        <textarea
          value={editText}
          readOnly={!isEditable}
          onChange={handleTextChange}
          className="callout-textarea"
          placeholder="输入提示、结论或注意事项…"
          rows={3}
        />
      </div>
    </div>
  )
}

export function $createCalloutNode({ icon = '💡', text = '' } = {}) {
  return new CalloutNode(icon, text)
}

export function $isCalloutNode(node) {
  return node instanceof CalloutNode
}
