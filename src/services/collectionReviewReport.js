import { readSearchCollection, compareSearchCollection } from './searchCollections'
import { COLLECTION_STATUS_LABELS } from './collectionReading'

export const MAX_REVIEW_REPORT_BYTES = 8 * 1024 * 1024
const escape = value => String(value).replace(/[&<>"'`\[\]()*_{}#!|\\~\-+\r\n]/g, character => `&#${character.codePointAt(0)};`)
const LIMITATION = '这是元数据复查报告，不是正文备份或语义差异。离开原检索范围不等于删除，额外匹配不等于新建；只表示所注明检查时间的数据。'

export function buildCollectionReviewReport(collection, currentReport) {
  const value = readSearchCollection(JSON.stringify(collection))
  const check = compareSearchCollection(value, currentReport)
  const ids = new Set(value.report.items.map(item => item.id))
  const additional = check.currentReport.items.filter(item => !ids.has(item.id))
  // Explicit schema: no collection storage key/raw, runtime navigation or snippets.
  return {
    format: 'local-notepad-collection-review', version: 1,
    collection: { id: value.id, name: value.name, savedAt: value.savedAt, mode: value.report.mode },
    historicalAt: value.report.exportedAt, checkedAt: check.checkedAt,
    historicalScope: value.report.scope, currentScope: check.currentReport.scope,
    counts: { historical: check.rows.length, ...check.counts, additional: additional.length },
    rows: check.rows, additional, limitation: LIMITATION,
  }
}

export function serializeCollectionReviewReport(collection, currentReport, format = 'markdown') {
  if (!['markdown', 'json'].includes(format)) throw new Error('不支持的复查报告格式')
  const report = buildCollectionReviewReport(collection, currentReport)
  let text
  if (format === 'json') text = JSON.stringify(report, null, 2)
  else {
    const lines = ['# 资料集复查报告', '', `资料集：${escape(report.collection.name)}`,
      `历史检索时间：${report.historicalAt}`, `本次检查时间：${report.checkedAt}`, '',
      `关键词：${escape(report.historicalScope.criteria.query || '（空）')}`,
      `目录：${escape(report.historicalScope.folderLabel)}`,
      `固定条件：${escape(JSON.stringify(report.historicalScope.criteria))}`,
      `历史版本：${report.historicalScope.revision}`, `检查版本：${report.currentScope.revision}`, '',
      `历史 ${report.counts.historical} 篇；未变化 ${report.counts.unchanged}；正文变化 ${report.counts.body}；元数据变化 ${report.counts.metadata}；不在原范围 ${report.counts.outside}；额外匹配 ${report.counts.additional}。`,
      `当前 ${report.currentScope.unsupported} 篇正文格式未能解析；正文匹配可能不完整。`, '', LIMITATION, '',
      '## 全部历史条目', '']
    const metadata = (label, item) => item ? [
      `${label}标题：${escape(item.title || '未命名')}`, `${label}目录：${escape(item.folderPath || '根目录')}`,
      `${label}修改时间（Unix 秒）：${item.updatedAt}；置顶：${item.pinned ? '是' : '否'}；标题命中：${item.titleMatch ? '是' : '否'}；正文命中：${item.bodyOccurrences}`,
      `${label}正文指纹：${item.contentSHA256}`,
    ] : [`${label}：不在本次原范围匹配中，不能据此证明已删除。`]
    report.rows.forEach((row, index) => lines.push(`### ${index + 1}. ${escape(row.before.title || '未命名')}`, '',
      `笔记 ID：${escape(row.id)}`, `状态：${COLLECTION_STATUS_LABELS[row.status]}`,
      `原因：${escape(row.reasons.join('、') || '无已识别差异')}`, ...metadata('历史', row.before), ...metadata('本次', row.current), ''))
    lines.push('## 当前范围额外匹配（不表示新建）', '')
    report.additional.forEach((item, index) => lines.push(`### ${index + 1}. ${escape(item.title || '未命名')}`, '',
      `笔记 ID：${escape(item.id)}`, ...metadata('本次', item), ''))
    text = lines.join('\n') + '\n'
  }
  if (new TextEncoder().encode(text).length > MAX_REVIEW_REPORT_BYTES) throw new Error('复查报告超过 8 MiB，未截断或下载；历史资料集保留')
  return { text, filename: `Local-Notepad-资料集复查-${report.collection.id}.${format === 'json' ? 'json' : 'md'}`,
    type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }
}
export function downloadCollectionReviewReport(output) {
  const url = URL.createObjectURL(new Blob([output.text], { type: output.type }))
  const link = document.createElement('a')
  try { link.href = url; link.download = output.filename; link.hidden = true; document.body.append(link); link.click() }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
