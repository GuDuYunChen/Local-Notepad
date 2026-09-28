// Display-only conversion of the overview's already validated UTC snapshot.
// No current clock, relative age, location lookup, status inference or IO.
const zoneName = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_+/-]{0,99}$/.test(value)
const freeze = Object.freeze
function utcRecord(value) {
  if (value === '尚无记录') return freeze({ text: '尚无记录', iso: '' })
  if (typeof value !== 'string' || !/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return freeze({ text: '未知', iso: '' })
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) return freeze({ text: '未知', iso: '' })
  return freeze({ text: value, iso: value })
}
export function deviceSyncTimeZone() {
  try {
    const value = new Intl.DateTimeFormat().resolvedOptions().timeZone
    return zoneName(value) ? value : ''
  } catch { return '' }
}
function localRecord(record, formatter) {
  if (!record.iso) return record
  // Avoid era-dependent formatting of astronomical year zero and boundary rollover.
  const year = new Date(record.iso).getUTCFullYear()
  if (year < 1 || year >= 9999) throw new Error('Calendar boundary')
  const parts = formatter.formatToParts(new Date(record.iso))
  const part = key => parts.find(item => item.type === key)?.value
  const y = part('year'), m = part('month'), d = part('day')
  const h = part('hour'), min = part('minute'), s = part('second'), ms = part('fractionalSecond'), offset = part('timeZoneName')
  if (!/^\d{4}$/.test(y) || ![m, d, h, min, s].every(v => typeof v === 'string' && /^\d{2}$/.test(v)) ||
      !/^\d{3}$/.test(ms) || !/^(?:GMT|UTC)(?:[+-]\d{2}:\d{2}(?::\d{2})?)?$/.test(offset)) throw new Error('Unsupported date parts')
  return freeze({ text: `${y}-${m}-${d} ${h}:${min}:${s}.${ms} ${offset}`, iso: record.iso })
}
export function syncClockDisplay(lastSuccess, readAt, timeZone = null) {
  const last = utcRecord(lastSuccess), read = utcRecord(readAt)
  const utc = fallback => freeze({ mode: 'utc', timeZone: 'UTC', fallback, lastSuccess: last, readAt: read })
  if (timeZone === null) return utc(false)
  try {
    if (!zoneName(timeZone)) return utc(true)
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3, timeZoneName: 'longOffset', hourCycle: 'h23' })
    const resolved = formatter.resolvedOptions().timeZone
    if (!zoneName(resolved)) return utc(true)
    return freeze({ mode: 'local', timeZone: resolved, fallback: false,
      lastSuccess: localRecord(last, formatter), readAt: localRecord(read, formatter) })
  } catch { return utc(true) }
}
