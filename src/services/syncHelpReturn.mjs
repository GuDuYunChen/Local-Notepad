// Return to current on-screen guidance, never to an executable control or a
// cached status. The caller supplies only its own mounted overview element.
export function focusSyncCurrentGuidance(root) {
  try {
    if (!root?.isConnected || !root.matches('[data-sync-section="overview"]') ||
        root.closest('[hidden],[inert]')) return false
    const target = root.querySelector('[data-sync-guidance]')
    if (!target?.isConnected || target.tagName !== 'DIV' || target.parentElement !== root ||
        target.closest('[data-sync-section="overview"]') !== root ||
        target.closest('[hidden],[inert]') || target.getAttribute('tabindex') !== '-1' ||
        target.getAttribute('role') !== 'region') return false
    target.focus({ preventScroll: true })
    // A focus listener may unmount or reparent the target synchronously.
    if (!root.isConnected || !target.isConnected || target.parentElement !== root ||
        target.closest('[data-sync-section="overview"]') !== root ||
        target.ownerDocument.activeElement !== target) return false
    target.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    return true
  } catch {
    // No fallback click, alternate instance, disclosure change or IO.
    return false
  }
}
