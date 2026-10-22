// Reuse the exact production-component fixture built by the preceding history
// search check. Unlike a mocked helper, this records actual Electron downloads.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto')
const {phases,names,verifyExportScene,verifyExportReport}=require('./sync-history-export-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-history-export')
if(!process.versions.electron){
  fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:100000,maxBuffer:4*1024*1024})
  if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr)
  if(r.error||r.status!==0)throw r.error||Error('Native export check failed')
  verifyExportReport(out,process.env.GITHUB_SHA||'');console.log('Actual downloaded history JSON and native frames verified.')
}else{
  const {app,BrowserWindow,session}=require('electron')
  app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'notepad-history-export-')))
  app.on('window-all-closed',()=>{});const watchdog=setTimeout(()=>app.exit(1),90000)
  const delay=ms=>new Promise(r=>setTimeout(r,ms))
  const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,actualBrowserDownload:true,syntheticRecords:true,scenes:[]}
  const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2))
  function inspect(){
    const p=document.querySelector('[data-sync-conflict-history]'),button=p.querySelector('[data-history-export-button]')
    const box=p.querySelector('[data-history-export]').getBoundingClientRect()
    return{requests:window.__requests.length,query:p.querySelector('[data-history-query]').value,
      ids:[...p.querySelectorAll('[data-history-row]')].map(n=>n.querySelectorAll('code')[1].textContent),
      disabled:button.getAttribute('aria-disabled')==='true',feedback:p.querySelector('[data-history-export-feedback]').textContent,
      mutations:window.__mutations,networkRequests:window.__networkRequests,navigationCalls:window.__navigationCalls,
      controlsVisible:box.top>=0&&box.bottom<=innerHeight&&box.left>=0&&box.right<=innerWidth,
      guidanceUnchanged:document.querySelector('[data-sync-guidance]').textContent===window.__guidance,
      overflow:document.documentElement.scrollWidth-innerWidth,rawErrorVisible:p.textContent.includes('PRIVATE_DISK'),domDownloadLinks:document.querySelectorAll('a[download]').length,
      width:innerWidth,height:innerHeight}
  }
  app.whenReady().then(async()=>{
    fs.mkdirSync(out,{recursive:true});save()
    const file=path.join(root,'test-results','sync-history-search','fixture.html')
    if(!fs.existsSync(file))throw Error('Run the production history search check first')
    for(const name of names){
      const scene={name,frames:[],downloads:[]};report.scenes.push(scene)
      const isolated=session.fromPartition('history-export-'+name)
      isolated.setPermissionRequestHandler((_wc,_permission,answer)=>answer(false))
      let waiting=null,downloadCount=0
      isolated.on('will-download',(_event,item)=>{
        const number=downloadCount++,filename=name+'-'+number+'.json'
        const requestedFilename=item.getFilename();item.setSavePath(path.join(out,filename))
        item.once('done',(_e,state)=>{
          try{
            if(state!=='completed')throw Error('Download did not complete: '+state)
            const bytes=fs.readFileSync(path.join(out,filename))
            scene.downloads.push({filename,requestedFilename,state,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),json:JSON.parse(bytes)})
            waiting?.resolve();waiting=null
          }catch(e){waiting?.reject(e);waiting=null}
        })
      })
      const win=new BrowserWindow({show:true,width:name==='export-narrow'?560:1000,height:900,useContentSize:true,
        webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      const exec=code=>win.webContents.executeJavaScript(code)
      const wait=async code=>{for(let i=0;i<80;i++){if(await exec(code))return;await delay(50)}throw Error('Export wait failed: '+code)}
      const click=key=>exec(`(()=>{const n=document.querySelector('[data-history-${key}]');n.focus({preventScroll:true});n.click();return true})()`)
      const type=text=>exec(`(()=>{const n=document.querySelector('[data-history-query]');n.focus({preventScroll:true});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(text)});n.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
      const download=async()=>{
        let timer
        const done=new Promise((resolve,reject)=>{waiting={resolve,reject};timer=setTimeout(()=>{waiting=null;reject(Error('Download event timeout'))},8000)})
        try{await click('export-button');await done}finally{clearTimeout(timer)}
      }
      const capture=async phase=>{
        await exec(`document.querySelector('[data-history-export]').scrollIntoView({block:'center',behavior:'instant'})`)
        let frame,last='',stable=0
        for(let i=0;i<40;i++){await delay(70);frame=await exec('('+inspect.toString()+')()');const s=JSON.stringify(frame);stable=s===last?stable+1:0;last=s;if(stable>=2)break}
        if(stable<2)throw Error('Export scene did not settle')
        const code=names.indexOf(name)*phases.length+phases.indexOf(phase)+1
        await exec(`(()=>{let s=document.getElementById('export-raster');if(!s){s=document.createElement('div');s.id='export-raster';s.setAttribute('aria-hidden','true');document.body.append(s)}s.style.cssText='position:fixed;left:0;top:0;width:32px;height:4px;display:flex;z-index:2147483647;pointer-events:none;contain:strict';s.replaceChildren();for(let i=0;i<8;i++){const c=document.createElement('span');c.style.cssText='display:block;flex:none;width:4px;height:4px;background:'+(((${code}>>>i)&1)?'rgb(221,238,255)':'rgb(17,34,51)');s.append(c)}return true})()`)
        let bytes,prior='',matches=0
        for(let i=0;i<40;i++){await delay(70);const b=(await win.capturePage()).toPNG(),hash=createHash('sha256').update(b).digest('hex')
          let valid=false;try{valid=verifyRasterWitness(b,code)}catch{}
          matches=valid?(prior===hash?matches+1:1):0;prior=hash;if(matches>=2){bytes=b;break}}
        if(!bytes||JSON.stringify(await exec('('+inspect.toString()+')()'))!==JSON.stringify(frame))throw Error('Export screenshot mismatch')
        const filename=name+'-'+phase+'.png';fs.writeFileSync(path.join(out,filename),bytes)
        scene.frames.push({phase,...frame,downloads:scene.downloads.length,stable,rasterCode:code,filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
      }
      try{
        win.setMenu(null);await win.loadFile(file,{query:{scene:name==='export-light'?'search-light':'search-dark'}})
        await wait('!!document.querySelector("[data-history-export-button]")');await exec('document.fonts.ready.then(()=>true)')
        await exec(`(()=>{window.__guidance=document.querySelector('[data-sync-guidance]').textContent;document.querySelector('[data-sync-conflict-history]').open=true;return true})()`)
        await click('export-button');await capture('unread')
        await type('abc');await click('read');await wait('document.querySelectorAll("[data-history-row]").length===1')
        await download();await capture('filtered')
        // Return to exactly the original condition without a new export action.
        await type('temporary-no-match');await type('abc');await capture('query-restored')
        await type('PRIVATE_QUERY');await click('export-button');await capture('empty')
        await type('abc');await click('more');await wait('!document.querySelector("[data-history-more]")')
        await click('read');await wait('document.querySelector(".sync-conflict-history-feedback").textContent.includes("未能读取")')
        await download();await capture('stale')
        await exec(`(()=>{window.__originalURL=URL.createObjectURL;URL.createObjectURL=()=>{throw Error('PRIVATE_DISK')};return true})()`)
        await click('export-button');await capture('failed')
        await type('temporary-no-match');await type('abc');await capture('failure-restored')
        await exec('URL.createObjectURL=window.__originalURL;true');await download();await capture('retry')
        verifyExportScene(scene)
      }finally{win.destroy()}
    }
    report.complete=true;save();clearTimeout(watchdog);app.exit(0)
  }).catch(e=>{console.error(e);clearTimeout(watchdog);app.exit(1)})
}
