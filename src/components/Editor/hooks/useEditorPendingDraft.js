import { createContext, useContext, useLayoutEffect, useRef } from 'react'

export const EditorPendingDraftContext = createContext(null)

export function useEditorPendingDraft({ nodeKey, label, dirty, value, discard }) {
  const registry = useContext(EditorPendingDraftContext)
  const token = useRef(Symbol('editor-block-draft'))
  const current = useRef(null)
  current.current = {
    label, dirty: Boolean(dirty), value,
    discard: () => {
      // Publish the explicit discard synchronously, before React reconciles the
      // input fields and before a caller is allowed to navigate away.
      discard()
      current.current = { ...current.current, dirty: false }
    },
  }
  useLayoutEffect(() => {
    if (!registry) return undefined
    return registry.register(token.current, () => current.current)
  }, [registry, nodeKey])
  useLayoutEffect(() => { registry?.changed() }, [registry, label, dirty, value])
}
