export function historyRow(id = 'history-a', status = 'resolved', resolution = 'local', at = 1790586600) {
  return { id, item_id: 'note-' + id, kind: 'file', current_title: '旅行笔记 · ' + id,
    created_at: 1790583000, resolved_at: at, status, resolution }
}
export function historyPage(items = [historyRow()], filter = 'all', cursor = '') {
  return { version: 1, scope: 'local-workspace', filter, items, has_more: !!cursor, next_cursor: cursor }
}
