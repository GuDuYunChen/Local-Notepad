// Snapshot metadata only. These labels neither authorize a resolution nor
// predict which side will be written. Unmarked is deliberately not "safe".
export const CONFLICT_RISK_FILTERS = Object.freeze([
  ['all', '全部关注项'], ['attention', '删除或待核实'], ['permanent', '含永久删除'],
  ['recycled', '含回收站'], ['missing', '版本缺失'], ['unknown', '状态待核实'],
].map(Object.freeze))
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const payloads = { file: 'file', tag: 'tag', 'file-tag': 'file_tag', attachment: 'attachment' }
const kinds = new Set(Object.keys(payloads))
const labels = Object.freeze({ permanent: '永久删除', recycled: '在回收站', missing: '版本快照缺失（不等于删除）', unknown: '状态待核实' })
const nonempty = value => typeof value === 'string' && !!value.trim()

// Match the engine's tombstone key namespaces. A header that contradicts its
// object key is not evidence of a valid deletion, even when both IDs agree.
const kindForItemKey = id => id.startsWith('tag:') ? 'tag' : id.startsWith('filetag:') ? 'file-tag'
  : id.startsWith('attachment:') ? 'attachment' : 'file'

function attachmentIdentityMatches(name, itemID) {
  if (!nonempty(name) || name.length > 4096 || name === '.' || name === '..' || /[\x00/\\]/.test(name)) return false
  // Encode the exact name; do not normalize case, Unicode or percent escapes.
  // TextEncoder replaces lone surrogates. Refuse that silent identity change,
  // while preserving a legitimate leading BOM as part of a filename.
  const bytes = new TextEncoder().encode(name)
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== name) return false
  return itemID === 'attachment:' + Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('')
}

function sideState(record, itemID) {
  if (record == null) return 'missing'
  if (!object(record) || !nonempty(itemID) || record.id !== itemID || record.format !== 'local-notepad-sync-record' ||
      record.version !== 1 || !kinds.has(record.kind)) return 'unknown'
  const key = payloads[record.kind]
  if (Object.values(payloads).some(name => (name !== key || record.state === 'purged') && record[name] != null)) return 'unknown'
  if (record.state === 'purged') return kindForItemKey(itemID) === record.kind ? 'permanent' : 'unknown'
  if (record.state !== 'present' || !object(record[key])) return 'unknown'
  const value = record[key]
  if (record.kind === 'file') {
    if (value.id !== itemID || typeof value.is_deleted !== 'boolean' || typeof value.is_folder !== 'boolean') return 'unknown'
    return value.is_deleted ? 'recycled' : 'unmarked'
  }
  if (record.kind === 'tag' && (!nonempty(value.id) || itemID !== 'tag:' + value.id)) return 'unknown'
  // Do not split opaque IDs: either component may itself contain colons.
  if (record.kind === 'file-tag' && (!nonempty(value.file_id) || !nonempty(value.tag_id) ||
      itemID !== 'filetag:' + value.file_id + ':' + value.tag_id)) return 'unknown'
  if (record.kind === 'attachment' && !attachmentIdentityMatches(value.name, itemID)) return 'unknown'
  return 'unmarked'
}

export function conflictRiskSummary(conflict) {
  const validObject = object(conflict)
  const states = validObject ? [sideState(conflict.local_record, conflict.item_id), sideState(conflict.remote_record, conflict.item_id)] : ['unknown', 'unknown']
  const notices = [], flags = new Set()
  for (const [index, state] of states.entries()) {
    if (state === 'unmarked') continue
    flags.add(state)
    notices.push(Object.freeze({ side: index ? 'remote' : 'local', state, label: (index ? '远端：' : '本机：') + labels[state] }))
  }
  if (!validObject || conflict.status !== 'open') {
    flags.add('unknown')
    notices.push(Object.freeze({ side: 'record', state: 'unknown', label: '记录未确认处于待处理状态' }))
  }
  // No raw records, hashes, titles, paths, credentials or content are retained.
  return Object.freeze({ attention: flags.size > 0, flags: Object.freeze([...flags]), notices: Object.freeze(notices) })
}
