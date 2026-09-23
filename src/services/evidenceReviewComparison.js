import { readReviewArchive } from './evidenceReviewArchiveData.js'
import { reviewRows } from './evidenceReviewReport.js'

export const REVIEW_COMPARISON_FILTERS = [
  { id: 'changed', label: '有变化的章节' },
  { id: 'all', label: '全部章节' },
  { id: 'issues', label: '对照中待修改' },
  { id: 'cleared', label: '取消待修改标记' },
  { id: 'notes', label: '共同章节备注变化' },
  { id: 'scope', label: '范围新增或移出' },
]
export const REVIEW_COMPARISON_KINDS = {
  added: '新增到范围', removed: '移出范围', changed: '记录有变化', unchanged: '记录未变化',
}
export const REVIEW_COMPARISON_STATES = {
  pending: '未核对', changes: '待修改', reviewed: '历史已核对',
}
const FILTER_KEYS = ['source', 'volumeId', 'query']
const metadata = archive => Object.freeze({
  id: archive.id, savedAt: archive.savedAt, entityLabel: archive.data.entityLabel,
  filters: archive.data.filters,
})

// Compare immutable historical metadata, never manuscript text or live review state.
// Chapter identity, not title/ordinal, is the join key. Removed scope is not resolution.
export function compareReviewArchives(before, after) {
  const a = readReviewArchive(JSON.stringify(before))
  const b = readReviewArchive(JSON.stringify(after))
  if (a.id === b.id) throw new Error('请选择两份不同的存档')
  if (a.data.projectId !== b.data.projectId || a.data.entityId !== b.data.entityId) {
    throw new Error('只能对比同一项目、同一实体的存档；不会按名称猜测身份')
  }
  const left = new Map(reviewRows(a.data).map(row => [row.id, Object.freeze(row)]))
  const right = new Map(reviewRows(b.data).map(row => [row.id, Object.freeze(row)]))
  const leftOrder = new Map([...left.keys()].filter(id => right.has(id)).map((id, index) => [id, index]))
  const rightOrder = new Map([...right.keys()].filter(id => left.has(id)).map((id, index) => [id, index]))
  const totals = { total: 0, added: 0, removed: 0, changed: 0, unchanged: 0, common: 0,
    issueAdded: 0, issueCleared: 0, issueRetained: 0, addedWithIssue: 0, removedWithIssue: 0,
    noteChanged: 0, stateChanged: 0, titleChanged: 0, orderChanged: 0, ordinalChanged: 0 }
  // Follow B's order, then append entries missing from B in A's original order.
  const ids = [...right.keys(), ...[...left.keys()].filter(id => !right.has(id))]
  const rows = ids.map(id => {
    const prior = left.get(id) || null
    const next = right.get(id) || null
    const common = Boolean(prior && next)
    const changes = Object.freeze({
      issueAdded: common && prior.state !== 'changes' && next.state === 'changes',
      issueCleared: common && prior.state === 'changes' && next.state !== 'changes',
      noteChanged: common && prior.note !== next.note,
      stateChanged: common && prior.state !== next.state,
      titleChanged: common && prior.title !== next.title,
      orderChanged: common && leftOrder.get(id) !== rightOrder.get(id),
      ordinalChanged: common && prior.ordinal !== next.ordinal,
    })
    const kind = !prior ? 'added' : !next ? 'removed' : Object.values(changes).some(Boolean) ? 'changed' : 'unchanged'
    totals.total += 1; totals[kind] += 1
    if (common) totals.common += 1
    if (common && prior.state === 'changes' && next.state === 'changes') totals.issueRetained += 1
    if (!prior && next.state === 'changes') totals.addedWithIssue += 1
    if (!next && prior.state === 'changes') totals.removedWithIssue += 1
    for (const key of Object.keys(changes)) if (changes[key]) totals[key] += 1
    return Object.freeze({ id, before: prior, after: next, kind, changes })
  })
  return Object.freeze({
    before: metadata(a), after: metadata(b), projectId: a.data.projectId, entityId: a.data.entityId,
    filterChanges: Object.freeze(FILTER_KEYS.filter(key => a.data.filters[key] !== b.data.filters[key])),
    reverseChronology: Date.parse(b.savedAt) < Date.parse(a.savedAt),
    sameTimestamp: b.savedAt === a.savedAt,
    totals: Object.freeze(totals), rows: Object.freeze(rows),
  })
}

