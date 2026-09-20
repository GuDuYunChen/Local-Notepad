import { useEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection, $isParagraphNode } from 'lexical'
import { searchBlocks } from '../utils/blockRegistry'
import './SlashMenuPlugin.css'

const SLASH_TRIGGER = '/'

export default function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef(null)
  const inputRef = useRef(null)

  const filteredBlocks = searchBlocks(query)

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setSelectedIndex(0)
  }, [])

  const selectBlock = useCallback(
    (block) => {
      let runAfterUpdate = false

      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return

        const anchor = selection.anchor
        const anchorNode = anchor.getNode()
        if (!$isParagraphNode(anchorNode)) return

        const textContent = anchorNode.getTextContent()
        const cursorOffset = anchor.offset
        const beforeCursor = textContent.slice(0, cursorOffset)
        const slashIndex = beforeCursor.lastIndexOf(SLASH_TRIGGER)
        const beforeSlash = slashIndex >= 0 ? textContent.slice(0, slashIndex) : ''
        const afterQuery = slashIndex >= 0 ? textContent.slice(cursorOffset) : ''
        const remainingText = beforeSlash + afterQuery

        if (block.createNode) {
          const nextNode = block.createNode()
          if (!nextNode) return

          if (!remainingText.trim()) {
            anchorNode.replace(nextNode)
          } else {
            anchorNode.setTextContent(remainingText)
            anchorNode.insertAfter(nextNode)
          }

          if (typeof nextNode.selectEnd === 'function') {
            nextNode.selectEnd()
          }
        } else {
          anchorNode.setTextContent(remainingText)
          runAfterUpdate = Boolean(block.run)
        }
      })

      if (runAfterUpdate) {
        Promise.resolve().then(() => block.run?.(editor))
      }

      closeMenu()
      editor.focus()
    },
    [editor, closeMenu]
  )

  useEffect(() => {
    const removeListener = editor.registerUpdateListener(({ editorState, prevEditorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          closeMenu()
          return
        }

        const anchor = selection.anchor
        const anchorNode = anchor.getNode()

        if (!$isParagraphNode(anchorNode)) {
          closeMenu()
          return
        }

        const textContent = anchorNode.getTextContent()
        const cursorOffset = anchor.offset

        const textBeforeCursor = textContent.slice(0, cursorOffset)
        const lastSlashIndex = textBeforeCursor.lastIndexOf(SLASH_TRIGGER)

        if (lastSlashIndex === -1) {
          closeMenu()
          return
        }

        const charBeforeSlash = lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : ''
        if (lastSlashIndex > 0 && !/\s/.test(charBeforeSlash)) {
          closeMenu()
          return
        }

        const textAfterSlash = textBeforeCursor.slice(lastSlashIndex + 1)
        if (textAfterSlash.includes('/') || textAfterSlash.includes('\n')) {
          closeMenu()
          return
        }

        const domSelection = window.getSelection()
        if (!domSelection || domSelection.rangeCount === 0) return

        const domRange = domSelection.getRangeAt(0)
        const rect = domRange.getBoundingClientRect()

        setIsOpen(true)
        setQuery(textAfterSlash)
        setPosition({
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX,
        })
        setSelectedIndex(0)
      })
    })

    return removeListener
  }, [editor, closeMenu])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
        return
      }

      if (e.key === 'ArrowDown') {
        if (!filteredBlocks.length) return
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredBlocks.length)
        return
      }

      if (e.key === 'ArrowUp') {
        if (!filteredBlocks.length) return
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredBlocks.length) % filteredBlocks.length)
        return
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (filteredBlocks[selectedIndex]) {
          selectBlock(filteredBlocks[selectedIndex])
        }
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
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
