const metricKeys = Object.freeze(['records', 'recordBytes', 'attachmentBytes', 'baseItems',
  ...['file', 'tag', 'file-tag', 'attachment'].flatMap(kind => [`${kind}:records`, `${kind}:bytes`])])
const countKeys = new Set(['records', 'baseItems', 'file:records', 'tag:records', 'file-tag:records', 'attachment:records'])
const invalid = () => new Error('比较概览依据不完整，未显示部分统计。')
const value = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid()
  return descriptor.value
}
const group = () => ({ increase: 0, decrease: 0, unchanged: 0, total: 0 })

// Count metric directions, never add quantities to bytes or infer changed notes.
// Use the full confirmed comparison, not the currently visible filtered rows.
export function summarizeOfflinePair(comparison) {
  try {
    if (value(comparison, 'source') !== 'offline-report-pair') throw invalid()
    const rows = value(comparison, 'rows')
    if (!Array.isArray(rows) || rows.length !== metricKeys.length) throw invalid()
    const all = group(), counts = group(), bytes = group()
    for (let i = 0; i < metricKeys.length; i++) {
      const row = value(rows, String(i)), key = value(row, 'key')
      const a = value(row, 'a'), b = value(row, 'b'), delta = value(row, 'delta')
      if (key !== metricKeys[i] || !Number.isSafeInteger(a) || a < 0 || !Number.isSafeInteger(b) || b < 0 ||
          !Number.isSafeInteger(delta) || delta !== b - a || value(row, 'unit') !== (countKeys.has(key) ? '项' : 'B')) throw invalid()
      const direction = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'unchanged'
      const target = countKeys.has(key) ? counts : bytes
      all[direction]++; all.total++; target[direction]++; target.total++
    }
    if (value(comparison, 'changed') !== all.increase + all.decrease) throw invalid()
    return Object.freeze({ all: Object.freeze(all), counts: Object.freeze(counts), bytes: Object.freeze(bytes) })
  } catch { throw invalid() }
}
