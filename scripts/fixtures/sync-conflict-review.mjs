export const settingsFixture = { sync_enabled: true, sync_provider: 'local-lab', sync_endpoint: '', sync_username: '' }
export const statusFixture = { device_id: 'device-a', remote_store_id: '' }
export function fileRecord(content = '本机正文', overrides = {}) {
  return { format: 'local-notepad-sync-record', version: 1, kind: 'file', id: 'n1', state: 'present', file: {
    id: 'n1', title: '本机标题', content, created_at: 1, updated_at: 2, is_folder: false,
    parent_id: '', sort_order: 0, is_deleted: false, deleted_at: 0, is_pinned: false, ...overrides,
  } }
}
export function conflictFixture(overrides = {}) {
  return { id: 'c1', item_id: 'n1', base_hash: 'a'.repeat(64), local_hash: 'b'.repeat(64), remote_hash: 'c'.repeat(64),
    status: 'open', created_at: 1, local_record: fileRecord(), remote_record: fileRecord('远端正文', { title: '远端标题' }), ...overrides }
}
