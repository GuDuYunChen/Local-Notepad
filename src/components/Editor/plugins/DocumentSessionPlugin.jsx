import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

const STORAGE_PREFIX = 'localNotepad.editorSession.v1:'

export function getDocumentSessionKey(documentId) {
  return documentId ? STORAGE_PREFIX + documentId : ''
}

export function readDocumentSession(documentId) {
  const key = getDocumentSessionKey(documentId)
  if (!key) return null

  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      scrollTop: Math.max(0, Number(parsed.scrollTop) || 0),
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
      updatedAt: Date.now(),
    }))
  } catch {
    // Session restoration is best-effort only.
  }
}

export default function DocumentSessionPlugin({ documentId }) {
  const [editor] = useLexicalComposerContext()
  const timerRef = useRef(null)

  useEffect(() => {
    if (!documentId) return undefined

    const rootElement = editor.getRootElement()
    const scroller = rootElement?.closest('.editor-container')
    if (!scroller) return undefined

    const session = readDocumentSession(documentId)
    let cancelled = false

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled && session?.scrollTop) {
          scroller.scrollTop = session.scrollTop
        }
      })
    })

    const persist = () => {
      writeDocumentSession(documentId, {
        scrollTop: scroller.scrollTop,
      })
    }

    const onScroll = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(persist, 160)
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', persist)

    return () => {
      cancelled = true
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', persist)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      persist()
    }
  }, [documentId, editor])

  return null
}
