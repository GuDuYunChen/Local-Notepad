import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createNodeSelection, $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $getSelection, $isRangeSelection } from 'lexical'
import { $isHeadingNode } from '@lexical/rich-text'
import { $isListNode } from '@lexical/list'
import { $isCodeNode } from '@lexical/code'
import { $isTableNode } from '@lexical/table'
import { blockRegistry, getBlockByType } from '../utils/blockRegistry'
import { $getNearestBlockElementAncestorOrThrow } from '@lexical/utils'
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes } from '@lexical/clipboard'
import './BlockHandlePlugin.css'
import { getBlockHandleLayout, getBlockMenuPosition } from '../utils/blockHandleLayout.mjs'
import { removeCopiedBlockIds } from '../../../services/blockReferenceModel.mjs'
import { $blockId, $setBlockId } from '../utils/blockReferenceState.js'
import { BLOCK_TYPES } from '../../../services/blockReferenceModel.mjs'
import { UiButton } from '~/components/ui/ControlKit'


let internalBlockClipboard = null

export function getInternalBlockClipboard() {
  return internalBlockClipboard
}

export function setInternalBlockClipboard(payload) {
  internalBlockClipboard = payload
}

export function $serializeBlockClipboard(editor, blockNode) {
  if (!blockNode) return null
  const selection = $createNodeSelection()
  selection.add(blockNode.getKey())
  const payload = $generateJSONFromSelectedNodes(editor, selection)
  return payload?.nodes?.length ? payload : null
}

