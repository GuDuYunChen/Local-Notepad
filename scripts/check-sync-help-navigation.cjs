// Real overview/help and production styles, synthetic facts, no real workspace.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createHash } = require('node:crypto')
const { verifyHelpNavigationScene, verifyHelpNavigationReport } = require('./sync-help-navigation-evidence.cjs')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'test-results', 'sync-help-navigation')
if (!process.versions.electron) {
  // A zero Electron exit is insufficient: require every scene, hash and focus receipt.
  fs.rmSync(out, { recursive: true, force: true })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    cwd: root, env, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status !== 0) throw result.error || new Error('Help navigation renderer failed')
  verifyHelpNavigationReport(out, process.env.GITHUB_SHA || '')
  console.log('Complete current-commit help navigation evidence verified.')
} else {
  const { app, BrowserWindow } = require('electron')
  const { build } = require('esbuild'), { pathToFileURL } = require('node:url')
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-help-nav-')))
  app.on('window-all-closed', () => {})
  const watchdog = setTimeout(() => app.exit(1), 70000)
  const delay = ms => new Promise(r => setTimeout(r, ms))
  function inspect() {
    const panel = document.querySelector('#first .sync-overview'), other = document.querySelector('#other [data-sync-help]')
    if (!panel || !other) return null
    const help = panel.querySelector('[data-sync-help]'), canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const paint = c => { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1) }
    const rgb = () => [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
    const lum = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }).reduce((a,b,i)=>a+b*[.2126,.7152,.0722][i],0)
    const probes = [...panel.querySelectorAll('h4,dt,dd,.sync-overview-status>strong,.sync-overview-status>p,.sync-overview-note,[data-sync-help-shortcut],.sync-help summary,.sync-help-intro,.sync-help-topic li strong,.sync-help-topic li span')].filter(n=>{
      if (!n.getClientRects().length) return false
      for (let a=n.parentElement; a&&a!==panel; a=a.parentElement) {
        if (a.tagName==='DETAILS'&&!a.open&&!a.firstElementChild?.contains(n)) return false
      }
      return true
    })
    const colors = probes.map(n => {
      const chain = []; for (let a = n; a; a = a.parentElement) chain.unshift(a)
      ctx.clearRect(0,0,1,1); paint('#ffffff'); for (const a of chain) paint(getComputedStyle(a).backgroundColor)
      const bg=rgb(), style=getComputedStyle(n); paint(style.color); const fg=rgb()
      ctx.clearRect(0,0,1,1); paint(style.getPropertyValue(n.matches('dt,.sync-overview-note,.sync-help-intro')?'--ink-soft':'--ink').trim()); const expected=rgb()
      const a=lum(fg),b=lum(bg)
      return { ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05), final:fg.every((v,i)=>v===expected[i]) }
    })
    return { colors, viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth-innerWidth,
      requests: window.__requests, navigationCalls: window.__navigationCalls, otherOverviewOpen: other.open,
      activeMarkup: panel.querySelectorAll('img,script,iframe,a').length, helpOpen: help.open,
      openTopics: [...help.querySelectorAll('[data-sync-help-topic][open]')].map(n=>n.dataset.syncHelpTopic),
      focusedTopic: document.activeElement?.tagName === 'SUMMARY' ? document.activeElement.parentElement.dataset.syncHelpTopic || '' : '',
      readOnlyHelp: help.textContent.includes('不检测当前连接，也不会执行同步') }
  }
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true })
    await build({ absWorkingDir: root, bundle: true, format: 'iife', platform: 'browser', alias: { '~': path.join(root,'src') },
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(out,'fixture.js'),
      stdin: { loader: 'jsx', resolveDir: root, contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import Overview from './src/components/SyncOverviewPanel.jsx';
        import {overviewFixture} from './scripts/fixtures/sync-overview.mjs';
        import './src/components/SyncCenterPanel.css';
        const scene=new URLSearchParams(location.search).get('scene');
        document.documentElement.dataset.theme=['operations','recovery-narrow'].includes(scene)?'dark':'light';
        let input=overviewFixture(),revision=0;
        if(scene==='first-use')input.settings.sync_enabled=false;
        if(scene==='conflicts')input.status.open_conflicts=input.conflictCount=2;
        if(scene==='recovery-narrow'){input.status.last_status='review_required';input.status.recovery.mode='blocked';input.health.failures=1;input.health.error='NAV_PRIVATE'}
        window.__requests=0;window.__navigationCalls=0;
        window.fetch=()=>{window.__requests++;return Promise.reject(new Error('Forbidden fixture request'))};
        const root=createRoot(document.getElementById('root')), other=overviewFixture();
        const draw=()=>root.render(<><div id="first" data-revision={revision}><Overview {...input} onNavigate={()=>{window.__navigationCalls++;return true}}/></div><div id="other"><Overview {...other}/></div></>);
        window.__changeSnapshot=()=>{revision++;input={...input,health:{...input.health,loading:true}};draw()};draw();
      ` } })
    const index=fs.readFileSync(path.join(root,'dist/index.html'),'utf8')
    const styles=[...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m=>pathToFileURL(path.resolve(root,'dist',m[1].replace(/^\//,''))).href)
    if (!styles.length) throw new Error('Missing production CSS')
    fs.writeFileSync(path.join(out,'fixture.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(h=>`<link rel="stylesheet" href="${h}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important}body{padding:16px;margin:0;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
    const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:[]}
    const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));save()
    for (const name of ['first-use','operations','conflicts','recovery-narrow']) {
      const win=new BrowserWindow({show:false,width:name==='recovery-narrow'?560:1000,height:900,useContentSize:true,
        webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      try {
        await win.loadFile(path.join(out,'fixture.html'),{query:{scene:name}})
        await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)')
        const capture=async phase=>{
          let sample,previous='',stable=0
          for(let i=0;i<60;i++){
            await delay(100);sample=await win.webContents.executeJavaScript('('+inspect.toString()+')()')
            const valid=sample&&sample.colors.length>=10&&sample.colors.every(c=>c.final&&c.ratio>=4.5)&&sample.overflow<=1
            const signature=JSON.stringify(sample);stable=valid?(signature===previous?stable+1:1):0;previous=signature
            if(stable>=3)break
          }
          if(stable<3)throw new Error('Unstable/unreadable help navigation: '+name+' '+JSON.stringify(sample))
          const b=(await win.capturePage()).toPNG(),png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),b)
          return {...sample,stableSamples:stable,png,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}
        }
        const before=await capture('before')
        await win.webContents.executeJavaScript(`document.querySelector('#first [data-sync-help-shortcut]').click()`)
        const after=await capture('after')
        await win.webContents.executeJavaScript(`window.__focusedSummary=document.activeElement;window.__openedTopic=document.activeElement.parentElement;window.__changeSnapshot()`)
        let updateObserved=false
        for(let attempt=0;attempt<50;attempt++){
          await delay(100)
          updateObserved=await win.webContents.executeJavaScript(`document.querySelector('#first').dataset.revision==='1'`)
          if(updateObserved)break
        }
        const retainedAfterUpdate=await win.webContents.executeJavaScript(`document.activeElement===window.__focusedSummary&&window.__openedTopic.isConnected&&window.__openedTopic.open&&document.querySelector('#first [data-sync-help]').open&&window.__requests===0&&window.__navigationCalls===0&&!document.querySelector('#other [data-sync-help]').open`)
        const scene={name,before,after,updateObserved,retainedAfterUpdate};report.scenes.push(scene);save();verifyHelpNavigationScene(scene)
      } finally {win.destroy()}
    }
    report.complete=true;save();clearTimeout(watchdog);app.exit(0)
  }).catch(error=>{console.error(error);clearTimeout(watchdog);app.exit(1)})
}
