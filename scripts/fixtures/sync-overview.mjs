// Synthetic UI/test facts only. Never read a real workspace or remote provider.
export function overviewFixture() {
  return { settings: { sync_enabled: true, sync_provider: 'webdav', sync_auto_enabled: false, sync_interval_minutes: 5 },
    status: { last_status: 'ok', last_sync_at: 1790499990, last_error: '', base_items: 20, open_conflicts: 0,
      recovery: { mode: 'idle', last_success_at: 1790499900, next_attempt_at: 0 } },
    health: { loading: false, lastReadAt: 1790500000000, error: '', failures: 0 },
    conflictCount: 0, busy: false, draftChanged: false, actionFailed: false }
}
