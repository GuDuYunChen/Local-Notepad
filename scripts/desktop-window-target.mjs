import assert from 'node:assert/strict'
import path from 'node:path'

export const UNAPPLIED_QUIT_DIALOG_TITLE = '退出未完成，窗口已保留'
export const UNAPPLIED_QUIT_DIALOG_MESSAGE = '公式、嵌入内容或源码有尚未应用的更改。请返回编辑，完成或取消这些更改后再退出。'

export function assertDesktopWindowImage(window, executablePath) {
  assert.ok(typeof executablePath === 'string' && path.win32.isAbsolute(executablePath))
  assert.ok(typeof window?.image === 'string' && path.win32.isAbsolute(window.image))
  assert.equal(path.win32.normalize(window.image).toLowerCase(), path.win32.normalize(executablePath).toLowerCase(), 'Native window belongs to another executable')
  return true
}

// showErrorBox need not have the BrowserWindow as its Win32 owner. Bind the
// exact failure dialog to the isolated application's PID and executable instead.
export function selectDesktopUnappliedDialog(windows, pid, executablePath) {
  assert.ok(Array.isArray(windows)); assert.ok(Number.isInteger(pid) && pid > 0)
  const matches = windows.filter(window => window.pid === pid && window.visible === true &&
    window.cls === '#32770' && window.title === UNAPPLIED_QUIT_DIALOG_TITLE &&
    Number.isSafeInteger(window.handle) && window.handle > 0 &&
    Array.isArray(window.childText) && window.childText.some(text => typeof text === 'string' && text.includes(UNAPPLIED_QUIT_DIALOG_MESSAGE)))
  assert.equal(matches.length, 1, 'Expected one owned native unapplied-draft error dialog')
  assertDesktopWindowImage(matches[0], executablePath)
  return matches[0]
}

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
