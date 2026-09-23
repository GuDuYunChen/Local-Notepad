import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createNodeSelection, $createRangeSelection, $getRoot, $isTextNode, $setSelection } from 'lexical'
import { toast } from '~/services/toast'
import { evidenceNavigation, isEvidenceContentReady, subscribeEvidenceContentReady } from '~/services/evidenceNavigation'
import { resolveEvidenceTarget } from '../utils/evidenceNavigationUtils'
import './EvidenceNavigationPlugin.css'

function serializeNode(node) {
  const result = node.exportJSON()
  if (typeof node.getChildren === 'function') result.children = node.getChildren().map(serializeNode)
  return result
}
function nodeAt(path) {
  let node = $getRoot()
  for (const index of path) node = node?.getChildren?.()[index]
  return node || null
}

// Must run inside editor.update. Selection-only: no split, mark, text mutation,
// history entry, network write or modification to the serialized manuscript.
export function $applyEvidenceTarget(target, select = true) {
  const result = resolveEvidenceTarget({ root: serializeNode($getRoot()) }, target)
  if (result.status !== 'found') return result
  let node
  if (result.kind === 'text') {
    const anchor = nodeAt(result.anchor.path)
    const focus = nodeAt(result.focus.path)
    if (!$isTextNode(anchor) || !$isTextNode(focus) ||
      result.anchor.offset > anchor.getTextContentSize() || result.focus.offset > focus.getTextContentSize()) return { status: 'unsupported' }
    if (select) {
      const selection = $createRangeSelection()
      selection.anchor.set(anchor.getKey(), result.anchor.offset, 'text')
      selection.focus.set(focus.getKey(), result.focus.offset, 'text')
      $setSelection(selection)
    }
    node = anchor
  } else {
    node = nodeAt(result.path)
    if (node?.getType() !== 'wiki-link') return { status: 'stale' }
    if (select) {
      const selection = $createNodeSelection()
      selection.add(node.getKey())
      $setSelection(selection)
    }
  }
  return { status: 'found', kind: result.kind, elementKey: node.getKey(), topLevelKey: node.getTopLevelElement()?.getKey() }
}

export default function EvidenceNavigationPlugin({ documentId, initialContent }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    let disposed = false
    let queued = false
    let frame = 0
    let flashTimer = null
    let flashed = null
    let interactions = 0
    const clearFlash = () => {
      if (flashTimer !== null) clearTimeout(flashTimer)
      flashTimer = null
      flashed?.classList.remove('editor-evidence-target')
      flashed = null
    }
    const attempt = () => {
      const request = evidenceNavigation.peek(documentId)
      if (disposed || !request || !isEvidenceContentReady(editor, documentId, initialContent)) return
      const root = editor.getRootElement()
      if (!root) return
      if (!evidenceNavigation.take(request.id, documentId)) return
      if (root.closest('.editor-shell')?.querySelector('.markdown-source-overlay')) {
        toast.warning('请先关闭 Markdown 源码面板，再重新点击证据定位；未应用的源码不会被覆盖')
        return
      }
      const interaction = interactions
      let result
      editor.update(() => {
        result = $applyEvidenceTarget(request.target, editor.isEditable())
      }, { discrete: true, tag: 'evidence-navigation' })
      if (result?.status !== 'found') {
        toast.warning(result?.status === 'stale'
          ? '正文已变化，证据位置已过期。请返回项目刷新证据后重试'
          : '此处暂不支持精确定位，请在已打开的章节中核对')
        return
      }
      // Reuse the outline's existing reveal handler, including folded sections.
      window.dispatchEvent(new CustomEvent('editor:search-match', {
        detail: { topLevelKey: result.topLevelKey },
      }))
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (disposed || evidenceNavigation.version() !== request.id || interaction !== interactions) return
        const element = editor.getElementByKey(result.elementKey)
        const scroller = root.closest('.editor-container')
        if (!element || !scroller) return
        clearFlash()
        element.classList.add('editor-evidence-target')
        flashed = element
        flashTimer = setTimeout(clearFlash, 1800)
        const selection = root.ownerDocument.getSelection()
        const range = result.kind === 'text' && editor.isEditable() && selection?.rangeCount && root.contains(selection.anchorNode)
          ? selection.getRangeAt(0) : null
        const selectedRect = range?.getBoundingClientRect?.()
        const rect = selectedRect?.height ? selectedRect : element.getBoundingClientRect()
        const bounds = scroller.getBoundingClientRect()
        scroller.scrollTo?.({ top: Math.max(0, scroller.scrollTop + rect.top - bounds.top - 48), behavior: 'auto' })
        toast.success('已定位到所选正文证据')
      })
    }
    const enqueue = () => {
      if (queued || disposed) return
      queued = true
      queueMicrotask(() => { queued = false; if (!disposed) attempt() })
    }
    const cancelOnInput = () => {
      interactions += 1
      const request = evidenceNavigation.peek(documentId)
      if (request) evidenceNavigation.cancel(request.id)
    }
    const unsubscribe = evidenceNavigation.subscribe(enqueue)
    const unready = subscribeEvidenceContentReady(enqueue)
    const unroot = editor.registerRootListener((root, previous) => {
      previous?.removeEventListener('keydown', cancelOnInput)
      previous?.removeEventListener('pointerdown', cancelOnInput)
      root?.addEventListener('keydown', cancelOnInput)
      root?.addEventListener('pointerdown', cancelOnInput)
      enqueue()
    })
    enqueue()
    return () => {
      disposed = true
      unsubscribe()
      unready()
      unroot()
      const root = editor.getRootElement()
      root?.removeEventListener('keydown', cancelOnInput)
      root?.removeEventListener('pointerdown', cancelOnInput)
      if (frame) cancelAnimationFrame(frame)
      clearFlash()
    }
  }, [editor, documentId, initialContent])
  return null
}
