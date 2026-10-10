import { prepareLocalComparisonDisplay } from './s3LocalOverviewDisplay.mjs'

export const COMPARISON_EXPORT_LIMIT = 16 * 1024
export const COMPARISON_EXPORT_NOTICE = '仅导出已确认的数量与容量比较，不会重新盘点；未验证同一工作区，数值相同不代表内容相同，不是笔记备份或同步授权。数量和容量可能透露使用规模，分享前请检查。'
const invalid = () => new Error('无法生成完整比较报告，未导出部分数据。')
const csvCell = value => typeof value === 'number' ? String(value) : `"${String(value).replace(/"/g, '""')}"`

// Capture one detached, immutable comparison when the user confirms it. Both
// the displayed rows and every later export use that exact observation. No
// caller-created deltas, file names, paths or record bodies enter the output.
// Filtering is intentionally absent: export always retains all twelve rows.
export function createLocalComparisonExport(report, localSummary) {
  const display = prepareLocalComparisonDisplay(report, localSummary)
  const rows = Object.freeze([...display.totals, ...display.categories])
  function prepare(format, now = Date.now()) {
    if ((format !== 'json' && format !== 'csv') || !Number.isSafeInteger(now) ||
        now < 0 || now > 253402300799999) throw invalid()
    const generatedAtUTC = new Date(now).toISOString()
    const referenceGeneratedAtUTC = display.comparison.reportGeneratedAtUTC
    const metrics = rows.map(row => ({ id: row.id, label: row.label, unit: row.unit,
      reference: row.values.reference, local: row.values.local, delta: row.values.delta }))
    const payload = { format: 'local-notepad-local-comparison-report', version: 1,
      generatedAtUTC, referenceGeneratedAtUTC, generationTimeIsObservationTime: false,
      scope: 'previously-confirmed-numeric-comparison', direction: 'local-minus-reference',
      sameWorkspaceVerified: false, completeForPreview: false, includesAllMetrics: true,
      metricCount: display.metricCount, changedMetricCount: display.changedCount,
      notice: COMPARISON_EXPORT_NOTICE, metrics }
    // UTF-8 BOM and CRLF are intentional for the CSV file only. Text columns
    // contain fixed labels/notices or strictly validated ISO timestamps. Signed
    // deltas are numeric cells; no caller-controlled spreadsheet formulas.
    const raw = format === 'json' ? JSON.stringify(payload, null, 2) + '\n' : '\ufeff' + [
      ['指标ID', '指标', '单位', '所选报告', '本次本地盘点', '差值（本次减报告）',
        '报告声明生成时间UTC', '导出生成时间UTC（不是盘点时间）', '同一工作区已验证', '范围说明'],
      ...metrics.map(row => [row.id, row.label, row.unit, row.reference, row.local, row.delta,
        referenceGeneratedAtUTC, generatedAtUTC, 'false', COMPARISON_EXPORT_NOTICE]),
    ].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
    if (new TextEncoder().encode(raw).length > COMPARISON_EXPORT_LIMIT) throw invalid()
    return Object.freeze({ raw, format, mime: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8',
      filename: `Local-Notepad-comparison-${generatedAtUTC.replace(/[:.]/g, '-')}.${format}` })
  }
  function download(format) {
    const file = prepare(format)
    const url = URL.createObjectURL(new Blob([file.raw], { type: file.mime }))
    let link
    try {
      link = document.createElement('a'); link.href = url; link.download = file.filename; link.hidden = true
      document.body.append(link); link.click()
    } finally {
      try { link?.remove() }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
    }
    // Initiating an anchor download is not confirmation of persistence.
    return file.filename
  }
  return Object.freeze({ display, prepare, download })
}
