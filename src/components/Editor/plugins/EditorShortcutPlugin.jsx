import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodes } from 'lexical'
import { INSERT_CHECK_LIST_COMMAND } from '@lexical/list'
import { $createFormulaNode } from '../nodes/FormulaNode'
import { isShortcutContextBlocked, matchShortcut } from '~/services/localShortcuts'
import { useEditorWriteScope } from '../hooks/useEditorWriteScope'

export function getEditorShortcut(event, bindings) {
  if (matchShortcut(event, 'formula', bindings)) return 'formula'
  if (matchShortcut(event, 'checklist', bindings)) return 'checklist'
  if (matchShortcut(event, 'copyReference', bindings)) return 'copy-reference'
  return null
}

export default function EditorShortcutPlugin({ documentId } = {}) {
  const [editor] = useLexicalComposerContext()
  const captureWrite = useEditorWriteScope(editor, documentId)

  useEffect(() => {
    const onKeyDown = event => {
      if (editor.isComposing() || isShortcutContextBlocked(event)) return
      const action = getEditorShortcut(event)
      if (!action) return

      const root = editor.getRootElement()
      const activeElement = document.activeElement
      if (!root || !activeElement || !root.contains(activeElement)) return
      if (activeElement.closest?.('input,textarea,select')) return
      const canWrite = captureWrite()
      if (!canWrite()) return

      event.preventDefault()

      if (action === 'formula') {
        editor.update(() => {
          if (!canWrite()) return
          $insertNodes([$createFormulaNode()])
        })
        return
      }

      if (action === 'checklist') {
        if (!canWrite()) return
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND)
        return
      }

      if (action === 'copy-reference') {
        window.dispatchEvent(new Event('editor:copy-current-reference'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor, captureWrite])

  return null
}
