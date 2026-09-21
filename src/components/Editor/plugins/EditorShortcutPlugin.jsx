import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodes } from 'lexical'
import { INSERT_CHECK_LIST_COMMAND } from '@lexical/list'
import { $createFormulaNode } from '../nodes/FormulaNode'

export function getEditorShortcut(event) {
  const modifier = event.ctrlKey || event.metaKey
  if (!modifier || !event.altKey) return null

  const key = String(event.key || '').toLowerCase()
  if (key === 'e') return 'formula'
  if (key === 't') return 'checklist'
  if (key === 'r') return 'copy-reference'
  return null
}

export default function EditorShortcutPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const onKeyDown = event => {
      const action = getEditorShortcut(event)
      if (!action) return

      const root = editor.getRootElement()
      const activeElement = document.activeElement
      if (!root || !activeElement || !root.contains(activeElement)) return

      event.preventDefault()

      if (action === 'formula') {
        editor.update(() => {
          $insertNodes([$createFormulaNode()])
        })
        return
      }

      if (action === 'checklist') {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND)
        return
      }

      if (action === 'copy-reference') {
        window.dispatchEvent(new Event('editor:copy-current-reference'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor])

  return null
}
