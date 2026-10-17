import { compareOfflineReportPair, OFFLINE_PAIR_NOTICE } from './s3OfflineReportPair.mjs'

export const OFFLINE_PAIR_EXPORT_LIMIT = 16 * 1024
export const OFFLINE_PAIR_EXPORT_NOTICE = `${OFFLINE_PAIR_NOTICE} 导出只使用点击比较时的完整统计，不会重新读文件；报告生成时间不是盘点时间。数量和容量可能透露使用规模，分享前请检查。`
const invalid = () => new Error('无法生成完整离线比较报告，未导出部分内容。')
const csvCell = value => typeof value === 'number' ? String(value) : `"${String(value).replace(/"/g, '""')}"`
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// Capture once at explicit comparison. The screen and all formats share this
// detached, frozen FILE-only model; never relabel either side as a local scan.
export function createOfflinePairExport(reportA, reportB) {
  const comparison = compareOfflineReportPair(reportA, reportB)
  function prepare(format, now = Date.now()) {
    if (!['json', 'csv', 'html'].includes(format) || !Number.isSafeInteger(now) || now < 0 || now > 253402300799999) throw invalid()
    const generatedAtUTC = new Date(now).toISOString()
    const data = { format: 'local-notepad-offline-pair-comparison', version: 1,
      scope: 'previously-confirmed-file-pair', direction: 'B-minus-A', generatedAtUTC,
      generationTimeIsObservationTime: false,
      reportA: { source: 'untrusted-file', declaredGeneratedAtUTC: comparison.generatedA },
      reportB: { source: 'untrusted-file', declaredGeneratedAtUTC: comparison.generatedB },
      sameWorkspaceVerified: false, contentEqualityVerified: false, completeForPreview: false,
      includesAllMetrics: true, metricCount: 12, changedMetricCount: comparison.changed,
      notice: OFFLINE_PAIR_EXPORT_NOTICE, metrics: comparison.rows }
    const raw = format === 'html' ? htmlReport(data) : format === 'json' ? JSON.stringify(data, null, 2) + '\n' : '\uFEFF' + [
      ['指标键', '指标', '单位', '报告 A', '报告 B', '差值 B − A', 'A声明生成时间UTC', 'B声明生成时间UTC', '导出时间UTC（不是盘点时间）', '同一工作区已验证', '范围说明'],
      ...comparison.rows.map(row => [row.key, row.label, row.unit, row.a, row.b, row.delta,
        comparison.generatedA, comparison.generatedB, generatedAtUTC, 'false', OFFLINE_PAIR_EXPORT_NOTICE]),
    ].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
    if (new TextEncoder().encode(raw).length > OFFLINE_PAIR_EXPORT_LIMIT) throw invalid()
    return Object.freeze({ raw, format,
      mime: format === 'html' ? 'text/html;charset=utf-8' : format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      filename: `Local-Notepad-offline-pair-${generatedAtUTC.replace(/[:.]/g, '-')}.${format}` })
  }
  function download(format) {
    const file = prepare(format)
    const url = URL.createObjectURL(new Blob([file.raw], { type: file.mime }))
    // Capture the matching revoke function before creating the short-lived link.
    const revoke = URL.revokeObjectURL.bind(URL)
    let link
    try {
      link = document.createElement('a'); link.href = url; link.download = file.filename; link.hidden = true
      document.body.append(link); link.click()
    } finally {
      try { link?.remove() } finally { setTimeout(() => revoke(url), 1000) }
    }
    return file.filename // A request, not evidence of a persisted file.
  }
  return Object.freeze({ comparison, prepare, download })
}

function htmlReport(data) {
  const rows = data.metrics.map(row => `<tr data-offline-metric="${escapeHTML(row.key)}"><th scope="row">${escapeHTML(row.label)}</th><td>${row.a}</td><td>${row.b}</td><td>${row.delta > 0 ? '+' : ''}${row.delta}</td><td>${escapeHTML(row.unit)}</td></tr>`).join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Local-Notepad 两份离线报告完整比较</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;color:#17212f;background:#f3f4f6;font:15px/1.65 system-ui,sans-serif}main{max-width:1060px;margin:32px auto;padding:28px;background:white;border:1px solid #cbd5e1;border-radius:12px}h1{font-size:25px;line-height:1.4}p,dd{overflow-wrap:anywhere}.notice{padding:12px;border-left:4px solid #536b87;background:#f1f4f8}dt{font-weight:600}dd{margin:0 0 10px}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}caption{text-align:left;font-weight:600;padding:10px 0}th,td{padding:9px;border:1px solid #b7c1ce;text-align:right;white-space:nowrap}th:first-child{text-align:left;white-space:normal}thead{background:#edf1f6}
@media(max-width:640px){main{margin:0;padding:16px;border:0;border-radius:0}h1{font-size:22px}table{font-size:13px}}
@page{size:A4 portrait;margin:14mm}@media print{body{background:white;color:black;font-size:10pt}main{margin:0;padding:0;border:0;max-width:none}.scroll{overflow:visible}table{font-size:9pt}th,td{padding:5pt;white-space:normal}thead{display:table-header-group}tr{break-inside:avoid}.notice{background:none}.print-help{display:none}}
</style></head><body><main>
<h1>两份离线报告完整比较</h1><p><strong>差值 = 报告 B − 报告 A</strong> · 全部 12 项指标，${data.changedMetricCount} 项数值不同；不是变化的笔记数。</p>
<p class="notice">${escapeHTML(data.notice)}</p>
<dl><dt>报告 A 声明生成时间（UTC）</dt><dd><time>${escapeHTML(data.reportA.declaredGeneratedAtUTC)}</time></dd>
<dt>报告 B 声明生成时间（UTC）</dt><dd><time>${escapeHTML(data.reportB.declaredGeneratedAtUTC)}</time></dd>
<dt>导出生成时间（UTC，不是盘点时间）</dt><dd><time>${escapeHTML(data.generatedAtUTC)}</time></dd></dl>
<div class="scroll"><table><caption>全部指标与精确字节数 · 零差值行完整保留</caption><thead><tr><th scope="col">指标</th><th scope="col">报告 A</th><th scope="col">报告 B</th><th scope="col">差值 B − A</th><th scope="col">单位</th></tr></thead><tbody>${rows}</tbody></table></div>
<p>两侧都是文件声明统计，不是当前工作区扫描结果。来源、同一工作区及时间先后未验证；本文件不包含正文、文件名、路径、对象标识或凭据，不执行脚本、不加载外部资源。</p>
<p class="print-help">可离线阅读并使用浏览器打印；打印前请检查纸张、缩放和分页。</p>
</main></body></html>\n`
}
