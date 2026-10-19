import { useCallback, useLayoutEffect, useRef } from 'react'

// An upload or file picker belongs to the editable session which started it.
// A return to editing must not revive work invalidated by reading mode, a
// different document, or an unmounted editing plugin.
export function useEditorWriteScope(editor, documentId) {
  const scope = useRef({ active: false, epoch: 0 })
  useLayoutEffect(() => {
    const current = scope.current
    current.active = true
    current.epoch += 1
    const unregister = editor.registerEditableListener(() => { current.epoch += 1 })
    return () => {
      current.active = false
      current.epoch += 1
      unregister()
    }
  }, [editor, documentId])

  return useCallback(() => {
    const current = scope.current
    const epoch = current.epoch
    const startedEditable = current.active && editor.isEditable()
    return () => startedEditable && current.active && current.epoch === epoch && editor.isEditable()
  }, [editor])
}
