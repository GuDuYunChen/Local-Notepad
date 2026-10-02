// Reuse the production Overview fixture. Native file input/FileReader and DOM
// controls, isolated synthetic files; no live history requests or user data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url')
const {names,phases,verifyOrderScene,verifyOrderReport}=require('./sync-history-file-order-evidence.cjs')
const {verifyFileDetailsScene,verifyFileDetailsReport}=require('./sync-history-file-details-evidence.cjs')
const {verifyIdentifierSelectionScene,verifyIdentifierSelectionReport}=require('./sync-history-file-identifier-selection-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const {establishNativeViewport}=require('./native-test-viewport.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-history-file-order')
if(!process.versions.electron){
 fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const r=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:110000,maxBuffer:4*1024*1024})
 if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr)
 if(r.error||r.status!==0)throw r.error||Error('Native file-order check failed')
 verifyIdentifierSelectionReport(out,process.env.GITHUB_SHA||'');console.log('File-order native evidence verified.')
}else{
 const {app,BrowserWindow}=require('electron'),delay=ms=>new Promise(r=>setTimeout(r,ms))
 app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'notepad-file-order-')));app.on('window-all-closed',()=>{})
 const watchdog=setTimeout(()=>app.exit(1),100000)
 const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,actualFileReader:true,syntheticRecords:true,sourceFilesUnchanged:false,scenes:[]}
 const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2))
 function inspect(){
  const p=document.querySelector('[data-history-file-viewer]'),nav=p.querySelector('[data-history-file-order-panel]'),q=k=>p.querySelector('[data-history-file-'+k+']')
  const r=nav.getBoundingClientRect(),tools=p.querySelector('[data-history-file-record-tools]'),tr=tools.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=canvas.height=1
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),paint=c=>{ctx.fillStyle=c;ctx.fillRect(0,0,1,1)},rgb=()=>[...ctx.getImageData(0,0,1,1).data].slice(0,3)
  const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
  const colors=[...nav.querySelectorAll('label,select,p'),...tools.querySelectorAll('button,p'),...p.querySelectorAll('[data-history-file-identifiers][open] button')].map(n=>{
   const ancestors=[];for(let a=n;a;a=a.parentElement)ancestors.unshift(a)
   ctx.clearRect(0,0,1,1);paint('#fff');for(const a of ancestors)paint(getComputedStyle(a).backgroundColor)
   const bg=rgb();paint(getComputedStyle(n).color);const a=lum(bg),b=lum(rgb());return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
  })
  return {identifiersCount:p.querySelectorAll('[data-history-file-identifiers]').length,identifiersOpen:p.querySelectorAll('[data-history-file-identifiers][open]').length,detailsToolsVisible:tr.top>=0&&tr.bottom<=innerHeight&&tr.left>=0&&tr.right<=innerWidth,detailsDisabled:{expand:q('expand-identifiers').getAttribute('aria-disabled')==='true',collapse:q('collapse-identifiers').getAttribute('aria-disabled')==='true'},detailsScope:tools.querySelector('p').textContent,ids:[...p.querySelectorAll('[data-history-file-row]')].map(n=>n.querySelectorAll('code')[1].textContent),order:q('order').value,draft:q('jump-input').value,error:q('jump-error')?.textContent||'',invalid:!!q('jump-error'),
   outcomes:[...p.querySelectorAll('[data-file-summary-outcome]')].map(n=>Number(n.textContent)),matches:q('matches').textContent,page:q('page').textContent,readOnly:q('jump-input').readOnly,
   disabled:Object.fromEntries(['first','prev','next','last','jump'].map(k=>[k,q(k).getAttribute('aria-disabled')==='true'])),
   reads:window.__fileReads,requests:window.__requests.length,mutations:window.__mutations,network:window.__networkRequests,navigation:window.__navigationCalls,
   liveUnchanged:document.querySelector('[data-sync-conflict-history]').textContent===window.__liveHistory,sourceUnchanged:q('scope').textContent===window.__fileScope,activeMarkup:p.querySelectorAll('img,script,a,iframe').length,
   targetRect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,
   focusInside:p.contains(document.activeElement),focusOrder:document.activeElement===q('order'),focusJump:document.activeElement===q('jump-input'),focusQuery:document.activeElement===q('query'),overflow:document.documentElement.scrollWidth-innerWidth,colors,width:innerWidth,height:innerHeight}
 }
 app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});save()
  const {prepareHistoryExport}=await import(pathToFileURL(path.join(root,'src/services/syncHistoryExport.mjs')).href)
  const rows=Array.from({length:61},(_,i)=>({id:'r'+i,itemID:'same',title:i===60?'尾页':'笔记 '+i,kind:'file',status:'resolved',resolution:'local',createdAt:i===60?0:i+1,resolvedAt:i===60?0:1790812800+61-i}))
  const raw=prepareHistoryExport({snapshot:{items:rows,filter:'all',hasMore:true},phase:'ready'},new Date('2026-10-01T10:00:00Z')).raw
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'file-order-fixtures-'))
  const files={'history.json':raw}
  fs.writeFileSync(path.join(data,'history.json'),raw)
  for(const name of names){
   const width=name==='order-narrow'?560:1000
   const win=new BrowserWindow({show:true,width,height:900,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
   const scene={name,frames:[],detailsActions:[],identifierSelections:[]};report.scenes.push(scene);let downloads=0
   const onDownload=()=>downloads++;win.webContents.session.on('will-download',onDownload)
   const exec=code=>win.webContents.executeJavaScript(code),cdp=(method,params)=>win.webContents.debugger.sendCommand(method,params)
   const wait=async code=>{for(let i=0;i<80;i++){if(await exec(code))return;await delay(60)}throw Error('Order view not ready: '+code)}
   const fileControl=k=>'[data-history-file-'+k+']'
   const click=sel=>exec(`(()=>{const n=document.querySelector(${JSON.stringify(sel)});n.focus({preventScroll:true});n.click();return true})()`)
   const change=(sel,value)=>exec(`(()=>{const n=document.querySelector(${JSON.stringify(sel)});n.focus({preventScroll:true});if(n.tagName==='INPUT')Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});else n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
   const detailAction=async(action,selector)=>{
    const before=await exec(`({page:document.querySelector('[data-history-file-page]').textContent,order:document.querySelector('[data-history-file-order]').value})`)
    await click(selector);await delay(70)
    const result=await exec(`({open:document.querySelectorAll('[data-history-file-identifiers][open]').length,focusRetained:document.activeElement===document.querySelector(${JSON.stringify(selector)}),pageUnchanged:document.querySelector('[data-history-file-page]').textContent===${JSON.stringify(before.page)},orderUnchanged:document.querySelector('[data-history-file-order]').value===${JSON.stringify(before.order)},reads:window.__fileReads})`)
    scene.detailsActions.push({action,...result})
   }
   const selectIdentifier=async field=>{
    const selector='[data-history-file-identifiers] [data-history-file-select-id="'+field+'"]'
    await exec(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'});true`)
    await click(selector);await delay(70)
    return selector
   }
   const recordIdentifier=async(action,field,before)=>{
    const selector='[data-history-file-identifiers] [data-history-file-select-id="'+field+'"]'
    const f=await exec('('+inspect.toString()+')()')
    const a=await exec(`(()=>{
     const p=document.querySelector('[data-history-file-viewer]'),button=p.querySelector(${JSON.stringify(selector)}),row=button.closest('[data-history-file-identifiers]'),code=row.querySelector('[data-history-file-selectable-id="'+${JSON.stringify(field)}+'"]'),selection=window.getSelection()
     const r=button.getBoundingClientRect(),lr=p.querySelector('.sync-history-file-list').getBoundingClientRect()
     return {text:selection?.toString()||'',rangeCount:selection?.rangeCount||0,kind:code.getAttribute('data-history-file-selectable-id'),recordID:row.querySelectorAll('code')[1].textContent,
      exactNode:!!selection&&code.contains(selection.anchorNode)&&code.contains(selection.focusNode),focusRetained:document.activeElement===button,
      visible:r.width>0&&r.height>0&&r.top>=Math.max(0,lr.top)&&r.bottom<=Math.min(innerHeight,lr.bottom)&&r.left>=Math.max(0,lr.left)&&r.right<=Math.min(innerWidth,lr.right),
      notice:p.querySelector('[data-history-file-selection-notice]')?.textContent||'',reads:window.__fileReads,network:window.__networkRequests,mutations:window.__mutations,
      page:p.querySelector('[data-history-file-page]').textContent,pageUnchanged:p.querySelector('[data-history-file-page]').textContent===${JSON.stringify(before.page)},orderUnchanged:p.querySelector('[data-history-file-order]').value===${JSON.stringify(before.order)}}
    })()`)
    scene.identifierSelections.push({action,...a,contrast:Math.min(...f.colors)});save()
   }
   const choose=async file=>{
    await exec(`document.querySelector('[data-history-file-choose]').focus({preventScroll:true});true`)
    const {root:doc}=await cdp('DOM.getDocument',{depth:0}),{nodeId}=await cdp('DOM.querySelector',{nodeId:doc.nodeId,selector:fileControl('input')})
    await cdp('DOM.setFileInputFiles',{nodeId,files:[path.join(data,file)]})
   }
   const capture=async phase=>{
    await exec(`document.querySelector('[data-history-file-order-panel]').scrollIntoView({block:'center',behavior:'instant'});true`)
    let frame,last='',stable=0
    for(let i=0;i<40;i++){await delay(70);frame=await exec('('+inspect.toString()+')()');const s=JSON.stringify(frame);stable=s===last?stable+1:0;last=s;if(stable>=2)break}
    if(stable<2)throw Error('Unstable file-order DOM')
    const code=names.indexOf(name)*phases.length+phases.indexOf(phase)+1
    await exec(`(()=>{let s=document.getElementById('order-raster');if(!s){s=document.createElement('div');s.id='order-raster';s.setAttribute('aria-hidden','true');document.body.append(s)}s.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';s.replaceChildren();for(let i=0;i<8;i++){const c=document.createElement('span');c.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+(((${code}>>>i)&1)?'rgb(221,238,255)':'rgb(17,34,51)');s.append(c)}return true})()`)
    let bytes,prior='',samples=0
    for(let i=0;i<40;i++){await delay(70);const b=(await win.capturePage()).toPNG(),hash=createHash('sha256').update(b).digest('hex');let valid=false;try{valid=verifyRasterWitness(b,code)}catch{}
     samples=valid?(prior===hash?samples+1:1):0;prior=hash;if(samples>=2){bytes=b;break}}
    if(!bytes||JSON.stringify(await exec('('+inspect.toString()+')()'))!==JSON.stringify(frame))throw Error('File-order raster/DOM mismatch')
    const png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),bytes);scene.frames.push({phase,...frame,downloads,stable,samples,code,png,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
   }
   try{
    win.setMenu(null);win.webContents.debugger.attach('1.3')
    await win.loadFile(path.join(root,'test-results','sync-history-search','fixture.html'),{query:{scene:name==='order-light'?'search-light':'search-dark'}})
    await wait(`!!document.querySelector('[data-history-file-input]')`);await exec('document.fonts.ready.then(()=>true)')
    scene.viewport=await establishNativeViewport(win,width,900);save()
    await exec(`(()=>{window.__liveHistory=document.querySelector('[data-sync-conflict-history]').textContent;window.__fileReads=0;const read=FileReader.prototype.readAsArrayBuffer;FileReader.prototype.readAsArrayBuffer=function(...a){window.__fileReads++;return read.apply(this,a)};document.querySelector('[data-history-file-viewer]').open=true;return true})()`)
    await choose('history.json');await wait(`!!document.querySelector('[data-history-file-jump-input]')`)
    await exec(`window.__fileScope=document.querySelector('[data-history-file-scope]').textContent;true`)
    await capture('file')
    await detailAction('single','[data-history-file-identifiers] > summary')
    await detailAction('expand',fileControl('expand-identifiers'))
    await detailAction('collapse',fileControl('collapse-identifiers'))
    await click(fileControl('last'));await change(fileControl('jump-input'),'99');await click(fileControl('jump'))
    await wait(`!!document.querySelector('[data-history-file-jump-error]')`)
    await change(fileControl('order'),'completed-asc')
    await wait(`document.querySelector('[data-history-file-row] code:last-child') !== null && !document.querySelector('[data-history-file-jump-error]')`)
    await capture('oldest')
    await change(fileControl('order'),'created-asc')
    await detailAction('created-expand',fileControl('expand-identifiers'))
    await exec(`document.querySelector('[data-history-file-order]').focus({preventScroll:true});true`);await capture('created')
    const selectionBefore=await exec(`({page:document.querySelector('[data-history-file-page]').textContent,order:document.querySelector('[data-history-file-order]').value})`)
    await selectIdentifier('object');await recordIdentifier('object','object',selectionBefore)
    await selectIdentifier('record');await recordIdentifier('record','record',selectionBefore)
    await click(fileControl('collapse-identifiers'))
    await wait(`window.getSelection().rangeCount===0&&!document.querySelector('[data-history-file-selection-notice]')`)
    await recordIdentifier('collapse-cleared','record',selectionBefore)
    await click(fileControl('expand-identifiers'));await selectIdentifier('record')
    // Do not focus a text input (which could clear the selection itself): this
    // tests cleanup caused by the actual page change while a record is selected.
    await exec(`document.querySelector('[data-history-file-next]').click();true`)
    await wait(`document.querySelector('[data-history-file-page]').textContent.includes('第 2 / 3 页')`)
    await recordIdentifier('page-cleared','record',selectionBefore)
    await click(fileControl('first'))
    await change(fileControl('jump-input'),'２')
    await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await wait(`document.querySelector('[data-history-file-page]').textContent.includes('第 2 / 3 页')`);await capture('page-two')
    await change(fileControl('query'),'尾页');await detailAction('filtered-expand',fileControl('expand-identifiers'));await capture('filtered')
    await change(fileControl('query'),'missing');await detailAction('empty-expand',fileControl('expand-identifiers'));await detailAction('empty-collapse',fileControl('collapse-identifiers'));await capture('empty')
    await click(fileControl('filter-clear'))
    if(!await exec(`document.querySelector('[data-history-file-order]').value==='created-asc'`))throw Error('Clearing filters discarded display order')
    await change(fileControl('order'),'file')
    await detailAction('restored-expand',fileControl('expand-identifiers'));await detailAction('restored-collapse',fileControl('collapse-identifiers'))
    await exec(`document.querySelector('[data-history-file-order]').focus({preventScroll:true});true`);await capture('restored')
    verifyOrderScene(scene);verifyFileDetailsScene(scene);verifyIdentifierSelectionScene(scene)
   }finally{win.webContents.session.removeListener('will-download',onDownload);win.destroy()}
  }
  for(const [name,raw]of Object.entries(files))if(fs.readFileSync(path.join(data,name),'utf8')!==raw)throw Error('Source file changed')
  report.sourceFilesUnchanged=true;report.complete=true;save();clearTimeout(watchdog);app.exit(0)
 }).catch(e=>{console.error(e);clearTimeout(watchdog);app.exit(1)})
}
