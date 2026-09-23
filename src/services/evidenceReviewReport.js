// User-authored review metadata only. Never import or serialize chapter content.
export const MAX_REVIEW_NOTE_LENGTH = 2000
export const REVIEW_STATES = [
  { id: 'all', label: '全部章节' },
  { id: 'pending', label: '未核对' },
  { id: 'changes', label: '待修改' },
  { id: 'reviewed', label: '已核对' },
  { id: 'noted', label: '有备注' },
]

export function getReviewAnnotation(session, id) {
  return session?.annotations && Object.hasOwn(session.annotations, id)
    ? session.annotations[id] : null
}
export function hasReviewAnnotations(session) {
  return Object.values(session?.annotations || {}).some(note => note.text || note.needsChanges)
}
export function reviewRows(session) {
  const reviewed = new Set(session?.reviewedIds || [])
  return (session?.chapters || []).map(chapter => {
    const note = getReviewAnnotation(session, chapter.id)
    return { id: chapter.id, title: chapter.title, ordinal: chapter.ordinal,
      state: note?.needsChanges ? 'changes' : reviewed.has(chapter.id) ? 'reviewed' : 'pending',
      note: note?.text || '' }
  })
}
export function reviewTotals(rows) {
  return rows.reduce((total, row) => {
    total.total += 1
    total[row.state] += 1
    if (row.note) total.noted += 1
    return total
  }, { total: 0, pending: 0, changes: 0, reviewed: 0, noted: 0 })
}
export function selectReviewRows(rows, { state = 'all', query = '', page = 1 } = {}) {
  const term = String(query).normalize('NFC').trim().toLowerCase()
  const selected = rows.filter(row => (
    (state === 'all' || (state === 'noted' ? Boolean(row.note) : row.state === state)) &&
    (!term || [row.title, row.note].some(text => text.normalize('NFC').toLowerCase().includes(term)))
  ))
  const pageCount = Math.max(1, Math.ceil(selected.length / 8))
  const requested = Number(page)
  const current = Number.isFinite(requested) ? Math.max(1, Math.min(pageCount, Math.floor(requested))) : 1
  return { rows: selected.slice((current - 1) * 8, current * 8), total: selected.length, page: current, pageCount }
}
export function nextUnreviewedChapter(session, currentId) {
  const rows = reviewRows(session)
  const current = rows.findIndex(row => row.id === currentId)
  if (current < 0) return null
  // Wrap at most once; do not navigate to the current chapter again.
  for (let step = 1; step < rows.length; step++) {
    const row = rows[(current + step) % rows.length]
    if (row.state !== 'reviewed') return row
  }
  return null
}

const stateLabel = state => REVIEW_STATES.find(item => item.id === state)?.label || '未核对'
function escapeMarkdown(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~\-]/g, '\\$&')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}
const line = value => escapeMarkdown(value).replace(/[\r\n\u2028\u2029]+/g, ' ')
export function buildEvidenceReviewReport(session, generatedAt = new Date()) {
  if (!session?.chapters?.length) throw new Error('没有可导出的核对清单')
  const rows = reviewRows(session)
  const totals = reviewTotals(rows)
  const source = { all: '全部来源', wiki: 'WikiLink', canonical: '原名', alias: '别名' }[session.filters.source]
  const lines = [
    '# 正文证据核对清单', '',
    '生成时间（UTC）：' + generatedAt.toISOString(),
    '项目 ID：' + line(session.projectId),
    '实体：' + line(session.entityLabel || session.entityId),
    '实体 ID：' + line(session.entityId),
    '进入时来源：' + source,
    '进入时卷范围：' + (session.filters.volumeId === null ? '全部卷' : session.filters.volumeId === '' ? '未分卷' : line(session.filters.volumeId)),
    '进入时搜索：' + (line(session.filters.query) || '无'), '',
    `共 ${totals.total} 章；已核对 ${totals.reviewed} 章；未核对 ${totals.pending} 章；待修改 ${totals.changes} 章；有备注 ${totals.noted} 章。`, '',
    '> 本清单是本轮人工记录，不是关系成立证明或永久校对结论。范围和标题来自进入时快照，未重新读取正文，不包含正文节选；备注为用户填写。', '',
  ]
  for (const row of rows) {
    lines.push(`## ${line(row.ordinal)} · ${line(row.title)}`, '', '章节 ID：' + line(row.id), '状态：' + stateLabel(row.state))
    if (row.note) lines.push('', '备注：', ...row.note.replace(/\r\n?/g, '\n').split(/[\n\u2028\u2029]/u).map(text => '> ' + escapeMarkdown(text)))
    lines.push('')
  }
  return lines.join('\n')
}
export function downloadEvidenceReviewReport(session) {
  const date = new Date()
  const body = buildEvidenceReviewReport(session, date)
  const blob = new Blob(['\ufeff', body], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    const label = Array.from(session.entityLabel || '实体').slice(0, 50).join('').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    link.href = url
    link.download = '核对清单-' + label + '-' + date.toISOString().slice(0, 10) + '.md'
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
