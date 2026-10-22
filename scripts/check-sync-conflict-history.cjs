// Production overview and history components, real DOM, synthetic responses.
// Backend/SQLite roundtrip is separately covered by the HTTP test, not here.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto')
const {verifyHistoryScene,verifyHistoryReport}=require('./sync-conflict-history-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-conflict-history')
if(!process.versions.electron){
  fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:100000,maxBuffer:8*1024*1024})
  if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr)
  if(r.error||r.status!==0)throw r.error||Error('History native check failed')
  verifyHistoryReport(out,process.env.GITHUB_SHA||'');console.log('Complete current-commit history evidence verified.')
}else{
  const {app,BrowserWindow}=require('electron'),{build}=require('esbuild'),{pathToFileURL}=require('node:url')
  app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'notepad-history-ui-')));app.on('window-all-closed',()=>{})
  const watchdog=setTimeout(()=>app.exit(1),85000),delay=ms=>new Promise(r=>setTimeout(r,ms))
  function inspect(){
    const panel=document.querySelector('[data-sync-conflict-history]'),overview=document.querySelector('.sync-overview')
    if(!panel)return null
    const shown=n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden'
    const visible=n=>{const r=n.getBoundingClientRect();return shown(n)&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d',{willReadFrequently:true})
    const paint=s=>{c.fillStyle=s;c.fillRect(0,0,1,1)},rgb=()=>[...c.getImageData(0,0,1,1).data].slice(0,3)
    const lum=rgb=>rgb.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((a,b,i)=>a+b*[.2126,.7152,.0722][i],0)
    const colors=[...panel.querySelectorAll('.sync-conflict-history-feedback,.sync-conflict-history-note,.sync-conflict-history-outcome,.sync-conflict-history-row-heading>strong,.sync-conflict-history-badge,dt,dd,.sync-conflict-history-list small,button,label')].filter(shown).map(n=>{
      const ancestors=[];for(let a=n;a;a=a.parentElement)ancestors.unshift(a)
      c.clearRect(0,0,1,1);paint('#ffffff');for(const a of ancestors)paint(getComputedStyle(a).backgroundColor)
      const bg=rgb(),style=getComputedStyle(n);paint(style.color);const fg=rgb()
      // The new count labels intentionally use the secondary text token.
      // Keep exact token equality AND the existing 4.5 contrast requirement.
      c.clearRect(0,0,1,1);paint(style.getPropertyValue(n.matches('.sync-conflict-history-note,small,.sync-history-summary-counts dt')?'--ink-soft':'--ink').trim());const expected=rgb(),a=lum(fg),b=lum(bg)
      return{final:fg.every((v,i)=>v===expected[i]),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
    })
    const rows=[...panel.querySelectorAll('[data-history-row]')]
    return{filter:panel.querySelector('select').value,ids:rows.map(n=>n.querySelectorAll('code')[1].textContent),
      outcomes:rows.map(n=>n.querySelector('.sync-conflict-history-outcome').textContent).join(' / '),
      feedback:panel.querySelector('.sync-conflict-history-feedback').textContent,requests:window.__requests,
      cancelledRead:window.__cancelledRead===true,mutations:window.__mutations,networkRequests:window.__networkRequests,navigationCalls:window.__navigationCalls,
      currentGuidanceUnchanged:overview.querySelector('[data-sync-guidance]').textContent===window.__guidance,
      iso:[...overview.querySelectorAll('.sync-overview-metrics time,.sync-overview-note time')].map(n=>n.dateTime),
      counts:[...overview.querySelectorAll('.sync-overview-metrics dd')].slice(0,2).map(n=>n.textContent),
      privateText:panel.textContent.includes('PRIVATE_'),activeMarkup:panel.querySelectorAll('script,img,iframe,a').length,
      controlsVisible:visible(panel.querySelector('select'))&&visible(panel.querySelector('[data-history-read]')),
      focusInside:panel.contains(document.activeElement),colors,viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth-innerWidth}
  }
  app.whenReady().then(async()=>{
    fs.mkdirSync(out,{recursive:true})
    await build({absWorkingDir:root,bundle:true,format:'iife',platform:'browser',alias:{'~':path.join(root,'src')},define:{'process.env.NODE_ENV':'"production"'},outfile:path.join(out,'fixture.js'),
      plugins:[{name:'synthetic-history-api',setup(b){b.onResolve({filter:/^~\/services\/api$/},()=>({path:'api',namespace:'history-fixture'}));b.onLoad({filter:/.*/,namespace:'history-fixture'},()=>({contents:'export const api=(...args)=>window.__historyLoad(...args)',loader:'js'}));b.onLoad({filter:/[\\/]src[\\/]services[\\/]api\.js$/},()=>({contents:'export const api=(...args)=>window.__historyLoad(...args)',loader:'js'}))}}],
      stdin:{resolveDir:root,loader:'jsx',contents:`
        import React from 'react';import{createRoot}from'react-dom/client';import Overview from './src/components/SyncOverviewPanel.jsx';
        import{overviewFixture}from'./scripts/fixtures/sync-overview.mjs';import{historyRow,historyPage}from'./scripts/fixtures/sync-conflict-history.mjs';import './src/components/SyncCenterPanel.css';
        const scene=new URLSearchParams(location.search).get('scene');document.documentElement.dataset.theme=scene==='history-light'?'light':'dark';
        window.__requests=[];window.__mutations=0;window.__networkRequests=0;window.__navigationCalls=0;
        for(const key of ['setItem','removeItem','clear']){const original=Storage.prototype[key];Storage.prototype[key]=function(...args){window.__mutations++;return original.apply(this,args)}}
        window.fetch=()=>{window.__networkRequests++;return Promise.reject(Error('PRIVATE_NETWORK'))};
        window.__historyLoad=(url,init)=>{window.__requests.push({path:url,method:init.method});const count=window.__requests.length;
          if(count===1)return Promise.resolve(historyPage([historyRow('h3'),historyRow('h2','superseded','remote-rebind',1790586500)],'all','next_page'));
          if(count===2)return Promise.resolve(historyPage([historyRow('h1','resolved','remote',1790586400)]));
          if(count===3)return Promise.reject(Error('PRIVATE_SERVER_PASSWORD'));
          if(count===4){init.signal.addEventListener('abort',()=>{window.__cancelledRead=true},{once:true});return new Promise(resolve=>{window.__late=()=>{resolve(historyPage([historyRow('late')]));return true}})}
          if(count===5)return Promise.resolve(historyPage([],'superseded'));
          return Promise.reject(Error('PRIVATE_UNEXPECTED_REQUEST'));
        };
        createRoot(document.getElementById('root')).render(<Overview {...overviewFixture()} onNavigate={()=>{window.__navigationCalls++;return true}}/>);
      `}})
    const index=fs.readFileSync(path.join(root,'dist/index.html'),'utf8'),styles=[...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m=>pathToFileURL(path.resolve(root,'dist',m[1].replace(/^\//,''))).href)
    if(!styles.length)throw Error('Missing production CSS')
    const file=path.join(out,'fixture.html')
    fs.writeFileSync(file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(h=>`<link rel="stylesheet" href="${h}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important;scroll-behavior:auto!important}body{margin:0;padding:16px;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0;padding-bottom:600px}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
    const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:[]}
    const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));save()
    const names=['history-light','history-dark','history-narrow'],phases=['unread','loaded','more','refresh-failed','stopped','empty']
    for(const name of names){
      const win=new BrowserWindow({show:true,width:name==='history-narrow'?560:1000,height:900,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      const exec=code=>win.webContents.executeJavaScript(code)
      const wait=async code=>{for(let i=0;i<60;i++){if(await exec(code))return;await delay(80)}throw Error('History wait failed '+name+' '+code)}
      const click=selector=>exec(`(()=>{const n=document.querySelector('[data-sync-conflict-history]').querySelector(${JSON.stringify(selector)});n.focus({preventScroll:true});n.click();return true})()`)
      const frames=[],scene={name,frames};report.scenes.push(scene)
      const capture=async phase=>{
        await exec(`document.querySelector('[data-sync-conflict-history]').scrollIntoView({block:'start',behavior:'instant'})`)
        let f,last='',stable=0
        for(let i=0;i<60;i++){await delay(90);f=await exec('('+inspect.toString()+')()');const sig=JSON.stringify(f)
          const valid=f&&f.colors.length>=4&&f.colors.every(c=>c.final&&c.ratio>=4.5)&&f.controlsVisible&&f.focusInside&&f.overflow<=1
          stable=valid?(sig===last?stable+1:1):0;last=sig;if(stable>=3)break}
        if(stable<3)throw Error('Invalid history frame '+name+' '+phase+' '+JSON.stringify(f))
        const code=names.indexOf(name)*6+phases.indexOf(phase)+1
        await exec(`(()=>{let s=document.getElementById('history-raster');if(!s){s=document.createElement('div');s.id='history-raster';s.setAttribute('aria-hidden','true');document.body.append(s)}s.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';s.replaceChildren();for(let i=0;i<8;i++){const c=document.createElement('span');c.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+(((${code}>>>i)&1)?'rgb(221,238,255)':'rgb(17,34,51)');s.append(c)}return true})()`)
        await exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')
        let bytes,lastHash='',rasterSamples=0
        for(let i=0;i<40;i++){const b=(await win.capturePage()).toPNG(),sha=createHash('sha256').update(b).digest('hex');let matches=false;try{matches=verifyRasterWitness(b,code)}catch{}
          if(JSON.stringify(await exec('('+inspect.toString()+')()'))!==JSON.stringify(f))throw Error('History DOM changed during screenshot')
          rasterSamples=matches?(sha===lastHash?rasterSamples+1:1):0;lastHash=sha;if(rasterSamples>=2){bytes=b;break}await delay(90)}
        if(!bytes)throw Error('Missing matching history raster');const png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),bytes)
        frames.push({phase,...f,stableSamples:stable,rasterCode:code,rasterSamples,png,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
      }
      try{
        win.setMenu(null);await win.loadFile(file,{query:{scene:name}});await wait('!!document.querySelector("[data-sync-conflict-history]")');await exec('document.fonts.ready.then(()=>true)')
        await exec(`(()=>{window.__guidance=document.querySelector('[data-sync-guidance]').textContent;return true})()`)
        await click(':scope>summary');await capture('unread')
        await click('[data-history-read]');await wait('document.querySelectorAll("[data-history-row]").length===2');await capture('loaded')
        await click('[data-history-more]');await wait('document.querySelectorAll("[data-history-row]").length===3');await capture('more')
        await click('[data-history-read]');await wait('document.querySelector(".sync-conflict-history-feedback").textContent.includes("未能读取")');await capture('refresh-failed')
        await click('[data-history-read]');await wait('!!document.querySelector("[data-history-stop]")');await click('[data-history-stop]');await wait('window.__cancelledRead===true');await exec('window.__late()');await capture('stopped')
        await exec(`(()=>{const s=document.querySelector('[data-sync-conflict-history] select');s.focus({preventScroll:true});s.value='superseded';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
        await wait('document.querySelector(".sync-conflict-history-feedback").textContent.includes("本次读取没有")');await capture('empty')
        verifyHistoryScene(scene)
      }finally{win.destroy()}
    }
    report.complete=true;save();clearTimeout(watchdog);app.exit(0)
  }).catch(error=>{console.error(error);clearTimeout(watchdog);app.exit(1)})
}
