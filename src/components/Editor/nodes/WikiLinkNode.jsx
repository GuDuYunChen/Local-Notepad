import { DecoratorNode } from 'lexical'
import React from 'react'
import WikiLinkView from './WikiLinkView'
import BlockEmbedView from './BlockEmbedView'
import { requireBlockId } from '../../../services/blockReferenceModel.mjs'
import {
  formatWikiReferenceText,
  normalizeSectionPath,
} from '../utils/referenceUtils'

export class WikiLinkNode extends DecoratorNode {
  __id
  __title
  __sectionPath
  __blockId
  __embedded

  static getType() {
    return 'wiki-link'
  }

  static clone(node) {
    return new WikiLinkNode(node.__id, node.__title, node.__sectionPath, node.__key, node.__blockId, node.__embedded)
  }

  static importJSON(serializedNode) {
    const hasBlock = Object.hasOwn(serializedNode, 'blockId')
    const blockId = hasBlock ? requireBlockId(serializedNode.blockId) : ''
    if (Object.hasOwn(serializedNode, 'embedded') && (!hasBlock || typeof serializedNode.embedded !== 'boolean'))
      throw Error('块嵌入数据无效，未静默降级为整篇笔记引用。')
    if (hasBlock && normalizeSectionPath(serializedNode.sectionPath).length)
      throw Error('块引用不能同时指向标题路径。')
    return new WikiLinkNode(
      serializedNode.id,
      serializedNode.title,
      normalizeSectionPath(serializedNode.sectionPath), undefined, blockId, serializedNode.embedded === true
    )
  }

  constructor(id = '', title = '', sectionPath = [], key, blockId = '', embedded = false) {
    super(key)
    this.__id = id
    this.__title = title
    this.__sectionPath = blockId ? [] : normalizeSectionPath(sectionPath)
    this.__blockId = blockId ? requireBlockId(blockId) : ''
    this.__embedded = Boolean(blockId && embedded)
  }

  exportJSON() {
    return {
      type: 'wiki-link',
      version: 1,
      id: this.__id,
      title: this.__title,
      sectionPath: this.__sectionPath,
      ...(this.__blockId ? { blockId: this.__blockId, embedded: this.__embedded } : {}),
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
    return this.__blockId ? (this.__embedded ? '!' : '') + '[[' + this.__title + '#^' + this.__blockId + ']]' : formatWikiReferenceText(this.__title, this.__sectionPath)
  }

  isInline() {
    return !this.__embedded
  }

  createDOM() {
    return document.createElement(this.__embedded ? 'div' : 'span')
  }

  updateDOM(previous) {
    return previous.__embedded !== this.__embedded
  }

  decorate() {
    if (this.__embedded) return <BlockEmbedView id={this.__id} title={this.__title} blockId={this.__blockId} />
    return (
      <WikiLinkView
        id={this.__id}
        title={this.__title}
        sectionPath={this.__sectionPath}
        blockId={this.__blockId}
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

export function $createBlockReferenceNode(id, title, blockId, embedded = false) {
  return new WikiLinkNode(id, title, [], undefined, requireBlockId(blockId), embedded)
}
