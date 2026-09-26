// Read-only presentation of the engine's Plan. This module never authorizes,
// executes, or reclassifies a sync. In particular, a hash does not reveal whether
// an upload/download is an edit or a deletion.
export const SYNC_PLAN_PAGE_SIZE = 20
export const SYNC_PLAN_MAX_ITEMS = 50000
export const SYNC_PLAN_MAX_ID_UNITS = 4096
const MAX_ID_BUDGET = 8 * 1024 * 1024
export const SYNC_PLAN_FILTERS = Object.freeze([
  ['changes', '有变化 / 冲突'], ['all', '全部对象'], ['upload', '上传'],
  ['download', '下载'], ['conflict', '冲突'], ['noop', '无变化'],
].map(Object.freeze))
const ACTIONS = new Set(['upload', 'download', 'conflict', 'noop'])
const FIELDS = Object.freeze({ upload: 'uploads', download: 'downloads', conflict: 'conflicts', noop: 'noops' })
const LABELS = Object.freeze({ upload: '上传', download: '下载', conflict: '冲突', noop: '无变化' })
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const fold = value => value.normalize('NFC').toLowerCase()

function itemLabel(id) {
  if (id.startsWith('attachment:')) {
    const hex = id.slice(11)
    if (hex.length && hex.length % 2 === 0 && /^[a-f0-9]+$/.test(hex)) {
      try {
        const name = new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16)),
        )
        // A display label, never a path or link. Preserve the exact raw ID too.
        if (name && name !== '.' && name !== '..' && !/[\x00-\x1f\x7f/\\]/.test(name)) {
          return { kind: '附件', label: name }
        }
      } catch { /* Show the opaque ID rather than guessing a filename. */ }
    }
    return { kind: '附件（名称不可解码）', label: id }
  }
  if (id.startsWith('filetag:')) return { kind: '标签关联', label: id }
  if (id.startsWith('tag:')) return { kind: '标签', label: id }
  return { kind: '笔记 / 文件夹', label: id }
}

// Never retain arbitrary server fields, body content, hashes, or credentials.
// Bad presentation data is returned as an explicit error model, not thrown:
// a display failure after /run must not relabel a completed write as a failure.
export function captureSyncPlan(raw, source = 'preview', capturedAt = Date.now()) {
  const base = {
    source: source === 'run' ? 'run' : 'preview',
    capturedAt: count(capturedAt) && capturedAt > 0 && capturedAt <= 8640000000000000 ? capturedAt : null,
    stale: false, counts: null, items: null, generation: null, needsInit: null,
  }
  const invalid = message => Object.freeze({ ...base, detailState: 'invalid', message })
  if (!['preview', 'run'].includes(source) || !isObject(raw)) return invalid('同步计划响应无效，不能当作空计划。')
  if (!Object.values(FIELDS).every(field => count(raw[field]))) return invalid('计划数量缺失或无效，不能核实汇总。')
  const counts = Object.freeze(Object.fromEntries(Object.values(FIELDS).map(field => [field, raw[field]])))
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(total)) return invalid('计划数量超出可核实范围。')
  base.counts = counts
  base.generation = count(raw.generation) ? raw.generation : null
  base.needsInit = typeof raw.needs_init === 'boolean' ? raw.needs_init : null
  const unavailable = message => Object.freeze({ ...base, detailState: 'unavailable', message })
  if (total > SYNC_PLAN_MAX_ITEMS) return unavailable('计划超过 50,000 个对象；仅保留服务端汇总，不截取部分明细冒充完整计划。')
  // Go serializes an empty nil slice as null. Missing items is not that receipt.
  const input = raw.items === null && total === 0 ? [] : raw.items
  if (input == null) return unavailable('服务端未提供完整明细；以下仅为服务端汇总，不能核实每个对象。')
  if (!Array.isArray(input) || input.length !== total) return invalid('计划明细与汇总数量不一致，请重新预演。')
  const seen = new Set()
  const actual = { uploads: 0, downloads: 0, conflicts: 0, noops: 0 }
  const items = []
  let idBudget = 0
  for (const item of input) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id.trim() ||
        item.id.length > SYNC_PLAN_MAX_ID_UNITS || !ACTIONS.has(item.action) || seen.has(item.id)) {
      return invalid('计划包含无效、重复或不支持的对象，未显示部分结果。')
    }
    idBudget += item.id.length
    if (idBudget > MAX_ID_BUDGET) return unavailable('计划对象编号总量过大；明细未展开，没有静默丢弃对象。')
    seen.add(item.id)
    actual[FIELDS[item.action]]++
    const { kind, label } = itemLabel(item.id)
    items.push(Object.freeze({ id: item.id, action: item.action, direction: LABELS[item.action],
      kind, label, search: fold(item.id + '\n' + label) }))
  }
  if (!Object.keys(actual).every(field => actual[field] === counts[field])) {
    return invalid('计划方向统计与实际明细不一致，请重新预演。')
  }
  return Object.freeze({ ...base, detailState: 'complete', message: '', items: Object.freeze(items) })
}

// Latches an observed change: A -> B -> A never revives an old preview.
export function invalidateSyncPlan(snapshot) {
  return !snapshot || snapshot.stale ? snapshot : Object.freeze({ ...snapshot, stale: true })
}

// Private in-memory observation key used by the parent. No password or arbitrary
// object serialization. This detects observed changes, not unsignalled edits on
// another device; even an unchanged key is NOT proof that a plan is current.
export function syncPlanObservation(settings, status) {
  const scalar = value => ['string', 'boolean', 'number'].includes(typeof value) ? value : null
  return JSON.stringify([
    settings?.sync_enabled, settings?.sync_provider, settings?.sync_endpoint, settings?.sync_username,
    settings?.sync_auto_enabled, settings?.sync_interval_minutes,
    status?.device_id, status?.remote_store_id, status?.remote_revision,
    status?.last_sync_at, status?.last_status, status?.base_items, status?.open_conflicts,
    status?.recovery?.mode, status?.recovery?.last_success_at,
  ].map(scalar))
}

export function syncPlanPage(snapshot, { filter = 'changes', query = '', page = 1 } = {}) {
  const selected = SYNC_PLAN_FILTERS.some(([value]) => value === filter) ? filter : 'changes'
  const needle = typeof query === 'string' ? fold(query.slice(0, 256).trim()) : ''
  const items = snapshot?.detailState === 'complete' ? snapshot.items : []
  const matches = items.filter(item =>
    (selected === 'all' || (selected === 'changes' ? item.action !== 'noop' : item.action === selected)) &&
    (!needle || item.search.includes(needle)),
  )
  const pages = Math.max(1, Math.ceil(matches.length / SYNC_PLAN_PAGE_SIZE))
  const current = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1))
  const start = (current - 1) * SYNC_PLAN_PAGE_SIZE
  return { rows: matches.slice(start, start + SYNC_PLAN_PAGE_SIZE), page: current, pages,
    matched: matches.length, total: items.length, filter: selected, from: matches.length ? start + 1 : 0,
    to: Math.min(start + SYNC_PLAN_PAGE_SIZE, matches.length) }
}
