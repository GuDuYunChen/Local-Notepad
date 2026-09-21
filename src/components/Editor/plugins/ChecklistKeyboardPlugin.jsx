import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
} from 'lexical'
import { $isListItemNode, $isListNode } from '@lexical/list'

function getCurrentChecklistItem() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null

  let node = selection.anchor.getNode()
  while (node && !$isListItemNode(node)) node = node.getParent?.()
  if (!$isListItemNode(node)) return null

  const list = node.getParent?.()
  if (!$isListNode(list) || list.getListType?.() !== 'check') return null
  return node
}

export default function ChecklistKeyboardPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => editor.registerCommand(
    KEY_ENTER_COMMAND,
    event => {
      if (!(event?.ctrlKey || event?.metaKey) || event?.altKey) return false

      const item = getCurrentChecklistItem()
      if (!item || typeof item.setChecked !== 'function') return false

      event.preventDefault()
      const checked = typeof item.getChecked === 'function' ? Boolean(item.getChecked()) : false
      item.setChecked(!checked)
      return true
    },
    COMMAND_PRIORITY_LOW,
  ), [editor])

  return null
}
