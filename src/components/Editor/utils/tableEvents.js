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

// Selection ownership changes synchronously, before React paints the modebar.
// It is scoped to the editor, not to DOM classes or a neighbouring editor.
const tableSelectionOwners = new WeakMap()
function tableSelectionOwner(editor) {
  let owner = tableSelectionOwners.get(editor)
  if (!owner) { owner = { active: false, epoch: 0 }; tableSelectionOwners.set(editor, owner) }
  return owner
}

export function setTableSelectionActive(editor, active) {
  const owner = tableSelectionOwner(editor)
  if (owner.active !== active) { owner.active = active; owner.epoch += 1 }
}

export function isTableSelectionActive(editor) {
  return !!editor && !!tableSelectionOwners.get(editor)?.active
}

// Queued work inside bulk selection belongs to that exact mode session.
// Changing selected cells does not end it, but leaving and re-entering does.
export function captureTableSelectionSession(editor) {
  const owner = tableSelectionOwner(editor), epoch = owner.epoch, startedActive = owner.active
  return () => startedActive && owner.active && owner.epoch === epoch
}

// Session persistence reads the suspended caret without making it writable.
// The owner validates the original nodes in the caller's editor-state read.
export function registerTableSelectionSessionRange(editor, readRange) {
  const owner = tableSelectionOwner(editor)
  owner.readSessionRange = readRange
  return () => { if (owner.readSessionRange === readRange) owner.readSessionRange = null }
}

export function getTableSelectionSessionRange(editor) {
  const owner = tableSelectionOwners.get(editor)
  return owner?.active ? owner.readSessionRange?.() ?? null : null
}

// A pending insertion must not revive after the user enters bulk selection
// and later leaves it. Document/editability validity is checked by its caller.
export function captureTableSelectionWrite(editor) {
  const owner = tableSelectionOwner(editor), epoch = owner.epoch, startedActive = owner.active
  return () => !startedActive && !owner.active && owner.epoch === epoch
}

export function isTableTextFormattingShortcut(event) {
  if (!(event?.ctrlKey || event?.metaKey) || event.altKey) return false
  const key = String(event.key || '').toLowerCase()
  return ['b', 'i', 'u', 'e'].includes(key) || (event.shiftKey && key === 'x')
}
