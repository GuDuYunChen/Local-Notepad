// Exercise the actual queue + review components with synthetic conflicts and
// production CSS in native Chromium. This is not a live WebDAV sync test.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'test-results', 'sync-conflict-queue')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-queue-render-')))
const watchdog = setTimeout(() => { console.error('Queue renderer timed out'); app.exit(1) }, 60000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
// Every scenario closes its test window. Do not let Electron's default
// last-window behavior exit successfully before the remaining scenes run.
app.on('window-all-closed', () => {})
const commit = process.env.GITHUB_SHA || null

function inspectQueue() {
  const queue = document.querySelector('.sync-conflict-queue')
  if (!queue) return { ready: false }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const paint = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1) }
  const pixel = () => [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  const luminance = rgb => rgb.map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 })
    .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0)
  const colors = []
  for (const [selector, token] of [
    ['.sync-conflict-heading>strong', '--ink'], ['.sync-queue-hint', '--ink-soft'],
    ['.sync-queue-search', '--ink'], ['.sync-queue-tools input', '--ink'],
    ['.sync-queue-tools select', '--ink'], ['.sync-queue-count', '--ink'],
    ['.sync-queue-identifiers', '--ink-soft'], ['.sync-conflict-item>div>strong', '--ink'],
    ['.sync-conflict-item>div>span', '--ink-soft'],
  ]) {
    const el = queue.querySelector(selector)
    if (!el) return { ready: false, missing: selector }
    const style = getComputedStyle(el), chain = []
    for (let node = el; node; node = node.parentElement) chain.unshift(node)
    ctx.clearRect(0, 0, 1, 1); paint('#fff')
    for (const node of chain) paint(getComputedStyle(node).backgroundColor)
    const background = pixel(); paint(style.color); const foreground = pixel()
    const a = luminance(foreground), b = luminance(background)
    ctx.clearRect(0, 0, 1, 1); paint(style.getPropertyValue(token).trim()); const expected = pixel()
    colors.push({ selector, foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
      finalColor: foreground.every((n, i) => n === expected[i]) })
  }
  const rect = queue.getBoundingClientRect()
  return { ready: true, colors, count: queue.querySelectorAll('[data-conflict-id]').length,
    bounds: [rect.left, rect.width, rect.height], viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth - innerWidth,
    writes: window.__queueWrites, activeMarkup: queue.querySelectorAll('img,script,iframe,a').length,
    label: queue.querySelector('.sync-queue-count').textContent }
}

app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true })
  await build({ absWorkingDir: root, bundle: true, format: 'iife', platform: 'browser',
    alias: { '~': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(output, 'fixture.js'), stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import './src/components/SyncCenterPanel.css';
      import Queue from './src/components/SyncConflictQueue.jsx';
      import { queueFixture, queueAttachment } from './scripts/fixtures/sync-conflict-queue.mjs';
      window.__queueWrites = 0;
      const conflicts = [...queueFixture(24), queueAttachment()];
      conflicts[0].local_record.file.title = '保持纯文本：<img src=x onerror=alert(1)>';
      createRoot(document.getElementById('root')).render(<div className="settings-card consumer-settings-section sync-center-card"><Queue conflicts={conflicts} scope="synthetic" onResolve={() => { window.__queueWrites++; return false }}/></div>);
    ` } })
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
  const styles = [...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]
    .map(m => pathToFileURL(path.resolve(root, 'dist', m[1].replace(/^\//, ''))).href)
  if (!styles.length) throw new Error('Production styles are missing')
  const reports = []
  const inspect = win => win.webContents.executeJavaScript('(' + inspectQueue.toString() + ')()')
  const capture = async (win, name, expectedRows) => {
    let data, previous = '', samples = 0
    for (let i = 0; i < 40; i++) {
      await delay(100); data = await inspect(win)
      const valid = data.ready && data.count === expectedRows && data.overflow <= 1 && data.writes === 0 && data.activeMarkup === 0 &&
        data.colors.every(c => c.finalColor && Number.isFinite(c.ratio) && c.ratio >= 4.5)
      const signature = JSON.stringify(data)
      samples = valid ? (signature === previous ? samples + 1 : 1) : 0; previous = signature
      if (samples >= 3) break
    }
    const png = (await win.capturePage()).toPNG()
    reports.push({ name, stableSamples: samples, ...data, imageSize: [png.readUInt32BE(16), png.readUInt32BE(20)] })
    fs.writeFileSync(path.join(output, name + '.png'), png)
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ platform: process.platform, syntheticRecords: true, backendExercised: false, commit, complete: false, reports }, null, 2))
    if (samples < 3) throw new Error('Queue render failed: ' + JSON.stringify(data))
  }
  const click = async (win, label) => {
    const ok = await win.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`)
    if (!ok) throw new Error('Missing enabled queue action: ' + label)
    await delay(100)
  }
  for (const [theme, width] of [['light', 1180], ['dark', 1180], ['dark', 560]]) {
    const filename = path.join(output, `fixture-${theme}-${width}.html`)
    fs.writeFileSync(filename, `<!doctype html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(href => `<link rel="stylesheet" href="${href}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important;scroll-behavior:auto!important}body{margin:0;padding:18px;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0}.settings-card{margin:0;max-width:none}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
    const win = new BrowserWindow({ show: false, width, height: 900, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    await win.loadFile(filename); await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)')
    await capture(win, `${theme}-${width}`, 10)
    if (width === 560) {
      await click(win, '下一页冲突'); await click(win, '下一页冲突')
      const focus = await win.webContents.executeJavaScript('document.activeElement.textContent')
      if (focus !== '冲突中心') throw new Error('Queue pagination focus was lost')
      await win.webContents.executeJavaScript('window.scrollTo(0,0)')
      await capture(win, 'dark-560-last-page', 5)
      await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('[aria-label="搜索冲突"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'资料😀');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`)
      await capture(win, 'dark-560-search', 1)
      const tail = await win.webContents.executeJavaScript(`({text:document.querySelector('.sync-conflict-queue').textContent,html:document.querySelector('.sync-conflict-queue').querySelectorAll('img,script,iframe,a').length,writes:window.__queueWrites})`)
      if (!tail.text.includes('资料😀.pdf') || !tail.text.includes('匹配 1 / 当前列表 25') || tail.html || tail.writes) throw new Error('Native filename search failed')
    }
    win.destroy()
  }
  const summary = { platform: process.platform, syntheticRecords: true, realComponents: true, backendExercised: false, commit, complete: true,
    navigationFocus: true, nativeSearch: true, writes: 0, reports }
  fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary))
  clearTimeout(watchdog); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1) })
