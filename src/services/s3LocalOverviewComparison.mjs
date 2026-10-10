import { sanitizeS3LocalOverviewResult } from '../../electron/s3-local-overview-codec.js'

export const LOCAL_COMPARISON_NOTICE = '差值 = 本次本地盘点 − 所选报告；这里只比较数量和容量，未验证两者来自同一工作区，也不能据此判断哪些笔记新增、删除、修改或需要同步。'
const invalid = () => new Error('比较依据无效，未显示部分差值。')
function observation(value) {
  const result = sanitizeS3LocalOverviewResult({ success: true, status: 200, code: 'OK', data: value })
  if (!result.success) throw invalid()
  return result.data
}
function fileReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const proto = Object.getPrototypeOf(value), names = Reflect.ownKeys(value)
  const expected = ['source', 'generatedAtUTC', 'summary']
  if ((proto !== null && proto !== Object.prototype) || names.length !== expected.length) throw invalid()
  const own = Object.create(null)
  for (const key of expected) {
    const d = Object.getOwnPropertyDescriptor(value, key)
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw invalid()
    own[key] = d.value
  }
  if (own.source !== 'untrusted-file' || typeof own.generatedAtUTC !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(own.generatedAtUTC)) throw invalid()
  const at = Date.parse(own.generatedAtUTC)
  if (!Number.isSafeInteger(at) || at < 0 || new Date(at).toISOString() !== own.generatedAtUTC) throw invalid()
  return { stamp: own.generatedAtUTC, summary: observation(own.summary) }
}
const difference = (reference, local) => Object.freeze({ reference, local, delta: local - reference })

// Pure arithmetic on two complete validated observations. File provenance is
// unverified; neither timestamps nor equal totals establish workspace identity,
// content equality, chronology, freshness or an upload/delete instruction.
// No reads, timestamps, caching, network, exports or mutation are performed.
export function compareLocalOverviewReport(report, localSummary) {
  try {
    const file = fileReport(report), local = observation(localSummary), reference = file.summary
    const kinds = local.kinds.map((row, i) => Object.freeze({ kind: row.kind,
      records: difference(reference.kinds[i].records, row.records),
      recordBytes: difference(reference.kinds[i].record_bytes, row.record_bytes) }))
    return Object.freeze({ source: 'numeric-comparison', sameWorkspaceVerified: false,
      completeForPreview: false, reportGeneratedAtUTC: file.stamp, notice: LOCAL_COMPARISON_NOTICE,
      records: difference(reference.records, local.records),
      recordBytes: difference(reference.record_bytes, local.record_bytes),
      attachmentBytes: difference(reference.attachment_bytes, local.attachment_bytes),
      baseItems: difference(reference.base_items, local.base_items), kinds: Object.freeze(kinds) })
  } catch { throw invalid() }
}

export function comparisonDelta(value) {
  if (!Number.isSafeInteger(value)) throw invalid()
  return value > 0 ? `+${value}` : String(value === 0 ? 0 : value)
}
