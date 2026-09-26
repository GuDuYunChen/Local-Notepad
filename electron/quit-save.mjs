import { randomBytes } from 'node:crypto'

export const QUIT_PREPARE = 'editor:quit:prepare'
export const QUIT_RESULT = 'editor:quit:result'
export const QUIT_RELEASE = 'editor:quit:release'
const messages = {
  composition: '输入法文字尚未确认。请完成输入后再退出，当前窗口和数据服务保留。',
  source: 'Markdown 源码有尚未应用的更改。请应用到正文并保存，或明确放弃后再退出。',
  structure: '章节结构尚未确认。请返回编辑器，使用 Ctrl+S 检查引用影响后再退出。',
  unresolved: '仍有切换前或已关闭笔记的正文未确认保存。请返回相应笔记保存后再退出。',
  loading: '正文仍在加载或切换，尚不能确认保存状态。请返回编辑器检查后再退出。',
  changed: '保存期间正文或文档发生变化，尚未确认最新内容。请检查并保存后再退出。',
  timeout: '等待编辑器保存确认超时。窗口和本地数据服务保留，请检查正文保存状态后重试。',
  'save-failed': '正文保存未获确认。已取消退出，请检查本地数据服务并保存正文。',
  unavailable: '编辑器暂时无法确认保存状态。已取消退出，未请求停止本地数据服务。',
}
export function quitSaveMessage(code) { return messages[code] || messages['save-failed'] }

// Exactly one current main-frame challenge. No renderer-supplied text or file IDs.
export function createQuitSaveGate({ ipcMain, timeoutMs = 10000, schedule = setTimeout, cancel = clearTimeout,
  makeID = () => randomBytes(16).toString('hex') }) {
  let current = null
  function release() {
    const task = current
    if (!task) return
    current = null
    task.cleanup()
    try { if (!task.wc.isDestroyed()) task.wc.send(QUIT_RELEASE, { id: task.id }) } catch {}
    if (!task.settled) { task.settled = true; task.reject(new Error(quitSaveMessage('unavailable'))) }
  }
  function prepare(win) {
    if (!win || win.isDestroyed()) return Promise.resolve()
    const wc = win.webContents
    if (wc.isDestroyed() || wc.isCrashed?.()) return Promise.reject(new Error(quitSaveMessage('unavailable')))
    // No renderer has ever been loaded; there cannot yet be an editor draft.
    if (wc.getURL() === '' && !wc.isLoading()) return Promise.resolve()
    if (current) {
      if (current.wc === wc) return current.promise
      return Promise.reject(new Error(quitSaveMessage('unavailable')))
    }
    const id = makeID(), frame = wc.mainFrame
    let resolve, reject, timer
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    const task = { id, wc, promise, resolve, reject, settled: false, approved: false }
    function cleanup() {
      cancel(timer)
      ipcMain.removeListener(QUIT_RESULT, receive)
      wc.removeListener('render-process-gone', lost)
      wc.removeListener('destroyed', lost)
      wc.removeListener('did-start-navigation', navigated)
    }
    function fail(code) {
      if (current !== task || task.settled) return
      task.settled = true
      task.reject(new Error(quitSaveMessage(code)))
      release()
    }
    function lost() { fail('unavailable') }
    function navigated(_event, _url, _inPlace, isMainFrame) { if (isMainFrame) lost() }
    function receive(event, value) {
      if (current !== task || task.settled || event.sender !== wc || event.senderFrame !== frame || wc.mainFrame !== frame ||
          value?.id !== id || typeof value?.ready !== 'boolean') return
      if (!value.ready) { fail(value.code); return }
      task.settled = true
      task.approved = true
      cleanup()
      resolve()
      // Keep the renderer frozen through backend drain. release() only on abort.
    }
    task.cleanup = cleanup
    current = task
    ipcMain.on(QUIT_RESULT, receive)
    wc.once('render-process-gone', lost)
    wc.once('destroyed', lost)
    wc.on('did-start-navigation', navigated)
    timer = schedule(() => fail('timeout'), timeoutMs)
    try { wc.send(QUIT_PREPARE, { id }) } catch { fail('unavailable') }
    return promise
  }
  return { prepare, release }
}
