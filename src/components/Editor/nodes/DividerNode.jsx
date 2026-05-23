import { DecoratorNode } from 'lexical'
import React from 'react'

export class DividerNode extends DecoratorNode {
  static getType() {
    return 'divider'
  }

  static clone(node) {
    return new DividerNode(node.__key)
  }

  static importJSON() {
    return new DividerNode()
  }

  exportJSON() {
    return {
      type: 'divider',
      version: 1,
    }
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
    return <DividerComponent />
  }
}

function DividerComponent() {
  return <hr className="divider-block" />
}

export function $createDividerNode() {
  return new DividerNode()
}

export function $isDividerNode(node) {
  return node instanceof DividerNode
}
