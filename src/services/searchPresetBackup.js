import { MAX_SEARCH_PRESETS, readSearchPreset, searchPresets } from './searchPresets'

export const MAX_PRESET_BACKUP_BYTES = 512 * 1024
const plans = new WeakMap()
const signature = entries => JSON.stringify(entries.map(entry => [entry.key, entry.raw]).sort((a, b) => a[0].localeCompare(b[0])))
const identity = preset => JSON.stringify([preset.name, preset.filters])
const serialize = preset => ({ format: 'local-notepad-search-preset', version: 1, ...preset })
function readShelf(store) {
  const shelf = store.list()
  if (shelf.error) throw new Error(shelf.error)
  return shelf.entries
}
function assertShelf(store, expected) {
  if (signature(readShelf(store)) !== expected) throw new Error('本地常用检索已变化，请重新预检；未覆盖原记录')
}

export function buildSearchPresetBackup(store = searchPresets, now = new Date()) {
  const entries = readShelf(store)
  if (!entries.length) throw new Error('没有可备份的常用检索')
  const stamp = signature(entries)
  // An unreadable member must never silently disappear from a claimed full backup.
  const presets = entries.map(entry => {
    if (!entry.preset) throw new Error('有不可读取的常用检索，未生成不完整备份；请先处理该条目')
    return serialize(readSearchPreset(store.readUnchanged(entry)))
  })
  assertShelf(store, stamp)
  const raw = JSON.stringify({ format: 'local-notepad-search-presets', version: 1, exportedAt: now.toISOString(), presets }, null, 2)
  if (new TextEncoder().encode(raw).length > MAX_PRESET_BACKUP_BYTES) throw new Error('备份超过大小限制')
  return raw
}

export function parseSearchPresetBackup(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_PRESET_BACKUP_BYTES || new TextEncoder().encode(raw).length > MAX_PRESET_BACKUP_BYTES) {
    throw new Error('常用检索备份超过 512 KiB 或格式无效')
  }
  let value
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')) } catch { throw new Error('不是有效的 JSON 备份') }
  if (value?.format !== 'local-notepad-search-presets' || value.version !== 1 ||
    typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt)) ||
    new Date(value.exportedAt).toISOString() !== value.exportedAt || !Array.isArray(value.presets) ||
    !value.presets.length || value.presets.length > MAX_SEARCH_PRESETS) throw new Error('常用检索备份版本或条目数量不支持')
  // Strip body, result, page and navigation fields before any UI or write can use them.
  return Object.freeze(value.presets.map(preset => readSearchPreset(JSON.stringify(preset))))
}

export function planSearchPresetImport(raw, store = searchPresets) {
  const presets = parseSearchPresetBackup(raw), entries = readShelf(store)
  const existing = new Set(entries.filter(entry => entry.preset).map(entry => identity(entry.preset)))
  const seen = new Set(), additions = [], rows = []
  let existingCount = 0, fileDuplicateCount = 0
  for (const preset of presets) {
    const key = identity(preset)
    const status = existing.has(key) ? 'existing' : seen.has(key) ? 'duplicate' : 'new'
    if (status === 'existing') existingCount++
    else if (status === 'duplicate') fileDuplicateCount++
    else additions.push(preset)
    seen.add(key)
    rows.push(Object.freeze({ name: preset.name, query: preset.filters.query, folderId: preset.filters.folderId, status }))
  }
  const available = Math.max(0, MAX_SEARCH_PRESETS - entries.length)
  if (additions.length > available) throw new Error(`需要新增 ${additions.length} 条，但仅余 ${available} 个位置；不会删除旧检索`)
  const plan = Object.freeze({ rows: Object.freeze(rows), total: presets.length, newCount: additions.length, existingCount, fileDuplicateCount })
  plans.set(plan, { store, stamp: signature(entries), additions, consumed: false })
  return plan
}

// A confirmed plan is one-shot, bound to its store and exact preflight shelf.
// Partial successes are retained. Re-preflight deduplicates those successes.
export function applySearchPresetImport(plan, store = searchPresets) {
  const state = plans.get(plan)
  if (!state || state.store !== store || state.consumed) throw new Error('预检已失效，请重新选择备份文件')
  state.consumed = true
  let added = 0, stamp = state.stamp
  try {
    assertShelf(store, stamp)
    for (const preset of state.additions) {
      assertShelf(store, stamp)
      const before = readShelf(store)
      // Imported queries get fresh IDs and the time of this explicit local save.
      const saved = store.save(preset.name, preset.filters)
      added++
      const after = readShelf(store)
      const inserted = after.find(entry => entry.preset?.id === saved.id)
      if (!inserted || after.length !== before.length + 1 || signature(after.filter(entry => entry !== inserted)) !== stamp) {
        throw new Error('导入期间本地常用检索发生变化，请重新预检剩余条目')
      }
      stamp = signature(after)
    }
    return Object.freeze({ added, skipped: plan.existingCount + plan.fileDuplicateCount, remaining: 0, error: '' })
  } catch (failure) {
    return Object.freeze({ added, skipped: plan.existingCount + plan.fileDuplicateCount,
      remaining: state.additions.length - added, error: failure.message || '导入未完成，请重新预检' })
  }
}

export function downloadSearchPresetBackup(raw) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = 'Local-Notepad-常用检索备份.json'; link.style.display = 'none'
  document.body.append(link)
  try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
