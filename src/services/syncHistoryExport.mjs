import { normalizeHistoryTimeFilter } from './syncHistoryTime.mjs'
import { historyOutcome, historyTime } from './syncConflictHistory.mjs'
import { selectHistoryRecords } from './syncHistorySearch.mjs'

export const HISTORY_EXPORT_LIMIT = 2000
export const HISTORY_EXPORT_BYTES = 4 * 1024 * 1024
const text = (value, max) => typeof value === 'string' && value.length <= max * 2 && [...value].length <= max
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799

// Capture one already-loaded selection. No new reads, stored queries, raw
// responses, historical bodies, cursors or credentials enter the report.
export function prepareHistoryExport({ snapshot, query = '', kind = 'all', outcome = 'all', phase, composing = false, timeFilter }, now = new Date()) {
  if (composing) throw new Error('请先完成输入法选字，再导出已确认的筛选结果。')
  if (phase === 'loading') throw new Error('正在读取记录，请等待读取完成或停止读取后再导出。')
  if (!snapshot || !['ready', 'error', 'stopped'].includes(phase)) throw new Error('请先读取历史记录。')
  if (!['all', 'resolved', 'superseded'].includes(snapshot.filter) || typeof snapshot.hasMore !== 'boolean') throw new Error('历史记录范围无效，未生成文件。')
  const completedDateUTC = normalizeHistoryTimeFilter(timeFilter)
  const dated = completedDateUTC.mode !== 'all'
  const selected = selectHistoryRecords(snapshot.items, { query, kind, outcome, timeFilter: completedDateUTC })
  if (!selected.matched) throw new Error('当前没有可导出的匹配记录。')
  if (selected.matched > HISTORY_EXPORT_LIMIT) throw new Error(`单次最多导出 ${HISTORY_EXPORT_LIMIT} 条，请缩小筛选范围；不会截断记录。`)
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('导出时间无效。')
  const ids = new Set()
  const records = selected.items.map(row => {
    if (!text(row.id, 128) || !row.id || /[\0\r\n]/.test(row.id) || ids.has(row.id) ||
        !text(row.itemID, 2048) || !row.itemID || !text(row.title, 255) ||
        !['file', 'tag', 'file-tag', 'attachment'].includes(row.kind) ||
        !['resolved', 'superseded'].includes(row.status) ||
        (snapshot.filter !== 'all' && row.status !== snapshot.filter) ||
        !['local', 'remote', 'remote-rebind', 'unknown'].includes(row.resolution) ||
        !time(row.createdAt) || !time(row.resolvedAt)) throw new Error('历史记录格式无效，未生成部分文件。')
    ids.add(row.id)
    return { id: row.id, itemID: row.itemID, kind: row.kind, currentTitle: row.title,
      createdAtUTC: historyTime(row.createdAt) || null, completedAtUTC: historyTime(row.resolvedAt) || null,
      status: row.status, resolution: row.resolution, outcome: historyOutcome(row) }
  })
  const exportedAtUTC = now.toISOString()
  const report = {
    format: 'local-notepad-conflict-history', version: dated ? 2 : 1, exportedAtUTC,
    scope: { type: 'loaded-filtered-history', loadedCount: selected.loaded, exportedCount: records.length,
      hasUnreadOlderRecords: snapshot.hasMore, sourceState: phase, currentRemoteStateVerified: false },
    filters: { recordStatus: snapshot.filter, objectType: kind, outcome,
      textFilterApplied: Boolean(query.trim()), ...(dated ? { completedDateUTC } : {}) },
    notices: [
      ...(dated ? [completedDateUTC.mode === 'missing' ? '仅导出处理或失效时间缺失的记录；时间缺失不代表未处理。' : '处理日期筛选按 UTC 日历日，包含结束当日；日期范围不含时间缺失记录。'] : []),
      '仅导出点击时已经读取、符合当前筛选的记录；不是全部历史或笔记备份。',
      '当前标题仅供辨认，不是历史标题或历史正文；已失效不等于已解决。',
      '可能包含旧同步目标记录；历史选边不保证当前仍是该版本，不证明两端一致。',
      '包含当前标题、对象标识和记录标识；不包含正文、查找词、分页游标或凭据。',
      ...(phase === 'error' ? ['最近读取失败，本文件使用上次成功读取的记录。'] : []),
      ...(phase === 'stopped' ? ['最近读取已停止，本文件使用此前已读取的记录。'] : []),
    ], records,
  }
  const raw = JSON.stringify(report, null, 2) + '\n'
  if (new TextEncoder().encode(raw).length > HISTORY_EXPORT_BYTES) throw new Error('文件超过 4 MiB，请缩小筛选范围；未生成部分文件。')
  return Object.freeze({ raw, count: records.length,
    filename: `Local-Notepad-冲突历史-${exportedAtUTC.replace(/[:.]/g, '-')}.json` })
}

// Like other browser downloads in this app, this acknowledges a REQUEST only.
// It cannot confirm a selected filesystem path or whether the user cancelled.
export function requestHistoryDownload(prepared) {
  const url = URL.createObjectURL(new Blob([prepared.raw], { type: 'application/json;charset=utf-8' }))
  let link
  try {
    link = document.createElement('a')
    link.href = url; link.download = prepared.filename; link.hidden = true
    document.body.append(link); link.click()
  } finally {
    link?.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return prepared.filename
}
