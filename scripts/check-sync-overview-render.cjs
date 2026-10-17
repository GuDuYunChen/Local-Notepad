// Real overview/navigation components + production styles, synthetic facts and
// inert destination regions. Does not touch the real backend or user workspace.
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { verifyOverviewSceneText } = require('./sync-overview-evidence.cjs')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'test-results', 'sync-overview')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-overview-')))
app.on('window-all-closed', () => {}) // Every scene must finish before explicit exit.
const watchdog = setTimeout(() => { console.error('Overview rendering timed out'); app.exit(1) }, 60000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function inspect() {
  const panel = document.querySelector('.sync-overview')
  if (!panel) return null
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const paint = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1) }
  const pixel = () => [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  const lum = rgb => rgb.map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 }).reduce((a, b, i) => a + b * [.2126, .7152, .0722][i], 0)
  const probes = [...panel.querySelectorAll('h4,.sync-overview-status>strong,.sync-overview-status>p,dt,dd,.sync-overview-note,.sync-overview-link:not(:disabled)>strong,.sync-overview-link:not(:disabled)>span')]
  probes.push(...[...panel.querySelectorAll('.sync-help summary,.sync-help-caption,.sync-help-intro,.sync-help-topic li strong,.sync-help-topic li span')].filter(node => node.getClientRects().length > 0))
  const colors = probes.map(element => {
    const style = getComputedStyle(element), ancestors = []
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node)
    ctx.clearRect(0, 0, 1, 1); paint('#ffffff')
    for (const node of ancestors) paint(getComputedStyle(node).backgroundColor)
    const background = pixel(); paint(style.color); const foreground = pixel()
    const token = element.matches('dt,.sync-overview-note,.sync-overview-link>span,.sync-help-intro,.sync-help-caption') ? '--ink-soft' : '--ink'
    ctx.clearRect(0, 0, 1, 1); paint(style.getPropertyValue(token).trim()); const expected = pixel()
    const a = lum(foreground), b = lum(background)
    return { text: element.textContent, foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), final: foreground.every((v, i) => v === expected[i]) }
  })
  const help = panel.querySelector('[data-sync-help]')
  return { help: { present: !!help, open: help?.open === true, topicCount: help?.querySelectorAll('[data-sync-help-topic]').length ?? 0,
      openTopics: [...(help?.querySelectorAll('[data-sync-help-topic][open]') || [])].map(node => node.dataset.syncHelpTopic),
      readOnly: help?.textContent.includes('不检测当前连接，也不会执行同步') === true, disclosureVerified: window.__helpDisclosureVerified === true },
    colors, viewport: { width: innerWidth, height: innerHeight },
    overflow: document.documentElement.scrollWidth - innerWidth,
    writes: window.__manualActions, activeMarkup: panel.querySelectorAll('img,script,iframe,a').length,
    navCount: panel.querySelectorAll('nav button').length,
    title: panel.querySelector('[role="status"]').textContent,
    readProvenance: [...panel.querySelectorAll('.sync-overview-note')].find(node => node.textContent.startsWith('状态依据：'))?.textContent || '',
    recoveryNotice: panel.querySelector('.sync-overview-status>.sync-overview-warning')?.textContent || '' }
}
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true })
  await build({ absWorkingDir: root, bundle: true, format: 'iife', platform: 'browser',
    alias: { '~': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(out, 'fixture.js'), stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Overview from './src/components/SyncOverviewPanel.jsx';
      import {focusSyncOverviewRegion} from './src/services/syncOverview.mjs';
      import {overviewFixture} from './scripts/fixtures/sync-overview.mjs';
      import './src/components/SyncCenterPanel.css';
      const mode = new URLSearchParams(location.search).get('scene');
      document.documentElement.dataset.theme = ['dark','narrow','uncertain','backoff-busy','uncertain-refreshing','help-operations-dark','help-recovery-narrow'].includes(mode) ? 'dark' : 'light';
      const input=overviewFixture();
      if(mode==='uncertain'){input.status.last_status='review_required';input.status.recovery={mode:'review_required'}}
      if(mode==='unavailable'){input.settings=null;input.status=null;input.health.lastReadAt=0}
      if(mode==='disabled')input.settings.sync_enabled=false;
      if(mode==='blocked-stale'){input.status.last_status='recovery_blocked';input.status.recovery.mode='blocked';input.health.failures=1;input.health.error='SYNTHETIC_PRIVATE_ERROR'}
      if(mode==='backoff-busy'){input.status.last_status='retry_wait';input.status.recovery.mode='backoff';input.busy=true}
      if(mode==='uncertain-refreshing'){input.status.last_status='review_required';input.status.recovery.mode='review_required';input.health.loading=true}
      if(mode==='contradictory-busy'){input.status.last_status='recovery_blocked';input.status.recovery.mode='backoff';input.busy=true;input.health.failures=1}
      window.__manualActions=0;
      const navigate=key=>focusSyncOverviewRegion(document.getElementById('center'),key);
      createRoot(document.getElementById('root')).render(<section id="center" data-sync-center className="settings-card consumer-settings-section sync-center-card">
        <Overview {...input} onNavigate={navigate}/>
        {['health','connection','diagnostic',...(input.settings?.sync_enabled?['execution']:[])].map(key=><section key={key} data-sync-section={key} tabIndex={-1} aria-label={key} style={{padding:'24px',marginBottom:'20px',border:'1px solid var(--line)'}}><h4>{key} — 合成导航目标</h4><button onClick={()=>window.__manualActions++}>不可自动触发的测试动作</button></section>)}
        <button id="return" onClick={()=>navigate('overview')}>返回同步总览</button>
      </section>);
    ` } })
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
  const styles = [...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m => pathToFileURL(path.resolve(root, 'dist', m[1].replace(/^\//, ''))).href)
  if (!styles.length) throw new Error('Missing production stylesheet')
  fs.writeFileSync(path.join(out, 'fixture.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(href=>`<link rel="stylesheet" href="${href}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important;scroll-behavior:auto!important}body{margin:0;padding:16px;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0}.settings-card{margin:0;max-width:none}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
  const report = { commit: process.env.GITHUB_SHA || '', platform: process.platform, complete: false, realComponents: true,
    syntheticRecords: true, backendExercised: false, nativeFocus: false, writes: 0, scenes: [] }
  const save = () => fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(report, null, 2))
  save()
  for (const name of ['light', 'dark', 'narrow', 'uncertain', 'unavailable', 'disabled', 'blocked-stale', 'backoff-busy', 'uncertain-refreshing', 'contradictory-busy', 'help-first-use', 'help-operations-dark', 'help-conflicts', 'help-recovery-narrow']) {
    const win = new BrowserWindow({ show: false, width: name.includes('narrow') ? 560 : 1000, height: 900, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    try {
      await win.loadFile(path.join(out, 'fixture.html'), { query: { scene: name } })
      await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)')
      if (name.startsWith('help-')) {
        let mounted = false
        for (let attempt = 0; attempt < 50; attempt++) {
          mounted = await win.webContents.executeJavaScript('!!document.querySelector("[data-sync-help]")')
          if (mounted) break
          await delay(100)
        }
        if (!mounted) throw new Error('Help component did not mount')
        const topic = { 'help-first-use': 'first-use', 'help-operations-dark': 'operations', 'help-conflicts': 'conflicts', 'help-recovery-narrow': 'recovery' }[name]
        const disclosure = await win.webContents.executeJavaScript(`(()=>{
          const help=document.querySelector('[data-sync-help]'), outer=help.querySelector('summary');
          const topic=help.querySelector('[data-sync-help-topic="${topic}"]'), summary=topic.querySelector('summary');
          if(help.open||topic.open)return false;
          outer.click(); summary.focus({preventScroll:true}); summary.click();
          if(!help.open||!topic.open)return false;
          summary.click(); if(topic.open)return false;
          summary.click(); outer.click(); outer.click();
          const valid=help.open&&topic.open&&document.activeElement===summary&&window.__manualActions===0;
          window.__helpDisclosureVerified=valid;
          help.scrollIntoView({block:'start',behavior:'instant'});
          return valid;
        })()`)
        if (!disclosure) throw new Error('Native help disclosure failed: ' + name)
      }
      let sample, previous = '', stable = 0
      for (let i = 0; i < 70; i++) {
        await delay(100); sample = await win.webContents.executeJavaScript('(' + inspect.toString() + ')()')
        const valid = sample && sample.colors.length >= 12 && sample.colors.every(c => c.final && Number.isFinite(c.ratio) && c.ratio >= 4.5) && sample.overflow <= 1 && sample.writes === 0 && sample.activeMarkup === 0 && sample.navCount === 5
        const signature = JSON.stringify(sample)
        stable = valid ? (signature === previous ? stable + 1 : 1) : 0; previous = signature
        if (stable >= 3) break
      }
      const image = (await win.capturePage()).toPNG(); fs.writeFileSync(path.join(out, name + '.png'), image)
      report.scenes.push({ name, ...sample, stableSamples: stable, png: name + '.png', sha256: hash(image), bytes: image.length })
      save()
      if (stable < 3) throw new Error('Invalid overview rendering: ' + name + ': ' + JSON.stringify(sample))
      verifyOverviewSceneText({ name, ...sample })
      const navigation = await win.webContents.executeJavaScript(`(()=>{
        document.querySelector('[aria-label="定位连接配置"]').click();
        const focused=document.activeElement===document.querySelector('[data-sync-section="connection"]');
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        document.getElementById('return').click();
        return focused&&document.activeElement===document.querySelector('[data-sync-section="overview"]')&&window.__manualActions===0;
      })()`)
      if (!navigation) throw new Error('Native focus/navigation failed: ' + name)
    } finally { win.destroy() }
  }
  report.complete = true; report.nativeFocus = true; save(); console.log(JSON.stringify(report)); clearTimeout(watchdog); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1) })
