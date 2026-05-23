import { TextNode } from 'lexical'

export class InlineCodeNode extends TextNode {
  static getType() {
    return 'inline-code'
  }

  static clone(node) {
    return new InlineCodeNode(node.__text, node.__key)
  }

  createDOM(config) {
    const dom = super.createDOM(config)
    dom.className = 'inline-code'
    return dom
  }

  updateDOM(prevNode, dom) {
    const updated = super.updateDOM(prevNode, dom)
    dom.className = 'inline-code'
    return updated
  }

  static importJSON(serializedNode) {
    const node = new InlineCodeNode(serializedNode.text)
    return node
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      type: 'inline-code',
      version: 1,
    }
  }

  isTextEntity() {
    return true
  }
}

export function $createInlineCodeNode(text) {
  return new InlineCodeNode(text)
}

export function $isInlineCodeNode(node) {
  return node instanceof InlineCodeNode
}
