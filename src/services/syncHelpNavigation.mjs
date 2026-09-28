// This index interprets only the existing overview's fixed presentation state.
// It recommends documentation, never checks a provider or authorizes an action.
const topics = Object.freeze({
  'first-use': Object.freeze({ key: 'first-use', label: '首次配置' }),
  operations: Object.freeze({ key: 'operations', label: '检查、预演与执行' }),
  conflicts: Object.freeze({ key: 'conflicts', label: '核对冲突' }),
  recovery: Object.freeze({ key: 'recovery', label: '状态与恢复' }),
})
const byState = Object.freeze({
  disabled: 'first-use', draft: 'first-use', preview: 'operations',
  conflicts: 'conflicts', mismatch: 'conflicts',
})
export function syncHelpRecommendation(state) {
  return topics[typeof state === 'string' && Object.hasOwn(byState, state) ? byState[state] : 'recovery']
}

// Explicit click only. Open and focus the existing native disclosure within
// this exact overview. Preserve other topics, drafts and parent snapshots.
export function focusSyncHelpTopic(root, key) {
  if (typeof key !== 'string' || !Object.hasOwn(topics, key)) return false
  let help, topic, before
  try {
    if (!root?.isConnected || !root.matches('[data-sync-section="overview"]') || root.closest('[hidden],[inert]')) return false
    help = root.querySelector('[data-sync-help]')
    if (!help?.isConnected || help.tagName !== 'DETAILS' || help.parentElement !== root || help.closest('[hidden],[inert]')) return false
    topic = help.querySelector(`[data-sync-help-topic="${key}"]`)
    const summary = topic?.firstElementChild
    if (!topic?.isConnected || topic.tagName !== 'DETAILS' || topic.closest('[data-sync-help]') !== help ||
        topic.closest('[data-sync-section="overview"]') !== root || topic.closest('[hidden],[inert]') ||
        summary?.tagName !== 'SUMMARY' || !summary.isConnected || summary.closest('[hidden],[inert]')) return false
    before = { help: help.open, topic: topic.open }
    help.open = true
    topic.open = true
    summary.focus({ preventScroll: true })
    if (!summary.isConnected || summary.ownerDocument.activeElement !== summary) throw new Error('Help focus unavailable')
    summary.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    return true
  } catch {
    // Restore only the two disclosures we attempted to open. No fallback
    // click, second center, retry, external link or executable control.
    if (before) {
      try { help.open = before.help; topic.open = before.topic } catch { /* DOM may have detached. */ }
    }
    return false
  }
}
