// Read only native drag metadata until drop. File contents, names and paths
// are never read here; the existing bounded FileReader is still authoritative.
export const LOCAL_REPORT_DROP_MESSAGES = Object.freeze({
  'drop-file-required': '请拖入一份统计 JSON 文件，不接受文字或链接；现有视图未改变。',
  'drop-one-file': '一次只能拖入一份报告，请重新选择；现有视图未改变。',
  'drop-directory': '不读取文件夹，请拖入单个统计 JSON 文件；现有视图未改变。',
  'drop-unavailable': '未能取得拖入的文件，请使用文件选择按钮；现有视图未改变。',
})
const refuse = code => Object.freeze({ code, file: null })
export function hasLocalReportFileDrag(transfer) {
  try { return Array.from(transfer?.types || []).includes('Files') }
  catch { return false }
}
export function selectLocalReportDrop(transfer) {
  try {
    const files = transfer?.files, count = files?.length
    if (count === 0) return refuse('drop-file-required')
    if (!Number.isSafeInteger(count) || count < 0) return refuse('drop-unavailable')
    if (count !== 1) return refuse('drop-one-file')
    // Directory metadata is optional across browsers. Do not traverse entries,
    // resolve paths or invent file data when the browser omits that metadata.
    const items = transfer.items
    if (items !== undefined && items !== null) {
      if (!Number.isSafeInteger(items.length) || items.length < 0 || items.length > 16) return refuse('drop-unavailable')
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item?.kind === 'file' && typeof item.webkitGetAsEntry === 'function') {
          const entry = item.webkitGetAsEntry()
          if (entry?.isDirectory === true) return refuse('drop-directory')
        }
      }
    }
    const file = files[0]
    return file ? Object.freeze({ code: 'drop-selected', file }) : refuse('drop-unavailable')
  } catch { return refuse('drop-unavailable') }
}
