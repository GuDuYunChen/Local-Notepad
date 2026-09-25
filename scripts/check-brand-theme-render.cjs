// Run with the installed Electron after build:renderer. No backend or user data.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'test-results', 'brand-theme')
const watchdog = setTimeout(() => { console.error('Brand/theme renderer timeout'); app.exit(1) }, 45000)
app.whenReady().then(async () => {
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
  const win = new BrowserWindow({ show: false, width: 1280, height: 960,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await win.loadFile(fixture)
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  const snapshot = `JSON.stringify(['sidebar','document','primary','dialog'].map(id=>{const s=getComputedStyle(document.getElementById(id));return [s.color,s.backgroundColor]}))`
  const lightBefore = await win.webContents.executeJavaScript(snapshot)
  await fs.writeFile(path.join(output, 'light.png'), (await win.capturePage()).toPNG())
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
  await fs.writeFile(path.join(output, 'dark.png'), (await win.capturePage()).toPNG())
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`)
  await new Promise(resolve => setTimeout(resolve, 200))
  const lightAfter = await win.webContents.executeJavaScript(snapshot)
  if (lightBefore !== lightAfter) throw new Error('Light theme does not restore after switching')
  console.log(JSON.stringify({ ...result, checks: result.checks + 3, nativePng: true, nativeIco: process.platform === 'win32', lightRoundTrip: true }))
  win.destroy(); clearTimeout(watchdog); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1) })
