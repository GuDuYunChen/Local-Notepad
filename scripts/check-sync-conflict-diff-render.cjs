// Render the real review/diff components with synthetic records and production
// styles. No backend, user workspace, credentials or synchronizing provider.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'test-results', 'sync-conflict-diff')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-diff-render-'))
app.setPath('userData', profile)
const watchdog = setTimeout(() => { console.error('Conflict diff renderer timeout'); app.exit(1) }, 60000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true })
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
  fs.writeFileSync(path.join(output, 'fixture.html'), `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(href => `<link rel="stylesheet" href="${href}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important}body{margin:0;padding:18px;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0}.settings-card{margin:0;max-width:none}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await win.loadFile(path.join(output, 'fixture.html'))
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
  const reports = []
  for (const [theme, width] of [['light', 1200], ['dark', 1200], ['dark', 560]]) {
    win.setContentSize(width, 900)
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    await wait(200)
    await win.webContents.executeJavaScript(`document.querySelector('[aria-label="正文差异定位"]').scrollIntoView({block:'start'})`)
    const check = await win.webContents.executeJavaScript(`(()=>{
      const table=document.querySelector('.sync-diff-table'),wrap=document.querySelector('.sync-diff-table-wrap');
      const lum=color=>{const c=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722};
      const ratios=['local','remote'].map(kind=>{const cell=document.querySelector('.sync-diff-'+kind+' td:last-child');const a=lum(getComputedStyle(cell.querySelector('pre')).color),b=lum(getComputedStyle(cell).backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
      return {rows:table.tBodies[0].rows.length,bodyOverflow:document.documentElement.scrollWidth-innerWidth,tableOverflow:wrap.scrollWidth-wrap.clientWidth,ratios,writes:window.__diffWrites,activeContent:table.querySelectorAll('img,script,a,iframe').length};
    })()`)
    if (check.bodyOverflow > 1 || check.tableOverflow > 1 || check.rows < 2 || check.rows > 64 || check.writes !== 0 || check.activeContent !== 0 || check.ratios.some(r => !Number.isFinite(r) || r < 4.5)) throw new Error('Diff rendering failed: ' + JSON.stringify(check))
    fs.writeFileSync(path.join(output, `${theme}-${width}.png`), (await win.capturePage()).toPNG())
    reports.push({ theme, width, ...check })
  }
  await click('下一处差异')
  const next = await win.webContents.executeJavaScript(`(()=>{const t=document.querySelector('.sync-diff-table');return {focus:document.activeElement.textContent,text:t.textContent,activeContent:t.querySelectorAll('img,script,a,iframe').length,overflow:document.documentElement.scrollWidth-innerWidth,writes:window.__diffWrites}})()`)
  if (next.focus !== '第 2 / 2 处差异' || !next.text.includes('远端第二处') || next.activeContent || next.overflow > 1 || next.writes) throw new Error('Native diff navigation failed')
  fs.writeFileSync(path.join(output, 'dark-560-next.png'), (await win.capturePage()).toPNG())
  const summary = { platform: process.platform, realComponents: true, syntheticRecords: true, backendExercised: false, reports, navigationFocus: true, writes: 0 }
  fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary)); win.destroy(); clearTimeout(watchdog); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1) })
