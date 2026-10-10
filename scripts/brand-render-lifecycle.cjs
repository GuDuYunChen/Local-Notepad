// Test-only lifecycle for the real brand/theme renderer. No user profile reuse,
// screenshot fabrication, retries or relaxed visual checks.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const PHASES = Object.freeze(['starting', 'ready', 'assets-ready', 'window-created',
  'document-loaded', 'fonts-ready', 'light-captured', 'dark-verified',
  'dark-captured', 'light-restored'])
const TIMEOUT_MS = 45000

function isolateBrandRenderProfile(app) {
  if (app.isReady()) throw new Error('Brand fixture profile must be isolated before ready')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-brand-render-'))
  // Chromium session files must not fall back to the caller's default profile.
  // This is an owned temporary test directory, not a user-data migration.
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  return profile
}

function createBrandRenderLifecycle({ write, exit, now = Date.now, schedule = setTimeout,
  cancel = clearTimeout }) {
  if (![write, exit, now, schedule, cancel].every(value => typeof value === 'function')) {
    throw new TypeError('Invalid brand-render lifecycle')
  }
  const started = now()
  let phase = 0, settled = false, timer
  const observations = [{ phase: PHASES[0], elapsedMs: 0 }]
  const snapshot = (complete, reason, result = null, images = null, detail = null) => ({
    schema: 1, complete, reason, phase: PHASES[phase], budgetMs: TIMEOUT_MS,
    elapsedMs: Math.max(0, now() - started), observations: observations.map(row => ({ ...row })),
    result, images, detail,
  })
  function finish(complete, reason, result, images, detail) {
    if (settled) return false
    settled = true
    cancel(timer)
    let code = complete ? 0 : 1
    try { write(snapshot(complete, reason, result, images, detail)) }
    catch { code = 1 } // A successful child may not hide a missing final receipt.
    exit(code)
    return true
  }
  function fail(reason = 'exception', detail = null) {
    const allowed = ['timeout', 'main-frame-load-failed', 'renderer-gone', 'exception',
      'invalid-progress', 'incomplete-evidence', 'report-write-failed']
    if (!allowed.includes(reason)) reason = 'exception'
    // Do not serialize native exception messages, URLs, stacks or profile paths.
    const safe = detail && Number.isSafeInteger(detail.errorCode) ? { errorCode: detail.errorCode } : null
    return finish(false, reason, null, null, safe)
  }
  function persist() {
    if (settled) return false
    try { write(snapshot(false, 'in-progress')); return true }
    catch { fail('report-write-failed'); return false }
  }
  function mark(name) {
    if (settled) return false
    if (PHASES[phase + 1] !== name) { fail('invalid-progress'); return false }
    phase++
    observations.push({ phase: name, elapsedMs: Math.max(0, now() - started) })
    return persist()
  }
  function complete(result, images) {
    if (settled) return false
    if (phase !== PHASES.length - 1 || !result || result.checks !== 23 ||
      result.nativePng !== true || result.lightRoundTrip !== true ||
      !Number.isFinite(result.primaryContrast) || result.primaryContrast < 4.5 ||
      !Number.isFinite(result.mutedContrast) || result.mutedContrast < 4.5 ||
      !Array.isArray(images) || images.length !== 2 ||
      images.some((image, index) => !image || image.name !== ['light.png', 'dark.png'][index] ||
        !Number.isSafeInteger(image.bytes) || image.bytes < 33 ||
        !/^[a-f0-9]{64}$/.test(image.sha256) ||
        !Number.isSafeInteger(image.width) || image.width < 1 ||
        !Number.isSafeInteger(image.height) || image.height < 1)) {
      return fail('incomplete-evidence')
    }
    const safeResult = { checks: result.checks, nativePng: true, nativeIco: result.nativeIco === true,
      lightRoundTrip: true, primaryContrast: result.primaryContrast, mutedContrast: result.mutedContrast }
    const safeImages = images.map(image => ({ name: image.name, bytes: image.bytes,
      sha256: image.sha256, width: image.width, height: image.height }))
    return finish(true, 'verified', safeResult, safeImages, null)
  }
  timer = schedule(() => fail('timeout'), TIMEOUT_MS)
  // Even before app.whenReady() or loadFile() settles, failure has a readable stage.
  persist()
  return Object.freeze({ mark, complete, fail, isSettled: () => settled })
}
module.exports = { isolateBrandRenderProfile, createBrandRenderLifecycle, PHASES, TIMEOUT_MS }
