// Real overview/help and production styles, synthetic facts, no real workspace.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createHash } = require('node:crypto')
const { verifyClockScene, verifyClockReport } = require('./sync-clock-evidence.cjs')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'test-results', 'sync-clock')
if (!process.versions.electron) {
  // A zero Electron exit is insufficient: require every scene, hash and focus receipt.
  fs.rmSync(out, { recursive: true, force: true })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    cwd: root, env, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status !== 0) throw result.error || new Error('Clock renderer failed')
  verifyClockReport(out, process.env.GITHUB_SHA || '')
  console.log('Complete current-commit clock evidence verified.')
} else {
  const { app, BrowserWindow } = require('electron')
  const { build } = require('esbuild'), { pathToFileURL } = require('node:url')
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-clock-')))
  app.on('window-all-closed', () => {})
  const watchdog = setTimeout(() => app.exit(1), 70000)
  const delay = ms => new Promise(r => setTimeout(r, ms))
  function inspect(){
    const panel=document.querySelector('#first .sync-overview'),other=document.querySelector('#other .sync-overview')
    if(!panel||!other)return null
    const controls=[...panel.querySelectorAll('.sync-clock-button')],canvas=document.createElement('canvas');canvas.width=canvas.height=1
    const ctx=canvas.getContext('2d',{willReadFrequently:true}),paint=c=>{ctx.fillStyle=c;ctx.fillRect(0,0,1,1)},rgb=()=>[...ctx.getImageData(0,0,1,1).data].slice(0,3)
    const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,b,i)=>a+b*[.2126,.7152,.0722][i],0)
    const probes=[...panel.querySelectorAll('.sync-clock-controls>span,.sync-clock-button,.sync-clock-note,.sync-clock-fallback,.sync-overview-metrics dt,.sync-overview-metrics dd,.sync-overview-note time')]
    const colors=probes.map(n=>{
      const chain=[];for(let a=n;a;a=a.parentElement)chain.unshift(a)
      ctx.clearRect(0,0,1,1);paint('#ffffff');for(const a of chain)paint(getComputedStyle(a).backgroundColor)
      const bg=rgb(),style=getComputedStyle(n);paint(style.color);const fg=rgb()
      const soft=n.matches('.sync-clock-zone,.sync-clock-note,dt')||!!n.closest('.sync-overview-note')
      ctx.clearRect(0,0,1,1);paint(style.getPropertyValue(soft?'--ink-soft':'--ink').trim());const expected=rgb(),a=lum(fg),b=lum(bg)
      return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),final:fg.every((v,i)=>v===expected[i])}
    })
    return {selected:controls[1]?.getAttribute('aria-pressed')==='true'?'local':'utc',zone:panel.querySelector('.sync-clock-zone')?.textContent,
      controlsOnScreen:controls.every(n=>{const r=n.getBoundingClientRect();return r.height>=44&&r.top>=0&&r.bottom<=innerHeight}),
      fallback:!!panel.querySelector('.sync-clock-fallback'),controlCount:controls.length,
      values:[...panel.querySelectorAll('time')].map(n=>({iso:n.dateTime,text:n.textContent,title:n.title})),
      counts:[...panel.querySelectorAll('dd')].map(n=>n.textContent),title:panel.querySelector('[data-sync-guidance]>strong').textContent,
      provenance:[...panel.querySelectorAll('.sync-overview-note')].find(n=>n.textContent.startsWith('状态依据：'))?.textContent,
      recoveryNotice:panel.querySelector('[data-sync-guidance]>.sync-overview-warning')?.textContent||'',
      otherUTC:other.querySelector('.sync-clock-button').getAttribute('aria-pressed')==='true',
      scopeText:panel.querySelector('.sync-clock-note').textContent.includes('不刷新、不执行同步'),
      privateText:panel.textContent.includes('CLOCK_PRIVATE'),requests:window.__requests,navigationCalls:window.__navigationCalls,
      colors,viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth-innerWidth}
  }
  app.whenReady().then(async()=>{
    fs.mkdirSync(out,{recursive:true})
    await build({absWorkingDir:root,bundle:true,format:'iife',platform:'browser',alias:{'~':path.join(root,'src')},define:{'process.env.NODE_ENV':'"production"'},outfile:path.join(out,'fixture.js'),stdin:{loader:'jsx',resolveDir:root,contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';import Overview from './src/components/SyncOverviewPanel.jsx';
      import {overviewFixture} from './scripts/fixtures/sync-overview.mjs';import './src/components/SyncCenterPanel.css';
      const scene=new URLSearchParams(location.search).get('scene');document.documentElement.dataset.theme=scene.includes('dark')||scene.includes('narrow')?'dark':'light';
      let input=overviewFixture(),revision=0;input.status.recovery.last_success_at=Date.parse('2024-11-03T08:30:00.000Z')/1000;input.health.lastReadAt=Date.parse('2024-11-03T09:30:00.000Z');
      if(scene==='unread-dark'){input.settings=null;input.status=null;input.conflictCount=null;input.health.lastReadAt=0}
      window.__requests=0;window.__navigationCalls=0;window.fetch=()=>{window.__requests++;return Promise.reject(new Error('CLOCK_PRIVATE_REQUEST'))};
      const root=createRoot(document.getElementById('root')),other=overviewFixture();
      const draw=()=>root.render(<><div id="first" data-revision={revision}><Overview {...input} onNavigate={()=>{window.__navigationCalls++;return true}}/></div><div id="other"><Overview {...other}/></div></>);
      window.__changeSnapshot=()=>{revision++;if(scene!=='unread-dark'){input={...input,status:{...input.status,last_status:'review_required',recovery:{...input.status.recovery,mode:'blocked'}},health:{...input.health,failures:1,error:'CLOCK_PRIVATE_ERROR',lastReadAt:input.health.lastReadAt+60000}}}draw()};draw();
    `}})
    const index=fs.readFileSync(path.join(root,'dist/index.html'),'utf8'),styles=[...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m=>pathToFileURL(path.resolve(root,'dist',m[1].replace(/^\//,''))).href)
    if(!styles.length)throw new Error('Missing production CSS')
    fs.writeFileSync(path.join(out,'fixture.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(h=>`<link rel="stylesheet" href="${h}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important}body{padding:16px;margin:0;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
    const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:[]}
    const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));save()
    for(const name of ['shanghai-light','los-angeles-dark','kathmandu-narrow','unread-dark','timezone-unavailable']){
      const win=new BrowserWindow({show:false,width:name==='kathmandu-narrow'?560:1000,height:900,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      try{
        await win.loadFile(path.join(out,'fixture.html'),{query:{scene:name}})
        win.webContents.debugger.attach('1.3')
        const zone=name==='los-angeles-dark'?'America/Los_Angeles':name==='kathmandu-narrow'?'Asia/Kathmandu':'Asia/Shanghai'
        await win.webContents.debugger.sendCommand('Emulation.setTimezoneOverride',{timezoneId:zone})
        const actual=await win.webContents.executeJavaScript('new Intl.DateTimeFormat().resolvedOptions().timeZone')
        const zoneEmulated=actual===zone||(zone==='Asia/Kathmandu'&&actual==='Asia/Katmandu')
        await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)')
        const capture=async phase=>{
          let sample,previous='',stable=0
          for(let i=0;i<60;i++){
            await delay(100);sample=await win.webContents.executeJavaScript('('+inspect.toString()+')()')
            const valid=sample&&sample.colors.length>=8&&sample.colors.every(c=>c.final&&c.ratio>=4.5)&&sample.overflow<=1
            const sig=JSON.stringify(sample);stable=valid?(sig===previous?stable+1:1):0;previous=sig;if(stable>=3)break
          }
          if(stable<3)throw new Error('Unstable clock scene '+name+' '+phase+' '+JSON.stringify(sample))
          const b=(await win.capturePage()).toPNG(),png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),b)
          return {...sample,stableSamples:stable,png,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}
        }
        const before=await capture('before')
        if(name==='timezone-unavailable'){
          // A function assignment is not a cloneable IPC result. Return a
          // primitive receipt; the scenario still has to prove visible fallback.
          const injected=await win.webContents.executeJavaScript(`(()=>{window.__originalDTF=Intl.DateTimeFormat;Intl.DateTimeFormat=function(){throw new Error('CLOCK_PRIVATE_TIMEZONE')};return true})()`)
          if(injected!==true)throw new Error('Timezone fault injection not acknowledged')
        }
        await win.webContents.executeJavaScript(`document.querySelector('#first [data-sync-help-shortcut]').click();document.querySelector('#first [data-sync-help-return]').click();window.__help=document.querySelector('#first [data-sync-help]');window.__topic=window.__help.querySelector('[data-sync-help-topic][open]');window.__localButton=document.querySelectorAll('#first .sync-clock-button')[1];window.__localButton.focus({preventScroll:true});window.__localButton.click();document.querySelector('#first [data-sync-guidance]').scrollIntoView({block:'start',behavior:'instant'})`)
        const local=await capture('local')
        await win.webContents.executeJavaScript('window.__changeSnapshot()')
        let updateObserved=false
        for(let i=0;i<50;i++){await delay(100);updateObserved=await win.webContents.executeJavaScript(`document.querySelector('#first').dataset.revision==='1'`);if(updateObserved)break}
        const updated=await capture('updated')
        const choiceAndFocusRetained=await win.webContents.executeJavaScript(`window.__localButton===document.querySelectorAll('#first .sync-clock-button')[1]&&document.activeElement===window.__localButton&&window.__localButton.getAttribute('aria-pressed')==='true'`)
        const helpRetained=await win.webContents.executeJavaScript(`window.__help===document.querySelector('#first [data-sync-help]')&&window.__help.open&&window.__topic.isConnected&&window.__topic.open`)
        await win.webContents.executeJavaScript(`if(window.__originalDTF)Intl.DateTimeFormat=window.__originalDTF;document.querySelector('#first .sync-clock-button').click()`)
        const restored=await capture('restored'),scene={name,before,local,updated,restored,zoneEmulated,updateObserved,choiceAndFocusRetained,helpRetained}
        report.scenes.push(scene);save();verifyClockScene(scene)
      }finally{if(win.webContents.debugger.isAttached())win.webContents.debugger.detach();win.destroy()}
    }
    report.complete=true;save();clearTimeout(watchdog);app.exit(0)
  }).catch(error=>{console.error(error);clearTimeout(watchdog);app.exit(1)})
}
