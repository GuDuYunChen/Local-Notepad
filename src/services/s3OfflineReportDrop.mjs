import { hasLocalReportFileDrag, selectLocalReportDrop } from './s3LocalReportDrop.mjs'

// One side, metadata-only hover, and no file I/O. The caller owns its existing
// bounded reader. Always contain the event before inspecting drag metadata.
export function createOfflineReportDrop({ isActive, onFile, onFeedback, onHighlight }) {
  let depth = 0
  const contain = event => { event.preventDefault(); event.stopPropagation() }
  const highlight = value => onHighlight(value)
  const hover = event => {
    const allowed = hasLocalReportFileDrag(event.dataTransfer)
    if (!allowed) depth = 0
    highlight(allowed)
    onFeedback(allowed ? '' : 'drop-file-required')
    try { event.dataTransfer.dropEffect = allowed ? 'copy' : 'none' } catch {}
    return allowed
  }
  return Object.freeze({
    enter(event) {
      contain(event)
      if (isActive() && hover(event)) depth++
    },
    over(event) { contain(event); if (isActive()) hover(event) },
    leave(event) {
      contain(event)
      if (!isActive()) return
      depth = Math.max(0, depth - 1)
      if (!depth) highlight(false)
    },
    end(event) { contain(event); depth = 0; if (isActive()) highlight(false) },
    drop(event) {
      contain(event)
      if (!isActive()) return
      depth = 0; highlight(false)
      const selected = hasLocalReportFileDrag(event.dataTransfer)
        ? selectLocalReportDrop(event.dataTransfer) : { code: 'drop-file-required', file: null }
      if (!isActive()) return // Metadata inspection cannot authorize a stale side.
      if (!selected.file) { onFeedback(selected.code); return }
      onFeedback('')
      onFile(selected.file)
    },
  })
}
