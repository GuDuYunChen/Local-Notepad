export const LOCAL_EXPORT_LIMITS = Object.freeze({
  roots: 100, notes: 100, metadata: 10000, pageSize: 200, depth: 64, nodes: 20000,
  contentBytes: 2 * 1024 * 1024, batchContentBytes: 8 * 1024 * 1024,
  assetBytes: 16 * 1024 * 1024, batchAssetBytes: 64 * 1024 * 1024, assets: 100,
  outputBytes: 32 * 1024 * 1024, responseBytes: 4 * 1024 * 1024,
  timeoutMs: 60000, requestTimeoutMs: 10000,
})

export class LocalExportError extends Error {
  constructor(code, message) { super(message); this.name = 'LocalExportError'; this.code = code }
}

export function checkExportOperation(signal, deadline, now = Date.now()) {
  if (signal?.aborted) throw new LocalExportError('cancelled', '已停止；未开始的笔记不会继续导出。')
  if (!Number.isFinite(deadline) || now >= deadline) throw new LocalExportError('timeout', '本次导出超过 60 秒，已停止；已确认的结果保留。')
}

export function exportName(value, fallback = '未命名') {
  let text = String(value || fallback).normalize('NFC')
    .replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').trim()
  if (!text || /^\.+$/.test(text)) text = fallback
  if (/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(text)) text = '_' + text
  return [...text].slice(0, 80).join('')
}

export const exportStem = title => exportName(String(title || '').replace(/\.[^./\\]+$/, ''))

export function assertExportId(id) {
  if (typeof id !== 'string' || !id || id.length > 200 || /[\x00-\x1f\x7f/\\?#]/.test(id)) {
    throw new LocalExportError('invalid-request', '所选笔记标识无效，请重新选择。')
  }
  return id
}
