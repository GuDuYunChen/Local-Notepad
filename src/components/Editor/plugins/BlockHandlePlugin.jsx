import { useEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection } from 'lexical'
import { $isHeadingNode } from '@lexical/rich-text'
import { $isListNode } from '@lexical/list'
import { $isCodeNode } from '@lexical/code'
import { $isTableNode } from '@lexical/table'
import { blockRegistry, getBlockByType } from '../utils/blockRegistry'
import './BlockHandlePlugin.css'

function getBlockTypeFromNode(node) {
  if (!node) return null
  if ($isHeadingNode(node)) {
    const tag = node.getTag()
    return tag === 'h1' ? 'heading-1' : tag === 'h2' ? 'heading-2' : 'heading-3'
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

    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      const anchorNode = selection.anchor.getNode()
      const type = getBlockTypeFromNode(anchorNode)
      setBlockType(type || 'paragraph')
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

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move'
    e.target.style.opacity = '0.5'
  }

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1'
  }

  const convertBlock = (newType) => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      const anchorNode = selection.anchor.getNode()
      const block = getBlockByType(newType)
      if (!block || !block.createNode) return

      const newNode = block.createNode(editor)
      if (newNode) {
        anchorNode.replace(newNode)
        newNode.selectStart()
      }
    })
    setShowMenu(false)
  }

  const insertBlockAbove = () => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      const anchorNode = selection.anchor.getNode()
      const paragraph = blockRegistry.find((b) => b.type === 'paragraph')
      if (paragraph && paragraph.createNode) {
        const newNode = paragraph.createNode(editor)
        if (newNode) {
          anchorNode.insertBefore(newNode)
          newNode.selectStart()
        }
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
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={() => setShowMenu(!showMenu)}
        aria-label="块操作手柄"
      >
        <span className="block-handle-icon">⋮⋮</span>
      </div>

      {showMenu && (
        <div className="block-menu" ref={menuRef} role="menu">
          <div className="block-menu-item" onClick={insertBlockAbove} role="menuitem">
            <span>+</span>
            <span>上方插入块</span>
          </div>
          <div className="block-menu-divider" />
          <div className="block-menu-label">转换为</div>
          {blockRegistry.slice(0, 8).map((block) => (
            <div
              key={block.type}
              className={`block-menu-item${block.type === blockType ? ' active' : ''}`}
              onClick={() => convertBlock(block.type)}
              role="menuitem"
            >
              <span className="block-menu-icon">{block.icon}</span>
              <span>{block.label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
