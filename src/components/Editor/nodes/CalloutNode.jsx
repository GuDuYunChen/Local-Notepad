import { DecoratorNode } from 'lexical'
import React, { useState } from 'react'

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
    return new CalloutNode(icon, text)
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
  const [currentIcon, setCurrentIcon] = useState(icon)
  const [editText, setEditText] = useState(text || '提示内容')
  const [showIconPicker, setShowIconPicker] = useState(false)

  const handleIconSelect = (newIcon) => {
    setCurrentIcon(newIcon)
    setShowIconPicker(false)
  }

  return (
    <div className="callout-block">
      <div className="callout-header">
        <button
          className="callout-icon-btn"
          onClick={() => setShowIconPicker(!showIconPicker)}
          aria-label="选择图标"
        >
          {currentIcon}
        </button>
        {showIconPicker && (
          <div className="callout-icon-picker">
            {CALLOUT_ICONS.map((ic) => (
              <button
                key={ic}
                className="callout-icon-option"
                onClick={() => handleIconSelect(ic)}
                aria-label={`选择图标 ${ic}`}
              >
                {ic}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="callout-content">
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="callout-textarea"
          placeholder="输入提示内容..."
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
