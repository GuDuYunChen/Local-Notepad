import React, { useCallback, useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
} from 'lexical'
import { $patchStyleText } from '@lexical/selection'

export default function FloatingTextToolbarPlugin() {
  const [editor] = useLexicalComposerContext()
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [formats, setFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
  })

  const updateToolbar = useCallback(() => {
    const rootElement = editor.getRootElement()
    const domSelection = window.getSelection()

    if (
      !rootElement ||
      !domSelection ||
      domSelection.rangeCount === 0 ||
      domSelection.isCollapsed ||
      !rootElement.contains(domSelection.anchorNode)
    ) {
      setVisible(false)
      return
    }

    let nextFormats = null
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return

      nextFormats = {
        bold: selection.hasFormat('bold'),
        italic: selection.hasFormat('italic'),
        underline: selection.hasFormat('underline'),
        strikethrough: selection.hasFormat('strikethrough'),
      }
    })

    if (!nextFormats) {
      setVisible(false)
      return
    }

    const rect = domSelection.getRangeAt(0).getBoundingClientRect()
    if (!rect.width && !rect.height) {
      setVisible(false)
      return
    }

    const toolbarWidth = 286
    const left = Math.max(
      12,
      Math.min(
        window.innerWidth - toolbarWidth - 12,
        rect.left + rect.width / 2 - toolbarWidth / 2
      )
    )
    const top = rect.top > 56 ? rect.top - 44 : rect.bottom + 10

    setFormats(nextFormats)
    setPosition({ top, left })
    setVisible(true)
  }, [editor])

  useEffect(() => {
    const unregister = editor.registerUpdateListener(() => {
      window.requestAnimationFrame(updateToolbar)
    })

    const onSelectionChange = () => {
      window.requestAnimationFrame(updateToolbar)
    }

    const onScroll = () => setVisible(false)

    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('resize', onSelectionChange)
    editor.getRootElement()?.closest('.editor-container')?.addEventListener('scroll', onScroll)

    return () => {
      unregister()
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('resize', onSelectionChange)
      editor.getRootElement()?.closest('.editor-container')?.removeEventListener('scroll', onScroll)
    }
  }, [editor, updateToolbar])

  const preventBlur = (event) => {
    event.preventDefault()
  }

  const toggleFormat = (format) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
    editor.focus()
    window.requestAnimationFrame(updateToolbar)
  }

  const toggleHighlight = () => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      $patchStyleText(selection, { 'background-color': '#fff0a6' })
    })
    editor.focus()
  }

  if (!visible) return null

  return (
    <div
      className="floating-text-toolbar"
      style={{ top: position.top, left: position.left }}
      role="toolbar"
      aria-label="选中文本格式"
      onMouseDown={preventBlur}
    >
      <button
        type="button"
        className={formats.bold ? 'active' : ''}
        onClick={() => toggleFormat('bold')}
        aria-label="加粗"
        title="加粗"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className={formats.italic ? 'active' : ''}
        onClick={() => toggleFormat('italic')}
        aria-label="斜体"
        title="斜体"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className={formats.underline ? 'active' : ''}
        onClick={() => toggleFormat('underline')}
        aria-label="下划线"
        title="下划线"
      >
        <span className="floating-underline">U</span>
      </button>
      <button
        type="button"
        className={formats.strikethrough ? 'active' : ''}
        onClick={() => toggleFormat('strikethrough')}
        aria-label="删除线"
        title="删除线"
      >
        <span className="floating-strike">S</span>
      </button>
      <span className="floating-toolbar-divider" />
      <button
        type="button"
        onClick={toggleHighlight}
        aria-label="高亮"
        title="高亮"
      >
        <span className="floating-highlight">A</span>
      </button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('editor:open-link'))}
        aria-label="添加链接"
        title="添加链接"
      >
        ↗
      </button>
    </div>
  )
}
