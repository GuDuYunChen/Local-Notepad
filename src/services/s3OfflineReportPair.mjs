import { compareLocalOverviewReport } from './s3LocalOverviewComparison.mjs'

export const OFFLINE_PAIR_NOTICE = '差值 = 报告 B − 报告 A；双方都是文件声明的统计，不是当前工作区。未验证来源、同一工作区或时间先后；数值相同不代表内容相同，也不授权备份恢复或同步。'
const empty = Object.freeze({ format: 'local-notepad-s3-local-candidate-overview', version: 1,
  read_only: true, observed_stable: true, complete_for_preview: false,
  records: 0, record_bytes: 0, attachment_bytes: 0, base_items: 0,
  kinds: Object.freeze(['file', 'tag', 'file-tag', 'attachment'].map(kind => Object.freeze({ kind, records: 0, record_bytes: 0 }))) })
const labels = ['笔记与文件夹（含回收站）', '标签', '笔记与标签关联', '附件']
// Validate each complete FILE envelope through the existing validator. The
// zero observation is solely a projection aid, never a claimed local scan.
// Discard its local/notice fields; publish a separately named file-only model.
export function compareOfflineReportPair(reportA, reportB) {
  try {
    const a = compareLocalOverviewReport(reportA, empty), b = compareLocalOverviewReport(reportB, empty)
    const row = (key, label, unit, left, right) => Object.freeze({ key, label, unit,
      a: left.reference, b: right.reference, delta: right.reference - left.reference })
    const rows = [
      row('records', '记录合计', '项', a.records, b.records),
      row('recordBytes', '规范记录容量', 'B', a.recordBytes, b.recordBytes),
      row('attachmentBytes', '附件正文容量', 'B', a.attachmentBytes, b.attachmentBytes),
      row('baseItems', '共同基线条目', '项', a.baseItems, b.baseItems),
      ...a.kinds.flatMap((kind, i) => [
        row(`${kind.kind}:records`, `${labels[i]} · 数量`, '项', kind.records, b.kinds[i].records),
        row(`${kind.kind}:bytes`, `${labels[i]} · 规范记录`, 'B', kind.recordBytes, b.kinds[i].recordBytes),
      ]),
    ]
    return Object.freeze({ source: 'offline-report-pair', sameWorkspaceVerified: false, completeForPreview: false,
      generatedA: a.reportGeneratedAtUTC, generatedB: b.reportGeneratedAtUTC,
      notice: OFFLINE_PAIR_NOTICE, rows: Object.freeze(rows), changed: rows.filter(item => item.delta !== 0).length })
  } catch { throw new Error('两份报告必须完整且有效；未生成部分比较。') }
}
