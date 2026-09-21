import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
} from 'lexical'

const STORAGE_PREFIX = 'localNotepad.editorSession.v2:'

export function getDocumentSessionKey(documentId) {
  return documentId ? STORAGE_PREFIX + documentId : ''
}

export function normalizeDocumentSelectionSnapshot(selection) {
  if (!selection || typeof selection !== 'object') return null

  const normalizePoint = point => {
    if (!point || typeof point !== 'object') return null
    const blockIndex = Number(point.blockIndex)
    const offset = Number(point.offset)
    if (!Number.isInteger(blockIndex) || blockIndex < 0) return null
    if (!Number.isFinite(offset) || offset < 0) return null
    return {
      blockIndex,
      offset: Math.floor(offset),
    }
  }

  const anchor = normalizePoint(selection.anchor)
  const focus = normalizePoint(selection.focus)
  if (!anchor || !focus) return null

  return { anchor, focus }
}

export function readDocumentSession(documentId) {
  const key = getDocumentSessionKey(documentId)
  if (!key) return null

  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      scrollTop: Math.max(0, Number(parsed.scrollTop) || 0),
      selection: normalizeDocumentSelectionSnapshot(parsed.selection),
    }
  } catch {
    return null
  }
}

export function writeDocumentSession(documentId, state) {
  const key = getDocumentSessionKey(documentId)
  if (!key) return

  try {
    localStorage.setItem(key, JSON.stringify({
      scrollTop: Math.max(0, Number(state?.scrollTop) || 0),
      selection: normalizeDocumentSelectionSnapshot(state?.selection),
      updatedAt: Date.now(),
    }))
  } catch {
    // Session restoration is best-effort only.
  }
}

function collectTextNodes(node, output) {
  if ($isTextNode(node)) {
    output.push(node)
    return
  }

  for (const child of node.getChildren?.() || []) {
    collectTextNodes(child, output)
  }
}

function pointToSnapshot(point) {
  const node = point?.getNode?.()
  if (!node) return null

  const topLevel = node.getTopLevelElement?.()
  if (!topLevel) return null

  const rootChildren = $getRoot().getChildren()
  const blockIndex = rootChildren.findIndex(child => child.getKey() === topLevel.getKey())
  if (blockIndex < 0) return null

  const textNodes = []
  collectTextNodes(topLevel, textNodes)

  if ($isTextNode(node)) {
    let offset = 0
    for (const textNode of textNodes) {
      if (textNode.getKey() === node.getKey()) {
        return {
          blockIndex,
          offset: offset + Math.max(0, Number(point.offset) || 0),
        }
      }
      offset += textNode.getTextContentSize()
    }
  }

  return {
    blockIndex,
    offset: 0,
  }
}

export function captureDocumentSelectionSnapshot() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null

  const anchor = pointToSnapshot(selection.anchor)
  const focus = pointToSnapshot(selection.focus)
  if (!anchor || !focus) return null

  return { anchor, focus }
}

function snapshotToPoint(snapshot) {
  const root = $getRoot()
  const block = root.getChildren()[snapshot.blockIndex]
  if (!block) return null

  const textNodes = []
  collectTextNodes(block, textNodes)

  if (!textNodes.length) {
    return {
      key: block.getKey(),
      offset: 0,
      type: 'element',
    }
  }

  let remaining = Math.max(0, Number(snapshot.offset) || 0)
  for (const textNode of textNodes) {
    const size = textNode.getTextContentSize()
    if (remaining <= size) {
      return {
        key: textNode.getKey(),
        offset: remaining,
        type: 'text',
      }
    }
    remaining -= size
  }

  const last = textNodes[textNodes.length - 1]
  return {
    key: last.getKey(),
    offset: last.getTextContentSize(),
    type: 'text',
  }
}

export function restoreDocumentSelectionSnapshot(snapshot) {
  const normalized = normalizeDocumentSelectionSnapshot(snapshot)
  if (!normalized) return false

  const anchor = snapshotToPoint(normalized.anchor)
  const focus = snapshotToPoint(normalized.focus)
  if (!anchor || !focus) return false

  const selection = $createRangeSelection()
  selection.anchor.set(anchor.key, anchor.offset, anchor.type)
  selection.focus.set(focus.key, focus.offset, focus.type)
  $setSelection(selection)
  return true
}

export default function DocumentSessionPlugin({ documentId, restoreSelection = true }) {
  const [editor] = useLexicalComposerContext()
  const timerRef = useRef(null)
  const selectionRef = useRef(null)

  useEffect(() => {
    if (!documentId) return undefined

    const rootElement = editor.getRootElement()
    const scroller = rootElement?.closest('.editor-container')
    if (!scroller) return undefined

    const session = readDocumentSession(documentId)
    let cancelled = false

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return

        scroller.scrollTop = session?.scrollTop ?? 0

        if (restoreSelection && session?.selection) {
          editor.update(() => {
            restoreDocumentSelectionSnapshot(session.selection)
          })
        }
      })
    })

    const persist = () => {
      writeDocumentSession(documentId, {
        scrollTop: scroller.scrollTop,
        selection: selectionRef.current,
      })
    }

    const onScroll = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(persist, 160)
    }

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      if (!restoreSelection) return
      editorState.read(() => {
        selectionRef.current = captureDocumentSelectionSnapshot()
      })
    })

    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', persist)

    return () => {
      cancelled = true
      unregister()
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', persist)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      persist()
    }
  }, [documentId, editor, restoreSelection])

  return null
}
