// Real production overview/history components and CSS in Electron, with the
// same explicitly synthetic record fixture as the preceding search driver.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto')
const {names,phases,verifySummaryScene,verifySummaryReport}=require('./sync-history-summary-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-history-summary')
if(!process.versions.electron){
 fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const result=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:100000,maxBuffer:4*1024*1024})
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr)
 if(result.error||result.status!==0)throw result.error||Error('Native summary verification failed')
 verifySummaryReport(out,process.env.GITHUB_SHA||'');console.log('Current-commit native summary evidence verified.')
}else{
 const {app,BrowserWindow}=require('electron')
 app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'notepad-history-summary-')));app.on('window-all-closed',()=>{})
 const watchdog=setTimeout(()=>app.exit(1),90000),delay=ms=>new Promise(r=>setTimeout(r,ms))
 const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,realOverview:true,syntheticRecords:true,backendExercised:false,scenes:[]}
 const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2))
 function inspect(){
  const panel=document.querySelector('[data-sync-conflict-history]'),s=panel.querySelector('[data-history-summary]');if(!s)return null
  const text=key=>s.querySelector('[data-history-summary-'+key+']')?.textContent||'',date=key=>s.querySelector('[data-history-summary-'+key+']')?.dateTime||null
  const rect=s.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=canvas.height=1
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),paint=c=>{ctx.fillStyle=c;ctx.fillRect(0,0,1,1)},rgb=()=>[...ctx.getImageData(0,0,1,1).data].slice(0,3)
  const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
  const colors=[...s.querySelectorAll('p,dt,dd,h5')].filter(n=>n.getClientRects().length).map(n=>{
   const ancestors=[];for(let a=n;a;a=a.parentElement)ancestors.unshift(a)
   ctx.clearRect(0,0,1,1);paint('#ffffff');for(const a of ancestors)paint(getComputedStyle(a).backgroundColor)
   const bg=rgb();paint(getComputedStyle(n).color);const a=lum(bg),b=lum(rgb());return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
  })
  return{open:s.open,scope:text('scope'),outcomes:[...s.querySelectorAll('[data-history-summary-outcome]')].map(n=>Number(n.textContent)),
   kinds:[...s.querySelectorAll('[data-history-summary-kind]')].map(n=>Number(n.textContent)),earliest:date('earliest'),latest:date('latest'),coverage:text('time-coverage'),provenance:text('provenance'),noTime:text('no-time'),unread:!!text('unread'),
   rows:panel.querySelectorAll('[data-history-row]').length,requests:window.__requests,mutations:window.__mutations,networkRequests:window.__networkRequests,navigationCalls:window.__navigationCalls,
   summaryActionControls:s.querySelectorAll('button,input,select,textarea,a').length,privateText:s.textContent.includes('PRIVATE_'),guidanceUnchanged:document.querySelector('[data-sync-guidance]').textContent===window.__guidance,
   visible:rect.top>=0&&rect.bottom<=innerHeight&&rect.left>=0&&rect.right<=innerWidth,focusInside:panel.contains(document.activeElement),overflow:document.documentElement.scrollWidth-innerWidth,colors,width:innerWidth,height:innerHeight}
 }
 app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});save()
  const file=path.join(root,'test-results','sync-history-search','fixture.html')
  if(!fs.existsSync(file))throw Error('Run the production search fixture first')
  for(const name of names){
   const win=new BrowserWindow({show:true,width:name==='summary-narrow'?560:1000,height:1000,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
   const scene={name,frames:[]};report.scenes.push(scene)
   const exec=code=>win.webContents.executeJavaScript(code)
   const wait=async code=>{for(let i=0;i<80;i++){if(await exec(code))return;await delay(60)}throw Error('Summary wait failed '+code)}
   const click=key=>exec(`(()=>{const n=document.querySelector('[data-history-${key}]');n.focus({preventScroll:true});n.click();return true})()`)
   const type=text=>exec(`(()=>{const n=document.querySelector('[data-history-query]');n.focus({preventScroll:true});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(text)});n.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
   const capture=async phase=>{
    await exec(`document.querySelector('[data-history-summary]').scrollIntoView({block:'start',behavior:'instant'})`)
    let frame,last='',stable=0
    for(let i=0;i<50;i++){await delay(70);frame=await exec('('+inspect.toString()+')()');const sig=JSON.stringify(frame);stable=sig===last?stable+1:0;last=sig;if(stable>=2)break}
    if(stable<2)throw Error('Summary did not settle '+name+' '+phase)
    const code=names.indexOf(name)*phases.length+phases.indexOf(phase)+1
    await exec(`(()=>{let s=document.getElementById('summary-raster');if(!s){s=document.createElement('div');s.id='summary-raster';s.setAttribute('aria-hidden','true');document.body.append(s)}s.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';s.replaceChildren();for(let i=0;i<8;i++){const c=document.createElement('span');c.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+(((${code}>>>i)&1)?'rgb(221,238,255)':'rgb(17,34,51)');s.append(c)}return true})()`)
    let bytes,prior='',rasterSamples=0
    for(let i=0;i<40;i++){await delay(70);const b=(await win.capturePage()).toPNG(),hash=createHash('sha256').update(b).digest('hex');let valid=false
     try{valid=verifyRasterWitness(b,code)}catch{}
     rasterSamples=valid?(prior===hash?rasterSamples+1:1):0;prior=hash;if(rasterSamples>=2){bytes=b;break}}
    if(!bytes||JSON.stringify(await exec('('+inspect.toString()+')()'))!==JSON.stringify(frame))throw Error('Summary screenshot/DOM mismatch')
    const filename=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,filename),bytes)
    scene.frames.push({phase,...frame,stable,rasterSamples,rasterCode:code,filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
   }
   try{
    win.setMenu(null);await win.loadFile(file,{query:{scene:name==='summary-light'?'search-light':'search-dark'}})
    await wait('!!document.querySelector("[data-history-read]")');await exec('document.fonts.ready.then(()=>true)')
    await exec(`(()=>{window.__guidance=document.querySelector('[data-sync-guidance]').textContent;document.querySelector('[data-sync-conflict-history]').open=true;return true})()`)
    await click('read');await wait('!!document.querySelector("[data-history-summary]")')
    await exec(`(()=>{const s=document.querySelector('[data-history-summary]');if(s.open)throw Error('Summary should start collapsed');s.querySelector('summary').focus({preventScroll:true});s.querySelector('summary').click();return true})()`)
    await capture('loaded');await type('abc');await capture('filtered')
    await type('');await click('more');await wait('!document.querySelector("[data-history-more]")');await capture('appended')
    await click('read');await wait('document.querySelector(".sync-conflict-history-feedback").textContent.includes("未能读取")');await capture('stale')
    await type('PRIVATE_UNMATCHED');await capture('empty')
    await type('')
    await exec(`window.__historyLoad=(url,init)=>{window.__requests.push({path:url,method:init.method});return Promise.resolve({version:1,scope:'local-workspace',filter:'all',has_more:false,next_cursor:'',items:[{id:'timeless',item_id:'note-timeless',kind:'file',current_title:'无时间记录',created_at:100,resolved_at:0,status:'resolved',resolution:'remote'}]})};true`)
    await click('read');await wait('document.querySelectorAll("[data-history-row]").length===1');await capture('timeless')
    verifySummaryScene(scene)
   }finally{win.destroy()}
  }
  report.complete=true;save();clearTimeout(watchdog);app.exit(0)
 }).catch(e=>{console.error(e);clearTimeout(watchdog);app.exit(1)})
}
