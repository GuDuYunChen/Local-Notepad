import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useEditorWriteScope } from './useEditorWriteScope'

// Preserve the existing editor write scope; abort is resource cleanup, not an
// alternative permission or save path. A return to editing never revives work.
export function useImageUploadSession(editor, documentId) {
  const captureWrite = useEditorWriteScope(editor, documentId)
  const active = useRef(null)
  const [busy, setBusy] = useState(false)
  const cancel = useCallback(() => {
    active.current?.controller.abort()
    active.current = null
    setBusy(false)
  }, [])
  useLayoutEffect(() => {
    setBusy(false)
    const unregister = editor.registerEditableListener(cancel)
    return () => {
      active.current?.controller.abort()
      active.current = null
      unregister()
    }
  }, [editor, documentId, cancel])
  const begin = useCallback(() => {
    if (active.current) return null
    const canWrite = captureWrite()
    if (!canWrite()) return null
    const controller = new AbortController()
    const task = {
      controller, signal: controller.signal,
      current: () => !controller.signal.aborted && canWrite(),
      finish: () => {
        if (active.current === task) { active.current = null; setBusy(false) }
      },
    }
    active.current = task; setBusy(true)
    return task
  }, [captureWrite])
  return { begin, cancel, busy }
}
