import { hasLocalReportFileDrag } from './s3LocalReportDrop.mjs'
import { selectOfflinePairFiles } from './s3OfflinePairBatch.mjs'

export const OFFLINE_BATCH_DROP_MESSAGES = Object.freeze({
  'batch-file-required': '请同时拖入两份统计 JSON，不接受文字或链接；现有选择未改变。',
  'batch-count': '此区域一次需要恰好两份报告；单份请使用下方 A / B 区域。现有选择未改变。',
  'batch-size': '每份报告必须非空且不超过 4 KiB；现有选择未改变。',
  'batch-directory': '不读取文件夹；请拖入两份统计 JSON，现有选择未改变。',
  'batch-unavailable': '未能取得两份文件，请使用文件选择按钮；现有选择未改变。',
})
const refused = code => Object.freeze({ code, files: null })
// Drop metadata only. Preserve the native list order without inspecting names,
// paths or contents. Optional directory entries are never traversed.
export function selectOfflineBatchDrop(transfer) {
  try {
    if (!hasLocalReportFileDrag(transfer)) return refused('batch-file-required')
    const selected = selectOfflinePairFiles(transfer.files)
    if (!selected.files) return refused(selected.code === 'pair-size' ? 'batch-size'
      : selected.code === 'pair-unavailable' ? 'batch-unavailable' : 'batch-count')
    const items = transfer.items
    if (items != null) {
      if (!Number.isSafeInteger(items.length) || items.length < 0 || items.length > 16) return refused('batch-unavailable')
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item?.kind === 'file' && typeof item.webkitGetAsEntry === 'function' &&
            item.webkitGetAsEntry()?.isDirectory === true) return refused('batch-directory')
      }
    }
    return Object.freeze({ code: 'batch-selected', files: selected.files })
  } catch { return refused('batch-unavailable') }
}

export function createOfflineBatchDrop({ isActive, onFiles, onFeedback, onHighlight }) {
  let depth = 0
  const contain = event => { event.preventDefault(); event.stopPropagation() }
  const hover = event => {
    const allowed = hasLocalReportFileDrag(event.dataTransfer)
    if (!isActive()) return false
    if (!allowed) depth = 0
    onHighlight(allowed); onFeedback(allowed ? '' : 'batch-file-required')
    try { event.dataTransfer.dropEffect = allowed ? 'copy' : 'none' } catch {}
    return allowed
  }
  return Object.freeze({
    enter(event) { contain(event); if (isActive() && hover(event)) depth++ },
    over(event) { contain(event); if (isActive()) hover(event) },
    leave(event) { contain(event); if (isActive()) { depth = Math.max(0, depth - 1); if (!depth) onHighlight(false) } },
    end(event) { contain(event); depth = 0; if (isActive()) onHighlight(false) },
    drop(event) {
      contain(event)
      if (!isActive()) return
      depth = 0; onHighlight(false)
      const result = selectOfflineBatchDrop(event.dataTransfer)
      if (!isActive()) return
      if (!result.files) { onFeedback(result.code); return }
      onFeedback('')
      if (isActive()) onFiles(result.files)
    },
  })
}
