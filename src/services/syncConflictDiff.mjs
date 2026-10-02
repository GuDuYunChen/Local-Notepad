import { conflictContentPreview } from './syncConflictReview.mjs'

// A view of two captured texts, never a merge plan or permission to write.
export const CONFLICT_DIFF_MAX_LINES = 2000
export const CONFLICT_DIFF_MAX_CELLS = 300000
export const CONFLICT_DIFF_PAGE_SIZE = 60
const MAX_SOURCE_UNITS = 512 * 1024
const EOL = { LF: '\n', CRLF: '\r\n', CR: '\r', none: '' }
const isNote = record => record?.kind === 'file' && record.state === 'present' &&
  typeof record.id === 'string' && !!record.id.trim() && record.file?.id === record.id &&
  record.file.is_folder === false && typeof record.file.content === 'string'
export const canCompareConflictText = review => !!review && isNote(review.local_record) &&
  isNote(review.remote_record) && review.local_record.id === review.remote_record.id

const result = (state, message, extra = {}) => Object.freeze({
  state, message, rows: Object.freeze([]), groups: Object.freeze([]), counts: null,
  sourceNotices: Object.freeze([]), ...extra,
})
const unavailable = message => result('unavailable', message)

// Keep line endings and whitespace byte-for-byte within the text projection.
// Empty text has zero lines; a final newline belongs to its preceding line.
function linesOf(text) {
  if (!text) return []
  const lines = [], matcher = /\r\n|\r|\n/g
  let start = 0, match
  while ((match = matcher.exec(text))) {
    lines.push(text.slice(start, matcher.lastIndex)); start = matcher.lastIndex
    if (lines.length > CONFLICT_DIFF_MAX_LINES) return null
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines.length > CONFLICT_DIFF_MAX_LINES ? null : lines
}
function row(kind, raw, localLine, remoteLine) {
  const ending = raw.endsWith('\r\n') ? 'CRLF' : raw.endsWith('\n') ? 'LF' : raw.endsWith('\r') ? 'CR' : 'none'
  return Object.freeze({ kind, localLine, remoteLine, ending, text: raw.slice(0, raw.length - EOL[ending].length) })
}

export function buildConflictTextDiff(review) {
  if (!canCompareConflictText(review)) return unavailable('仅支持两端都存在的笔记正文；缺失、永久删除、文件夹、标签及附件不能当作空正文比较。')
  const leftSource = review.local_record.file.content, rightSource = review.remote_record.file.content
  if (leftSource === rightSource) return result('same-text', '两端正文原始数据相同；标题、删除状态等其他字段仍可能不同，请继续核对版本信息。', { rawEqual: true })
  if (leftSource.length > MAX_SOURCE_UNITS || rightSource.length > MAX_SOURCE_UNITS) {
    return unavailable('正文超过差异读取预算，本次未生成行差异。原有预览仍可查看，但不能代替完整文档核对。')
  }
  const left = conflictContentPreview(leftSource), right = conflictContentPreview(rightSource)
  if (left.limited || right.limited) return unavailable('正文投影不完整，可能含未展示的嵌入对象或超长内容。本次不比较截取片段，也不会据此声称两端相同。')
  const sourceNotices = Object.freeze([left.notice, right.notice])
  if (left.text === right.text) return result('same-text', '可见文本相同，但正文原始数据不同；格式、链接目标或文档结构仍可能不同，不能据此认定版本相同。', { rawEqual: false, sourceNotices })
  const a = linesOf(left.text), b = linesOf(right.text)
  if (!a || !b) return unavailable('正文行数超过差异展示预算，本次未生成行差异。未裁切成看似完整的对比，请核对两端完整文档。')
  let prefix = 0, suffix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix, stride = m + 1
  if ((n + 1) * stride > CONFLICT_DIFF_MAX_CELLS) return unavailable('不同正文过多，超过精确比较预算。本次未生成行差异；请使用原有两端预览并核对完整文档。')
  // Bounded LCS with deterministic local-first ties. Common edges avoid a
  // quadratic allocation for a small edit in an otherwise long document.
  const lcs = new Uint16Array((n + 1) * stride)
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    lcs[i * stride + j] = a[prefix + i] === b[prefix + j]
      ? 1 + lcs[(i + 1) * stride + j + 1]
      : Math.max(lcs[(i + 1) * stride + j], lcs[i * stride + j + 1])
  }
  const rows = []
  let x = 0, y = 0, localOnly = 0, remoteOnly = 0
  const same = () => { rows.push(row('same', a[x], x + 1, y + 1)); x++; y++ }
  for (; x < prefix;) same()
  while (x < a.length - suffix || y < b.length - suffix) {
    const i = x - prefix, j = y - prefix
    if (i < n && j < m && a[x] === b[y]) same()
    else if (i < n && (j === m || lcs[(i + 1) * stride + j] >= lcs[i * stride + j + 1])) {
      rows.push(row('local', a[x], x + 1, null)); x++; localOnly++
    } else { rows.push(row('remote', b[y], null, y + 1)); y++; remoteOnly++ }
  }
  while (x < a.length) same()
  const groups = []
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind === 'same') { i++; continue }
    const start = i
    while (i < rows.length && rows[i].kind !== 'same') i++
    groups.push(Object.freeze({ start, end: i }))
  }
  return result('different', '仅本机 / 仅远端表示快照中的文本差异，不表示将执行删除或新增。行号属于文本投影，不是原编辑器行号。', {
    rawEqual: false, sourceNotices, rows: Object.freeze(rows), groups: Object.freeze(groups),
    counts: Object.freeze({ localOnly, remoteOnly, localLines: a.length, remoteLines: b.length }),
  })
}

// Bound rendered rows separately from computation. Every change remains
// reachable; context is shown only at the start/end of its change group.
export function conflictDiffPage(model, groupIndex = 0, page = 1) {
  if (model?.state !== 'different' || !model.groups?.length) return null
  const group = Math.max(0, Math.min(model.groups.length - 1, Number.isSafeInteger(groupIndex) ? groupIndex : 0))
  const { start, end } = model.groups[group], total = end - start
  const pages = Math.ceil(total / CONFLICT_DIFF_PAGE_SIZE)
  const current = Math.max(1, Math.min(pages, Number.isSafeInteger(page) ? page : 1))
  const from = start + (current - 1) * CONFLICT_DIFF_PAGE_SIZE, to = Math.min(end, from + CONFLICT_DIFF_PAGE_SIZE)
  let contextStart = start, contextEnd = end
  while (contextStart > 0 && start - contextStart < 2 && model.rows[contextStart - 1].kind === 'same') contextStart--
  while (contextEnd < model.rows.length && contextEnd - end < 2 && model.rows[contextEnd].kind === 'same') contextEnd++
  return Object.freeze({ group, page: current, pages, total, from: from - start + 1, to: to - start,
    before: Object.freeze(current === 1 ? model.rows.slice(contextStart, start) : []),
    changes: Object.freeze(model.rows.slice(from, to)),
    after: Object.freeze(current === pages ? model.rows.slice(end, contextEnd) : []),
  })
}
