// Render real review/diff components with synthetic records and production
// styles. No backend, user workspace, credentials or synchronizing provider.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const { diffCSSReferences, createDiffCaptureGate, captureDiffFrame, loadDiffWindow } = require('./sync-diff-render-capture.cjs')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'test-results', 'sync-conflict-diff')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-diff-render-'))
app.setPath('userData', profile)
// An unexpected fixture-window close must reach the failure path/watchdog;
// Electron's implicit all-windows-closed exit cannot count as success.
app.on('window-all-closed', () => {})
const reports = []
let currentPhase = 'starting', windowLifecycle = null
const writeChecks = (complete, error) => {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({
    commit: process.env.GITHUB_SHA || null, platform: process.platform, realComponents: true,
    syntheticRecords: true, backendExercised: false, windowLifecycle, reports, complete,
    ...(complete ? { navigationFocus: true, writes: 0 } : { phase: currentPhase }),
    ...(error ? { error: String(error.stack || error) } : {}),
  }, null, 2))
}
const watchdog = setTimeout(() => { const error = Error('Conflict diff renderer timeout'); writeChecks(false, error); console.error(error); app.exit(1) }, 60000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// This function executes inside Chromium. Canvas resolves CSS colors and alpha
// compositing against the actual ancestor backgrounds, including light-mode
// translucent semantic colors. Do not treat rgba(..., .1) as opaque RGB.
function inspectDiff(cssReferences) {
  const table = document.querySelector('.sync-diff-table')
  const wrap = document.querySelector('.sync-diff-table-wrap')
  if (!table || !wrap) return { themeColorsReady: false, visible: false }
  const bounds = wrap.getBoundingClientRect(), rasterProbes = []
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const paint = color => { context.fillStyle = color; context.fillRect(0, 0, 1, 1) }
  const pixel = () => [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
  const resolve = color => { context.clearRect(0, 0, 1, 1); paint(color); return pixel() }
  const luminance = rgb => rgb.map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 })
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
  const colors = []
  for (const kind of ['local', 'remote']) {
    const cell = document.querySelector('.sync-diff-' + kind + ' td:last-child')
    const cellBounds = cell.getBoundingClientRect(), y = Math.ceil(cellBounds.top) + 4
    for (const [position, x] of [['left', Math.ceil(cellBounds.left) + 16], ['right', Math.floor(Math.min(cellBounds.right, bounds.right - 16)) - 8]]) {
      rasterProbes.push({ kind, position, x, y, exposed: document.elementFromPoint(x, y)?.closest('td') === cell })
    }
    for (const selector of ['pre', '.sync-diff-line-meta strong', '.sync-diff-line-meta span']) {
      const element = cell.querySelector(selector), style = getComputedStyle(element)
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node)
      context.clearRect(0, 0, 1, 1); paint('#ffffff')
      for (const node of ancestors) paint(getComputedStyle(node).backgroundColor)
      const background = pixel(); paint(style.color); const foreground = pixel()
      const a = luminance(foreground), b = luminance(background)
      const expected = resolve(style.getPropertyValue('--ink').trim())
      const cellStyle = getComputedStyle(cell)
      const expectedFill = cellStyle.getPropertyValue(kind === 'local' ? '--danger-light' : '--success-light').trim() || cellStyle.getPropertyValue('--paper').trim()
      context.clearRect(0, 0, 1, 1); paint('#ffffff')
      for (const node of ancestors) paint(node === cell ? expectedFill : getComputedStyle(node).backgroundColor)
      const expectedBackground = pixel()
      colors.push({ kind, selector, foreground, background,
        ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
        finalForeground: foreground.every((value, i) => value === expected[i]),
        finalBackground: background.every((value, i) => value === expectedBackground[i]) })
    }
  }
  const textChecks = []
  for (const [id, selector, token, ordinal] of [
    ['heading', '.sync-diff-heading > strong', '--ink', 0],
    ['position', '.sync-diff-navigation > strong', '--ink', 0],
    ['local-column', '.sync-diff-table th', '--ink-soft', 0],
    ['remote-column', '.sync-diff-table th', '--ink-soft', 1],
    ['text-column', '.sync-diff-table th', '--ink', 2],
    ['summary', '.sync-diff-summary', '--ink', 0],
    ['description', '.sync-diff-details > p.sync-review-caption', '--ink-soft', 0],
    ['range', '.sync-diff-details > p.sync-review-caption', '--ink-soft', 1],
    ['source', '.sync-diff-details > p.sync-review-caption', '--ink-soft', 2],
  ]) {
    const element = document.querySelectorAll(selector)[ordinal]
    if (!element) throw new Error('Missing diff text probe: ' + id)
    const style = getComputedStyle(element), ancestors = []
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node)
    context.clearRect(0, 0, 1, 1); paint('#ffffff')
    for (const node of ancestors) paint(getComputedStyle(node).backgroundColor)
    const background = pixel(); paint(style.color); const foreground = pixel()
    const a = luminance(foreground), b = luminance(background)
    const expected = resolve(style.getPropertyValue(token).trim())
    textChecks.push({ id, foreground, background,
      ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
      finalForeground: foreground.every((value, i) => value === expected[i]) })
  }
  const runningAnimations = document.getAnimations().filter(animation => animation.playState === 'running')
    .map(animation => ({ target: animation.effect?.target?.tagName, className: animation.effect?.target?.className,
      property: animation.transitionProperty || animation.animationName || '',
      currentTime: animation.currentTime, progress: animation.effect?.getComputedTiming?.().progress }))
  return { themeColorsReady: colors.every(color => color.finalForeground && color.finalBackground) && textChecks.every(text => text.finalForeground),
    visible: bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth,
    bounds: { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right },
    viewport: { width: innerWidth, height: innerHeight },
    rows: table.tBodies[0].rows.length, bodyOverflow: document.documentElement.scrollWidth - innerWidth,
    tableOverflow: wrap.scrollWidth - wrap.clientWidth, colors, textChecks, writes: window.__diffWrites,
    activeContent: table.querySelectorAll('img,script,a,iframe').length,
    theme: document.documentElement.dataset.theme, visibility: document.visibilityState,
    capturePhase: window.__diffCapturePhase, tableText: table.textContent,
    scroll: { x: scrollX, y: scrollY, tableLeft: wrap.scrollLeft, tableTop: wrap.scrollTop }, rasterProbes, cssReferences,
    runningAnimations: runningAnimations.slice(0, 30), runningAnimationCount: runningAnimations.length }
}

