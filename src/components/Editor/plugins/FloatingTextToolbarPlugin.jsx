import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
} from 'lexical'
import { $patchStyleText } from '@lexical/selection'
import { UiButton } from '~/components/ui/ControlKit'


export default function FloatingTextToolbarPlugin() {
  const [editor] = useLexicalComposerContext()
  const toolbarRef = useRef(null)
  const keyboardFocusRef = useRef(false)
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

    // Retain the real selected-text toolbar during keyboard traversal. Never
    // replace or reconstruct the browser selection to satisfy focus checks.
    const active = document.activeElement
    const formatTrigger = rootElement?.closest('.editor-shell')?.querySelector('.editor-toolbar [aria-label="更多格式"]')
    const selectedRangeRetained = domSelection?.rangeCount === 1 && !domSelection.isCollapsed &&
      rootElement?.contains(domSelection.anchorNode) && rootElement?.contains(domSelection.focusNode)
    if (keyboardFocusRef.current && selectedRangeRetained &&
        (toolbarRef.current?.contains(active) || active === formatTrigger)) return
    keyboardFocusRef.current = false

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

  useEffect(() => {
    // Native Alt+F10 enters the floating selection toolbar without focusing
    // the font combobox or changing Lexical's Tab indentation semantics.
    const enterSelectedToolbar = (event) => {
      if (event.defaultPrevented || event.repeat || event.key !== 'F10' || !event.altKey ||
          event.ctrlKey || event.metaKey || event.shiftKey || !editor.isEditable()) return
      const rootElement = editor.getRootElement()
      if (!rootElement?.contains(event.target)) return
      const selected = window.getSelection()
      if (!selected || selected.rangeCount !== 1 || selected.isCollapsed ||
          !rootElement.contains(selected.anchorNode) || !rootElement.contains(selected.focusNode) || !selected.toString()) return
      let lexicalRange = false
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        lexicalRange = $isRangeSelection(selection) && !selection.isCollapsed()
      })
      if (!lexicalRange) return
      const button = toolbarRef.current?.querySelector('button[aria-label="加粗"]')
      if (!button || button.disabled) return
      event.preventDefault()
      keyboardFocusRef.current = true
      button.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', enterSelectedToolbar)
    return () => document.removeEventListener('keydown', enterSelectedToolbar)
  }, [editor])

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
      ref={toolbarRef}
      aria-keyshortcuts="Alt+F10"
      style={{ top: position.top, left: position.left }}
      role="toolbar"
      aria-label="选中文本格式"
      onMouseDown={preventBlur}
    >
      <UiButton density="compact"
        type="button"
        className={formats.bold ? 'active' : ''}
        onClick={() => toggleFormat('bold')}
        aria-label="加粗"
        title="加粗"
      >
        <strong>B</strong>
      </UiButton>
      <UiButton density="compact"
        type="button"
        className={formats.italic ? 'active' : ''}
        onClick={() => toggleFormat('italic')}
        aria-label="斜体"
        title="斜体"
      >
        <em>I</em>
      </UiButton>
      <UiButton density="compact"
        type="button"
        className={formats.underline ? 'active' : ''}
        onClick={() => toggleFormat('underline')}
        aria-label="下划线"
        title="下划线"
      >
        <span className="floating-underline">U</span>
      </UiButton>
      <UiButton density="compact"
        type="button"
        className={formats.strikethrough ? 'active' : ''}
        onClick={() => toggleFormat('strikethrough')}
        aria-label="删除线"
        title="删除线"
      >
        <span className="floating-strike">S</span>
      </UiButton>
      <span className="floating-toolbar-divider" />
      <UiButton density="compact"
        type="button"
        onClick={toggleHighlight}
        aria-label="高亮"
        title="高亮"
      >
        <span className="floating-highlight">A</span>
      </UiButton>
      <UiButton density="compact"
        type="button"
        onClick={() => window.dispatchEvent(new Event('editor:open-link'))}
        aria-label="添加链接"
        title="添加链接"
      >
        ↗
      </UiButton>
    </div>
  )
}
