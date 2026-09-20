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

  static importJSON(serializedNode) {
    return new WikiLinkNode(serializedNode.id, serializedNode.title)
  }

  constructor(id, title, key) {
    super(key)
    this.__id = id
    this.__title = title
  }

  exportJSON() {
    return {
      type: 'wiki-link',
      version: 1,
      id: this.__id,
      title: this.__title,
    }
  }

  getId() {
    return this.__id
  }

  getTitle() {
    return this.__title
  }

  getTextContent() {
    return `[[${this.__title}]]`
  }

  isInline() {
    return true
  }

  createDOM() {
    return document.createElement('span')
  }

  updateDOM() {
    return false
  }

  decorate() {
    return <WikiLinkView id={this.__id} title={this.__title} />
  }
}

function WikiLinkView({ id, title }) {
  const openTarget = (event) => {
    event.preventDefault()
    event.stopPropagation()
    window.dispatchEvent(new CustomEvent('wikiLink:open', {
      detail: { id, title },
    }))
  }

  return (
    <span
      className="wiki-link"
      role="link"
      tabIndex={0}
      title={`打开笔记：${title}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={openTarget}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') openTarget(event)
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 4h10l2 2v14H6z" />
        <path d="M9 9h6M9 13h6M9 17h4" />
      </svg>
      <span>{title}</span>
    </span>
  )
}

export function $createWikiLinkNode(id, title) {
  return new WikiLinkNode(id, title)
}

export function $isWikiLinkNode(node) {
  return node instanceof WikiLinkNode
}
