import { readLocalOverviewFile, LOCAL_REPORT_FILE_BYTES } from './s3LocalOverviewFile.mjs'

export const OFFLINE_BATCH_NOTICE = '按文件选择器返回顺序分配：第一份为 A，第二份为 B，不代表时间先后；两份都校验通过后才一起替换，仍需手动确认比较 B − A。'
const rejected = code => Object.freeze({ code, files: null })
export function selectOfflinePairFiles(files) {
  try {
    const count = files?.length
    if (count === 0) return rejected('pair-cancelled')
    if (count !== 2) return rejected('pair-count')
    const a = files[0], b = files[1]
    for (const file of [a, b]) {
      const size = file?.size
      if (!Number.isSafeInteger(size) || size < 1 || size > LOCAL_REPORT_FILE_BYTES) return rejected('pair-size')
    }
    return Object.freeze({ code: 'pair-selected', files: Object.freeze([a, b]) })
  } catch { return rejected('pair-unavailable') }
}
const fail = code => Object.assign(new Error('两份报告未能完整读取，本次未采用任何新报告。'), { code })

// One caller-owned batch, two existing bounded readers. No partial result,
// filenames/paths, retries, persistence, native scans or implicit comparison.
export async function readOfflinePairFiles(files, { signal, read = readLocalOverviewFile } = {}) {
  const selection = selectOfflinePairFiles(files)
  if (!selection.files) throw fail(selection.code)
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw fail('pair-unavailable')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    if (signal?.aborted) { abort(); throw fail('pair-aborted') }
    const results = await Promise.all(selection.files.map(file => Promise.resolve().then(() => {
      if (controller.signal.aborted) throw fail('pair-aborted')
      try { return read(file, { signal: controller.signal }) }
      catch (error) { abort(); throw error }
    })))
    if (controller.signal.aborted) throw fail('pair-aborted')
    return Object.freeze({ a: results[0], b: results[1] })
  } catch {
    const cancelled = signal?.aborted
    abort() // Cancel any owned sibling; its late result can never be adopted.
    throw fail(cancelled ? 'pair-aborted' : 'pair-read-failed')
  } finally { signal?.removeEventListener('abort', abort) }
}
