// Real isolated Electron UI, production styles, synthetic inputs; no user data.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { pathToFileURL } = require('node:url'), { build } = require('esbuild')
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'test-results/sync-diagnostic')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-diagnostic-')))
app.on('window-all-closed', () => {}) // Only complete evidence permits exit(0).
const watchdog = setTimeout(() => app.exit(1), 75000)
const wait = ms => new Promise(r => setTimeout(r, ms))
function inspect() {
  const panel = document.querySelector('.sync-diagnostic-panel'), area = panel?.querySelector('textarea')
  if (!area) return { ready: false }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const paint = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1) }
  const rgb = () => [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  const lum = values => values.map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 }).reduce((n, x, i) => n + x * [.2126, .7152, .0722][i], 0)
  const ratios = [], final = []
  for (const node of [panel.querySelector('h4'), panel.querySelector('p'), area]) {
    const style = getComputedStyle(node), ancestors = []
    for (let el = node; el; el = el.parentElement) ancestors.unshift(el)
    ctx.clearRect(0, 0, 1, 1); paint('#fff'); for (const el of ancestors) paint(getComputedStyle(el).backgroundColor)
    const bg = rgb(); paint(style.color); const fg = rgb()
    const a = lum(bg), b = lum(fg); ratios.push((Math.max(a, b) + .05) / (Math.min(a, b) + .05))
    ctx.clearRect(0, 0, 1, 1); paint(style.getPropertyValue(node.tagName === 'P' ? '--ink-soft' : '--ink'))
    final.push(rgb().every((n, i) => n === fg[i]))
  }
  const rect = area.getBoundingClientRect()
  return { ready: final.every(Boolean) && ratios.every(n => n >= 4.5), ratios,
    overflow: document.documentElement.scrollWidth - innerWidth, textOverflow: area.scrollWidth - area.clientWidth,
    areaVisible: rect.top >= 0 && rect.bottom <= innerHeight,
    previewChars: area.value.length, privateLeak: area.value.includes('PRIVATE_DIAGNOSTIC_SENTINEL'), networkCalls: window.__networkCalls }
}
app.whenReady().then(async () => {
  fs.mkdirSync(dir, { recursive: true })
  await build({ absWorkingDir: root, bundle: true, format: 'iife', platform: 'browser', alias: { '~': path.join(root, 'src') },
    define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(dir, 'fixture.js'),
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import Panel from './src/components/SyncDiagnosticPanel.jsx';
      const secret='PRIVATE_DIAGNOSTIC_SENTINEL'; window.__networkCalls=0;
      window.fetch=()=>{window.__networkCalls++;return Promise.reject(new Error('No network allowed'))};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('Synthetic permission denial'))}});
      const initial={settings:{sync_provider:'webdav',sync_enabled:true,sync_auto_enabled:false,sync_interval_minutes:5,sync_endpoint:secret,sync_username:secret,sync_password:secret},
        status:{device_id:secret,last_status:'error',last_error:secret,base_items:20,open_conflicts:2,last_sync_at:1790499990,recovery:{mode:'review_required',last_success_at:1790499000}},
        health:{loading:false,lastReadAt:1790500000000,failures:0,error:''},conflictCount:2,busy:false,draftChanged:false,actionFailed:true};
      function Fixture(){const [input,set]=useState(initial);window.__setInput=set;window.__initial=initial;return <div className="settings-card consumer-settings-section sync-center-card"><Panel {...input}/></div>}
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` } })
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
  const styles = [...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m => pathToFileURL(path.resolve(root, 'dist', m[1].replace(/^\//, ''))).href)
  if (!styles.length) throw new Error('Production styles missing')
  fs.writeFileSync(path.join(dir, 'fixture.html'), `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';font-src 'self';img-src 'self' data:">${styles.map(h=>`<link rel="stylesheet" href="${h}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important;scroll-behavior:auto!important}body{margin:0;padding:16px;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0}.settings-card{margin:0;max-width:none}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
  const win = new BrowserWindow({ show: false, width: 1000, height: 800, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const js = code => win.webContents.executeJavaScript(code)
  const click = async label => {
    for (let i = 0; i < 40; i++) {
      if (await js(`(()=>{const el=[...document.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(label)});if(!el||el.disabled)return false;el.click();return true})()`)) { await wait(100); return }
      await wait(50)
    }
    throw new Error('Missing button: ' + label)
  }
  const report = { commit: process.env.NOTEPAD_DIAGNOSTIC_COMMIT, platform: process.platform, complete: false,
    realComponents: true, syntheticRecords: true, backendExercised: false, manualSelection: false, clipboardFailureHandled: false, scenes: [] }
  const save = () => fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(report, null, 2))
  save()
  await win.loadFile(path.join(dir, 'fixture.html')); await click('生成诊断摘要'); await js('document.fonts.ready.then(()=>true)')
  for (const [name, theme, width] of [['light','light',1000], ['dark','dark',1000], ['narrow','dark',560], ['changed','dark',560], ['unavailable','dark',560]]) {
    win.setContentSize(width, 800); await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    if (name === 'changed') {
      await js('window.__setInput({...window.__initial,busy:true})'); await wait(100)
      if (!(await js(`document.querySelector('.sync-diagnostic-panel').textContent.includes('可见诊断字段已变化')`))) throw new Error('Missing changed snapshot notice')
    }
    if (name === 'unavailable') {
      await js('window.__setInput({health:{loading:false,lastReadAt:0,failures:1,error:"PRIVATE_DIAGNOSTIC_SENTINEL"},conflictCount:0})'); await wait(100); await click('重新生成摘要')
    }
    let check, previous = '', stable = 0
    for (let i = 0; i < 60; i++) {
      await js(`document.querySelector('textarea').scrollIntoView({block:'center',behavior:'instant'})`); await wait(100)
      check = await js('(' + inspect.toString() + ')()')
      const key = JSON.stringify(check)
      stable = check.ready && check.areaVisible && key === previous ? stable + 1 : 0; previous = key
      if (stable >= 2) break
    }
    const image = await win.capturePage(), bytes = image.toPNG(), size = image.getSize()
    fs.writeFileSync(path.join(dir, name + '.png'), bytes)
    report.scenes.push({ name, ...check, ready: check.ready && stable >= 2, width: size.width, height: size.height, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }); save()
    if (!check.ready || stable < 2 || check.privateLeak || check.networkCalls || check.overflow > 1 || check.textOverflow > 1) throw new Error('Diagnostic scene failed: ' + name)
  }
  await click('复制诊断摘要')
  report.clipboardFailureHandled = await js(`document.querySelector('.sync-diagnostic-panel').textContent.includes('复制未确认')`)
  await click('选择摘要')
  report.manualSelection = await js(`(()=>{const el=document.querySelector('textarea');return document.activeElement===el&&el.selectionStart===0&&el.selectionEnd===el.value.length})()`)
  if (!report.clipboardFailureHandled || !report.manualSelection) throw new Error('Manual copy fallback failed')
  report.complete = true; save(); win.destroy(); clearTimeout(watchdog); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1) })
