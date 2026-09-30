// Production Overview + actual file input/FileReader. Fixtures are synthetic;
// no live history, database or user file is changed by these UI operations.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url')
const {names,phases,verifyFileSelectionScene,verifyFileSelectionReport}=require('./sync-history-file-selection-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-history-file-selection')
if(!process.versions.electron){
  fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const run=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024})
  if(run.stdout)process.stdout.write(run.stdout);if(run.stderr)process.stderr.write(run.stderr)
  if(run.error||run.status!==0)throw run.error||Error('Offline file selection native check failed')
  verifyFileSelectionReport(out,process.env.GITHUB_SHA||'');console.log('Native file filtering, scope and IME evidence verified.')
}else{
  const {app,BrowserWindow}=require('electron'),delay=ms=>new Promise(r=>setTimeout(r,ms))
  app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'history-file-search-')));app.on('window-all-closed',()=>{})
  const watchdog=setTimeout(()=>app.exit(1),110000)
  const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,actualFileReader:true,syntheticRecords:true,compositionDriver:'CDP native composition',scenes:[]}
  const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2))
  function inspect(){
    const p=document.querySelector('[data-history-file-viewer]'),key=n=>p.querySelector('[data-history-file-'+n+']'),text=n=>key(n)?.textContent||''
    const target=window.__phase==='stale'||window.__phase==='replaced'?p.querySelector('.sync-history-file-controls'):key('search')
    const r=target.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=canvas.height=1
    const ctx=canvas.getContext('2d',{willReadFrequently:true}),paint=c=>{ctx.fillStyle=c;ctx.fillRect(0,0,1,1)},rgb=()=>[...ctx.getImageData(0,0,1,1).data].slice(0,3)
    const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
    const colors=[...p.querySelectorAll('[data-history-file-search] label,[data-history-file-search]>p,[data-history-file-matches]')].map(n=>{
      const ancestors=[];for(let a=n;a;a=a.parentElement)ancestors.unshift(a)
      ctx.clearRect(0,0,1,1);paint('#fff');for(const a of ancestors)paint(getComputedStyle(a).backgroundColor)
      const bg=rgb();paint(getComputedStyle(n).color);const a=lum(bg),b=lum(rgb());return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
    })
    return{ids:[...p.querySelectorAll('[data-history-file-row]')].map(n=>n.querySelectorAll('code')[1].textContent),query:key('query').value,kind:key('kind').value,outcome:key('outcome').value,
      filename:text('name'),scope:text('scope'),matches:text('matches'),page:text('page'),stale:!!key('stale'),composing:!!key('composing'),fileReads:window.__fileReads,
      requests:window.__requests.length,networkRequests:window.__networkRequests,mutations:window.__mutations,navigationCalls:window.__navigationCalls,
      liveHistoryUnchanged:document.querySelector('[data-sync-conflict-history]').textContent===window.__liveHistory,guidanceUnchanged:document.querySelector('[data-sync-guidance]').textContent===window.__guidance,
      activeMarkup:p.querySelectorAll('script,img,iframe,a').length,targetRect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},targetVisible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,
      focusInside:p.contains(document.activeElement),focusQuery:document.activeElement===key('query'),overflow:document.documentElement.scrollWidth-innerWidth,
      colors,prevDisabled:key('prev').getAttribute('aria-disabled')==='true',nextDisabled:key('next').getAttribute('aria-disabled')==='true',imeEvents:window.__imeEvents,scriptedCompositionEvents:window.__scriptedCompositionEvents,width:innerWidth,height:innerHeight}
  }
  app.whenReady().then(async()=>{
    fs.mkdirSync(out,{recursive:true});save()
    const {prepareHistoryExport}=await import(pathToFileURL(path.join(root,'src/services/syncHistoryExport.mjs')).href)
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'history-file-search-data-'))
    const rows=Array.from({length:61},(_,i)=>({id:'r'+i,itemID:'object-'+i,title:i===60?'尾页 星图 ＡＢＣ Café 🌱':'笔记 '+i,kind:i%2?'tag':'file',status:i===60?'superseded':'resolved',resolution:i===60?'remote-rebind':i%3?'remote':'local',createdAt:1,resolvedAt:1790726400}))
    const make=items=>prepareHistoryExport({snapshot:{items,filter:'all',hasMore:true},phase:'ready'},new Date('2026-09-30T12:00:00Z')).raw
    const files={'history.json':make(rows),'invalid.json':'{"PRIVATE_ERROR":','replacement.json':make([{...rows[0],id:'fresh',title:'新文件'}])}
    for(const [name,content] of Object.entries(files))fs.writeFileSync(path.join(directory,name),content)
    const fixture=path.join(root,'test-results','sync-history-search','fixture.html');if(!fs.existsSync(fixture))throw Error('Build the production search fixture first')
    for(const name of names){
      const win=new BrowserWindow({show:true,width:name==='file-search-narrow'?560:1000,height:900,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      const scene={name,frames:[]};report.scenes.push(scene);let downloads=0;const cdpCommands=[]
      const downloadListener=()=>downloads++;win.webContents.session.on('will-download',downloadListener)
      const exec=code=>win.webContents.executeJavaScript(code),cdp=(method,params)=>win.webContents.debugger.sendCommand(method,params)
      const compose=async(method,params)=>{
        const entry={method,params,completed:false};cdpCommands.push(entry)
        await cdp(method,params);entry.completed=true
      }
      const wait=async code=>{for(let i=0;i<80;i++){if(await exec(code))return;await delay(60)}throw Error('File selection wait failed: '+code)}
      const click=key=>exec(`(()=>{const n=document.querySelector('[data-history-file-${key}]');n.focus({preventScroll:true});n.click();return true})()`)
      const type=value=>exec(`(()=>{const n=document.querySelector('[data-history-file-query]');n.focus({preventScroll:true});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
      const choose=(key,value)=>exec(`(()=>{const n=document.querySelector('[data-history-file-${key}]');n.focus({preventScroll:true});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
      const selectFile=async file=>{
        await exec("document.querySelector('[data-history-file-choose]').focus({preventScroll:true});true")
        const {root:doc}=await cdp('DOM.getDocument',{depth:0}),{nodeId}=await cdp('DOM.querySelector',{nodeId:doc.nodeId,selector:'[data-history-file-input]'})
        await cdp('DOM.setFileInputFiles',{nodeId,files:[path.join(directory,file)]})
      }
      const capture=async phase=>{
        const top=phase==='stale'||phase==='replaced'
        await exec(`window.__phase=${JSON.stringify(phase)};document.querySelector(${JSON.stringify(top?'[data-history-file-viewer]':'[data-history-file-search]')}).scrollIntoView({block:'start',behavior:'instant'});true`)
        let frame,last='',stable=0
        for(let i=0;i<50;i++){await delay(65);frame=await exec('('+inspect.toString()+')()');const s=JSON.stringify(frame);stable=s===last?stable+1:0;last=s;if(stable>=2)break}
        if(stable<2)throw Error('Unstable file-search frame')
        const code=names.indexOf(name)*phases.length+phases.indexOf(phase)+1
        await exec(`(()=>{let s=document.getElementById('file-search-raster');if(!s){s=document.createElement('div');s.id='file-search-raster';s.setAttribute('aria-hidden','true');document.body.append(s)}s.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';s.replaceChildren();for(let i=0;i<8;i++){const c=document.createElement('span');c.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+(((${code}>>>i)&1)?'rgb(221,238,255)':'rgb(17,34,51)');s.append(c)}return true})()`)
        let bytes,prior='',rasterSamples=0
        for(let i=0;i<40;i++){await delay(65);const b=(await win.capturePage()).toPNG(),hash=createHash('sha256').update(b).digest('hex');let valid=false;try{valid=verifyRasterWitness(b,code)}catch{}
          rasterSamples=valid?(prior===hash?rasterSamples+1:1):0;prior=hash;if(rasterSamples>=2){bytes=b;break}}
        if(!bytes||JSON.stringify(await exec('('+inspect.toString()+')()'))!==JSON.stringify(frame))throw Error('File-search capture does not match DOM')
        const png=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,png),bytes);scene.frames.push({phase,...frame,cdpCommands:JSON.parse(JSON.stringify(cdpCommands)),downloads,stable,rasterSamples,rasterCode:code,png,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
      }
      try{
        win.setMenu(null);win.webContents.debugger.attach('1.3');await win.loadFile(fixture,{query:{scene:name==='file-search-light'?'search-light':'search-dark'}})
        await wait('!!document.querySelector("[data-history-file-input]")');await exec('document.fonts.ready.then(()=>true)')
        await exec(`(()=>{window.__guidance=document.querySelector('[data-sync-guidance]').textContent;window.__liveHistory=document.querySelector('[data-sync-conflict-history]').textContent;window.__fileReads=0;const read=FileReader.prototype.readAsArrayBuffer;FileReader.prototype.readAsArrayBuffer=function(...args){window.__fileReads++;return read.apply(this,args)};const s=document.querySelector('[data-history-file-viewer]>summary');s.focus();s.click();return true})()`)
        await selectFile('history.json');await wait('!!document.querySelector("[data-history-file-query]")')
        await exec(`(()=>{window.__imeEvents=[];window.__scriptedCompositionEvents=0;const dispatch=EventTarget.prototype.dispatchEvent;EventTarget.prototype.dispatchEvent=function(e){if(/^composition(?:start|update|end)$/.test(e.type))window.__scriptedCompositionEvents++;return dispatch.call(this,e)};const n=document.querySelector('[data-history-file-query]');for(const type of ['compositionstart','compositionupdate','compositionend'])n.addEventListener(type,e=>window.__imeEvents.push({type:e.type,data:e.data,trusted:e.isTrusted}));return true})()`)
        await capture('loaded');await type('abc');await capture('last-page-match')
        await type('');await choose('kind','tag');await choose('outcome','local');await capture('combined')
        await choose('kind','all');await choose('outcome','all');await type('笔记');await click('next')
        await exec("document.querySelector('[data-history-file-query]').focus({preventScroll:true});document.querySelector('[data-history-file-query]').setSelectionRange(0,2);true")
        await compose('Input.imeSetComposition',{text:'xingtu',selectionStart:6,selectionEnd:6,replacementStart:0,replacementEnd:2});await wait("document.querySelector('[data-history-file-query]').value==='xingtu'");await capture('candidate')
        await compose('Input.insertText',{text:'星图'});await wait("document.querySelector('[data-history-file-query]').value==='星图'");await capture('committed')
        await type('missing');await capture('empty');await type('abc');await selectFile('invalid.json');await wait('!!document.querySelector("[data-history-file-stale]")');await capture('stale')
        await click('filter-clear');await capture('cleared');await type('abc');await selectFile('replacement.json');await wait("document.querySelector('[data-history-file-name]').textContent==='replacement.json'");await capture('replaced')
        verifyFileSelectionScene(scene)
      }finally{win.webContents.session.removeListener('will-download',downloadListener);win.destroy()}
    }
    for(const [name,content] of Object.entries(files))if(fs.readFileSync(path.join(directory,name),'utf8')!==content)throw Error('Fixture file was changed')
    report.complete=true;save();clearTimeout(watchdog);app.exit(0)
  }).catch(e=>{console.error(e);clearTimeout(watchdog);app.exit(1)})
}
