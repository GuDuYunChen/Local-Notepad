import { useEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection, $createTextNode, $isParagraphNode, $isTextNode } from 'lexical'
import { $createMentionNode } from '../nodes/MentionNode'
import './MentionPlugin.css'

const MENTION_TRIGGER = '@'

const DEFAULT_SUGGESTIONS = [
  { id: '1', name: '张三' },
  { id: '2', name: '李四' },
  { id: '3', name: '王五' },
  { id: '4', name: '赵六' },
  { id: '5', name: '孙七' },
]

export default function MentionPlugin({ suggestions = DEFAULT_SUGGESTIONS }) {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef(null)

  const filteredSuggestions = suggestions.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  )

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setSelectedIndex(0)
  }, [])

  const selectMention = useCallback(
    (suggestion) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return

        const anchor = selection.anchor
        const anchorNode = anchor.getNode()

        if ($isTextNode(anchorNode) || $isParagraphNode(anchorNode)) {
          const textContent = anchorNode.getTextContent?.() || ''
          const cursorOffset = anchor.offset

          const textBeforeCursor = textContent.slice(0, cursorOffset)
          const lastAtIndex = textBeforeCursor.lastIndexOf(MENTION_TRIGGER)

          if (lastAtIndex !== -1) {
            const textBeforeAt = textContent.slice(0, lastAtIndex)
            const textAfterCursor = textContent.slice(cursorOffset)

            anchorNode.setTextContent(textBeforeAt)

            const mentionNode = $createMentionNode(suggestion.name, suggestion.id)
            const spaceNode = $createTextNode(' ')
            selection.insertNodes([mentionNode, spaceNode])

            if (textAfterCursor) {
              const remainingNode = $createTextNode(textAfterCursor)
              selection.insertNodes([remainingNode])
            }
          }
        }
      })

      closeMenu()
      editor.focus()
    },
    [editor, closeMenu]
  )

  useEffect(() => {
    const removeListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          closeMenu()
          return
        }

        const anchor = selection.anchor
        const anchorNode = anchor.getNode()

        if (!$isTextNode(anchorNode) && !$isParagraphNode(anchorNode)) {
          closeMenu()
          return
        }

        const textContent = anchorNode.getTextContent?.() || ''
        const cursorOffset = anchor.offset

        const textBeforeCursor = textContent.slice(0, cursorOffset)
        const lastAtIndex = textBeforeCursor.lastIndexOf(MENTION_TRIGGER)

        if (lastAtIndex === -1) {
          closeMenu()
          return
        }

        const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)

        if (textAfterAt.includes(' ')) {
          closeMenu()
          return
        }

        const domSelection = window.getSelection()
        if (!domSelection || domSelection.rangeCount === 0) return

        const domRange = domSelection.getRangeAt(0)
        const rect = domRange.getBoundingClientRect()

        setIsOpen(true)
        setQuery(textAfterAt)
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
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredSuggestions.length)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length)
        return
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (filteredSuggestions[selectedIndex]) {
          selectMention(filteredSuggestions[selectedIndex])
        }
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredSuggestions, selectedIndex, selectMention, closeMenu])

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
  }, [isOpen, position, filteredSuggestions])

  if (!isOpen || filteredSuggestions.length === 0) return null

  return (
    <div className="mention-menu" ref={menuRef} role="listbox" aria-label="提及选择">
      {filteredSuggestions.map((suggestion, index) => (
        <div
          key={suggestion.id}
          className={`mention-menu-item${index === selectedIndex ? ' selected' : ''}`}
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => selectMention(suggestion)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="mention-menu-avatar">{suggestion.name[0]}</span>
          <span className="mention-menu-name">{suggestion.name}</span>
        </div>
      ))}
    </div>
  )
}
