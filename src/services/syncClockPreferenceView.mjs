// Fixed presentation only: the last observed preference is not live storage.
const label = mode => mode === 'local' ? '本机时区' : 'UTC'
export function syncClockPreferenceView(currentMode, savedMode, unavailable = false, fallback = false) {
  const current = currentMode === 'local' ? 'local' : 'utc'
  const saved = savedMode === 'local' || savedMode === 'utc' ? savedMode : null
  const summary = unavailable ? '保存记录未确认' : saved ? '上次核对已记住：' + label(saved) : '上次核对未记住选择'
  const detail = unavailable ? '已保存方式尚未核实，当前显示保持可用。'
    : fallback ? '本机时区暂不可用，当前实际显示 UTC；没有改写已保存方式。'
      : saved === null ? '当前显示：' + label(current) + '。未记住选择，下次打开默认 UTC。'
        : saved === current ? '当前显示与上次核对的保存方式一致：' + label(current) + '。'
          : '当前仅为本次显示：' + label(current) + '；上次核对已记住：' + label(saved) + '。'
  return Object.freeze({ summary, detail })
}