export function $insertBlockClipboardPayloadAfter(payload, blockNode) {
  if (!blockNode || !payload?.nodes?.length) return []

  const nodes = $generateNodesFromSerializedNodes(removeCopiedBlockIds(payload.nodes))
  let cursor = blockNode
  for (const node of nodes) {
    cursor.insertAfter(node)
    cursor = node
  }
  return nodes
}


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
  const activeBlockRef = useRef(null)

  const readLayout = useCallback((element) => {
    const editorRoot = editor.getRootElement()
    const owner = editorRoot?.closest('.editor-container')
    if (!owner || !element?.isConnected || element.parentElement !== editorRoot) return null
    const ownerRect = owner.getBoundingClientRect()
    return getBlockHandleLayout({
      block: element.getBoundingClientRect(),
      port: { left: ownerRect.left + owner.clientLeft, top: ownerRect.top + owner.clientTop,
        width: owner.clientWidth, height: owner.clientHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollTop: owner.scrollTop, scrollLeft: owner.scrollLeft,
    })
  }, [editor])

  const placeControls = useCallback((layout) => {
    if (layout) setPosition(layout)
    setIsVisible(Boolean(layout))
    if (!layout) setShowMenu(false)
  }, [])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    // offset dimensions exclude the existing entrance animation's transform.
    const next = getBlockMenuPosition(position, { width: menu.offsetWidth, height: menu.offsetHeight })
    if (!next) { setShowMenu(false); return }
    menu.style.top = `${next.top}px`
    menu.style.left = `${next.left}px`
  }, [position, showMenu])

  const updatePosition = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      activeBlockRef.current = null
      placeControls(null)
      return
    }

    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    let element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement

    if (!element || element.closest('.editor-input') !== editor.getRootElement()) {
      activeBlockRef.current = null
      placeControls(null)
      return
    }

    while (element && element.parentElement && !element.parentElement.classList.contains('editor-input')) {
      element = element.parentElement
    }

    if (!element) {
      activeBlockRef.current = null
      placeControls(null)
      return
    }

    const layout = readLayout(element)

    if (!layout) {
      activeBlockRef.current = null
      placeControls(null)
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

    activeBlockRef.current = element
    placeControls(layout)
    setShowMenu(false)
  }, [editor, readLayout, placeControls])

  useEffect(() => {
    const removeUpdateListener = editor.registerUpdateListener(() => {
      updatePosition()
    })

    const handleMouseMove = (e) => {
      // An open menu owns pointer travel until the existing outside-mousedown
      // handler closes it; moving to a menu item must not unmount that item.
      if (menuRef.current || handleRef.current?.contains(e.target)) return
      const editorContainer = e.target.closest?.('.editor-container')
      if (!editorContainer) {
        setIsVisible(false)
        return
      }

      const editorRect = editorContainer.getBoundingClientRect()
      const relativeX = e.clientX - editorRect.left
      const blockLeft = activeBlockRef.current?.getBoundingClientRect().left ?? editorRect.left
      const gutterEnd = Math.max(40, blockLeft - editorRect.left)

      if (relativeX < gutterEnd && relativeX > 0) {
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

    const handleViewportChange = (event) => {
      const block = activeBlockRef.current
      if (!block) return
      if (event.type === 'scroll' && event.target !== document
        && !event.target.contains?.(block)) return
      placeControls(readLayout(block))
    }

    document.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      removeUpdateListener()
      document.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [editor, updatePosition, readLayout, placeControls])

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

      const identity = $blockId(blockNode)
      if (identity && BLOCK_TYPES.has(newNode.getType())) $setBlockId(newNode, identity)
      blockNode.replace(newNode)
      if (typeof newNode.selectStart === 'function') newNode.selectStart()
      setBlockKey(newNode.getKey())
    })
    setShowMenu(false)
  }

  const serializeBlock = () => $serializeBlockClipboard(editor, getBlockNode())

  const copyBlock = () => {
    editor.update(() => {
      const payload = serializeBlock()
      if (!payload) return
      setInternalBlockClipboard(payload)

      const blockNode = getBlockNode()
      const plainText = blockNode?.getTextContent?.() || ''
      if (plainText && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(plainText).catch(() => {})
      }
    })
    setShowMenu(false)
  }

  const insertSerializedNodesAfter = payload => {
    const nodes = $insertBlockClipboardPayloadAfter(payload, getBlockNode())
    const cursor = nodes[nodes.length - 1]
    if (!cursor) return

    if (typeof cursor.selectEnd === 'function') cursor.selectEnd()
    setBlockKey(cursor.getKey())
  }

  const pasteBlockAfter = () => {
    const payload = getInternalBlockClipboard()
    if (!payload) return

    editor.update(() => {
      insertSerializedNodesAfter(payload)
    })
    setShowMenu(false)
  }

  const duplicateBlock = () => {
    editor.update(() => {
      const payload = serializeBlock()
      if (!payload) return
      insertSerializedNodesAfter(payload)
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
        <div className="block-menu" ref={menuRef} role="menu" style={position.menu}>
          <UiButton density="compact" type="button" className="block-menu-item" onClick={() => insertSibling('before')} role="menuitem">
            <span className="block-menu-icon">↑</span>
            <span>上方插入空白块</span>
          </UiButton>
          <UiButton density="compact" type="button" className="block-menu-item" onClick={() => insertSibling('after')} role="menuitem">
            <span className="block-menu-icon">↓</span>
            <span>下方插入空白块</span>
          </UiButton>

          <div className="block-menu-divider" />
          <UiButton density="compact" type="button" className="block-menu-item" onClick={copyBlock} role="menuitem">
            <span className="block-menu-icon">⧉</span>
            <span>复制当前块</span>
          </UiButton>
          <UiButton density="compact"
            type="button"
            className="block-menu-item"
            onClick={pasteBlockAfter}
            role="menuitem"
            disabled={!getInternalBlockClipboard()}
          >
            <span className="block-menu-icon">⇣</span>
            <span>粘贴复制块到下方</span>
          </UiButton>
          <UiButton density="compact" type="button" className="block-menu-item" onClick={duplicateBlock} role="menuitem">
            <span className="block-menu-icon">＋</span>
            <span>重复当前块</span>
          </UiButton>

          <div className="block-menu-divider" />
          <div className="block-menu-label">转换为</div>

          {blockRegistry.slice(0, 8).map((block) => (
            <UiButton density="compact"
              type="button"
              key={block.type}
              className={`block-menu-item${block.type === blockType ? ' active' : ''}`}
              onClick={() => convertBlock(block.type)}
              role="menuitem"
            >
              <span className="block-menu-icon">{block.icon}</span>
              <span>{block.label}</span>
            </UiButton>
          ))}

          <div className="block-menu-divider" />
          <UiButton density="compact" type="button" className="block-menu-item danger" onClick={deleteBlock} role="menuitem">
            <span className="block-menu-icon">⌫</span>
            <span>删除当前块</span>
          </UiButton>
        </div>
      )}
    </>
  )
}
