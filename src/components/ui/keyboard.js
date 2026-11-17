// Only the shared Select owns a separately dismissible popup. Other expanded
// comboboxes (for example the command palette query) keep their dialog policy.
export function selectOwnsEscape(event, scope) {
  if (event.key !== 'Escape') return false
  const field = event.target?.closest?.('[data-ui-control="select"] [role="combobox"][aria-expanded="true"]')
  return Boolean(field && scope?.contains(field))
}
