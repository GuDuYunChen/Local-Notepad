// Reuse the production Overview fixture. Native file input/FileReader and DOM
// controls, isolated synthetic files; no live history requests or user data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url')
const {names,phases,verifyPaginationScene,verifyPaginationReport}=require('./sync-history-file-pagination-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-history-file-pagination')
if(!process.versions.electron){
 fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const r=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:110000,maxBuffer:4*1024*1024})
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr)
 if(r.error||r.status!==0)throw r.error||Error('Native file-pagination check failed')
 verifyPaginationReport(out,process.env.GITHUB_SHA||'');console.log('File-pagination native evidence verified.')
}else{
 const {app,BrowserWindow}=require('electron'),delay=ms=>new Promise(r=>setTimeout(r,ms))
 app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'notepad-file-pagination-')));app.on('window-all-closed',()=>{})
 const watchdog=setTimeout(()=>app.exit(1),100000)
 const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,actualFileReader:true,syntheticRecords:true,sourceFilesUnchanged:false,scenes:[]}
 const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2))
 function inspect(){
  const p=document.querySelector('[data-history-file-viewer]'),nav=p.querySelector('.sync-history-file-pages'),q=k=>p.querySelector('[data-history-file-'+k+']')
  const r=nav.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=canvas.height=1
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),paint=c=>{ctx.fillStyle=c;ctx.fillRect(0,0,1,1)},rgb=()=>[...ctx.getImageData(0,0,1,1).data].slice(0,3)
  const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
  const colors=[...nav.querySelectorAll('label,[data-history-file-page],.sync-history-file-page-jump>span,.sync-history-file-page-error')].map(n=>{
   const ancestors=[];for(let a=n;a;a=a.parentElement)ancestors.unshift(a)
   ctx.clearRect(0,0,1,1);paint('#fff');for(const a of ancestors)paint(getComputedStyle(a).backgroundColor)
   const bg=rgb();paint(getComputedStyle(n).color);const a=lum(bg),b=lum(rgb());return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
  })
  return {ids:[...p.querySelectorAll('[data-history-file-row]')].map(n=>n.querySelectorAll('code')[1].textContent),draft:q('jump-input').value,error:q('jump-error')?.textContent||'',invalid:!!q('jump-error'),
   outcomes:[...p.querySelectorAll('[data-file-summary-outcome]')].map(n=>Number(n.textContent)),matches:q('matches').textContent,page:q('page').textContent,readOnly:q('jump-input').readOnly,
   disabled:Object.fromEntries(['first','prev','next','last','jump'].map(k=>[k,q(k).getAttribute('aria-disabled')==='true'])),
   reads:window.__fileReads,requests:window.__requests.length,mutations:window.__mutations,network:window.__networkRequests,navigation:window.__navigationCalls,
   liveUnchanged:document.querySelector('[data-sync-conflict-history]').textContent===window.__liveHistory,sourceUnchanged:q('scope').textContent===window.__fileScope,activeMarkup:p.querySelectorAll('img,script,a,iframe').length,
   targetRect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,
   focusInside:p.contains(document.activeElement),focusJump:document.activeElement===q('jump-input'),focusQuery:document.activeElement===q('query'),overflow:document.documentElement.scrollWidth-innerWidth,colors,width:innerWidth,height:innerHeight}
 }
 app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});save()
  const {prepareHistoryExport}=await import(pathToFileURL(path.join(root,'src/services/syncHistoryExport.mjs')).href)
  const rows=Array.from({length:61},(_,i)=>({id:'r'+i,itemID:'same',title:i===60?'尾页':'笔记 '+i,kind:'file',status:'resolved',resolution:'local',createdAt:1,resolvedAt:1790726400}))
  const raw=prepareHistoryExport({snapshot:{items:rows,filter:'all',hasMore:true},phase:'ready'},new Date('2026-10-01T10:00:00Z')).raw
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'file-pagination-fixtures-'))
  const files={'history.json':raw}
  fs.writeFileSync(path.join(data,'history.json'),raw)
  for(const name of names){
   const win=new BrowserWindow({show:true,width:name==='pagination-narrow'?560:1000,height:900,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
   const scene={name,frames:[]};report.scenes.push(scene);let downloads=0
   const onDownload=()=>downloads++;win.webContents.session.on('will-download',onDownload)
   const exec=code=>win.webContents.executeJavaScript(code),cdp=(method,params)=>win.webContents.debugger.sendCommand(method,params)
   const wait=async code=>{for(let i=0;i<80;i++){if(await exec(code))return;await delay(60)}throw Error('Pagination view not ready: '+code)}
   const fileControl=k=>'[data-history-file-'+k+']'
   const click=sel=>exec(`(()=>{const n=document.querySelector(${JSON.stringify(sel)});n.focus({preventScroll:true});n.click();return true})()`)
   const change=(sel,value)=>exec(`(()=>{const n=document.querySelector(${JSON.stringify(sel)});n.focus({preventScroll:true});if(n.tagName==='INPUT')Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});else n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
   const choose=async file=>{
    await exec(`document.querySelector('[data-history-file-choose]').focus({preventScroll:true});true`)
    const {root:doc}=await cdp('DOM.getDocument',{depth:0}),{nodeId}=await cdp('DOM.querySelector',{nodeId:doc.nodeId,selector:fileControl('input')})
    await cdp('DOM.setFileInputFiles',{nodeId,files:[path.join(data,file)]})
   }
   const capture=async phase=>{
    await exec(`document.querySelector('.sync-history-file-pages').scrollIntoView({block:'center',behavior:'instant'});true`)
    let frame,last='',stable=0
    for(let i=0;i<40;i++){await delay(70);frame=await exec('('+inspect.toString()+')()');const s=JSON.stringify(frame);stable=s===last?stable+1:0;last=s;if(stable>=2)break}
    if(stable<2)throw Error('Unstable file-pagination DOM')
    const code=names.indexOf(name)*phases.length+phases.indexOf(phase)+1
    await exec(`(()=>{let s=document.getElementById('pagination-raster');if(!s){s=document.createElement('div');s.id='pagination-raster';s.setAttribute('aria-hidden','true');document.body.append(s)}s.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';s.replaceChildren();for(let i=0;i<8;i++){const c=document.createElement('span');c.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+(((${code}>>>i)&1)?'rgb(221,238,255)':'rgb(17,34,51)');s.append(c)}return true})()`)
    let bytes,prior='',samples=0
    for(let i=0;i<40;i++){await delay(70);const b=(await win.capturePage()).toPNG(),hash=createHash('sha256').update(b).digest('hex');let valid=false;try{valid=verifyRasterWitness(b,code)}catch{}
     samples=valid?(prior===hash?samples+1:1):0;prior=hash;if(samples>=2){bytes=b;break}}
    if(!bytes||JSON.stringify(await exec('('+inspect.toString()+')()'))!==JSON.stringify(frame))throw Error('File-pagination raster/DOM mismatch')
    const png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),bytes);scene.frames.push({phase,...frame,downloads,stable,samples,code,png,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
   }
   try{
    win.setMenu(null);win.webContents.debugger.attach('1.3')
    await win.loadFile(path.join(root,'test-results','sync-history-search','fixture.html'),{query:{scene:name==='pagination-light'?'search-light':'search-dark'}})
    await wait(`!!document.querySelector('[data-history-file-input]')`);await exec('document.fonts.ready.then(()=>true)')
    await exec(`(()=>{window.__liveHistory=document.querySelector('[data-sync-conflict-history]').textContent;window.__fileReads=0;const read=FileReader.prototype.readAsArrayBuffer;FileReader.prototype.readAsArrayBuffer=function(...a){window.__fileReads++;return read.apply(this,a)};document.querySelector('[data-history-file-viewer]').open=true;return true})()`)
    await choose('history.json');await wait(`!!document.querySelector('[data-history-file-jump-input]')`)
    await exec(`window.__fileScope=document.querySelector('[data-history-file-scope]').textContent;true`)
    await capture('first');await click(fileControl('last'));await click(fileControl('first'));await click(fileControl('last'));await capture('last')
    await change(fileControl('jump-input'),'２')
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await wait(`document.querySelector('[data-history-file-page]').textContent.includes('第 2 / 3 页')`);await capture('jumped')
    await change(fileControl('jump-input'),'99')
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await wait(`!!document.querySelector('[data-history-file-jump-error]')`);await capture('invalid')
    await change(fileControl('query'),'尾页');await capture('filtered')
    await change(fileControl('query'),'missing');await click(fileControl('last'));await click(fileControl('jump'));await capture('empty')
    await click(fileControl('filter-clear'));await capture('cleared')
    verifyPaginationScene(scene)
   }finally{win.webContents.session.removeListener('will-download',onDownload);win.destroy()}
  }
  for(const [name,raw]of Object.entries(files))if(fs.readFileSync(path.join(data,name),'utf8')!==raw)throw Error('Source file changed')
  report.sourceFilesUnchanged=true;report.complete=true;save();clearTimeout(watchdog);app.exit(0)
 }).catch(e=>{console.error(e);clearTimeout(watchdog);app.exit(1)})
}
