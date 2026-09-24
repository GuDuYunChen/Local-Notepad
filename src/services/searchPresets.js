// Only explicit user saves persist search terms. No automatic query history,
// snippets, result IDs, page offsets, revision tokens or manuscript are stored.
export const SEARCH_PRESET_PREFIX = 'localNotepad.searchPreset.v1:'
export const MAX_SEARCH_PRESETS = 40
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const text = (value, max, label, empty = true) => {
  if (typeof value !== 'string') throw new Error(label + '格式无效')
  const clean = value.normalize('NFC').trim()
  if ((!empty && !clean) || Array.from(clean).length > max) throw new Error(label + '长度无效')
  return clean
}
export function copySearchPresetFilters(value) {
  if (!record(value) || !['all', 'title', 'body'].includes(value.source) ||
      !['relevance', 'updated', 'title'].includes(value.sort) || !['0', '7', '30', '90'].includes(value.days) ||
      typeof value.pinned !== 'boolean' || typeof value.matchCase !== 'boolean') throw new Error('检索条件格式不支持')
  return Object.freeze({
    query: text(value.query, 128, '关键词'), source: value.source,
    folderId: text(value.folderId, 512, '目录标识'), days: value.days,
    pinned: value.pinned, matchCase: value.matchCase, sort: value.sort,
  })
}
export function applySearchPresetFilters(value, now = Date.now()) {
  const filters = copySearchPresetFilters(value)
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('当前时间不可用')
  return { ...filters, since: filters.days === '0' ? 0 : Math.max(0, Math.floor(now / 1000) - Number(filters.days) * 86400), page: 1, revision: '' }
}
export function readSearchPreset(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('已保存检索格式不支持')
  const value = JSON.parse(raw)
  if (!record(value) || value.format !== 'local-notepad-search-preset' || value.version !== 1 ||
      typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,96}$/.test(value.id) ||
      typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) ||
      new Date(value.savedAt).toISOString() !== value.savedAt) throw new Error('已保存检索格式不支持')
  return Object.freeze({ id: value.id, name: text(value.name, 48, '检索名称', false), savedAt: value.savedAt,
    filters: copySearchPresetFilters(value.filters) })
}
export function createSearchPresetStore({ storage = () => globalThis.localStorage,
  createId = () => globalThis.crypto.randomUUID(), now = () => new Date() } = {}) {
  const listeners = new Set()
  const publish = () => { for (const callback of [...listeners]) { try { callback() } catch { /* A view error is not a failed write. */ } } }
  function db() {
    const value = storage()
    if (!value || typeof value.getItem !== 'function') throw new Error('本地存储不可用')
    return value
  }
  function list() {
    try {
      const storage = db(), keys = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(SEARCH_PRESET_PREFIX)) keys.push(key)
      }
      const entries = keys.map(key => {
        const raw = storage.getItem(key)
        try {
          const preset = readSearchPreset(raw)
          if (key !== SEARCH_PRESET_PREFIX + preset.id) throw new Error('标识不一致')
          return { key, raw, preset, error: '' }
        } catch { return { key, raw, preset: null, error: '此条检索损坏或版本不支持，原记录未改动' } }
      }).sort((a, b) => (b.preset?.savedAt || '').localeCompare(a.preset?.savedAt || '') || a.key.localeCompare(b.key))
      return { entries, error: '' }
    } catch { return { entries: [], error: '无法读取已保存检索，请检查本地存储权限；普通检索仍可使用' } }
  }
  function readUnchanged(entry) {
    if (!entry || typeof entry.key !== 'string' || !entry.key.startsWith(SEARCH_PRESET_PREFIX)) throw new Error('检索标识无效')
    const raw = db().getItem(entry.key)
    if (raw === null || raw !== entry.raw) throw new Error('此条检索已变化或被删除，请刷新后重试')
    return raw
  }
  return {
    list, readUnchanged,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
    save(name, filters) {
      const clean = copySearchPresetFilters(filters), label = text(name, 48, '检索名称', false)
      const shelf = list()
      if (shelf.error) throw new Error(shelf.error)
      if (shelf.entries.length >= MAX_SEARCH_PRESETS) throw new Error('最多保留 40 条检索，请先删除不需要的条目；不会自动淘汰')
      const id = createId(), key = SEARCH_PRESET_PREFIX + id
      const raw = JSON.stringify({ format: 'local-notepad-search-preset', version: 1, id, name: label, savedAt: now().toISOString(), filters: clean })
      const preset = readSearchPreset(raw), storage = db()
      if (storage.getItem(key) !== null) throw new Error('检索标识冲突，请重试；没有覆盖旧记录')
      try { storage.setItem(key, raw) } catch { throw new Error('检索保存失败，可能空间不足或权限受限；当前条件仍保留') }
      publish()
      return preset
    },
    apply(entry) { return applySearchPresetFilters(readSearchPreset(readUnchanged(entry)).filters, now().getTime()) },
    remove(entry) {
      readUnchanged(entry)
      try { db().removeItem(entry.key) } catch { throw new Error('删除失败，已保存检索未改动') }
      publish()
    },
  }
}
export const searchPresets = createSearchPresetStore()
