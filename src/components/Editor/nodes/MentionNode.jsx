import { DecoratorNode } from 'lexical'
import React from 'react'

export class MentionNode extends DecoratorNode {
  __mention
  __id

  static getType() {
    return 'mention'
  }

  static clone(node) {
    return new MentionNode(node.__mention, node.__id, node.__key)
  }

  static importJSON(serializedNode) {
    const { mention, id } = serializedNode
    return new MentionNode(mention, id)
  }

  exportJSON() {
    return {
      mention: this.__mention,
      id: this.__id,
      type: 'mention',
      version: 1,
    }
  }

  constructor(mention, id, key) {
    super(key)
    this.__mention = mention
    this.__id = id
  }

  getMention() {
    return this.__mention
  }

  getId() {
    return this.__id
  }

  createDOM() {
    return document.createElement('span')
  }

  updateDOM() {
    return false
  }

  isInline() {
    return true
  }

  decorate() {
    return <MentionComponent mention={this.__mention} />
  }
}

function MentionComponent({ mention }) {
  return <span className="mention-node">@{mention}</span>
}

export function $createMentionNode(mention, id) {
  return new MentionNode(mention, id)
}

export function $isMentionNode(node) {
  return node instanceof MentionNode
}