export function selectReviewComparisonRows(comparison, { state = 'changed', query = '', page = 1 } = {}) {
  const filter = REVIEW_COMPARISON_FILTERS.some(item => item.id === state) ? state : 'changed'
  const term = typeof query === 'string' ? query.normalize('NFC').trim().toLowerCase() : ''
  const rows = (comparison?.rows || []).filter(row => {
    const matches = filter === 'all' || (filter === 'changed' && row.kind !== 'unchanged') ||
      (filter === 'issues' && row.after?.state === 'changes') ||
      (filter === 'cleared' && row.changes.issueCleared) ||
      (filter === 'notes' && row.changes.noteChanged) ||
      (filter === 'scope' && ['added', 'removed'].includes(row.kind))
    return matches && (!term || [row.id, row.before?.title, row.after?.title, row.before?.note, row.after?.note]
      .some(value => typeof value === 'string' && value.normalize('NFC').toLowerCase().includes(term)))
  })
  const pageCount = Math.max(1, Math.ceil(rows.length / 8))
  const number = Number(page)
  const current = Number.isFinite(number) ? Math.max(1, Math.min(pageCount, Math.floor(number))) : 1
  return { rows: rows.slice((current - 1) * 8, current * 8), total: rows.length, page: current, pageCount }
}

const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\`*_{}\[\]()#+.!|~\-]/g, '\\$&').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
const line = value => escape(value).replace(/[\r\n\u2028\u2029]+/g, ' ')
const sourceLabel = id => ({ all: '全部来源', wiki: 'WikiLink', canonical: '原名', alias: '别名' })[id]
export function reviewComparisonScopeLabel(filters) {
  const volume = filters.volumeId === null ? '全部卷' : filters.volumeId === '' ? '未分卷' : filters.volumeId
  return `${sourceLabel(filters.source)} · ${volume} · 搜索：${filters.query || '无'}`
}
export function buildReviewComparisonReport(comparison, generatedAt = new Date()) {
  if (!comparison?.rows?.length) throw new Error('没有可导出的存档对比')
  const t = comparison.totals
  const lines = ['# 核对存档对比清单', '', '生成时间（UTC）：' + generatedAt.toISOString(),
    '项目 ID：' + line(comparison.projectId), '实体 ID：' + line(comparison.entityId), '',
    '> 本报告只对比两份历史人工记录，不读取正文，不证明问题已修复或当前正文已审核。取消待修改只是标记变化；移出范围不算解决。', '',
  ]
  for (const [key, label] of [['before', '基准 A'], ['after', '对照 B']]) {
    const snapshot = comparison[key]
    lines.push(`## ${label}`, '', '存档 ID：' + line(snapshot.id), '保存时间（UTC）：' + line(snapshot.savedAt),
      '实体标签：' + line(snapshot.entityLabel), '筛选：' + line(reviewComparisonScopeLabel(snapshot.filters)), '')
  }
  if (comparison.filterChanges.length) lines.push('注意：两份存档的来源、卷或搜索条件不同；范围增减可能由筛选变化造成。', '')
  if (comparison.reverseChronology) lines.push('注意：B 的保存时间早于 A，本报告仍按所选 A → B 方向计算。', '')
  if (comparison.sameTimestamp) lines.push('注意：保存时间相同；不能仅凭时间判断先后，本报告按所选 A → B 方向计算。', '')
  lines.push('## 变化汇总', '',
    `共同 ${t.common} 章（变化 ${t.changed}、未变化 ${t.unchanged}）；新增到范围 ${t.added} 章；移出范围 ${t.removed} 章。`,
    `共同章节：新增待修改标记 ${t.issueAdded}；取消待修改标记 ${t.issueCleared}；仍待修改 ${t.issueRetained}；备注变化 ${t.noteChanged}。`,
    `范围新增中待修改 ${t.addedWithIssue}；范围移出中原待修改 ${t.removedWithIssue}。各变化维度可以重叠，不应相加作为章节总数。`, '',
    '以下包含两份存档的全部章节并集，不受界面筛选和分页限制。', '')
  for (const row of comparison.rows) {
    lines.push('## ' + line((row.after || row.before).title), '', '章节 ID：' + line(row.id), '变化：' + REVIEW_COMPARISON_KINDS[row.kind])
    if (row.changes.issueCleared) lines.push('待修改标记被取消，不代表问题已经修复。')
    if (row.changes.orderChanged) lines.push('共同章节的相对次序变化。')
    for (const [key, label] of [['before', 'A'], ['after', 'B']]) {
      const side = row[key]
      if (!side) { lines.push('', `${label}：不在此存档范围内`); continue }
      lines.push('', `${label} 标题：` + line(side.title), `${label} 序号：` + line(side.ordinal),
        `${label} 状态：` + REVIEW_COMPARISON_STATES[side.state], `${label} 备注：`)
      lines.push(...(side.note || '（无备注）').replace(/\r\n?/g, '\n').split(/[\n\u2028\u2029]/u).map(text => '> ' + escape(text)))
    }
    lines.push('')
  }
  return lines.join('\n')
}
