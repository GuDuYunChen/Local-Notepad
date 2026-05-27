import { DecoratorNode } from 'lexical'
import React from 'react'

export class WikiLinkNode extends DecoratorNode {
  __id
  __title

  static getType() {
    return 'wiki-link'
  }

  static clone(node) {
    return new WikiLinkNode(node.__id, node.__title, node.__key)
  }

  constructor(id, title, key) {
    super(key)
    this.__id = id
    this.__title = title
  }

  getId() {
    return this.__id
  }

  getTitle() {
    return this.__title
  }

  createDOM() {
    return document.createElement('span')
  }

  updateDOM() {
    return false
  }

  decorate() {
    return (
      <span
        className="wiki-link"
        data-id={this.__id}
        contentEditable={false}
      >
        [[{this.__title}]]
      </span>
    )
  }
}

export function $createWikiLinkNode(id, title) {
  return new WikiLinkNode(id, title)
}

export function $isWikiLinkNode(node) {
  return node instanceof WikiLinkNode
}
