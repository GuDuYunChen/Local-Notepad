// Deliberately window-only. Navigating away never silently destroys an unsaved
// annotation, but this cache is not crash recovery or a substitute for Save.
const drafts = new Map()
const warn = event => { if (drafts.size) { event.preventDefault(); event.returnValue = '' } }
let listening = false
function syncWarning() {
  if (!globalThis.window) return
  if (drafts.size && !listening) { window.addEventListener('beforeunload', warn); listening = true }
  if (!drafts.size && listening) { window.removeEventListener('beforeunload', warn); listening = false }
}
export const studyDraftKey = (snapshot, id) => JSON.stringify([snapshot.key, snapshot.data.reportSHA256, id])
export const collectionStudyDrafts = {
  get: key => drafts.get(key),
  list: () => [...drafts].map(([key, draft]) => ({ key, draft })),
  set(key, draft) {
    if (!drafts.has(key) && drafts.size >= 64) throw new Error('当前窗口已有 64 份未保存批注，请先保存或导出；未自动丢弃任何草稿')
    drafts.set(key, Object.freeze(draft)); syncWarning()
  },
  remove(key, expected) {
    if (expected && drafts.get(key) !== expected) return false
    drafts.delete(key); syncWarning(); return true
  },
}
