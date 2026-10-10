// Local presentation preference only. Never store a zone, offset, timestamp,
// sync setting or credential. Resolve storage inside try: its getter may throw.
export const SYNC_CLOCK_PREFERENCE_KEY = 'local-notepad.sync-clock-mode.v1'
const storage = () => globalThis.localStorage
const valid = mode => mode === 'utc' || mode === 'local'
export function readSyncClockPreference(resolveStorage = storage) {
  try {
    const mode = resolveStorage().getItem(SYNC_CLOCK_PREFERENCE_KEY)
    return Object.freeze({ mode: valid(mode) ? mode : null,
      status: valid(mode) ? 'saved' : mode === null ? 'empty' : 'invalid' })
  } catch { return Object.freeze({ mode: null, status: 'unavailable' }) }
}
export function saveSyncClockPreference(mode, resolveStorage = storage) {
  if (!valid(mode)) return false
  try {
    const target = resolveStorage()
    target.setItem(SYNC_CLOCK_PREFERENCE_KEY, mode)
    return target.getItem(SYNC_CLOCK_PREFERENCE_KEY) === mode
  } catch { return false }
}
export function clearSyncClockPreference(resolveStorage = storage) {
  try {
    const target = resolveStorage()
    target.removeItem(SYNC_CLOCK_PREFERENCE_KEY)
    return target.getItem(SYNC_CLOCK_PREFERENCE_KEY) === null
  } catch { return false }
}
