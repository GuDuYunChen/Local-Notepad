// Real overview and real browser localStorage in an isolated, disposable profile.
// No user workspace/backend. Screenshots are deliberately positioned at the clock controls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createHash } = require('node:crypto')
const { verifyKeyboardScene, verifyKeyboardReport } = require('./sync-clock-keyboard-evidence.cjs')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')
const { clockKeyboardEvents } = require('./sync-clock-keyboard-input.cjs')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'test-results', 'sync-clock-keyboard')
if (!process.versions.electron) {
  fs.rmSync(out, { recursive: true, force: true })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { cwd: root, env, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status !== 0) throw result.error || new Error('Preference renderer failed')
  verifyKeyboardReport(out, process.env.GITHUB_SHA || '')
  console.log('Complete current-commit native keyboard evidence verified.')
} else {
  const { app, BrowserWindow } = require('electron'), { build } = require('esbuild'), { pathToFileURL } = require('node:url')
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-clock-keyboard-')))
  app.on('window-all-closed', () => {})
  const watchdog = setTimeout(() => app.exit(1), 70000), delay = ms => new Promise(r => setTimeout(r, ms))
  function inspect() {
    const p = document.querySelector('#first .sync-overview'), other = document.querySelector('#other .sync-overview')
    if (!p || !other) return null
    const shown = n => {
      if (!n.getClientRects().length) return false
      for (let a = n.parentElement; a; a = a.parentElement) if (a.tagName === 'DETAILS' && !a.open && !a.querySelector(':scope>summary')?.contains(n)) return false
      return true
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const c = canvas.getContext('2d', { willReadFrequently: true }), paint = v => { c.fillStyle = v; c.fillRect(0, 0, 1, 1) }, rgb = () => [...c.getImageData(0, 0, 1, 1).data].slice(0, 3)
    const lum = v => v.map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 }).reduce((a, b, i) => a + b * [.2126, .7152, .0722][i], 0)
    const probes = [...p.querySelectorAll('.sync-clock-controls>span,.sync-clock-button,.sync-clock-preference>summary,.sync-clock-preference>summary>span,.sync-clock-preference-button,.sync-clock-preference-summary,.sync-clock-preference-error,.sync-clock-preference-receipt')].filter(shown)
    const colors = probes.map(n => {
      const ancestors = []; for (let a = n; a; a = a.parentElement) ancestors.unshift(a)
      c.clearRect(0, 0, 1, 1); paint('#ffffff'); for (const a of ancestors) paint(getComputedStyle(a).backgroundColor)
      const bg = rgb(), style = getComputedStyle(n); paint(style.color); const fg = rgb()
      c.clearRect(0, 0, 1, 1); paint(style.getPropertyValue(n.matches('.sync-clock-zone,.sync-clock-preference-summary,.sync-clock-preference>summary>span') ? '--ink-soft' : '--ink').trim())
      const expected = rgb(), a = lum(fg), b = lum(bg)
      return { final: fg.every((v, i) => v === expected[i]), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
    })
    const visible = n => { const r = n.getBoundingClientRect(); return shown(n) && r.top >= 0 && r.bottom <= innerHeight && r.width > 0 }
    const raw = window.__originalGet.call(localStorage, 'local-notepad.sync-clock-mode.v1'), message = p.querySelector('.sync-clock-preference-error')?.textContent || ''
    const live=p.querySelector('[data-sync-clock-feedback]'), node=live.firstElementChild
    window.__feedbackNodes ||= []
    if(node && !window.__feedbackNodes.includes(node))window.__feedbackNodes.push(node)
    return { liveStable: live===window.__liveRegion, liveRole:live.getAttribute('role'), livePolite:live.getAttribute('aria-live'), liveAtomic:live.getAttribute('aria-atomic'),
      messageSerial:node?window.__feedbackNodes.indexOf(node)+1:0,
      feedback:live.textContent.trim(), feedbackVisible:node?visible(node):true,
      controlsLinked:[...p.querySelectorAll('.sync-clock-preference-button')].every(n=>n.getAttribute('aria-controls')===live.id),
      focusedAction:['restore','save','clear'].find(a=>document.activeElement===p.querySelector('[data-sync-clock-'+a+']')) || '',
      trustedKeys:window.__keys,
      focusOutline:getComputedStyle(document.activeElement).outlineStyle !== 'none' && parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2,
      mode: p.querySelectorAll('.sync-clock-button')[1].getAttribute('aria-pressed') === 'true' ? 'local' : 'utc',
      stored: ['utc', 'local'].includes(raw) ? raw : raw === null ? null : 'invalid', open: p.querySelector('[data-sync-clock-preference]').open,
      error: message ? 'read' : '',
      comparison: p.querySelector('[data-sync-clock-comparison]').textContent,
      receipt: p.querySelector('.sync-clock-preference-receipt')?.textContent || '',
      focusRetained: document.activeElement === p.querySelector('[data-sync-clock-restore]'),
      restoreVisible: visible(p.querySelector('[data-sync-clock-restore]')),
      actionsVisible: [...p.querySelectorAll('.sync-clock-preference-button')].every(visible),
      mutations: window.__mutations, requests: window.__requests, navigationCalls: window.__navigationCalls,
      otherKeyPreserved: localStorage.getItem('clock-pref-fixture-sentinel') === 'keep',
      privateText: p.textContent.includes('PREFERENCE_PRIVATE'), otherUTC: other.querySelector('.sync-clock-button').getAttribute('aria-pressed') === 'true',
      iso: [...p.querySelectorAll('time')].map(n => n.dateTime), guidance: p.querySelector('[data-sync-guidance]').textContent,
      counts: [...p.querySelectorAll('dd')].slice(0, 2).map(n => n.textContent),
      controlsVisible: [...p.querySelectorAll('.sync-clock-button')].every(visible), summaryVisible: visible(p.querySelector('.sync-clock-preference>summary')),
      colors, viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth }
  }
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true })
    await build({ absWorkingDir: root, bundle: true, format: 'iife', platform: 'browser', alias: { '~': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(out, 'fixture.js'), stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import Overview from './src/components/SyncOverviewPanel.jsx';
      import {overviewFixture} from './scripts/fixtures/sync-overview.mjs'; import './src/components/SyncCenterPanel.css';
      const scene=new URLSearchParams(location.search).get('scene'),key='local-notepad.sync-clock-mode.v1';
      document.documentElement.dataset.theme=scene.includes('dark')||scene.includes('narrow')?'dark':'light';
      window.__mutations=[];window.__requests=0;window.__navigationCalls=0;window.__keys=[];
      document.addEventListener('keydown',e=>window.__keys.push({key:e.key,shift:e.shiftKey,trusted:e.isTrusted}));
      const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem,get=Storage.prototype.getItem;
      window.__seed=value=>{if(value===null)remove.call(localStorage,key);else set.call(localStorage,key,value);return true};
      window.__originalGet=get;
      window.__blockRead=blocked=>{Storage.prototype.getItem=blocked?function(k){if(k===key)throw Error('PREFERENCE_PRIVATE_READ');return get.call(this,k)}:get;return true};
      Storage.prototype.setItem=function(k,v){if(k===key){window.__mutations.push(['set',v]);if(window.__blocked)throw Error('PREFERENCE_PRIVATE_WRITE')}return set.call(this,k,v)};
      Storage.prototype.removeItem=function(k){if(k===key){window.__mutations.push(['remove']);if(window.__blocked)throw Error('PREFERENCE_PRIVATE_CLEAR')}return remove.call(this,k)};
      window.fetch=()=>{window.__requests++;return Promise.reject(Error('PREFERENCE_PRIVATE_REQUEST'))};
      createRoot(document.getElementById('root')).render(<><div id="first"><Overview {...overviewFixture()} onNavigate={()=>{window.__navigationCalls++;return true}}/></div><div id="other"><Overview {...overviewFixture()}/></div></>);
    ` } })
    const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8'), styles = [...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m => pathToFileURL(path.resolve(root, 'dist', m[1].replace(/^\//, ''))).href)
    if (!styles.length) throw Error('Missing production CSS')
    const file = path.join(out, 'fixture.html')
    fs.writeFileSync(file, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(h => `<link rel="stylesheet" href="${h}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important}body{margin:0;padding:16px;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
    const report = { commit: process.env.GITHUB_SHA || '', platform: process.platform, complete: false, realOverview: true, syntheticRecords: true, backendExercised: false, nativeKeyboard: true, scenes: [] }
    const save = () => fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(report, null, 2)); save()
    for (const name of ['keyboard-light', 'keyboard-dark', 'keyboard-narrow']) {
      const win = new BrowserWindow({ show: true, width: name === 'keyboard-narrow' ? 560 : 1000, height: 900, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      const exec = code => win.webContents.executeJavaScript(code)
      const wait = async code => { for (let i = 0; i < 60; i++) { if (await exec(code)) return true; await delay(100) } throw Error('Missing observed state: ' + name + ': ' + code + ': ' + JSON.stringify(await exec(`({keys:window.__keys,active:document.activeElement?.outerHTML,open:document.querySelector('#first [data-sync-clock-preference]')?.open})`))) }
      const load = async () => { await win.loadFile(file, { query: { scene: name } }); await wait('!!document.querySelector("#first [data-sync-clock-save]")'); await exec('document.fonts.ready.then(()=>true)') }
      const capture = async phase => {
        await exec(`document.querySelector('#first .sync-clock-controls').scrollIntoView({block:'start',behavior:'instant'})`)
        let f, stable = 0, last = ''
        for (let i = 0; i < 60; i++) {
          await delay(100); f = await exec('(' + inspect.toString() + ')()')
          const valid = f && f.restoreVisible && f.actionsVisible && f.colors.length >= 5 && f.colors.every(c => c.final && c.ratio >= 4.5) && f.overflow <= 1 && f.controlsVisible && f.summaryVisible
          const sig = JSON.stringify(f); stable = valid ? (sig === last ? stable + 1 : 1) : 0; last = sig; if (stable >= 3) break
        }
        if (stable < 3) throw Error('Invalid preference frame: ' + name + ' ' + phase + ' ' + JSON.stringify(f))
        const rasterCode=1+['keyboard-light','keyboard-dark','keyboard-narrow'].indexOf(name)*7+
          ['temporary','saved','repeated','cleared','restored','read-failed','recovered'].indexOf(phase)
        // A hidden window can expose an older compositor surface on capture.
        // Stamp outside application content only AFTER observed DOM stability.
        // Do not accept elapsed time or DOM values as proof of fresh PNG pixels.
        await exec(`(()=>{
          let strip=document.getElementById('clock-raster-witness');
          if(!strip){strip=document.createElement('div');strip.id='clock-raster-witness';strip.setAttribute('aria-hidden','true');document.body.append(strip)}
          strip.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';
          strip.replaceChildren();
          for(let bit=0;bit<8;bit++){const cell=document.createElement('span');cell.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+((( ${rasterCode} >>>bit)&1)?'rgb(221,238,255)':'rgb(17,34,51)');strip.append(cell)}
          return true;
        })()`)
        await exec('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
        let b, rasterSamples=0, lastHash=''
        for(let i=0;i<40;i++){
          const candidate=(await win.capturePage()).toPNG(), sha=createHash('sha256').update(candidate).digest('hex')
          let matches=false;try{matches=verifyRasterWitness(candidate,rasterCode)}catch{}
          const now=await exec('('+inspect.toString()+')()')
          if(JSON.stringify(now)!==JSON.stringify(f))throw Error('DOM changed during raster capture: '+name+' '+phase)
          rasterSamples=matches?(sha===lastHash?rasterSamples+1:1):0;lastHash=sha
          if(rasterSamples>=2){b=candidate;break}await delay(100)
        }
        if(!b)throw Error('No stable matching raster frame: '+name+' '+phase)
        const png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),b)
        return { ...f, stableSamples: stable, rasterCode, rasterSamples, png, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }
      }
      try {
        // Focus is required by Electron's native input API; no DOM click/focus
        // is used for the subsequent Tab/Enter/Space operation sequence.
        win.setMenu(null);win.show();win.focus();win.webContents.focus()
        await load();await exec(`(()=>{window.__seed('utc');localStorage.setItem('clock-pref-fixture-sentinel','keep');return true})()`)
        await load();win.focus();win.webContents.focus()
        await exec(`(()=>{window.__liveRegion=document.querySelector('#first [data-sync-clock-feedback]');document.querySelector('#first .sync-clock-button').focus();return true})()`)
        const press=async(key,shift=false)=>{
          for (const event of clockKeyboardEvents(key, shift)) win.webContents.sendInputEvent(event)
          await delay(80)
        }
        const expectFocus=selector=>wait(`document.activeElement===document.querySelector(${JSON.stringify('#first '+selector)})`)
        await press('Tab');await expectFocus('.sync-clock-button:nth-of-type(2)')
        await press('Space');await wait(`document.querySelectorAll('#first .sync-clock-button')[1].getAttribute('aria-pressed')==='true'`)
        await press('Tab');await expectFocus('.sync-clock-preference>summary')
        await press('Return');await wait(`document.querySelector('#first [data-sync-clock-preference]').open`)
        await press('Tab');await expectFocus('[data-sync-clock-restore]')
        const frames=[],scene={name,frames};report.scenes.push(scene)
        const record=async phase=>{frames.push({phase,...await capture(phase)});save()}
        await record('temporary')
        await press('Tab');await expectFocus('[data-sync-clock-save]');await press('Return');await record('saved')
        await press('Return');await record('repeated')
        await press('Tab');await expectFocus('[data-sync-clock-clear]');await press('Space');await record('cleared')
        await press('Tab',true);await expectFocus('[data-sync-clock-save]');await press('Return')
        await press('Tab',true);await expectFocus('[data-sync-clock-restore]');await press('Return');await record('restored')
        await exec('window.__blockRead(true)');await press('Return');await record('read-failed')
        await exec(`(()=>{window.__blockRead(false);window.__seed('utc');return true})()`)
        await press('Return');await record('recovered')
        verifyKeyboardScene(scene)
      } finally { win.destroy() }
    }
    report.complete = true; save(); clearTimeout(watchdog); app.exit(0)
  }).catch(e => { console.error(e); clearTimeout(watchdog); app.exit(1) })
}
