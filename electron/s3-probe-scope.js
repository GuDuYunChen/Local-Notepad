// A narrow sender/document lifetime guard for the unpublished S3 probe bridge.
// Main-process configuration only; never pass renderer-supplied URLs or timers.
// No credentials, requests, response data, filesystem or network live here.
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/

function documentURL(value) {
  if (typeof value !== 'string' || value.length > 8192) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search) return null
    if (url.protocol === 'file:') {
      if (url.host) return null
    } else if (url.protocol === 'http:') {
      if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5000') return null
    } else return null
    url.hash = ''
    return url.href
  } catch { return null }
}

export function createS3ProbeScope({ getWindow, getExpectedURL, isClosing = () => false,
  timeoutMs = 7500, schedule = setTimeout, cancelTimer = clearTimeout } = {}) {
  if (typeof getWindow !== 'function' || typeof getExpectedURL !== 'function' ||
      typeof isClosing !== 'function' || typeof schedule !== 'function' ||
      typeof cancelTimer !== 'function' || !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 || timeoutMs > 8000) throw new TypeError('Invalid S3 probe scope configuration')
  let active = null
  let disposed = false

  function trusted(event, expectedOwner) {
    try {
      if (disposed || isClosing() !== false) return false
      const win = getWindow()
      if (!win || win.isDestroyed() || (expectedOwner && win !== expectedOwner)) return false
      const contents = win.webContents
      if (!contents || contents.isDestroyed() || event?.sender !== contents ||
          !event.senderFrame || event.senderFrame !== contents.mainFrame) return false
      const expected = documentURL(getExpectedURL())
      return Boolean(expected && documentURL(event.senderFrame.url) === expected &&
        documentURL(contents.getURL()) === expected)
    } catch { return false } // Never pass native exception strings to the renderer.
  }
  const refuse = code => Object.freeze({ ok: false, code })

  function acquire(event, requestId) {
    if (!trusted(event)) return refuse('untrusted-probe-sender')
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return refuse('invalid-probe-request')
    if (active) return refuse('probe-busy') // No queue or accepted replacement.
    let win
    try { win = getWindow() } catch { return refuse('untrusted-probe-sender') }
    if (!trusted(event, win)) return refuse('untrusted-probe-sender')
    const controller = new AbortController()
    const current = { event, requestId, win, controller }
    active = current
    let released = false
    let timer
    const listeners = []
    const abort = () => { if (!released && !controller.signal.aborted) controller.abort() }
    const navigation = (details, _url, _isInPlace, legacyMainFrame) => {
      // Electron 31 supplies positional isMainFrame. Also accept the documented
      // details field without treating missing/ambiguous frame identity as safe.
      const main = details?.isMainFrame
      if (main === true || legacyMainFrame === true || (main !== false && legacyMainFrame !== false)) abort()
    }
    const listen = (target, name, handler) => {
      // Record first so release can unwind a partially installed registration.
      listeners.push([target, name, handler])
      target.on(name, handler)
    }
    function release() {
      if (released) return
      released = true
      if (timer !== undefined) cancelTimer(timer)
      for (const [target, name, handler] of listeners.splice(0)) {
        try { target.removeListener(name, handler) } catch {}
      }
      if (active === current) active = null
    }
    try {
      listen(event.sender, 'did-start-navigation', navigation)
      listen(event.sender, 'render-process-gone', abort)
      listen(event.sender, 'destroyed', abort)
      listen(win, 'close', abort)
      listen(win, 'closed', abort)
      timer = schedule(abort, timeoutMs)
      timer?.unref?.()
      if (!trusted(event, win)) abort()
    } catch {
      abort(); release()
      return refuse('probe-scope-unavailable')
    }
    return Object.freeze({ ok: true, signal: controller.signal,
      mayDeliver: () => !released && active === current && !controller.signal.aborted && trusted(event, win),
      // Caller releases ONLY after the underlying request settles. Aborting
      // cannot open a second slot while the native request is still draining.
      release })
  }

  function cancel(event, requestId) {
    if (!trusted(event) || !active || active.event.sender !== event.sender ||
        active.event.senderFrame !== event.senderFrame || active.requestId !== requestId) return false
    active.controller.abort()
    return true
  }
  function abortAll() { active?.controller.abort() }
  function dispose() { disposed = true; abortAll() }
  return Object.freeze({ acquire, cancel, abortAll, dispose })
}
