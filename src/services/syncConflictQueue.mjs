import { conflictRiskSummary, CONFLICT_RISK_FILTERS } from './syncConflictRisk.mjs'
// Search only captured conflict metadata. No body projection, network, mutation
// decision or credential/persistence capability belongs in this module.
export const CONFLICT_QUEUE_PAGE_SIZE = 10
export const CONFLICT_QUEUE_MAX_ITEMS = 50000
export const CONFLICT_QUEUE_FILTERS = Object.freeze([
  ['all', '全部类型'], ['file', '笔记 / 文件夹'], ['tag', '标签'],
  ['file-tag', '标签关联'], ['attachment', '附件'], ['other', '未识别类型'],
].map(Object.freeze))
const MAX_FIELD = 4096
const MAX_INDEX_UNITS = 8 * 1024 * 1024
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' ? value : ''
const idOK = value => typeof value === 'string' && value.trim() && value.length <= MAX_FIELD
const fold = value => value.normalize('NFC').toLowerCase()
const kinds = new Set(['file', 'tag', 'file-tag', 'attachment'])
const label = (record, fallback) => {
  if (!object(record)) return '不存在'
  if (record.state === 'purged') return '已永久删除'
  if (record.kind === 'file') return text(record.file?.title) || fallback
  if (record.kind === 'tag') return text(record.tag?.name) || fallback
  if (record.kind === 'attachment') return text(record.attachment?.name) || fallback
  if (record.kind === 'file-tag') return '标签关联'
  return fallback
}
const recordKind = record => object(record) && kinds.has(record.kind) ? record.kind : null

export function indexConflictQueue(conflicts) {
  const fail = message => Object.freeze({ valid: false, message, total: Array.isArray(conflicts) ? conflicts.length : null,
    entries: Object.freeze([]), counts: null, riskCounts: null })
  if (!Array.isArray(conflicts)) return fail('冲突列表响应无效，不能当作没有冲突。请刷新状态。')
  if (conflicts.length > CONFLICT_QUEUE_MAX_ITEMS) return fail('冲突列表超过 50,000 条，暂不展开；没有截取部分结果或自动处理任何冲突。')
  const seen = new Set(), entries = []
  const counts = { file: 0, tag: 0, 'file-tag': 0, attachment: 0, other: 0 }
  const riskCounts = { attention: 0, permanent: 0, recycled: 0, missing: 0, unknown: 0 }
  let budget = 0
  for (let index = 0; index < conflicts.length; index++) {
    const c = conflicts[index]
    if (!object(c) || !idOK(c.id) || !idOK(c.item_id) || seen.has(c.id)) {
      return fail('冲突列表含无效或重复编号，暂不能处理；请刷新状态重新读取。')
    }
    seen.add(c.id)
    const left = recordKind(c.local_record), right = recordKind(c.remote_record)
    const kind = left && right && left !== right ? 'other' : left || right || 'other'
    const localLabel = label(c.local_record, c.item_id), remoteLabel = label(c.remote_record, c.item_id)
    if (localLabel.length > MAX_FIELD || remoteLabel.length > MAX_FIELD) {
      return fail('冲突名称过长，无法完整核实列表；请刷新状态，没有隐藏截断的处理选项。')
    }
    const search = [c.id, c.item_id, localLabel, remoteLabel].join('\n')
    budget += search.length
    if (budget > MAX_INDEX_UNITS) return fail('冲突名称与编号总量超过检索预算，暂不展开；未删除或处理任何记录。')
    counts[kind]++
    const risk = conflictRiskSummary(c)
    if (risk.attention) riskCounts.attention++
    for (const flag of risk.flags) riskCounts[flag]++
    entries.push(Object.freeze({ id: c.id, itemID: c.item_id, index, kind, localLabel, remoteLabel,
      search: fold(search), open: c.status === 'open', risk }))
  }
  // Preserve server order and original array indices; never sort or retain body
  // snapshots in this secondary index. Repeated item IDs can be distinct lives.
  return Object.freeze({ valid: true, message: '', total: conflicts.length,
    entries: Object.freeze(entries), counts: Object.freeze(counts), riskCounts: Object.freeze(riskCounts) })
}

export function conflictQueuePage(model, { query = '', kind = 'all', risk = 'all', page = 1 } = {}) {
  const filter = CONFLICT_QUEUE_FILTERS.some(([value]) => value === kind) ? kind : 'all'
  const riskFilter = CONFLICT_RISK_FILTERS.some(([value]) => value === risk) ? risk : 'all'
  const needle = fold(text(query).slice(0, 256).trim())
  const matches = (model?.valid ? model.entries : []).filter(entry =>
    (filter === 'all' || entry.kind === filter) &&
    (riskFilter === 'all' || (riskFilter === 'attention' ? entry.risk.attention : entry.risk.flags.includes(riskFilter))) && (!needle || entry.search.includes(needle)))
  const pages = Math.max(1, Math.ceil(matches.length / CONFLICT_QUEUE_PAGE_SIZE))
  const current = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1))
  const start = (current - 1) * CONFLICT_QUEUE_PAGE_SIZE
  return Object.freeze({ rows: Object.freeze(matches.slice(start, start + CONFLICT_QUEUE_PAGE_SIZE)),
    matched: matches.length, total: model?.total ?? null, page: current, pages, kind: filter, risk: riskFilter,
    from: matches.length ? start + 1 : 0, to: Math.min(start + CONFLICT_QUEUE_PAGE_SIZE, matches.length) })
}
