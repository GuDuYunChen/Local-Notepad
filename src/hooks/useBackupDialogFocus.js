import { useLayoutEffect, useRef } from 'react'

const controls = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]'
function visible(element) {
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert')) return false
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (node.tagName === 'DETAILS' && !node.open) {
      const summary = [...node.children].find(child => child.tagName === 'SUMMARY')
      if (!summary?.contains(element)) return false
    }
  }
  return true
}
function focusable(dialog) {
  return [...dialog.querySelectorAll(controls)].filter(node => !node.disabled && node.tabIndex >= 0 && visible(node))
}

// Own the backup dialog's keyboard scope, including its existing nested confirmations.
// Do not change the semantics or keyboard handling of other application dialogs.
export default function useBackupDialogFocus(overlayRef, dialogRef, headingRef, onClose) {
  const close = useRef(onClose)
  close.current = onClose
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const dialog = dialogRef.current
    if (!overlay || !dialog) return undefined
    const previous = document.activeElement
    const inert = []
    for (let node = overlay; node?.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node) continue
        inert.push([sibling, sibling.getAttribute('inert')])
        sibling.setAttribute('inert', '')
      }
    }
    const activeDialog = () => [...overlay.querySelectorAll('[role="dialog"]')].filter(visible).at(-1) || dialog
    headingRef.current?.focus({ preventScroll: true })
    const focusInside = () => {
      const scope = activeDialog()
      if (!scope.contains(document.activeElement)) {
        const target = scope === dialog ? headingRef.current : focusable(scope)[0]
        target?.focus({ preventScroll: true })
      }
    }
    const keydown = event => {
      if (event.isComposing || event.keyCode === 229) return
      // These shortcuts otherwise reach App and change the workspace behind the modal.
      if (((event.ctrlKey || event.metaKey) && ['s', 'k', '/'].includes(event.key.toLowerCase())) ||
        ['F1', 'F2', 'F11'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); return
      }
      const scope = activeDialog()
      if (event.key === 'Escape' && scope === dialog) {
        event.preventDefault(); event.stopImmediatePropagation(); close.current?.(); return
      }
      if (event.key !== 'Tab') return
      const items = focusable(scope)
      const index = items.indexOf(document.activeElement)
      if (!items.length) { event.preventDefault(); return }
      if (index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
        event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusInside)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusInside)
      for (const [node, value] of inert) {
        if (value === null) node.removeAttribute('inert')
        else node.setAttribute('inert', value)
      }
      const target = previous?.isConnected && previous !== document.body ? previous :
        document.querySelector('[aria-label="更多功能"]')
      if (target && visible(target)) target.focus({ preventScroll: true })
    }
  }, [overlayRef, dialogRef, headingRef])
}
