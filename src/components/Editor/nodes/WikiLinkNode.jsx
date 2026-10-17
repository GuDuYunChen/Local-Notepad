import { DecoratorNode } from 'lexical'
import React from 'react'
import WikiLinkView from './WikiLinkView'
import {
  formatWikiReferenceText,
  normalizeSectionPath,
} from '../utils/referenceUtils'

export class WikiLinkNode extends DecoratorNode {
  __id
  __title
  __sectionPath

  static getType() {
    return 'wiki-link'
  }

  static clone(node) {
    return new WikiLinkNode(node.__id, node.__title, node.__sectionPath, node.__key)
  }

  static importJSON(serializedNode) {
    return new WikiLinkNode(
      serializedNode.id,
      serializedNode.title,
      normalizeSectionPath(serializedNode.sectionPath)
    )
  }

  constructor(id, title, sectionPath = [], key) {
    super(key)
    this.__id = id
    this.__title = title
    this.__sectionPath = normalizeSectionPath(sectionPath)
  }

  exportJSON() {
    return {
      type: 'wiki-link',
      version: 1,
      id: this.__id,
      title: this.__title,
      sectionPath: this.__sectionPath,
    }
  }

  getId() {
    return this.__id
  }

  getTitle() {
    return this.__title
  }

  getSectionPath() {
    return [...this.__sectionPath]
  }

  getTextContent() {
    return formatWikiReferenceText(this.__title, this.__sectionPath)
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
    return (
      <WikiLinkView
        id={this.__id}
        title={this.__title}
        sectionPath={this.__sectionPath}
      />
    )
  }
}

export function $createWikiLinkNode(id, title, sectionPath = []) {
  return new WikiLinkNode(id, title, sectionPath)
}

export function $isWikiLinkNode(node) {
  return node instanceof WikiLinkNode
}