// An isolated fixture witness, not product UI. It binds the saved compositor
// image to this theme/navigation phase; semantic row probes still have to match.
function setCapturePhase(phase) {
  let marker = document.getElementById('diff-capture-witness')
  if (!marker) {
    marker = document.createElement('div'); marker.id = 'diff-capture-witness'; marker.setAttribute('aria-hidden', 'true')
    Object.assign(marker.style, { position: 'fixed', top: '0', left: '0', width: '32px', height: '4px',
      display: 'flex', pointerEvents: 'none', zIndex: '2147483647', margin: '0', padding: '0', border: '0', transition: 'none' })
    document.body.append(marker)
  }
  marker.replaceChildren(...Array.from({ length: 8 }, (_, bit) => {
    const pixel = document.createElement('span')
    Object.assign(pixel.style, { display: 'block', width: '4px', height: '4px', flex: 'none',
      margin: '0', padding: '0', border: '0', transition: 'none', background: (phase >>> bit) & 1 ? 'rgb(221,238,255)' : 'rgb(17,34,51)' })
    return pixel
  }))
  window.__diffCapturePhase = phase
}

app.whenReady().then(async () => {
  currentPhase = 'building'; writeChecks(false)
  await build({ absWorkingDir: root, bundle: true, format: 'iife', platform: 'browser',
    alias: { '~': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(output, 'fixture.js'), stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import Review from './src/components/SyncConflictReview.jsx';
      import './src/components/SyncCenterPanel.css';
      import { conflictFixture, fileRecord } from './scripts/fixtures/sync-conflict-review.mjs';
      window.__diffWrites = 0;
      const conflict = conflictFixture({local_record: fileRecord('开始核对\\n本机保留原有说明。\\n共同上下文。\\n本机第二处。\\n结束'), remote_record: fileRecord('开始核对\\n远端增加一条补充说明。\\n共同上下文。\\n远端第二处：<img src=x onerror=alert(1)> ' + 'longword'.repeat(80) + '\\n结束')});
      createRoot(document.getElementById('root')).render(<div className="settings-card consumer-settings-section sync-center-card"><Review conflict={conflict} scope="synthetic-render-scope" onResolve={() => { window.__diffWrites++; return false }}/></div>);
    ` } })
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
  const styles = [...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]
    .map(match => pathToFileURL(path.resolve(root, 'dist', match[1].replace(/^\//, ''))).href)
  if (!styles.length) throw new Error('Missing production renderer styles')
  fs.writeFileSync(path.join(output, 'fixture.html'), `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(href => `<link rel="stylesheet" href="${href}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important;scroll-behavior:auto!important}body{margin:0;padding:18px;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0}.settings-card{margin:0;max-width:none}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  currentPhase = 'first-paint'
  windowLifecycle = await loadDiffWindow(win, path.join(output, 'fixture.html'))
  const click = async label => {
    const found = await win.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`)
    if (!found) throw new Error('Missing enabled button: ' + label)
    await wait(100)
  }
  for (let i = 0; i < 30; i++) {
    if (await win.webContents.executeJavaScript(`!!document.querySelector('button')`)) break
    await wait(50)
  }
  await click('对照版本'); await click('查看正文差异')
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)')
  const capture = async name => {
    currentPhase = name
    const phase = reports.length + 1
    await win.webContents.executeJavaScript('(' + setCapturePhase.toString() + ')(' + phase + ')')
    const inspect = async () => ({ ...await win.webContents.executeJavaScript('(' + inspectDiff.toString() + ')((' + diffCSSReferences.toString() + ')("inspect",' + phase + '))'),
      windowVisible: win.isVisible() && !win.isMinimized() })
    const capturePNG = async () => (await win.capturePage()).toPNG({ scaleFactor: 1 })
    let check, stability = { ready: false, samples: 0 }
    const gate = createDiffCaptureGate()
    // Three consecutive correctly colored and geometrically identical frames,
    // not page-wide animation completion. Keep transitions enabled and record
    // animation diagnostics; unrelated animation cannot approve a bad frame.
    for (let i = 0; i < 60; i++) {
      // Refresh only during the existing settling loop, never inside either
      // capture observation. A changed independent source starts three new
      // stable observations; no extra waiting or product-style override.
      await win.webContents.executeJavaScript(`document.querySelector('.sync-diff-table-wrap').scrollIntoView({block:'center',behavior:'instant'});(` + diffCSSReferences.toString() + ')("prepare",' + phase + ')')
      await wait(100)
      check = await inspect()
      stability = gate.observe(check)
      if (stability.ready) break
    }
    check.settled = stability.ready; check.stableSamples = stability.samples
    const captured = await captureDiffFrame({ inspect, capture: capturePNG, stableFrame: check, stableSamples: stability.samples, phase })
    // Even a failed precondition retains an explicitly diagnostic screenshot
    // when Chromium can still provide one. It cannot satisfy a success receipt.
    if (!captured.png) {
      try { captured.png = await capturePNG(); captured.diagnosticOnly = true }
      catch (error) { captured.screenshotError = String(error.stack || error) }
    }
    if (captured.png) fs.writeFileSync(path.join(output, name + '.png'), captured.png)
    const { png, ...captureEvidence } = captured
    reports.push({ name, ...check, capture: captureEvidence })
    // Keep diagnostics and failure screenshots instead of discarding evidence.
    writeChecks(false)
    if (!captured.complete) throw new Error('Diff screenshot did not match its observations: ' + captured.error)
    if (!check.settled || !check.visible || check.bodyOverflow > 1 || check.tableOverflow > 1 || check.rows < 2 || check.rows > 64 || check.writes !== 0 || check.activeContent !== 0 || check.colors.some(color => !Number.isFinite(color.ratio) || color.ratio < 4.5)) throw new Error('Diff rendering failed: ' + JSON.stringify(check))
  }
  for (const [theme, width] of [['light', 1200], ['dark', 1200], ['dark', 560]]) {
    win.setContentSize(width, 900)
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    await capture(`${theme}-${width}`)
  }
  await click('下一处差异')
  const next = await win.webContents.executeJavaScript(`(()=>{const t=document.querySelector('.sync-diff-table');return {focus:document.activeElement.textContent,text:t.textContent,activeContent:t.querySelectorAll('img,script,a,iframe').length,writes:window.__diffWrites}})()`)
  if (next.focus !== '第 2 / 2 处差异' || !next.text.includes('远端第二处') || next.activeContent || next.writes) throw new Error('Native diff navigation failed')
  await capture('dark-560-next')
  writeChecks(true)
  console.log(fs.readFileSync(path.join(output, 'checks.json'), 'utf8')); win.destroy(); clearTimeout(watchdog); app.exit(0)
}).catch(error => { writeChecks(false, error); console.error(error); clearTimeout(watchdog); app.exit(1) })
