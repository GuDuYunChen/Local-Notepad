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
    if ((format !== 'json' && format !== 'csv' && format !== 'html') || !Number.isSafeInteger(now) ||
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
    const raw = format === 'html' ? comparisonHTML(payload) : format === 'json' ? JSON.stringify(payload, null, 2) + '\n' : '\ufeff' + [
      ['指标ID', '指标', '单位', '所选报告', '本次本地盘点', '差值（本次减报告）',
        '报告声明生成时间UTC', '导出生成时间UTC（不是盘点时间）', '同一工作区已验证', '范围说明'],
      ...metrics.map(row => [row.id, row.label, row.unit, row.reference, row.local, row.delta,
        referenceGeneratedAtUTC, generatedAtUTC, 'false', COMPARISON_EXPORT_NOTICE]),
    ].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
    if (new TextEncoder().encode(raw).length > COMPARISON_EXPORT_LIMIT) throw invalid()
    return Object.freeze({ raw, format, mime: format === 'html' ? 'text/html;charset=utf-8' : format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8',
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

// Only called with this module's validated, detached full comparison. Still
// escape every interpolated text/attribute. The file has no script, navigation,
// external asset or network dependency; printing is a browser operation.
const htmlText = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c])
function comparisonHTML(data) {
  const rows = data.metrics.map(row => `<tr data-metric="${htmlText(row.id)}"><th scope="row">${htmlText(row.label)}</th><td>${row.reference}</td><td>${row.local}</td><td>${row.delta > 0 ? '+' : ''}${row.delta}</td><td>${htmlText(row.unit)}</td></tr>`).join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Local-Notepad 完整统计比较报告</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#17212f;font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1060px;margin:32px auto;padding:32px;background:white;border:1px solid #d5dbe3;border-radius:12px}
h1{font-size:25px;line-height:1.35;margin:0 0 12px}h2{font-size:18px;margin:24px 0 8px}p{margin:8px 0;overflow-wrap:anywhere}
.notice{padding:12px 16px;border-left:4px solid #536b87;background:#f1f4f8}.muted{color:#475569}dl{margin:16px 0}dt{font-weight:600}dd{margin:0 0 8px;overflow-wrap:anywhere}
.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}caption{text-align:left;font-weight:600;padding:10px 0}
th,td{padding:10px 12px;border:1px solid #b7c1ce;text-align:right;white-space:nowrap}th:first-child{text-align:left;white-space:normal}thead{background:#edf1f6}tbody tr:nth-child(even){background:#f8fafc}
@media(max-width:640px){main{margin:0;padding:20px 12px;border:0;border-radius:0}h1{font-size:22px}th,td{padding:8px}table{font-size:13px}}
@page{size:A4 portrait;margin:14mm}
@media print{body{background:white;font-size:10pt;color:#000}main{max-width:none;margin:0;padding:0;border:0;border-radius:0}h1{font-size:18pt}.print-help{display:none}.table-scroll{overflow:visible}table{font-size:9pt;width:100%}th,td{padding:5pt;white-space:normal}thead{display:table-header-group}tr{break-inside:avoid}h2,caption{break-after:avoid}.notice{background:none;border:1px solid #555}.muted{color:#222}}
</style></head><body><main>
<h1>Local-Notepad 完整统计比较报告</h1>
<p class="muted">全部 ${data.metricCount} 项指标 · ${data.changedMetricCount} 项数值不同。指标个数不是发生变化的笔记数量。</p>
<p class="notice">${htmlText(data.notice)}</p>
<dl><dt>导出生成时间（UTC，不是盘点时间）</dt><dd><time>${htmlText(data.generatedAtUTC)}</time></dd>
<dt>所选报告声明的生成时间（UTC，不是盘点时间）</dt><dd><time>${htmlText(data.referenceGeneratedAtUTC)}</time></dd></dl>
<p><strong>差值 = 本次本地盘点 − 所选报告。</strong>正数表示本次统计值更大，负数表示更小；零值不代表内容相同。未验证同一工作区。</p>
<p>这里保存的是点击比较时已确认的两份统计；导出没有再次读取数据，之后的编辑不会更新本文件。全部指标均保留，不受界面差异筛选影响。</p>
<div class="table-scroll"><table><caption>完整数量与容量比较（容量精确到字节）</caption>
<thead><tr><th scope="col">指标</th><th scope="col">所选报告</th><th scope="col">本次本地盘点</th><th scope="col">差值</th><th scope="col">单位</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<p class="print-help">可在浏览器中离线打开，并使用浏览器的打印功能。打印结果受纸张及浏览器设置影响，请先检查打印预览。</p>
<p class="muted">本文件不加载外部资源，不执行脚本，不包含笔记正文、文件名、路径、对象标识或凭据。数量和容量仍可能透露使用规模，分享前请检查。</p>
</main></body></html>\n`
}
