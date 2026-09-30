// Real production React/Overview/CSS in Chromium. Responses are explicitly
// synthetic; the unchanged actual Go/SQLite history API has its separate test.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto')
const {phases,scenes,verifyHistorySearchScene,verifyHistorySearchReport}=require('./sync-history-search-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-history-search')
if(!process.versions.electron){
 fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const r=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024})
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr)
 if(r.error||r.status!==0)throw r.error||Error('History search native check failed')
 verifyHistorySearchReport(out,process.env.GITHUB_SHA||'');console.log('Current-commit history search evidence verified.')
}else{
 const {app,BrowserWindow}=require('electron'),{build}=require('esbuild'),{pathToFileURL}=require('node:url')
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'notepad-history-search-'));app.setPath('userData',userData);app.on('window-all-closed',()=>{})
 const watchdog=setTimeout(()=>app.exit(1),105000),delay=ms=>new Promise(r=>setTimeout(r,ms))
 function inspect(){
  const panel=document.querySelector('[data-sync-conflict-history]'),overview=document.querySelector('.sync-overview');if(!panel)return null
  const visible=n=>{const r=n.getBoundingClientRect();return n.getClientRects().length>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&getComputedStyle(n).visibility!=='hidden'}
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d',{willReadFrequently:true})
  const paint=s=>{c.fillStyle=s;c.fillRect(0,0,1,1)},rgb=()=>[...c.getImageData(0,0,1,1).data].slice(0,3)
  const lum=rgb=>rgb.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((a,b,i)=>a+b*[.2126,.7152,.0722][i],0)
  const colors=[...panel.querySelectorAll('.sync-history-search legend,.sync-history-search label,.sync-history-search>p,[data-history-search-feedback]')].map(n=>{
   const ancestors=[];for(let a=n;a;a=a.parentElement)ancestors.unshift(a);c.clearRect(0,0,1,1);paint('#ffffff')
   for(const a of ancestors)paint(getComputedStyle(a).backgroundColor);const bg=rgb();paint(getComputedStyle(n).color);const fg=rgb(),a=lum(fg),b=lum(bg)
   return{ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
  })
  const rows=[...panel.querySelectorAll('[data-history-row]')]
  return{imeEvents:window.__imeEvents||[],query:panel.querySelector('[data-history-query]').value,kind:panel.querySelector('[data-history-kind]').value,outcome:panel.querySelector('[data-history-outcome]').value,
   serverFilter:panel.querySelector('select').value,ids:rows.map(n=>n.querySelectorAll('code')[1].textContent),outcomes:rows.map(n=>n.querySelector('.sync-conflict-history-outcome').textContent).join(' / '),
   searchFeedback:panel.querySelector('[data-history-search-feedback]').textContent,readFeedback:panel.querySelector('.sync-conflict-history-feedback').textContent,
   requests:window.__requests,mutations:window.__mutations,networkRequests:window.__networkRequests,navigationCalls:window.__navigationCalls,
   currentGuidanceUnchanged:overview.querySelector('[data-sync-guidance]').textContent===window.__guidance,
   privateText:panel.textContent.includes('PRIVATE_'),activeMarkup:panel.querySelectorAll('script,img,iframe,a').length,
   controlsVisible:['query','kind','outcome'].every(name=>visible(panel.querySelector('[data-history-'+name+']'))),
   focusInside:panel.contains(document.activeElement),focusQuery:document.activeElement===panel.querySelector('[data-history-query]'),
   hasMore:!!panel.querySelector('[data-history-more]'),colors,viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth-innerWidth}
 }
 app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true})
  await build({absWorkingDir:root,bundle:true,format:'iife',platform:'browser',alias:{'~':path.join(root,'src')},define:{'process.env.NODE_ENV':'"production"'},outfile:path.join(out,'fixture.js'),
   plugins:[{name:'synthetic-history-search',setup(b){b.onResolve({filter:/^~\/services\/api$/},()=>({path:'api',namespace:'history-search'}));b.onLoad({filter:/.*/,namespace:'history-search'},()=>({contents:'export const api=(...a)=>window.__historyLoad(...a)',loader:'js'}));b.onLoad({filter:/[\\/]src[\\/]services[\\/]api\.js$/},()=>({contents:'export const api=(...a)=>window.__historyLoad(...a)',loader:'js'}))}}],
   stdin:{resolveDir:root,loader:'jsx',contents:`
    import React from 'react';import{createRoot}from'react-dom/client';import Overview from './src/components/SyncOverviewPanel.jsx';
    import{overviewFixture}from'./scripts/fixtures/sync-overview.mjs';import{historyRow,historyPage}from'./scripts/fixtures/sync-conflict-history.mjs';import './src/components/SyncCenterPanel.css';
    document.documentElement.dataset.theme=new URLSearchParams(location.search).get('scene')==='search-light'?'light':'dark';
    window.__requests=[];window.__mutations=0;window.__networkRequests=0;window.__navigationCalls=0;
    for(const key of ['setItem','removeItem','clear']){const original=Storage.prototype[key];Storage.prototype[key]=function(...args){window.__mutations++;return original.apply(this,args)}}
    window.fetch=()=>{window.__networkRequests++;return Promise.reject(Error('PRIVATE_NETWORK'))};
    const row=(id,kind,resolution,stamp,title)=>({...historyRow(id,resolution==='remote-rebind'?'superseded':'resolved',resolution,stamp),kind,current_title:title});
    window.__historyLoad=(url,init)=>{window.__requests.push({path:url,method:init.method});const n=window.__requests.length;
     if(n===1)return Promise.resolve(historyPage([row('h5','file','local',1790586600,'星图研究 ＡＢＣ'),row('h4','file','remote',1790586500,'Café 星图'),row('h3','attachment','remote-rebind',1790586400,''),row('h2','tag','unknown',1790586300,''),row('h1','file-tag','local',1790586200,'')],'all','older-page'));
     if(n===2)return Promise.resolve(historyPage([row('h0','file','remote',1790586100,'晚章·未读取')]));
     return Promise.reject(Error('PRIVATE_SERVER_PASSWORD'));
    };
    createRoot(document.getElementById('root')).render(<Overview {...overviewFixture()} onNavigate={()=>{window.__navigationCalls++;return true}}/>);
   `}})
  const index=fs.readFileSync(path.join(root,'dist/index.html'),'utf8'),styles=[...index.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m=>pathToFileURL(path.resolve(root,'dist',m[1].replace(/^\//,''))).href)
  if(!styles.length)throw Error('Missing production CSS')
  const file=path.join(out,'fixture.html')
  fs.writeFileSync(file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:">${styles.map(h=>`<link rel="stylesheet" href="${h}">`).join('')}<link rel="stylesheet" href="fixture.css"><style>html,body{height:auto!important;overflow:auto!important;scroll-behavior:auto!important}body{margin:0;padding:16px;background:var(--paper);color:var(--ink)}#root{height:auto;min-width:0;padding-bottom:900px}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
  const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,compositionDriver:'CDP Input.imeSetComposition/Input.insertText',complete:false,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:[]}
  const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));save()
  for(const name of scenes){
   const win=new BrowserWindow({show:true,width:name==='search-narrow'?560:1000,height:1000,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
   const exec=code=>win.webContents.executeJavaScript(code),scene={name,frames:[]};report.scenes.push(scene)
   const wait=async code=>{for(let i=0;i<70;i++){if(await exec(code))return;await delay(70)}throw Error('History search wait failed '+name+' '+code)}
   const click=attr=>exec(`(()=>{const n=document.querySelector('[data-history-${attr}]');n.focus({preventScroll:true});n.click();return true})()`)
   const choose=(attr,value)=>exec(`(()=>{const n=document.querySelector('[data-history-${attr}]');n.focus({preventScroll:true});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
   const type=value=>exec(`(()=>{const n=document.querySelector('[data-history-query]');n.focus({preventScroll:true});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
   const capture=async phase=>{
    await exec(`document.querySelector('[data-sync-conflict-history]').scrollIntoView({block:'start',behavior:'instant'})`)
    let frame,last='',stable=0
    for(let i=0;i<50;i++){await delay(80);frame=await exec('('+inspect.toString()+')()');const sig=JSON.stringify(frame);stable=sig===last?stable+1:0;last=sig;if(stable>=2)break}
    if(stable<2)throw Error('Unstable history search frame '+name+' '+phase)
    const code=scenes.indexOf(name)*phases.length+phases.indexOf(phase)+1
    await exec(`(()=>{let s=document.getElementById('search-raster');if(!s){s=document.createElement('div');s.id='search-raster';s.setAttribute('aria-hidden','true');document.body.append(s)}s.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';s.replaceChildren();for(let i=0;i<8;i++){const c=document.createElement('span');c.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+(((${code}>>>i)&1)?'rgb(221,238,255)':'rgb(17,34,51)');s.append(c)}return true})()`)
    await exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')
    let bytes,lastHash='',rasterSamples=0
    for(let i=0;i<40;i++){const b=(await win.capturePage()).toPNG(),sha=createHash('sha256').update(b).digest('hex');let matches=false
     try{matches=verifyRasterWitness(b,code)}catch{}
     rasterSamples=matches?(sha===lastHash?rasterSamples+1:1):0;lastHash=sha
     if(rasterSamples>=2){bytes=b;break}await delay(80)
    }
    if(!bytes)throw Error('Missing current phase raster');if(JSON.stringify(await exec('('+inspect.toString()+')()'))!==JSON.stringify(frame))throw Error('DOM changed during capture')
    const png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),bytes);scene.frames.push({phase,...frame,stableSamples:stable,rasterSamples,rasterCode:code,png,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
   }
   try{
    win.setMenu(null);await win.loadFile(file,{query:{scene:name}});await wait('!!document.querySelector("[data-history-query]")');await exec('document.fonts.ready.then(()=>true)')
    win.webContents.debugger.attach('1.3')
    await exec(`(()=>{window.__imeEvents=[];const n=document.querySelector('[data-history-query]');for(const type of ['compositionstart','compositionupdate','compositionend'])n.addEventListener(type,e=>window.__imeEvents.push({type:e.type,data:e.data,trusted:e.isTrusted}));return true})()`)
    await exec(`(()=>{window.__guidance=document.querySelector('[data-sync-guidance]').textContent;document.querySelector('[data-sync-conflict-history]').open=true;return true})()`)
    await type('abc');await choose('kind','file');await choose('outcome','local');await capture('unread-local')
    await click('read');await wait('document.querySelectorAll("[data-history-row]").length===1');await capture('title-match')
    await type('');await choose('kind','attachment');await choose('outcome','superseded');await capture('kind-outcome')
    await type('晚章');await choose('kind','all');await choose('outcome','all');await capture('unread-pages')
    await click('more');await wait('document.querySelectorAll("[data-history-row]").length===1&&!document.querySelector("[data-history-more]")');await capture('appended-match')
    await type('abc');await choose('kind','file');await choose('outcome','local');await click('read');await wait('document.querySelector(".sync-conflict-history-feedback").textContent.includes("未能读取")');await capture('refresh-failed')
    await click('clear');await capture('cleared')
    // Drive Chromium's native composition path. Do not manufacture DOM
    // composition events or call React's handlers to claim IME coverage.
    await type('abc')
    await exec(`(()=>{const n=document.querySelector('[data-history-query]');n.focus({preventScroll:true});n.setSelectionRange(0,3);return true})()`)
    await win.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'xingtu',selectionStart:6,selectionEnd:6,replacementStart:0,replacementEnd:3})
    await wait(`document.querySelector('[data-history-query]').value==='xingtu'`)
    await capture('ime-candidate')
    await win.webContents.debugger.sendCommand('Input.insertText',{text:'星图'})
    await wait(`document.querySelector('[data-history-query]').value==='星图'`)
    await capture('ime-committed')
    await type('文'.repeat(127))
    await exec(`(()=>{const n=document.querySelector('[data-history-query]');n.focus({preventScroll:true});n.setSelectionRange(127,127);return true})()`)
    await win.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'zhong',selectionStart:5,selectionEnd:5,replacementStart:127,replacementEnd:127})
    await wait(`document.querySelector('[data-history-query]').value===${JSON.stringify('文'.repeat(127)+'zhong')}`)
    await capture('ime-boundary')
    await win.webContents.debugger.sendCommand('Input.insertText',{text:'中'})
    await wait(`document.querySelector('[data-history-query]').value===${JSON.stringify('文'.repeat(127)+'中')}`)
    await capture('ime-boundary-committed')
    verifyHistorySearchScene(scene)
   }finally{win.destroy()}
  }
  report.complete=true;save();clearTimeout(watchdog);app.exit(0)
 }).catch(error=>{console.error(error);clearTimeout(watchdog);app.exit(1)})
}
