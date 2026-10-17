import assert from 'node:assert/strict'

// Chromium may expose a visible untitled auxiliary HWND ahead of the actual
// BrowserWindow. Process.MainWindowHandle is not a reliable selector here.
export function selectDesktopMainWindow(windows, pid, title) {
  assert.ok(Array.isArray(windows)); assert.ok(Number.isInteger(pid) && pid > 0)
  assert.ok(typeof title === 'string' && title.trim().length > 0)
  const matches = windows.filter(w => w.pid === pid && w.visible === true &&
    w.cls === 'Chrome_WidgetWin_1' && w.title === title &&
    Array.isArray(w.childText) && w.childText.includes('Chrome Legacy Window') &&
    Number.isSafeInteger(w.handle) && w.handle > 0)
  assert.equal(matches.length, 1, 'Expected one owned, titled application renderer window')
  return matches[0]
}
