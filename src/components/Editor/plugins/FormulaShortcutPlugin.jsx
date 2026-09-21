import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_SPACE_COMMAND,
} from 'lexical'
import { $createFormulaNode } from '../nodes/FormulaNode'

export function matchFormulaShortcut(text) {
  const source = String(text || '')

  if (source === '$$') {
    return {
      type: 'block',
      expression: '',
      start: 0,
      end: source.length,
    }
  }

  const match = source.match(/\$([^$\n]+)\$$/)
  if (!match || match.index === undefined) return null
  if (match.index + match[0].length !== source.length) return null

  return {
    type: 'inline',
    expression: match[1].trim(),
    start: match.index,
    end: source.length,
  }
}

export default function FormulaShortcutPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => editor.registerCommand(
    KEY_SPACE_COMMAND,
    event => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

      const node = selection.anchor.getNode()
      if (!$isTextNode(node)) return false

      const offset = selection.anchor.offset
      const beforeCursor = node.getTextContent().slice(0, offset)
      const shortcut = matchFormulaShortcut(beforeCursor)
      if (!shortcut) return false

      if (shortcut.type === 'block') {
        const parent = node.getParent()
        if (!parent || parent.getType?.() !== 'paragraph') return false
        if (parent.getTextContent().trim() !== '$') return false

        event?.preventDefault?.()
        parent.replace($createFormulaNode({
          expression: '',
          displayMode: true,
        }))
        return true
      }

      if (!shortcut.expression) return false

      event?.preventDefault?.()
      const matchLength = shortcut.end - shortcut.start
      let targetNode = node

      if (shortcut.start > 0) {
        const parts = node.splitText(shortcut.start)
        targetNode = parts[parts.length - 1]
      }

      if (matchLength < targetNode.getTextContentSize()) {
        const parts = targetNode.splitText(matchLength)
        targetNode = parts[0]
      }

      const formula = $createFormulaNode({
        expression: shortcut.expression,
        displayMode: false,
      })
      targetNode.replace(formula)

      const space = $createTextNode(' ')
      formula.insertAfter(space)
      space.selectEnd()
      return true
    },
    COMMAND_PRIORITY_LOW,
  ), [editor])

  return null
}
