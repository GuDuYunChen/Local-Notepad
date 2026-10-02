// The caller invokes this only after an explicit "do not save" decision.
// It is synchronous: refuse a pending write rather than navigating while its
// outcome is unknown, aborting it, or attempting to roll it back.
export function discardEditorDraft({ id, ready, content, saved, pending }, registry, reset) {
  if (!id || ready !== true || typeof content !== 'string' || typeof saved !== 'string' ||
      !Array.isArray(pending) || pending.length || typeof reset !== 'function') return false
  if (registry.discard(id, content) !== true) return false
  reset(saved)
  return true
}

// Editor initialization and undo-to-baseline can emit onChange without leaving
// any unsaved content. A pending older write still forbids a clean observation.
export function observeEditorDraft(registry, id, content, saved, hasPendingWrite) {
  if (!id) return
  registry.remember(id, content)
  if (!hasPendingWrite && content === saved) registry.saved(id, content)
}
