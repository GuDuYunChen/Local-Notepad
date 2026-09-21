import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
} from 'lexical'
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import {
  isHeadingAnchor,
  isPasteableLink,
  normalizeLinkUrl,
  parseHeadingAnchor,
} from '../utils/linkUtils'

function getLinkNodeFromDOM(anchor) {
  let node = $getNearestNodeFromDOMNode(anchor)
  while (node && !$isLinkNode(node)) node = node.getParent?.() || null
  return $isLinkNode(node) ? node : null
}

export default function LinkInteractionPlugin({ readOnly = false }) {
  const [editor] = useLexicalComposerContext()
  const [popover, setPopover] = useState(null)
  const [draftUrl, setDraftUrl] = useState('')
  const [invalid, setInvalid] = useState(false)
  const popoverRef = useRef(null)

  const close = useCallback(() => {
    setPopover(null)
    setDraftUrl('')
    setInvalid(false)
  }, [])

  const openUrl = useCallback((url) => {
    const headingPath = parseHeadingAnchor(url)
    if (headingPath) {
      window.dispatchEvent(new CustomEvent('editor:open-heading-anchor', {
        detail: { path: headingPath, href: url },
      }))
      close()
      return
    }

    const normalized = normalizeLinkUrl(url)
    if (!normalized) return
    window.open(normalized, '_blank', 'noopener,noreferrer')
    close()
  }, [close])

  useEffect(() => {
    if (readOnly) return undefined

    return editor.registerCommand(
      PASTE_COMMAND,
      event => {
        if (event.clipboardData?.files?.length) return false

        const pasted = event.clipboardData?.getData('text/plain')?.trim() || ''
        if (!isPasteableLink(pasted)) return false

        let canApply = false
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          canApply = Boolean($isRangeSelection(selection) && !selection.isCollapsed())
        })

        if (!canApply) return false

        const url = normalizeLinkUrl(pasted)
        if (!url) return false

        event.preventDefault()
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
        return true
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor, readOnly])

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return undefined

    const onClick = event => {
      const anchor = event.target?.closest?.('a.editor-link')
      if (!anchor || !root.contains(anchor)) return

      event.preventDefault()

      const href = anchor.getAttribute('href') || ''
      if (isHeadingAnchor(href)) {
        openUrl(href)
        return
      }

      if (event.ctrlKey || event.metaKey) {
        openUrl(href)
        return
      }

      let nodeKey = ''
      let url = href

      editor.getEditorState().read(() => {
        const linkNode = getLinkNodeFromDOM(anchor)
        if (!linkNode) return
        nodeKey = linkNode.getKey()
        url = linkNode.getURL()
      })

      if (!nodeKey) return

      const rect = anchor.getBoundingClientRect()
      setDraftUrl(url)
      setInvalid(false)
      setPopover({
        nodeKey,
        url,
        top: rect.bottom + 8,
        left: rect.left,
      })
    }

    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [editor, openUrl])

  useEffect(() => {
    if (!popover) return undefined

    const onPointerDown = event => {
      if (popoverRef.current?.contains(event.target)) return
      if (event.target?.closest?.('a.editor-link')) return
      close()
    }

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        editor.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [close, editor, popover])

  useEffect(() => {
    if (!popover || !popoverRef.current) return

    const rect = popoverRef.current.getBoundingClientRect()
    const margin = 10
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin)
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin)

    popoverRef.current.style.left = Math.min(Math.max(margin, popover.left), maxLeft) + 'px'
    popoverRef.current.style.top = Math.min(Math.max(margin, popover.top), maxTop) + 'px'
  }, [popover])

  const applyUrl = () => {
    if (!popover?.nodeKey || readOnly) return

    const nextUrl = normalizeLinkUrl(draftUrl)
    if (!nextUrl) {
      setInvalid(true)
      return
    }

    editor.update(() => {
      const node = $getNodeByKey(popover.nodeKey)
      if ($isLinkNode(node)) node.setURL(nextUrl)
    })

    setPopover(current => current ? { ...current, url: nextUrl } : current)
    setDraftUrl(nextUrl)
    setInvalid(false)
    editor.focus()
  }

  const removeLink = () => {
    if (!popover?.nodeKey || readOnly) return

    editor.update(() => {
      const node = $getNodeByKey(popover.nodeKey)
      if (!$isLinkNode(node)) return

      const children = node.getChildren()
      for (const child of children) node.insertBefore(child)
      node.remove()
    })

    close()
    editor.focus()
  }

  const copyUrl = async () => {
    const value = popover?.url || draftUrl
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard copying is optional; editing remains available.
    }
  }

  if (!popover) return null

  return (
    <div
      ref={popoverRef}
      className="editor-link-popover"
      style={{ top: popover.top, left: popover.left }}
      role="dialog"
      aria-label="链接操作"
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="editor-link-popover-kicker">
        {isHeadingAnchor(popover.url) ? '章节链接' : '网页链接'}
      </div>

      {!readOnly ? (
        <div className="editor-link-popover-input-row">
          <input
            value={draftUrl}
            onChange={event => {
              setDraftUrl(event.target.value)
              setInvalid(false)
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applyUrl()
              }
            }}
            className={invalid ? 'invalid' : ''}
            aria-label="链接地址"
            spellCheck={false}
          />
          <button type="button" onClick={applyUrl}>应用</button>
        </div>
      ) : (
        <div className="editor-link-popover-url">{popover.url}</div>
      )}

      {invalid && (
        <div className="editor-link-popover-error">
          仅支持 http(s)、mailto 或当前文档章节锚点。
        </div>
      )}

      <div className="editor-link-popover-actions">
        <button type="button" onClick={() => openUrl(draftUrl || popover.url)}>
          {isHeadingAnchor(draftUrl || popover.url) ? '跳转' : '打开'}
        </button>
        <button type="button" onClick={() => void copyUrl()}>复制</button>
        {!readOnly && (
          <button type="button" className="danger" onClick={removeLink}>移除</button>
        )}
      </div>
    </div>
  )
}
