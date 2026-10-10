// Test harness only. Constructor dimensions can be constrained by the desktop.
// Establish the requested client size after load/menu changes, then observe it
// in both the native window and renderer. Never emulate or rewrite dimensions.
const { setTimeout: sleep } = require('node:timers/promises')
const VIEWPORT_PROBE = '({width:innerWidth,height:innerHeight})'
const MAX_OBSERVATIONS = 20
function positive(value, max) { return Number.isSafeInteger(value) && value > 0 && value <= max }
function dimensions(size) {
  if (!Array.isArray(size) || size.length !== 2 || !size.every(v => positive(v, 16384))) {
    throw new Error('Native viewport returned invalid content dimensions')
  }
  return { width: size[0], height: size[1] }
}
function readWithTimeout(contents, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native viewport renderer read timed out')), timeoutMs)
    Promise.resolve().then(() => contents.executeJavaScript(VIEWPORT_PROBE)).then(
      value => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); reject(new Error('Native viewport renderer read failed')) },
    )
  })
}
async function establishNativeViewport(win, width, height, { intervalMs = 50, readTimeoutMs = 1000 } = {}) {
  if (!positive(width, 16384) || !positive(height, 16384) || !positive(intervalMs, 100) || !positive(readTimeoutMs, 1000)) {
    throw new TypeError('Native viewport dimensions or timing budget are invalid')
  }
  if (win.isDestroyed()) throw new Error('Native viewport window was destroyed')
  const requested = { width, height }, initial = dimensions(win.getContentSize())
  // Exactly one explicit resize, not repeated retries, zoom, CSS overrides,
  // device emulation, replacement windows or an updated expected screenshot.
  win.setContentSize(width, height)
  let consecutiveMatches = 0, content, renderer
  for (let observations = 1; observations <= MAX_OBSERVATIONS; observations++) {
    await sleep(intervalMs)
    if (win.isDestroyed()) throw new Error('Native viewport window was destroyed')
    content = dimensions(win.getContentSize())
    renderer = await readWithTimeout(win.webContents, readTimeoutMs)
    const matches = content.width === width && content.height === height &&
      renderer?.width === width && renderer?.height === height
    consecutiveMatches = matches ? consecutiveMatches + 1 : 0
    if (consecutiveMatches >= 2) {
      return { requested, initial, content, renderer, resizeRequests: 1, observations, consecutiveMatches }
    }
  }
  throw new Error(`Native viewport did not settle at ${width}x${height}; content=${content?.width}x${content?.height}, renderer=${renderer?.width}x${renderer?.height}`)
}
module.exports = { establishNativeViewport, VIEWPORT_PROBE, MAX_OBSERVATIONS }
