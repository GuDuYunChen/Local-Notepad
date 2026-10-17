// Select visible, already-rendered identifier text only. No clipboard API,
// execCommand, file/HTTP access, persistence, or delayed work is used here.
const ownsSelection = (node, selection) => selection?.rangeCount === 1 &&
  !!selection.anchorNode && !!selection.focusNode &&
  node.contains(selection.anchorNode) && node.contains(selection.focusNode)
const selectionFor = node => node.ownerDocument.defaultView.getSelection()

export function selectHistoryFileIdentifier(node) {
  try {
    if (!node || node.nodeName !== 'CODE' || !node.isConnected ||
        !node.hasAttribute('data-history-file-selectable-id') || !node.textContent) return false
    const selection = selectionFor(node)
    if (!selection) return false
    const range = node.ownerDocument.createRange()
    // The code node excludes its label, button, and every other record/field.
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
    return ownsSelection(node, selection) && selection.toString() === node.textContent
  } catch { return false } // A denied/unsupported selection is not a copy receipt.
}

export function clearHistoryFileIdentifierSelection(node) {
  try {
    if (!node) return false
    const selection = selectionFor(node)
    // Never clear a user's selection in a different control or document area.
    if (!ownsSelection(node, selection)) return false
    selection.removeAllRanges()
    return true
  } catch { return false }
}
