// Keep the existing public event details while routing product events through
// their owning editor. Window events remain compatible for a single editor.
export function dispatchTableEvent(editor, type, detail) {
  const root = editor.getRootElement()
  if (!root?.isConnected) return false
  return root.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }))
}

export function isTableEventForEditor(editor, event) {
  return isTableEventForRoot(editor.getRootElement(), event)
}

export function isTableEventForRoot(root, event) {
  if (!root?.isConnected) return false
  const doc = root.ownerDocument
  const target = event.target
  const isWindow = target === window || target === doc.defaultView || (target?.window === target && target?.document === doc)
  if (!isWindow && target !== document && target !== doc) {
    const element = target?.nodeType === 1 ? target : target?.parentElement
    return element?.closest?.('[data-lexical-editor="true"]') === root
  }
  const focusedEditor = doc.activeElement?.closest?.('[data-lexical-editor="true"]')
  if (focusedEditor) return focusedEditor === root
  return doc.querySelectorAll('[data-lexical-editor="true"]').length === 1
}

// Bulk cell selection owns a separate logical selection. Toolbar formatting
// must not fall through to Lexical's retained text caret in another cell.
export function isTableSelectionActive(editor) {
  const root = editor?.getRootElement?.()
  const container = root?.closest?.('.editor-container')
  return !!container?.querySelector('.table-selection-modebar')
}

export function isTableTextFormattingShortcut(event) {
  if (!(event?.ctrlKey || event?.metaKey) || event.altKey) return false
  const key = String(event.key || '').toLowerCase()
  return ['b', 'i', 'u', 'e'].includes(key) || (event.shiftKey && key === 'x')
}
