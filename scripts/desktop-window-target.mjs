import assert from 'node:assert/strict'
import path from 'node:path'

// Electron 31.7.7 uses Error as pszWindowTitle and the application title as
// pszMainInstruction. Keep both identities; the caption alone is insufficient.
export const UNAPPLIED_QUIT_DIALOG_CAPTION = 'Error'
export const UNAPPLIED_QUIT_DIALOG_TITLE = '退出未完成，窗口已保留'
export const UNAPPLIED_QUIT_DIALOG_MESSAGE = '公式、嵌入内容或源码有尚未应用的更改。请返回编辑，完成或取消这些更改后再退出。'
export const DESKTOP_ACCESSIBILITY_SOURCE = 'UIAutomation.FromHandle.FindAll.Descendants'

export function assertDesktopAccessibleText(window) {
  const value = window.accessibility
  assert.ok(value && typeof value === 'object', 'Native accessibility observation is missing')
  assert.equal(value.source, DESKTOP_ACCESSIBILITY_SOURCE)
  assert.equal(value.status, 'complete', 'Native accessibility read refused: ' + value.errorCode)
  assert.equal(value.errorCode, null); assert.equal(value.errorType, null)
  assert.equal(value.budgetMs, 2000)
  assert.ok(Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs <= value.budgetMs)
  const identity = Object.fromEntries(['pid', 'handle', 'image', 'title', 'cls', 'visible'].map(key => [key, window[key]]))
  assert.deepEqual(value.boundWindow, identity)
  assert.deepEqual(value.revalidatedWindow, identity, 'Accessible text no longer belongs to the same native window')
  assert.equal(value.root?.pid, window.pid); assert.equal(value.root?.handle, window.handle)
  assert.ok(Array.isArray(value.elements) && value.elements.length <= 64)
  const elements = [value.root, ...value.elements]
  for (const element of elements) {
    assert.equal(element?.pid, window.pid)
    assert.ok(Number.isSafeInteger(element.handle) && element.handle >= 0)
    assert.equal(typeof element.name, 'string'); assert.ok(element.name.length <= 4096)
    assert.equal(typeof element.cls, 'string'); assert.ok(element.cls.length <= 256)
  }
  const names = elements.map(element => element.name)
  assert.ok(elements.reduce((sum, element) => sum + element.name.length + element.cls.length, 0) <= 32768)
  return names
}

export function assertDesktopWindowImage(window, executablePath) {
  assert.ok(typeof executablePath === 'string' && path.win32.isAbsolute(executablePath))
  assert.ok(typeof window?.image === 'string' && path.win32.isAbsolute(window.image))
  assert.equal(path.win32.normalize(window.image).toLowerCase(), path.win32.normalize(executablePath).toLowerCase(), 'Native window belongs to another executable')
  return true
}

// showErrorBox need not have the BrowserWindow as its Win32 owner. Bind the
// exact failure dialog to the isolated application's PID and executable instead.
export function isDesktopUnappliedDialogWindow(window, pid) {
  if (!(window?.pid === pid && window.visible === true &&
    window.cls === '#32770' && window.title === UNAPPLIED_QUIT_DIALOG_CAPTION &&
    Number.isSafeInteger(window.handle) && window.handle > 0 &&
    Array.isArray(window.childText))) return false
  let names = window.childText
  if (window.accessibility != null) {
    try { names = [...names, ...assertDesktopAccessibleText(window)] } catch { return false }
  }
  return [UNAPPLIED_QUIT_DIALOG_TITLE, UNAPPLIED_QUIT_DIALOG_MESSAGE].every(expected =>
    names.some(text => typeof text === 'string' && text.includes(expected)))
}

export function selectDesktopUnappliedDialog(windows, pid, executablePath) {
  assert.ok(Array.isArray(windows)); assert.ok(Number.isInteger(pid) && pid > 0)
  const candidates = windows.filter(window => window?.pid === pid && window.visible === true &&
    window.cls === '#32770' && window.title === UNAPPLIED_QUIT_DIALOG_CAPTION)
  assert.equal(candidates.length, 1, 'Expected one visible Error dialog in the owned process')
  const matches = windows.filter(window => isDesktopUnappliedDialogWindow(window, pid))
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
