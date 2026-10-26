import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { BLOCK_REFERENCE_VERSION, BLOCK_REFERENCE_SOURCES, blockReferenceBlob, verifyBlockReferencesReport } from './block-references-evidence.mjs'
import { verifyBlockReferencesDesktop, BLOCK_REFERENCE_CHECKS } from './block-references-desktop-driver.mjs'
import { createExportDirectorySession } from './local-export-directory-session.mjs'
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { selectDesktopMainWindow, assertDesktopWindowImage } from './desktop-window-target.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)), hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version
assert.equal(version,BLOCK_REFERENCE_VERSION)
export async function blockReferencesUntil(check,label,budget=15000){const deadline=performance.now()+budget;while(performance.now()<deadline){const value=await check();if(value)return value;await sleep(100)}throw Error(label)}
async function portFree(port=0){const server=createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r)});const p=server.address().port;await new Promise(r=>server.close(r));return p}
async function connect(url,trace){const parsed=new URL(url);assert.equal(parsed.protocol,'ws:');assert.equal(parsed.hostname,'127.0.0.1');const ws=new WebSocket(url),pending=new Map(),listeners=new Set();let id=0
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Debugger connect timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(timer);r()},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);j(Error('Debugger connect error'))},{once:true})})
 const fail=()=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Debugger closed'))}pending.clear()};ws.addEventListener('close',fail)
 ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.method){if(msg.method==='Runtime.exceptionThrown')trace(JSON.stringify(msg));for(const listener of listeners)listener(msg)}const task=pending.get(msg.id);if(task){pending.delete(msg.id);clearTimeout(task.timer);if(msg.error)task.reject(Error(JSON.stringify(msg.error)));else task.resolve(msg.result)}})
 return{close:()=>ws.close(),onEvent(fn){listeners.add(fn);return()=>listeners.delete(fn)},send(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Debugger command timeout: '+method))},15000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}))})}}
}
export async function runBlockReferencesDesktop({executablePath,out=path.join(root,'test-results/block-references'),scope='packaged',productCommit=process.env.GITHUB_SHA,localDev=false,ownedRoot=process.env.RUNNER_TEMP||tmpdir()}={}){
 if(localDev){assert.equal(scope,'development');assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux')}
 else{assert.equal(process.platform,'win32');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.match(productCommit||'',/^[a-f0-9]{40}$/);assert.ok(['packaged','installed'].includes(scope))}
 const scratch=mkdtempSync(path.join(ownedRoot,'block103-')),data=scope==='installed'?path.join(homedir(),'AppData/Roaming/Notepad'):path.join(scratch,'data'),profile=path.join(scratch,'profile');mkdirSync(out,{recursive:true})
 const report={schemaVersion:1,module:'2F.103',version,platform:process.platform,scope,runnerEnvironment:localDev?'local-development':process.env.RUNNER_ENVIRONMENT,sourceFiles:Object.fromEntries(BLOCK_REFERENCE_SOURCES.map(name=>[name,blockReferenceBlob(readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n'))])),productCommit:productCommit||null,verifierCommit:process.env.GITHUB_SHA||null,syntheticData:true,realBackend:true,bridgeOverridden:false,timerAccelerated:false,complete:false,cleanupComplete:false,forceTerminated:false,checks:[],screenshots:[],startedAt:new Date().toISOString(),localValidationOnly:localDev,verificationScope:localDev?'development-business-only':'windows-complete'}
 const save=()=>writeFileSync(path.join(out,'block-references.json'),JSON.stringify(report,null,2)+'\n');save()
 const env={...process.env,NOTEPAD_DATA:data,PORT:'27121'};for(const name of Object.keys(env))if(/TOKEN|SECRET|PASSWORD|CREDENTIAL|ELECTRON_RUN_AS_NODE/.test(name))delete env[name]
 let app,cdp,windowSession,directorySession,backend,vite,trace='',finished
 const traceData=x=>{trace=(trace+String(x)).slice(-200000)}
 const own=(command,args,extra={})=>{const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],...extra});child.stdout.on('data',traceData);child.stderr.on('data',traceData);child.on('error',traceData);return child}
 const until=blockReferencesUntil
 const api=async(route,options={})=>{const r=await fetch('http://127.0.0.1:27121'+route,{...options,headers:{Origin:'null','Content-Type':'application/json'},signal:AbortSignal.timeout(4000)});assert.equal(r.status,200);const body=await r.json();assert.equal(body.code,0,JSON.stringify(body));return body.data}
 const evaluate=async(expression)=>{const v=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(v.exceptionDetails,undefined,JSON.stringify(v.exceptionDetails));return v.result?.value}
 const click=async(request)=>{if(typeof request==='string')request={selector:request};const p=await until(()=>evaluate(`(()=>{const r=${JSON.stringify(request)};const all=[...document.querySelectorAll(r.selector)].filter(n=>!n.disabled&&(r.text===undefined||n.textContent.trim()===r.text||n.getAttribute('aria-label')===r.text)&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);if(all.length!==1)return null;const n=all[0];n.scrollIntoView({block:'center'});const b=n.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);return hit&&n.contains(hit)?{x,y}:null})()`),'Control missing, ambiguous or occluded: '+JSON.stringify(request));for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1})}
 const capture=async(filename)=>{if(!filename.includes('failure'))await until(()=>evaluate("document.querySelectorAll('.app-toast').length===0"),'Transient notification still covers screenshot',12000);await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const bytes=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');writeFileSync(path.join(out,filename),bytes,{flag:'wx'});report.screenshots.push({filename,bytes:bytes.length,sha256:hash(bytes)});save()}
 try{
   await portFree(27121);const port=await portFree()
   if(localDev){backend=own(path.join(root,'server/bin/notepad-block-dev'),[]);await until(async()=>{try{await api('/api/health');return true}catch{return false}},'Local isolated backend not ready');vite=own(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','localhost']);await until(async()=>{try{return(await fetch('http://localhost:5000',{signal:AbortSignal.timeout(500)})).ok}catch{return false}},'Vite not ready');executablePath=path.join(root,'node_modules/electron/dist/electron')}
   const args=[...(localDev?[root,'--no-sandbox']:[]),`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`]
   app=own(executablePath,args,{cwd:path.dirname(executablePath)});finished=new Promise((r,j)=>{app.once('error',j);app.once('exit',(code,signal)=>r({code,signal}))});finished.catch(()=>{})
   const pid=app.pid;assert.ok(pid>0);report.pid=pid;report.executable=executablePath;report.executableSHA256=hash(readFileSync(executablePath));save()
   const page=await until(async()=>{assert.equal(app.exitCode,null);try{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(800)})).json();const list=pages.filter(p=>p.type==='page'&&(localDev?p.url.startsWith('http://localhost:5000'):p.url.startsWith('file:')));return list.length===1&&list[0]}catch(error){if(app.exitCode!==null)throw error;return false}},'Application renderer not ready')
   cdp=await connect(page.webSocketDebuggerUrl,traceData);for(const d of ['Runtime','Page','Network'])await cdp.send(d+'.enable')
   await until(()=>evaluate("Boolean(document.querySelector('.workspace-sidebar'))"),'Application shell not ready')
   const diagnostics=await evaluate('window.electronAPI.appDiagnostics()');assert.equal(diagnostics.version,version);assert.equal(diagnostics.packaged,!localDev);report.app={version:diagnostics.version,packaged:diagnostics.packaged};assert.equal(path.resolve((await api('/api/diagnostics')).data_dir),path.resolve(data))
   if(!localDev){report.asarSHA256=hash(readFileSync(path.join(path.dirname(executablePath),'resources/app.asar')));report.backendSHA256=hash(readFileSync(path.join(path.dirname(executablePath),'resources/bin/notepad-server.exe')));windowSession=createDesktopWindowSession();await windowSession.ready;const window=selectDesktopMainWindow(await windowSession.inspect(pid,executablePath),pid,await evaluate('document.title'));assertDesktopWindowImage(window,executablePath)}
   const resizeSmall=async()=>{
     assert.equal(localDev,false,'Native Windows layout cannot be replaced by development metrics')
     {directorySession=createExportDirectorySession({ownedRoot:scratch});await directorySession.ready;const target=selectDesktopMainWindow(await windowSession.inspect(pid,executablePath),pid,await evaluate('document.title'));assertDesktopWindowImage(target,executablePath);report.minimumWindow=await directorySession.minimumWindow({pid,mainHandle:target.handle,executable:executablePath})}
     save()
   }
   await verifyBlockReferencesDesktop({api,evaluate,click,cdp,until,capture,report,save,resizeSmall})
   assert.deepEqual(report.checks,localDev?BLOCK_REFERENCE_CHECKS.slice(0,16):BLOCK_REFERENCE_CHECKS)
   if(windowSession){const window=selectDesktopMainWindow(await windowSession.inspect(pid,executablePath),pid,await evaluate('document.title'));assertDesktopWindowImage(window,executablePath);await windowSession.close(window)}else await evaluate('window.close()').catch(()=>{})
   let closeTimer;const receipt=await Promise.race([finished,new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('Normal app close deadline')),15000)})]).finally(()=>clearTimeout(closeTimer));assert.deepEqual(receipt,{code:0,signal:null});report.exit={pid,...receipt,normalClose:true};app=null;cdp.close();cdp=null
   if(!localDev)await until(async()=>{try{await fetch('http://127.0.0.1:27121/api/health',{signal:AbortSignal.timeout(500)});return false}catch{return true}},'Owned backend remained alive',5000)
   report.backendStopped=!localDev
   report.complete=true
 }catch(error){report.error={message:error.message};if(cdp)await capture('block103-failure.png').catch(()=>{});throw error}
 finally{
   cdp?.close();if(app&&app.exitCode===null){report.forceTerminated=true;app.kill('SIGTERM');await Promise.race([finished.catch(()=>{}),sleep(3000)]);if(app.exitCode===null)app.kill('SIGKILL')}
   if(directorySession)await directorySession.dispose().then(clean=>{if(!clean)report.cleanupError='Owned resize helper did not close cleanly'},error=>{report.cleanupError=String(error)})
   if(windowSession)await windowSession.dispose().then(clean=>{if(!clean)report.cleanupError='Owned window helper did not close cleanly'},error=>{report.cleanupError=String(error)})
   for(const child of [vite,backend])if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000)]);if(child.exitCode===null){child.kill('SIGKILL');report.forceTerminated=true}}
   writeFileSync(path.join(out,'block-reference-runtime.log'),trace);report.cleanupComplete=!report.forceTerminated&&!report.cleanupError;report.completedAt=new Date().toISOString();save()
   if(report.cleanupComplete)rmSync(scratch,{recursive:true,force:true})
 }
 assert.equal(report.cleanupComplete,true);if(!localDev)verifyBlockReferencesReport(out,{commit:productCommit,verifier:process.env.GITHUB_SHA,scope,sources:report.sourceFiles});return report
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const localDev=process.argv.length===3&&process.argv[2]==='--local-dev';assert.ok(process.argv.length===2||localDev,'No arbitrary paths accepted')
 const unpacked=path.join(root,'release/win-unpacked');const executablePath=localDev?undefined:path.join(unpacked,readdirSync(unpacked).find(x=>x.endsWith('.exe')&&!x.startsWith('Uninstall'))||'missing')
 runBlockReferencesDesktop({executablePath,localDev,scope:localDev?'development':'packaged'}).then(r=>console.log(JSON.stringify({complete:r.complete,checks:r.checks.length,cleanupComplete:r.cleanupComplete}))).catch(e=>{console.error(e);process.exitCode=1})
}
