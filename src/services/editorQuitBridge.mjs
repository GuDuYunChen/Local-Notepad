import { editorQuit, EditorQuitError, waitForQuit } from './editorQuit.mjs'

// A successful answer keeps input frozen until the main process closes the
// window or explicitly releases this exact challenge after a shutdown failure.
export function installEditorQuitBridge({ bridge, registry = editorQuit, freeze, timeoutMs = 8000,
  schedule = setTimeout, cancel = clearTimeout }) {
  if (!bridge?.onQuitPrepare || !bridge?.onQuitRelease || !bridge?.reportQuitResult) return () => {}
  let task = null, disposed = false
  function release(id) {
    if (!task || task.id !== id) return
    const old = task; task = null
    cancel(old.timer); old.controller.abort(); old.unlock()
  }
  const offRelease = bridge.onQuitRelease(value => release(value?.id))
  const offPrepare = bridge.onQuitPrepare(value => {
    if (disposed || !/^[a-f0-9]{32}$/.test(value?.id || '')) return
    if (task?.id === value.id) return
    if (task) release(task.id)
    let unlock
    try { unlock = freeze() } catch (error) {
      bridge.reportQuitResult({ id: value.id, ready: false,
        code: error instanceof EditorQuitError ? error.code : 'unavailable' })
      return
    }
    const controller = new AbortController()
    const next = { id: value.id, controller, unlock, timer: null }
    task = next
    next.timer = schedule(() => controller.abort(), timeoutMs)
    void waitForQuit(Promise.resolve().then(() => registry.flush(controller.signal)), controller.signal).then(() => {
      if (disposed || task !== next || controller.signal.aborted) return
      cancel(next.timer)
      bridge.reportQuitResult({ id: next.id, ready: true })
    }).catch(error => {
      if (disposed || task !== next) return
      const code = error instanceof EditorQuitError ? error.code : 'save-failed'
      bridge.reportQuitResult({ id: next.id, ready: false, code })
      release(next.id)
    })
  })
  return () => { disposed = true; offPrepare(); offRelease(); if (task) release(task.id) }
}

export function freezeEditorForQuit(doc = document, win = window) {
  const root = doc.getElementById('root'), focus = doc.activeElement, wasInert = root?.inert
  if (root) root.inert = true
  const veil = doc.createElement('div')
  veil.className = 'editor-quit-veil'
  veil.setAttribute('role', 'dialog'); veil.setAttribute('aria-modal', 'true'); veil.setAttribute('aria-label', '退出前保存正文')
  veil.tabIndex = -1
  const text = doc.createElement('p'); text.setAttribute('role', 'status')
  text.textContent = '正在确认正文保存，请勿关闭应用。保存失败会返回编辑，不会强制退出。'
  veil.appendChild(text); doc.body.appendChild(veil); veil.focus()
  const block = event => { event.preventDefault(); event.stopImmediatePropagation() }
  const events = ['keydown', 'beforeinput', 'paste', 'drop']
  for (const name of events) win.addEventListener(name, block, true)
  let released = false
  return () => {
    if (released) return
    released = true
    for (const name of events) win.removeEventListener(name, block, true)
    veil.remove()
    if (root) root.inert = wasInert
    if (focus?.isConnected) focus.focus()
  }
}

// Do not blur an active IME composition: text not committed to Lexical is not a
// database draft yet. The user must finish composition before confirming exit.
export function installDocumentQuitBridge({ bridge, doc = document, win = window, ...options }) {
  let composing = false
  const start = () => { composing = true }, end = () => { composing = false }
  win.addEventListener('compositionstart', start, true)
  win.addEventListener('compositionend', end, true)
  const dispose = installEditorQuitBridge({ ...options, bridge, freeze: () => {
    if (composing) throw new EditorQuitError('composition')
    return freezeEditorForQuit(doc, win)
  } })
  return () => {
    dispose()
    win.removeEventListener('compositionstart', start, true)
    win.removeEventListener('compositionend', end, true)
  }
}
