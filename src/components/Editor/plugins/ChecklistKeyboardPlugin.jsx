import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
} from 'lexical'
import { $createListItemNode, $isListItemNode, $isListNode } from '@lexical/list'

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

export function getChecklistEnterAction(event, checked, text) {
  const modifier = Boolean(event?.ctrlKey || event?.metaKey)
  const alt = Boolean(event?.altKey)

  if (modifier && !alt) return 'toggle'
  if (!modifier && !alt && checked && String(text || '').trim()) return 'continue'
  return null
}

export default function ChecklistKeyboardPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => editor.registerCommand(
    KEY_ENTER_COMMAND,
    event => {
      const item = getCurrentChecklistItem()
      if (!item) return false

      const checked = typeof item.getChecked === 'function' ? Boolean(item.getChecked()) : false
      const action = getChecklistEnterAction(event, checked, item.getTextContent?.() || '')
      if (!action) return false

      event.preventDefault()

      if (action === 'toggle') {
        if (typeof item.setChecked !== 'function') return false
        item.setChecked(!checked)
        return true
      }

      const nextItem = $createListItemNode(false)
      item.insertAfter(nextItem)
      nextItem.selectStart()
      return true
    },
    COMMAND_PRIORITY_LOW,
  ), [editor])

  return null
}
