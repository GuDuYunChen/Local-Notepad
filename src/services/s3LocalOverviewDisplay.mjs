import { compareLocalOverviewReport } from './s3LocalOverviewComparison.mjs'

const labels = Object.freeze({ file: '笔记与文件夹（含回收站）', tag: '标签', 'file-tag': '笔记与标签关联', attachment: '附件' })
const metric = (id, label, values, unit) => Object.freeze({ id, label, values, unit })

// Always derive the display from two fully revalidated observations, never
// certify a caller-created delta. All twelve metrics are retained; filtering
// changes only the visible rows, not the comparison, source totals or consent.
export function prepareLocalComparisonDisplay(report, localSummary) {
  const comparison = compareLocalOverviewReport(report, localSummary)
  const totals = Object.freeze([
    metric('records', '记录合计', comparison.records, '项'),
    metric('recordBytes', '规范记录容量', comparison.recordBytes, 'B'),
    metric('attachmentBytes', '附件正文容量', comparison.attachmentBytes, 'B'),
    metric('baseItems', '共同基线条目', comparison.baseItems, '项'),
  ])
  const categories = Object.freeze(comparison.kinds.flatMap(row => [
    metric(`${row.kind}:records`, `${labels[row.kind]} · 数量`, row.records, '项'),
    metric(`${row.kind}:recordBytes`, `${labels[row.kind]} · 规范记录容量`, row.recordBytes, 'B'),
  ]))
  const changedTotals = Object.freeze(totals.filter(row => row.values.delta !== 0))
  const changedCategories = Object.freeze(categories.filter(row => row.values.delta !== 0))
  return Object.freeze({ comparison, totals, categories, changedTotals, changedCategories,
    metricCount: totals.length + categories.length,
    changedCount: changedTotals.length + changedCategories.length })
}
