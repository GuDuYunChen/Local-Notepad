// Real browser File input + FileReader, not a fake parsed-record callback.
// This uses the production Overview fixture; file data are explicitly synthetic.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url')
const {names,phases,verifyFileScene,verifyFileReport}=require('./sync-history-file-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-history-file')
if(!process.versions.electron){
 fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const r=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:110000,maxBuffer:4*1024*1024})
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr)
 if(r.error||r.status!==0)throw r.error||Error('Offline history native test failed')
 verifyFileReport(out,process.env.GITHUB_SHA||'');console.log('Actual local FileReader and isolated file view verified.')
}else{
 const {app,BrowserWindow}=require('electron'),delay=ms=>new Promise(r=>setTimeout(r,ms))
 app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'notepad-history-file-')));app.on('window-all-closed',()=>{})
 const watchdog=setTimeout(()=>app.exit(1),100000)
 const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,actualFileReader:true,syntheticRecords:true,downloadedExportCompatibility:[],scenes:[]}
 const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2))
 function inspect(){
  const p=document.querySelector('[data-history-file-viewer]'),text=k=>p.querySelector('[data-history-file-'+k+']')?.textContent||''
  const target=window.__framePhase==='page2'?p.querySelector('.sync-history-file-list'):p.querySelector('.sync-history-file-controls')
  const r=target.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=canvas.height=1
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),paint=c=>{ctx.fillStyle=c;ctx.fillRect(0,0,1,1)},rgb=()=>[...ctx.getImageData(0,0,1,1).data].slice(0,3)
  const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
  const colors=[...p.querySelectorAll('p,dt,dd,h5,small')].filter(n=>n.getClientRects().length).map(n=>{
   const ancestors=[];for(let a=n;a;a=a.parentElement)ancestors.unshift(a)
   ctx.clearRect(0,0,1,1);paint('#ffffff');for(const a of ancestors)paint(getComputedStyle(a).backgroundColor)
   const bg=rgb();paint(getComputedStyle(n).color);const a=lum(bg),b=lum(rgb());return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
  })
  return{ids:[...p.querySelectorAll('[data-history-file-row]')].map(n=>n.querySelectorAll('code')[1].textContent),notice:text('notice'),filename:text('name'),scope:text('scope'),source:text('source'),dates:text('dates'),page:text('page'),stale:!!p.querySelector('[data-history-file-stale]'),
   requests:window.__requests.length,mutations:window.__mutations,networkRequests:window.__networkRequests,navigationCalls:window.__navigationCalls,
   currentGuidanceUnchanged:document.querySelector('[data-sync-guidance]').textContent===window.__guidance,liveRows:document.querySelectorAll('[data-history-row]').length,
   activeMarkup:p.querySelectorAll('script,img,a,iframe').length,focusInside:p.contains(document.activeElement),focusChoose:document.activeElement===p.querySelector('[data-history-file-choose]'),
   colors,targetRect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},targetVisible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,width:innerWidth,height:innerHeight}
 }
 app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});save()
  const {prepareHistoryExport}=await import(pathToFileURL(path.join(root,'src/services/syncHistoryExport.mjs')).href)
  const {parseHistoryFile}=await import(pathToFileURL(path.join(root,'src/services/syncHistoryFile.mjs')).href)
  // Independently consume the files actually downloaded by both old exporters.
  for(const directory of ['sync-history-export','sync-history-time']){
   const dir=path.join(root,'test-results',directory),json=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
   if(json.commit!==report.commit||json.complete!==true)throw Error('Missing current-commit exporter evidence')
   for(const scene of json.scenes)for(const file of scene.downloads){
    const bytes=fs.readFileSync(path.join(dir,file.filename)),parsed=parseHistoryFile(bytes.toString('utf8'))
    if(createHash('sha256').update(bytes).digest('hex')!==file.sha256||parsed.records.length!==file.json.records.length)throw Error('Downloaded report mismatch')
    report.downloadedExportCompatibility.push({name:directory+'/'+file.filename,version:parsed.version,records:parsed.records.length,sha256:file.sha256})
   }
  }
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'notepad-file-fixtures-'))
  const rows=Array.from({length:31},(_,i)=>({id:'r'+i,itemID:'note-'+i,title:'档案 <img src=x> '+i,kind:'file',status:'resolved',resolution:'local',createdAt:1,resolvedAt:i===0?1790726400:1790640000}))
  const make=extra=>prepareHistoryExport({snapshot:{items:rows,filter:'all',hasMore:true},phase:'ready',...extra},new Date('2026-09-30T12:00:00Z')).raw
  const v1=make({}),v2=make({phase:'error',timeFilter:{mode:'range',from:'2026-09-30',to:'2026-09-30'}})
  const invalid=JSON.parse(v1);invalid.records[1].id='r0'
  for(const [name,raw] of [['v1.json',v1],['v2.json',v2],['invalid.json',JSON.stringify(invalid)],['utf8.json',Buffer.from([0xc3,0x28])],['oversize.json',' '.repeat(4*1024*1024+1)]])fs.writeFileSync(path.join(data,name),raw)
  const fixture=path.join(root,'test-results','sync-history-search','fixture.html')
  for(const name of names){
   const win=new BrowserWindow({show:true,width:name==='file-narrow'?560:1000,height:900,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
   const scene={name,frames:[]};report.scenes.push(scene)
   const exec=code=>win.webContents.executeJavaScript(code)
   const wait=async code=>{for(let i=0;i<80;i++){if(await exec(code))return;await delay(60)}throw Error('File view wait failed '+code)}
   const click=key=>exec(`(()=>{const n=document.querySelector('[data-history-file-${key}]');n.focus({preventScroll:true});n.click();return true})()`)
   const choose=async file=>{
    await exec(`document.querySelector('[data-history-file-choose]').focus({preventScroll:true});true`)
    const {root:doc}=await win.webContents.debugger.sendCommand('DOM.getDocument',{depth:0})
    const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:doc.nodeId,selector:'[data-history-file-input]'})
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[path.join(data,file)]})
   }
   const capture=async phase=>{
    await exec(`window.__framePhase=${JSON.stringify(phase)};document.querySelector(${JSON.stringify(phase==='page2'?'.sync-history-file-list':'[data-history-file-viewer]')}).scrollIntoView({block:${JSON.stringify(phase==='page2'?'center':'start')},behavior:'instant'});true`)
    let f,last='',stable=0
    for(let i=0;i<50;i++){await delay(60);f=await exec('('+inspect.toString()+')()');const s=JSON.stringify(f);stable=last===s?stable+1:0;last=s;if(stable>=2)break}
    if(stable<2)throw Error('Unstable offline view')
    const code=names.indexOf(name)*phases.length+phases.indexOf(phase)+1
    await exec(`(()=>{let s=document.getElementById('file-raster');if(!s){s=document.createElement('div');s.id='file-raster';s.setAttribute('aria-hidden','true');document.body.append(s)}s.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';s.replaceChildren();for(let i=0;i<8;i++){const c=document.createElement('span');c.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+(((${code}>>>i)&1)?'rgb(221,238,255)':'rgb(17,34,51)');s.append(c)}return true})()`)
    let bytes,prior='',rasterSamples=0
    for(let i=0;i<40;i++){await delay(60);const b=(await win.capturePage()).toPNG(),hash=createHash('sha256').update(b).digest('hex');let valid=false
     try{valid=verifyRasterWitness(b,code)}catch{}
     rasterSamples=valid?(prior===hash?rasterSamples+1:1):0;prior=hash;if(rasterSamples>=2){bytes=b;break}}
    if(!bytes||JSON.stringify(await exec('('+inspect.toString()+')()'))!==JSON.stringify(f))throw Error('File view screenshot mismatch')
    const png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),bytes)
    scene.frames.push({phase,...f,stable,rasterSamples,rasterCode:code,png,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
   }
   try{
    win.setMenu(null);win.webContents.debugger.attach('1.3');await win.loadFile(fixture,{query:{scene:name==='file-light'?'search-light':'search-dark'}})
    await wait('!!document.querySelector("[data-history-file-input]")');await exec('document.fonts.ready.then(()=>true)')
    await exec(`(()=>{window.__guidance=document.querySelector('[data-sync-guidance]').textContent;const n=document.querySelector('[data-history-file-viewer]>summary');n.focus();n.click();return true})()`)
    await capture('unread');await choose('v1.json');await wait('document.querySelectorAll("[data-history-file-row]").length===25');await capture('version1')
    await click('next');await wait('document.querySelectorAll("[data-history-file-row]").length===6');await capture('page2')
    await choose('v2.json');await wait('document.querySelectorAll("[data-history-file-row]").length===1');await capture('version2')
    await choose('invalid.json');await wait('document.querySelector("[data-history-file-notice]").textContent.includes("不符合")');await capture('invalid')
    await choose('utf8.json');await wait('document.querySelector("[data-history-file-notice]").textContent.includes("UTF-8")');scene.invalidUTF8Refused=true
    await choose('oversize.json');await wait('document.querySelector("[data-history-file-notice]").textContent.includes("4 MiB")');scene.oversizeRefused=true
    await click('clear');await capture('cleared');verifyFileScene(scene)
   }finally{win.destroy()}
  }
  report.complete=true;save();clearTimeout(watchdog);app.exit(0)
 }).catch(e=>{console.error(e);clearTimeout(watchdog);app.exit(1)})
}
