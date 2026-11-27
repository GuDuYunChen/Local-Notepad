import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection, $isParagraphNode, $isTextNode, COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND } from 'lexical'
import { $isTableNode } from '@lexical/table'
import { searchBlocks } from '../utils/blockRegistry'
import { useEditorWriteScope } from '../hooks/useEditorWriteScope'
import { captureTableSelectionWrite, isTableSelectionActive } from '../utils/tableEvents'
import { toast } from '~/services/toast'
import './SlashMenuPlugin.css'

const SLASH_TRIGGER = '/'

function $currentSlashQuery() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  const node = selection.anchor.getNode()
  // A real typed caret points at a text node. Paragraph element offsets count
  // children, so treating them as character positions hides the actual menu.
  if (!$isTextNode(node) || !$isParagraphNode(node.getParent())) return null
  const text = node.getTextContent(), end = selection.anchor.offset
  const start = text.slice(0, end).lastIndexOf(SLASH_TRIGGER)
  const previous = start > 0 ? text[start - 1] : node.getPreviousSibling()?.getTextContent().slice(-1)
  if (start < 0 || (previous && !/\s/.test(previous))) return null
  const query = text.slice(start + 1, end)
  if (query.includes('/') || query.includes('\n')) return null
  return { node, paragraph: node.getParent(), start, end, query }
}

export default function SlashMenuPlugin({ documentId } = {}) {
  const [editor] = useLexicalComposerContext()
  const captureWrite = useEditorWriteScope(editor, documentId)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef(null)
  const inputRef = useRef(null)
  const menuWrite = useRef(null)
  const menuTarget = useRef(null)

  const filteredBlocks = searchBlocks(query)

  const closeMenu = useCallback(() => {
    menuWrite.current = null
    menuTarget.current = null
    setIsOpen(false)
    setQuery('')
    setSelectedIndex(0)
  }, [])

  useLayoutEffect(() => { closeMenu() }, [documentId, closeMenu])

  const selectBlock = useCallback(
    (block) => {
      const canWrite = menuWrite.current
      const target = menuTarget.current
      if (!canWrite?.()) {
        closeMenu()
        toast.warning('插入位置或表格选择已变化，请重新打开内容菜单。')
        return
      }
      editor.getRootElement()?.focus({ preventScroll: true })

      editor.update(() => {
        if (!canWrite()) return
        const match = $currentSlashQuery()
        if (!match || !target || match.node.getKey() !== target.key || match.start !== target.start
          || match.end !== target.end || match.node.getTextContent() !== target.text) return
        const { node, paragraph, start, end } = match
        if (block.type === 'table' && node.getParents().some($isTableNode)) {
          // The existing TablePlugin forbids nesting. Refuse before removing
          // the typed command so a rejected insertion cannot change a cell.
          toast.warning('表格内不支持再插入表格，请在表格外选择插入位置。')
          return
        }

        if (block.createNode) {
          const nextNode = block.createNode()
          if (!nextNode) return
          node.spliceText(start, end - start, '', true)
          if (!paragraph.getTextContent().trim()) {
            paragraph.replace(nextNode)
          } else {
            paragraph.insertAfter(nextNode)
          }

          if (typeof nextNode.selectEnd === 'function') {
            nextNode.selectEnd()
          }
        } else {
          node.spliceText(start, end - start, '', true)
          // Synchronous Table/List commands belong to the same transaction
          // as their trigger removal, including when Lexical queues it.
          // Upload commands retain this same scope in their existing callback.
          block.run?.(editor, canWrite)
        }
      })

      closeMenu()
    },
    [editor, closeMenu, captureWrite]
  )

  useEffect(() => {
    const removeListener = editor.registerUpdateListener(({ editorState }) => {
      if (!editor.isEditable() || isTableSelectionActive(editor) || (menuWrite.current && !menuWrite.current())) {
        closeMenu()
        return
      }
      editorState.read(() => {
        const match = $currentSlashQuery()
        if (!match) {
          closeMenu()
          return
        }

        const domSelection = window.getSelection()
        if (!domSelection || domSelection.rangeCount === 0) return

        const domRange = domSelection.getRangeAt(0)
        const rect = domRange.getBoundingClientRect()

        if (!menuWrite.current) {
          const canWriteDocument = captureWrite(), ownsSelection = captureTableSelectionWrite(editor)
          menuWrite.current = () => canWriteDocument() && ownsSelection()
        }
        menuTarget.current = { key: match.node.getKey(), start: match.start, end: match.end, text: match.node.getTextContent() }
        setIsOpen(true)
        setQuery(match.query)
        setPosition({
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX,
        })
        setSelectedIndex(0)
      })
    })

    return removeListener
  }, [editor, closeMenu, captureWrite])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      if (!menuWrite.current?.()) { closeMenu(); return false }
      const target = e.target?.nodeType === 1 ? e.target : e.target?.parentElement
      if (!target || !editor.getRootElement()?.contains(target)
        || target.closest('input,textarea,select,button,[contenteditable="false"]')) return false
      if (e.isComposing || e.keyCode === 229 || editor.isComposing()) return false
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
        return true
      }

      if (e.key === 'ArrowDown') {
        if (!filteredBlocks.length) return false
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredBlocks.length)
        return true
      }

      if (e.key === 'ArrowUp') {
        if (!filteredBlocks.length) return false
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredBlocks.length) % filteredBlocks.length)
        return true
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (filteredBlocks[selectedIndex]) {
          selectBlock(filteredBlocks[selectedIndex])
        }
        return true
      }
      return false
    }

    // Own accepted menu keys before RichText splits the paragraph or the
    // indentation plugin handles Tab. Commands belong to this editor only.
    return editor.registerCommand(KEY_DOWN_COMMAND, handleKeyDown, COMMAND_PRIORITY_HIGH)
  }, [isOpen, filteredBlocks, selectedIndex, selectBlock, closeMenu])

  useEffect(() => {
    if (!isOpen || !menuRef.current) return

    const menuRect = menuRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    let adjustedTop = position.top
    let adjustedLeft = position.left

    if (adjustedTop + menuRect.height > viewportHeight) {
      adjustedTop = viewportHeight - menuRect.height - 16
    }

    if (adjustedLeft + menuRect.width > viewportWidth) {
      adjustedLeft = viewportWidth - menuRect.width - 16
    }

    menuRef.current.style.top = `${adjustedTop}px`
    menuRef.current.style.left = `${adjustedLeft}px`
  }, [isOpen, position, filteredBlocks])

  if (!isOpen || filteredBlocks.length === 0) return null

  return (
    <div className="slash-menu" ref={menuRef} role="listbox" aria-label="块类型选择">
      {filteredBlocks.map((block, index) => (
        <div
          key={block.type}
          className={`slash-menu-item${index === selectedIndex ? ' selected' : ''}`}
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => selectBlock(block)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="slash-menu-icon">{block.icon}</span>
          <div className="slash-menu-item-content">
            <span className="slash-menu-label">{block.label}</span>
            <span className="slash-menu-desc">{block.description}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
