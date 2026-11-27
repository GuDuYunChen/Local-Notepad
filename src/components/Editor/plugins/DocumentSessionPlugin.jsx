import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
} from 'lexical'

import { evidenceNavigation } from '~/services/evidenceNavigation'
import { captureTableSelectionWrite, getTableSelectionSessionRange } from '../utils/tableEvents'

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
    const normalized = {
      blockIndex,
      offset: Math.floor(offset),
    }
    // Existing paragraph snapshots keep their original shape. Table points
    // also retain the exact descendant, including an empty paragraph or a
    // text-node boundary which a flattened character offset cannot identify.
    if (point.path !== undefined) {
      const nodeOffset = Number(point.nodeOffset)
      if (!Array.isArray(point.path) || point.path.length > 128 ||
          !point.path.every(index => Number.isSafeInteger(index) && index >= 0) ||
          !['text', 'element'].includes(point.pointType) ||
          !Number.isSafeInteger(nodeOffset) || nodeOffset < 0) return null
      normalized.path = [...point.path]
      normalized.pointType = point.pointType
      normalized.nodeOffset = nodeOffset
    }
    return normalized
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

  const root = $getRoot()
  let topLevel = node
  const path = []
  // TableCellNode is a Lexical shadow root. getTopLevelElement() stops inside
  // the cell, so use the physical ancestry to reach this editor's root.
  while (topLevel.getParent() && topLevel.getParent() !== root) {
    path.unshift(topLevel.getIndexWithinParent())
    topLevel = topLevel.getParent()
  }
  if (topLevel.getParent() !== root) return null

  const rootChildren = $getRoot().getChildren()
  const blockIndex = rootChildren.findIndex(child => child.getKey() === topLevel.getKey())
  if (blockIndex < 0) return null

  if (topLevel.getType() === 'table') {
    return { blockIndex, offset: 0, path, pointType: point.type, nodeOffset: point.offset }
  }

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

export function captureDocumentSelectionSnapshot(selection = $getSelection()) {
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

  if (snapshot.path) {
    if (block.getType() !== 'table') return null
    let node = block
    for (const index of snapshot.path) {
      node = node.getChildren?.()[index]
      if (!node) return null
    }
    const isText = snapshot.pointType === 'text'
    if (isText ? !$isTextNode(node) : !$isElementNode(node)) return null
    return {
      key: node.getKey(),
      offset: Math.min(snapshot.nodeOffset, isText ? node.getTextContentSize() : node.getChildrenSize()),
      type: snapshot.pointType,
    }
  }

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
    // The editor is reused across notes, including reading mode where the
    // update listener deliberately does not capture a caret. Start from this
    // note's own session so pagehide cannot persist the previous note's path.
    selectionRef.current = session?.selection ?? null
    const skipRestore = Boolean(evidenceNavigation.peek(documentId))
    const navigationVersion = evidenceNavigation.version()
    const canRestoreSelection = captureTableSelectionWrite(editor)
    let cancelled = false
    const canRestore = () => !cancelled && !skipRestore && !evidenceNavigation.peek(documentId) &&
      evidenceNavigation.version() === navigationVersion && canRestoreSelection()

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // A later bulk gesture owns the selection, even after that mode ends.
        // An old frame must not reopen an IME-blocked range or replace a new caret.
        if (!canRestore()) return

        scroller.scrollTop = session?.scrollTop ?? 0

        if (restoreSelection && session?.selection) {
          editor.update(() => {
            if (!canRestore()) return
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
        // An IME-blocked bulk operation temporarily owns no writable text
        // selection. Persist its still-valid caret through the existing path
        // serializer, without restoring that range into the editor or DOM.
        selectionRef.current = captureDocumentSelectionSnapshot($getSelection() || getTableSelectionSessionRange(editor))
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
