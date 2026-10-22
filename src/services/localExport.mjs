const phases = new Set(['prepared', 'choosing', 'running', 'cancelling', 'settled'])
const states = new Set(['prepared', 'running', 'completed', 'partial', 'cancelled'])
const statuses = ['ready', 'running', 'succeeded', 'failed', 'cancelled']
const methods = ['Prepare', 'ChooseDirectory', 'Start', 'Status', 'Cancel', 'Retry', 'Reveal', 'Release']
export const LOCAL_EXPORT_LIMIT = 100
const text = (value, max, empty = true) => typeof value === 'string' && value.length <= max && (empty || value.length > 0)
const invalid = () => { throw new Error('桌面导出回执不完整或身份不匹配，请查回结果后再操作。') }

export function localExportBridge(value = globalThis.window?.electronAPI) {
  return value && methods.every(name => typeof value['exportWorkspace' + name] === 'function') ? value : null
}

export function validateExportSelection(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > LOCAL_EXPORT_LIMIT || ids.some(id => !text(id, 256, false)) || new Set(ids).size !== ids.length) {
    throw new Error('每批最多100篇笔记。请选择1–100个不同的笔记或文件夹，再读取预览。')
  }
  return ids.slice()
}

export function validateExportPlan(value, { planId, format, previous } = {}) {
  if (!value || typeof value !== 'object' || !text(value.planId, 128, false) || (planId && value.planId !== planId) ||
      !text(value.requestId, 128, false) || !['markdown', 'docx'].includes(value.format) || (format && value.format !== format) ||
      value.source !== 'saved' || !phases.has(value.phase) || !states.has(value.state) || typeof value.busy !== 'boolean' ||
      value.busy !== ['choosing', 'running', 'cancelling'].includes(value.phase) ||
      !Array.isArray(value.items) || value.items.length < 1 || value.items.length > LOCAL_EXPORT_LIMIT ||
      !text(value.destination || '', 32768) || !value.counts || typeof value.counts !== 'object' ||
      ['canStart', 'canRetry', 'canReveal'].some(name => typeof value[name] !== 'boolean') ||
      (value.canChooseDirectory !== undefined && typeof value.canChooseDirectory !== 'boolean') ||
      (value.message !== undefined && !text(value.message, 4000)) ||
      (value.code !== undefined && !text(value.code, 128, false))) invalid()
  const seen = new Set(), computed = Object.fromEntries(statuses.map(status => [status, 0]))
  for (const item of value.items) {
    if (!item || !text(item.id, 256, false) || seen.has(item.id) || !text(item.title, 4096, false) ||
        !text(item.relativePath, 32768, false) || !text(item.preview, 20000) || !statuses.includes(item.status) ||
        !text(item.message || '', 4000) || !Array.isArray(item.warnings) || item.warnings.length > 100 ||
        item.warnings.some(warning => !text(warning, 4000)) || (item.partialPath !== undefined && !text(item.partialPath, 32768, false))) invalid()
    seen.add(item.id); computed[item.status]++
    if (item.status === 'succeeded' && (!text(item.outputPath, 32768, false) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256 || ''))) invalid()
  }
  if (value.counts.total !== value.items.length || statuses.some(status => value.counts[status] !== computed[status])) invalid()
  if (previous) {
    if (previous.planId !== value.planId || previous.format !== value.format || previous.items.length !== value.items.length) invalid()
    previous.items.forEach((before, index) => {
      const after = value.items[index]
      if (before.id !== after.id || before.title !== after.title || before.relativePath !== after.relativePath || before.preview !== after.preview) invalid()
      if (before.status === 'succeeded' && (after.status !== 'succeeded' || before.outputPath !== after.outputPath || before.bytes !== after.bytes || before.sha256 !== after.sha256)) invalid()
    })
  }
  return value
}

export function exportResult(response, expected) {
  if (response?.success !== true) throw new Error(text(response?.message, 4000, false) ? response.message : '本次导出操作没有完成，请查回结果或重试。')
  return validateExportPlan(response.plan, expected)
}

export function localExportRequest(operation, timeout = 65000) {
  let timer
  const request = Promise.resolve().then(operation).catch(cause => {
    // A rejected IPC promise has no authoritative native receipt. Treat it as an
    // unknown outcome; callers must query/reuse the same idempotency identity.
    const error = new Error(cause?.message || '桌面导出响应连接中断，请查回结果后再操作。')
    error.code = 'local-export-response-lost'
    throw error
  })
  return Promise.race([
    request,
    new Promise((_, reject) => { timer = setTimeout(() => {
      const error = new Error('等待桌面导出响应超时。请先查回结果，避免重复操作。')
      error.code = 'local-export-request-timeout'
      reject(error)
    }, timeout) }),
  ]).finally(() => clearTimeout(timer))
}

export const exportStatusLabels = Object.freeze({ ready: '等待导出', running: '正在导出', succeeded: '已导出', failed: '导出失败', cancelled: '已停止' })
