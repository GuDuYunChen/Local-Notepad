const record = (id, title, content) => ({ format: 'local-notepad-sync-record', version: 1, kind: 'file', id, state: 'present',
  file: { id, title, content, created_at: 1, updated_at: 2, is_folder: false, parent_id: '', sort_order: 0, is_deleted: false, deleted_at: 0, is_pinned: false } })
export const queueSettings = { sync_enabled: true, sync_provider: 'local-lab', sync_endpoint: '', sync_username: '', sync_auto_enabled: false }
export const queueStatus = { device_id: 'device-a', provider: 'local-lab', enabled: true, remote_store_id: '', base_items: 2, last_status: 'conflicts' }
export function queueFixture(size = 25) {
  return Array.from({ length: size }, (_, i) => {
    const index = String(i + 1).padStart(3, '0'), itemID = 'note-' + index
    return { id: 'conflict-' + index, item_id: itemID, base_hash: 'a'.repeat(64), local_hash: 'b'.repeat(64), remote_hash: 'c'.repeat(64),
      status: 'open', created_at: 1000 - i, local_record: record(itemID, '本机笔记 ' + index, '本机正文 ' + index),
      remote_record: record(itemID, '远端笔记 ' + index, '远端正文 ' + index) }
  })
}
export function queueAttachment(id = 'attachment-conflict', name = '资料😀.pdf') {
  const itemID = 'attachment:' + Array.from(new TextEncoder().encode(name), n => n.toString(16).padStart(2, '0')).join('')
  const value = { format: 'local-notepad-sync-record', version: 1, kind: 'attachment', id: itemID, state: 'present',
    attachment: { name, size: 100, blob_hash: 'd'.repeat(64) } }
  return { ...queueFixture(1)[0], id, item_id: itemID, local_record: value, remote_record: { ...value, state: 'purged', attachment: undefined } }
}
