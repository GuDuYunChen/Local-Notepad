// Run with the installed Electron after build:renderer. No backend or user data.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const syncFs = require('node:fs')
const { createHash } = require('node:crypto')
const { isolateBrandRenderProfile, createBrandRenderLifecycle } = require('./brand-render-lifecycle.cjs')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'test-results', 'brand-theme')
// Set these before whenReady: this fixture must never open the default profile.
isolateBrandRenderProfile(app)
syncFs.mkdirSync(output, { recursive: true })
for (const name of ['checks.json', 'light.png', 'dark.png']) {
  if (syncFs.existsSync(path.join(output, name))) throw new Error('Refusing stale brand-render evidence')
}
const identity = {
  commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
  attempt: process.env.GITHUB_RUN_ATTEMPT || null, event: process.env.GITHUB_EVENT_NAME || null,
  platform: process.platform, electron: process.versions.electron,
  source: Object.fromEntries(['scripts/check-brand-theme-render.cjs', 'scripts/brand-render-lifecycle.cjs',
    'scripts/theme-render-fixture.mjs'].map(name => [name,
      createHash('sha256').update(syncFs.readFileSync(path.join(root, name))).digest('hex')])),
}
let window
const lifecycle = createBrandRenderLifecycle({
  write: report => syncFs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ ...report, identity }, null, 2)),
  exit: code => {
    if (code) console.error('Brand/theme renderer failed; see checks.json for its last completed phase')
    if (window && !window.isDestroyed()) window.destroy()
    app.exit(code)
  },
})
const imageReceipt = async name => {
  const bytes = await fs.readFile(path.join(output, name)), decoded = nativeImage.createFromBuffer(bytes)
  if (decoded.isEmpty()) throw new Error('Brand renderer screenshot is empty')
  return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...decoded.getSize() }
}
app.whenReady().then(async () => {
  if (!lifecycle.mark('ready')) return
  const { APP_ICON_DATA_URL } = await import(pathToFileURL(path.join(root, 'src/assets/appIconData.js')).href)
  const { createThemeFixture, verifyDarkThemeFixture } = await import(pathToFileURL(path.join(root, 'scripts/theme-render-fixture.mjs')).href)
  const image = nativeImage.createFromDataURL(APP_ICON_DATA_URL)
  if (image.isEmpty() || image.getSize().width !== 256) throw new Error('Electron cannot decode the brand source')
  if (process.platform === 'win32' && nativeImage.createFromPath(path.join(root, 'build/icon.ico')).isEmpty()) throw new Error('Windows cannot decode the ICO')
  const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8')
  const styles = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]
    .map(match => pathToFileURL(path.resolve(root, 'dist', match[1].replace(/^\//, ''))).href)
  if (!styles.length) throw new Error('No built renderer CSS found')
  await fs.mkdir(output, { recursive: true })
  const fixture = path.join(output, 'fixture.html')
  await fs.writeFile(fixture, createThemeFixture(styles, APP_ICON_DATA_URL))
  if (!lifecycle.mark('assets-ready')) return
  const win = new BrowserWindow({ show: false, width: 1280, height: 960,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  window = win
  win.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame) lifecycle.fail('main-frame-load-failed', { errorCode })
  })
  win.webContents.on('render-process-gone', () => lifecycle.fail('renderer-gone'))
  if (!lifecycle.mark('window-created')) return
  await win.loadFile(fixture)
  if (!lifecycle.mark('document-loaded')) return
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  if (!lifecycle.mark('fonts-ready')) return
  const snapshot = `JSON.stringify(['sidebar','document','primary','dialog'].map(id=>{const s=getComputedStyle(document.getElementById(id));return [s.color,s.backgroundColor]}))`
  const lightBefore = await win.webContents.executeJavaScript(snapshot)
  await fs.writeFile(path.join(output, 'light.png'), (await win.capturePage()).toPNG())
  if (!lifecycle.mark('light-captured')) return
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`)
  await new Promise(resolve => setTimeout(resolve, 250))
  const result = await win.webContents.executeJavaScript(`(${verifyDarkThemeFixture.toString()})()`)

  // Hidden BrowserWindows do not reliably update Chromium's :hover state on
  // Windows CI. Verify the computed production hover token here; the static
  // brand/theme suite separately validates that the primary hover selector
  // consumes --action-hover.
  const hoverToken = await win.webContents.executeJavaScript(
    `getComputedStyle(document.documentElement).getPropertyValue('--action-hover').trim()`
  )
  if (hoverToken.toLowerCase() !== '#79baff') {
    throw new Error('Primary hover token failed: ' + hoverToken)
  }

  // Programmatic focus in a hidden BrowserWindow does not establish Chromium's
  // keyboard modality, so :focus-visible is not a deterministic native CI probe.
  // Verify focusability here; the static suite enforces the actual focus-ring rule.
  const focused = await win.webContents.executeJavaScript(`(()=>{const el=document.getElementById('field');el.focus();return document.activeElement===el})()`)
  if (!focused) throw new Error('Input cannot receive focus')
  if (!lifecycle.mark('dark-verified')) return
  await fs.writeFile(path.join(output, 'dark.png'), (await win.capturePage()).toPNG())
  if (!lifecycle.mark('dark-captured')) return
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`)
  await new Promise(resolve => setTimeout(resolve, 200))
  const lightState = await win.webContents.executeJavaScript(`(()=>{const s=getComputedStyle(document.documentElement);return {theme:document.documentElement.dataset.theme,paper:s.getPropertyValue('--paper').trim(),surface:s.getPropertyValue('--surface').trim(),ink:s.getPropertyValue('--ink').trim()}})()`)
  if (lightState.theme !== 'light' || lightState.paper.toLowerCase() !== '#f6f6f8' ||
      lightState.surface.toLowerCase() !== '#ffffff' || lightState.ink.toLowerCase() !== '#24222a') {
    throw new Error('Light theme tokens do not restore: ' + JSON.stringify(lightState))
  }
  console.log(JSON.stringify({ ...result, checks: result.checks + 3, nativePng: true, nativeIco: process.platform === 'win32', lightRoundTrip: true }))
  if (!lifecycle.mark('light-restored')) return
  lifecycle.complete({ ...result, checks: result.checks + 3, nativePng: true,
    nativeIco: process.platform === 'win32', lightRoundTrip: true },
    [await imageReceipt('light.png'), await imageReceipt('dark.png')])
}).catch(() => { lifecycle.fail('exception') })
