import { sanitizeS3LocalOverviewResult } from '../../electron/s3-local-overview-codec.js'

const labels = Object.freeze({ file: '笔记与文件夹（含回收站）', tag: '标签', 'file-tag': '笔记与标签关联', attachment: '附件' })
export const LOCAL_REPORT_NOTICE = '仅包含已读取的数量与容量，不含正文、文件名、路径或凭据；不是笔记备份、原子快照、远端比较或同步授权。'
const invalid = () => new Error('本地统计或报告时间无效，未生成部分报告。')

// Revalidate the whole observation; never spread caller-controlled fields into
// a file. Generation time is not observation time or a freshness certificate.
export function prepareLocalOverviewReport(summary, now = Date.now()) {
  const checked = sanitizeS3LocalOverviewResult({ success: true, status: 200, code: 'OK', data: summary })
  if (!checked.success || !Number.isSafeInteger(now) || now < 0 || now > 253402300799999) throw invalid()
  const generatedAtUTC = new Date(now).toISOString(), data = checked.data
  const report = { format: 'local-notepad-local-inventory-report', version: 1, generatedAtUTC,
    scope: 'previously-read-local-observation', readOnly: true, completeForPreview: false,
    notice: LOCAL_REPORT_NOTICE, generationTimeIsObservationTime: false,
    records: data.records, recordBytes: data.record_bytes, attachmentBytes: data.attachment_bytes,
    baseItems: data.base_items,
    kinds: data.kinds.map(row => ({ kind: row.kind, records: row.records, recordBytes: row.record_bytes })) }
  const raw = JSON.stringify(report, null, 2) + '\n'
  const text = ['Local-Notepad 本地盘点报告', `报告生成时间（UTC）：${generatedAtUTC}（不是读取完成时间）`,
    `记录合计：${data.records}`, `规范记录容量：${data.record_bytes} B`, `附件正文容量：${data.attachment_bytes} B`,
    `已有共同基线条目：${data.base_items}`,
    ...data.kinds.map(row => `${labels[row.kind]}：${row.records} 项，规范记录 ${row.record_bytes} B`),
    LOCAL_REPORT_NOTICE, '生成报告不会重新盘点；读取后数据可能已经变化。数量和容量也可能透露使用规模，分享前请检查。'].join('\n') + '\n'
  if (new TextEncoder().encode(raw).length > 4096 || new TextEncoder().encode(text).length > 4096) throw invalid()
  return Object.freeze({ raw, text, filename: `Local-Notepad-local-inventory-${generatedAtUTC.replace(/[:.]/g, '-')}.json` })
}

// This is only a download request, not confirmation that a file was saved.
// No API, native read, localStorage, database or remote operation occurs here.
export function requestLocalOverviewDownload(summary) {
  const prepared = prepareLocalOverviewReport(summary)
  const url = URL.createObjectURL(new Blob([prepared.raw], { type: 'application/json;charset=utf-8' }))
  let link
  try {
    link = document.createElement('a'); link.href = url; link.download = prepared.filename; link.hidden = true
    document.body.append(link); link.click()
  } finally {
    try { link?.remove() }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }
  return prepared.filename
}

export const LOCAL_REPORT_COPY_WAIT_MS = 5000
const receipt = code => Object.freeze({ code })
// One actual write at a time, including after its UI is unmounted or its wait
// times out. Otherwise a late write could overwrite a newer copy. The timeout
// ends confirmation waiting, not the OS operation. Never retry automatically.
export function createLocalOverviewClipboard({ write = text => navigator.clipboard.writeText(text),
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id),
  clock = () => performance.now(), reportTime = () => Date.now() } = {}) {
  let active = null
  return Object.freeze({
    copy(summary) {
      if (active) return Promise.resolve(receipt('copy-busy'))
      const task = {}; active = task
      let resolve, timer, timerReady = false, finished = false, started, deadline
      const pending = new Promise(done => { resolve = done })
      const finish = code => {
        if (finished) return
        finished = true
        if (timerReady) { try { cancel(timer) } catch {} }
        resolve(receipt(code))
      }
      const release = () => { if (active === task) active = null }
      const interruption = () => {
        try {
          const at = clock()
          return !Number.isFinite(at) || at < started ? 'copy-unconfirmed'
            : at >= deadline ? 'copy-timeout' : null
        } catch { return 'copy-unconfirmed' }
      }
      const done = ok => {
        try { finish(interruption() || (ok ? 'copied' : 'copy-unconfirmed')) }
        finally { release() }
      }
      let prepared
      try { prepared = prepareLocalOverviewReport(summary, reportTime()) }
      catch { finish('invalid-report'); release(); return pending }
      try {
        started = clock()
        if (!Number.isFinite(started) || started < 0) throw new Error('Invalid clock')
        deadline = started + LOCAL_REPORT_COPY_WAIT_MS
        timer = schedule(() => finish('copy-timeout'), LOCAL_REPORT_COPY_WAIT_MS)
        timerReady = true
        if (finished) { try { cancel(timer) } catch {}; release(); return pending }
        // A delayed timer has not necessarily revoked this operation yet.
        // Recheck before the OS side effect, using the same receipt policy.
        // No write was issued on refusal, so only this unused slot is released.
        const reason = interruption()
        if (reason) { finish(reason); release(); return pending }
        const result = write(prepared.text)
        // A real Clipboard.writeText returns a Promise. An absent/non-thenable
        // receipt cannot establish that the system clipboard changed.
        if (!result || typeof result.then !== 'function') { done(false); return pending }
        Promise.resolve(result).then(() => done(true), () => done(false))
      } catch { done(false) }
      return pending
    },
  })
}

// Shared within this renderer, so closing/reopening Settings cannot launch a
// second clipboard write while the first actual operation remains unresolved.
export const localOverviewClipboard = createLocalOverviewClipboard()
