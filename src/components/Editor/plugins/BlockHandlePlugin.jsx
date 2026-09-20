import { useEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $isHeadingNode } from '@lexical/rich-text'
import { $isListNode } from '@lexical/list'
import { $isCodeNode } from '@lexical/code'
import { $isTableNode } from '@lexical/table'
import { blockRegistry, getBlockByType } from '../utils/blockRegistry'
import { $getNearestBlockElementAncestorOrThrow } from '@lexical/utils'
import './BlockHandlePlugin.css'

function getBlockTypeFromNode(node) {
  if (!node) return null
  if ($isHeadingNode(node)) {
    const tag = node.getTag()
    if (tag === 'h1') return 'heading-1'
    if (tag === 'h2') return 'heading-2'
    if (tag === 'h3') return 'heading-3'
    return 'heading-4'
  }
  if ($isListNode(node)) return node.getListType() === 'bullet' ? 'bullet-list' : 'numbered-list'
  if ($isCodeNode(node)) return 'code-block'
  if ($isTableNode(node)) return 'table'
  return 'paragraph'
}

export default function BlockHandlePlugin() {
  const [editor] = useLexicalComposerContext()
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [blockType, setBlockType] = useState('paragraph')
  const [blockKey, setBlockKey] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef(null)
  const handleRef = useRef(null)

  const updatePosition = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      setIsVisible(false)
      return
    }

    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    let element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement

    if (!element || !element.closest('.editor-input')) {
      setIsVisible(false)
      return
    }

    while (element && element.parentElement && !element.parentElement.classList.contains('editor-input')) {
      element = element.parentElement
    }

    if (!element) {
      setIsVisible(false)
      return
    }

    const rect = element.getBoundingClientRect()
    const editorRect = element.closest('.editor-container')?.getBoundingClientRect()

    if (!editorRect) {
      setIsVisible(false)
      return
    }

    editor.getEditorState().read(() => {
      const lexicalSelection = $getSelection()
      if (!$isRangeSelection(lexicalSelection)) return

      const anchorNode = lexicalSelection.anchor.getNode()
      const blockNode = $getNearestBlockElementAncestorOrThrow(anchorNode)
      const type = getBlockTypeFromNode(blockNode)
      setBlockType(type || 'paragraph')
      setBlockKey(blockNode.getKey())
    })

    setPosition({
      top: rect.top - editorRect.top,
      left: -36,
    })
    setIsVisible(true)
    setShowMenu(false)
  }, [editor])

  useEffect(() => {
    const removeUpdateListener = editor.registerUpdateListener(() => {
      updatePosition()
    })

    const handleMouseMove = (e) => {
      const editorContainer = e.target.closest('.editor-container')
      if (!editorContainer) {
        setIsVisible(false)
        return
      }

      const rect = e.target.getBoundingClientRect()
      const editorRect = editorContainer.getBoundingClientRect()
      const relativeX = e.clientX - editorRect.left

      if (relativeX < 40 && relativeX > 0) {
        updatePosition()
      } else {
        setIsVisible(false)
      }
    }

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      removeUpdateListener()
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [editor, updatePosition])

  const getBlockNode = () => {
    if (!blockKey) return null
    return $getNodeByKey(blockKey)
  }

  const convertBlock = (newType) => {
    editor.update(() => {
      const blockNode = getBlockNode()
      const block = getBlockByType(newType)
      if (!blockNode || !block || !block.createNode) return

      const newNode = block.createNode()
      if (!newNode) return

      const text = blockNode.getTextContent?.() || ''
      if (text) {
        if (newNode.getType?.() === 'list') {
          const firstItem = newNode.getFirstChild?.()
          if (firstItem?.clear && firstItem?.append) {
            firstItem.clear()
            firstItem.append($createTextNode(text))
          }
        } else if (typeof newNode.append === 'function') {
          newNode.append($createTextNode(text))
        }
      }

      blockNode.replace(newNode)
      if (typeof newNode.selectStart === 'function') newNode.selectStart()
      setBlockKey(newNode.getKey())
    })
    setShowMenu(false)
  }

  const insertSibling = (position) => {
    editor.update(() => {
      const blockNode = getBlockNode()
      if (!blockNode) return

      const paragraph = $createParagraphNode()
      if (position === 'before') blockNode.insertBefore(paragraph)
      else blockNode.insertAfter(paragraph)
      paragraph.selectStart()
    })
    setShowMenu(false)
  }

  const deleteBlock = () => {
    editor.update(() => {
      const blockNode = getBlockNode()
      if (!blockNode) return

      const root = $getRoot()
      const siblings = root.getChildren()
      const index = siblings.findIndex(node => node.getKey() === blockNode.getKey())
      const nextFocus = siblings[index + 1] || siblings[index - 1]

      blockNode.remove()

      if (root.getChildrenSize() === 0) {
        const paragraph = $createParagraphNode()
        root.append(paragraph)
        paragraph.selectStart()
      } else if (nextFocus && typeof nextFocus.selectStart === 'function') {
        nextFocus.selectStart()
      }
    })
    setShowMenu(false)
  }

  if (!isVisible) return null

  const currentBlock = getBlockByType(blockType)

  return (
    <>
      <div
        className="block-handle"
        ref={handleRef}
        style={{ top: `${position.top}px`, left: `${position.left}px` }}
        draggable={Boolean(blockKey)}
        data-block-key={blockKey}
        onClick={() => setShowMenu(!showMenu)}
        aria-label="块操作与拖动排序"
        title="拖动排序 · 点击打开块操作"
      >
        <span className="block-handle-icon">⋮⋮</span>
      </div>

      {showMenu && (
        <div className="block-menu" ref={menuRef} role="menu">
          <button type="button" className="block-menu-item" onClick={() => insertSibling('before')} role="menuitem">
            <span className="block-menu-icon">↑</span>
            <span>上方插入空白块</span>
          </button>
          <button type="button" className="block-menu-item" onClick={() => insertSibling('after')} role="menuitem">
            <span className="block-menu-icon">↓</span>
            <span>下方插入空白块</span>
          </button>

          <div className="block-menu-divider" />
          <div className="block-menu-label">转换为</div>

          {blockRegistry.slice(0, 8).map((block) => (
            <button
              type="button"
              key={block.type}
              className={`block-menu-item${block.type === blockType ? ' active' : ''}`}
              onClick={() => convertBlock(block.type)}
              role="menuitem"
            >
              <span className="block-menu-icon">{block.icon}</span>
              <span>{block.label}</span>
            </button>
          ))}

          <div className="block-menu-divider" />
          <button type="button" className="block-menu-item danger" onClick={deleteBlock} role="menuitem">
            <span className="block-menu-icon">⌫</span>
            <span>删除当前块</span>
          </button>
        </div>
      )}
    </>
  )
}
