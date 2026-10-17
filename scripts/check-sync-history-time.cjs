// Reuse the exact production-component fixture built by the preceding history
// search check. Unlike a mocked helper, this records actual Electron downloads.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto')
const {phases,names,verifyTimeScene,verifyTimeReport}=require('./sync-history-time-evidence.cjs')
const {verifyRasterWitness}=require('./sync-clock-raster-evidence.cjs')
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','sync-history-time')
if(!process.versions.electron){
  fs.rmSync(out,{recursive:true,force:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(require('electron'),[__filename],{cwd:root,env,encoding:'utf8',timeout:100000,maxBuffer:4*1024*1024})
  if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr)
  if(r.error||r.status!==0)throw r.error||Error('Native export check failed')
  verifyTimeReport(out,process.env.GITHUB_SHA||'');console.log('Actual downloaded history JSON and native frames verified.')
}else{
  const {app,BrowserWindow,session}=require('electron')
  app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'notepad-history-time-')))
  app.on('window-all-closed',()=>{});const watchdog=setTimeout(()=>app.exit(1),90000)
  const delay=ms=>new Promise(r=>setTimeout(r,ms))
  const report={commit:process.env.GITHUB_SHA||'',platform:process.platform,complete:false,actualBrowserDownload:true,realOverview:true,syntheticRecords:true,scenes:[]}
  const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2))
  function inspect(){
    const p=document.querySelector('[data-sync-conflict-history]'),time=p.querySelector('[data-history-time-filter]')
    const text=key=>p.querySelector('[data-history-'+key+']')?.textContent||''
    const visible=n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}
    const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d',{willReadFrequently:true})
    const paint=s=>{ctx.fillStyle=s;ctx.fillRect(0,0,1,1)},rgb=()=>[...ctx.getImageData(0,0,1,1).data].slice(0,3)
    const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
    const colors=[...time.querySelectorAll('p,label,summary')].map(n=>{
      const chain=[];for(let a=n;a;a=a.parentElement)chain.unshift(a);ctx.clearRect(0,0,1,1);paint('#ffffff')
      for(const a of chain)paint(getComputedStyle(a).backgroundColor);const bg=lum(rgb());paint(getComputedStyle(n).color);const fg=lum(rgb())
      return(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)
    })
    return {open:time.querySelector('details').open,requests:window.__requests,ids:[...p.querySelectorAll('[data-history-row]')].map(n=>n.querySelectorAll('code')[1].textContent),
      outcomes:[...p.querySelectorAll('[data-history-summary-outcome]')].map(n=>Number(n.textContent)),kinds:[...p.querySelectorAll('[data-history-summary-kind]')].map(n=>Number(n.textContent)),
      summaryScope:text('summary-scope'),provenance:text('summary-provenance'),applied:text('time-applied'),pending:!!text('time-pending'),error:text('time-error'),hasMore:!!p.querySelector('[data-history-more]'),
      controlsVisible:visible(time)&&[...time.querySelectorAll('input,select,button')].every(visible),focusInside:p.contains(document.activeElement),colors,
      mutations:window.__mutations,networkRequests:window.__networkRequests,navigationCalls:window.__navigationCalls,
      guidanceUnchanged:document.querySelector('[data-sync-guidance]').textContent===window.__guidance,
      privateText:time.textContent.includes('PRIVATE_'),overflow:document.documentElement.scrollWidth-innerWidth,width:innerWidth,height:innerHeight}
  }
  app.whenReady().then(async()=>{
    fs.mkdirSync(out,{recursive:true});save()
    const file=path.join(root,'test-results','sync-history-search','fixture.html')
    if(!fs.existsSync(file))throw Error('Run the production history search check first')
    for(const name of names){
      const scene={name,frames:[],downloads:[]};report.scenes.push(scene)
      const isolated=session.fromPartition('history-time-'+name)
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
      const win=new BrowserWindow({show:true,width:name==='date-narrow'?560:1000,height:900,useContentSize:true,
        webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      const exec=code=>win.webContents.executeJavaScript(code)
      const wait=async code=>{for(let i=0;i<80;i++){if(await exec(code))return;await delay(50)}throw Error('Export wait failed: '+code)}
      const click=key=>exec(`(()=>{const n=document.querySelector('[data-history-${key}]');n.focus({preventScroll:true});n.click();return true})()`)
      const type=(key,text)=>exec(`(()=>{const n=document.querySelector('[data-history-${key}]');n.focus({preventScroll:true});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(text)});n.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
      const choose=(key,value)=>exec(`(()=>{const n=document.querySelector('[data-history-${key}]');n.focus({preventScroll:true});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
      const download=async()=>{
        let timer
        const done=new Promise((resolve,reject)=>{waiting={resolve,reject};timer=setTimeout(()=>{waiting=null;reject(Error('Download event timeout'))},8000)})
        try{await click('export-button');await done}finally{clearTimeout(timer)}
      }
      const capture=async phase=>{
        await exec(`document.querySelector('[data-history-time-filter]').scrollIntoView({block:'start',behavior:'instant'})`)
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
        scene.frames.push({phase,...frame,downloads:scene.downloads.length,stable,rasterSamples:matches,rasterCode:code,filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});save()
      }
      try{
        win.setMenu(null);await win.loadFile(file,{query:{scene:name==='date-light'?'search-light':'search-dark'}})
        await wait('!!document.querySelector("[data-history-export-button]")');await exec('document.fonts.ready.then(()=>true)')
        await exec(`(()=>{window.__guidance=document.querySelector('[data-sync-guidance]').textContent;document.querySelector('[data-sync-conflict-history]').open=true;return true})()`)
        await exec(`(()=>{
          const at=s=>Date.parse(s+'Z')/1000;
          const row=(id,stamp,kind,resolution,status='resolved')=>({id,item_id:'note-'+id,current_title:'星图'+id,kind,resolution,status,created_at:1,resolved_at:stamp,content:'PRIVATE_BODY'});
          const rows=[row('a',at('2026-10-02T00:00:00'),'file','remote'),row('b',at('2026-10-01T23:59:59'),'tag','local'),row('c',at('2026-10-01T00:00:00'),'attachment','remote','superseded'),row('d',at('2026-09-30T23:59:59'),'file','local'),row('e',at('2026-09-30T00:00:00'),'file-tag','unknown'),row('f',at('2026-09-29T23:59:59'),'file','remote'),row('g',0,'tag','unknown')];
          window.__historyLoad=(url,init)=>{window.__requests.push({path:url,method:init.method});const n=window.__requests.length;
            if(n<=2)return Promise.resolve({version:1,scope:'local-workspace',filter:'all',items:n===1?rows.slice(0,6):rows.slice(6),has_more:n===1,next_cursor:n===1?'date-next':''});
            return Promise.reject(Error('PRIVATE_SERVICE'));
          };return true})()`)
        await click('read');await wait('document.querySelectorAll("[data-history-row]").length===6')
        await exec(`document.querySelector('[data-history-time-controls]').open=true;true`);await capture('loaded')
        await choose('time-mode','range');await type('time-from','2026-10-01');await type('time-to','2026-10-01');await capture('draft')
        await click('time-apply');await wait('document.querySelectorAll("[data-history-row]").length===2');await download();await capture('applied')
        await type('time-from','2026-10-02');await click('time-apply');await wait('!!document.querySelector("[data-history-time-error]")');await capture('invalid')
        await type('time-from','2026-10-01');await click('time-apply');await click('more');await wait('!document.querySelector("[data-history-more]")');await capture('appended')
        await choose('time-mode','missing');await click('time-apply');await wait('document.querySelectorAll("[data-history-row]").length===1');await download();await capture('missing')
        await click('read');await wait('document.querySelector(".sync-conflict-history-feedback").textContent.includes("未能读取")');await capture('stale')
        await click('clear');await wait('document.querySelectorAll("[data-history-row]").length===7');await capture('cleared')
        await choose('time-mode','range');await type('time-from','2026-10-01');await click('time-apply');await wait('document.querySelectorAll("[data-history-row]").length===3');await download();await capture('open-ended')
        verifyTimeScene(scene)
      }finally{win.destroy()}
    }
    report.complete=true;save();clearTimeout(watchdog);app.exit(0)
  }).catch(e=>{console.error(e);clearTimeout(watchdog);app.exit(1)})
}
