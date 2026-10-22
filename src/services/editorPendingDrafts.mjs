// Unapplied block fields belong to one mounted editor. They are not a second
// document body or a successful save receipt; normal body autosave stays intact.
export function createEditorPendingDrafts() {
  const entries = new Map()
  const listeners = new Set()
  let revision = 0

  const capture = () => Object.freeze({
    revision,
    drafts: Object.freeze([...entries].flatMap(([token, read]) => {
      const value = read()
      return value?.dirty ? [Object.freeze({ token, label: value.label, value: value.value })] : []
    })),
  })
  const notify = () => {
    revision += 1
    for (const listener of [...listeners]) listener()
  }
  const matches = (reviewed, current) => reviewed?.revision === current.revision &&
    Array.isArray(reviewed.drafts) && reviewed.drafts.length === current.drafts.length &&
    reviewed.drafts.every((item, index) => item.token === current.drafts[index].token &&
      item.value === current.drafts[index].value && item.label === current.drafts[index].label)

  return {
    capture,
    hasPending: () => capture().drafts.length > 0,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    register(token, read) {
      entries.set(token, read)
      notify()
      return () => { if (entries.get(token) === read) { entries.delete(token); notify() } }
    },
    changed: notify,
    discard(reviewed) {
      const current = capture()
      if (!matches(reviewed, current)) return false
      const pending = current.drafts.map(item => entries.get(item.token)?.())
      if (pending.some(item => typeof item?.discard !== 'function')) return false
      try { for (const item of pending) item.discard() }
      catch { notify(); return false }
      notify()
      return !capture().drafts.length
    },
  }
}
