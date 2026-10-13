// Executes real hash-pinned NSIS installers ONLY on a disposable hosted runner.
// No production runtime, database engine, installer or renderer is replaced.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, lstatSync, copyFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { RELEASES, PRODUCT_COMMIT, assertHostedWindows, requireOwnedPath, nsisArgs, verifyInstaller, validateLifecycleReport } from './installer-lifecycle-core.mjs'
import { desktopNote } from './desktop-save-fixture.mjs'
import { createDesktopWindowSession } from './desktop-window-session.mjs'
import { selectDesktopMainWindow } from './desktop-window-target.mjs'
import { verifyTrashWorkspaceDesktop } from './check-trash-workspace-desktop.mjs'

assertHostedWindows(process.env, process.platform)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'test-results', 'installer-lifecycle')
mkdirSync(out, { recursive: true })
const report = { complete:false, productCommit:PRODUCT_COMMIT, verifierCommit:process.env.GITHUB_SHA,
  platform:process.platform, runnerEnvironment:process.env.RUNNER_ENVIRONMENT, syntheticData:true,
  usedDefaultDataPath:true, forceTerminated:false, cleanupComplete:false, checks:[], commands:[],
  appExits:[], dataComparisons:[], snapshots:[], screenshots:[], startedAt:new Date().toISOString() }
const save = () => writeFileSync(path.join(out, 'installation.json'), JSON.stringify(report,null,2)+'\n')
const sha = b => createHash('sha256').update(b).digest('hex')
const mark = name => { report.checks.push(name); save(); console.log('PASS '+name) }
const scratch = mkdtempSync(path.join(process.env.RUNNER_TEMP, 'notepad-install-'))
const installDir = requireOwnedPath(scratch, path.join(scratch, '中文 安装目录'))
const dataDir = path.join(homedir(), 'AppData', 'Roaming', 'Notepad')
const appExe = path.join(installDir, '记事本.exe')
const cleanEnv = {...process.env}
for (const k of Object.keys(cleanEnv)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k)) delete cleanEnv[k]
for (const k of ['ELECTRON_RUN_AS_NODE','NOTEPAD_DATA','PORT']) delete cleanEnv[k]
let appChild, appExited, cdp, windowSession, sequence=0, trace=''
const apiBase='http://127.0.0.1:27121'
function captureTrace(b) { trace=(trace+String(b)).slice(-180000) }
async function until(check,label,budget=18000) {
  const end=performance.now()+budget;let last
  while(performance.now()<end) { try {const r=await check();if(r)return r}catch(e){last=e} await sleep(100) }
  throw Error(label+(last?': '+last.message:''))
}
async function freePort(port=0) {
  const s=createServer();await new Promise((res,rej)=>{s.once('error',rej);s.listen(port,'127.0.0.1',res)})
  const p=s.address().port;await new Promise(res=>s.close(res));return p
}
async function command(file,args,options={}) {
  const started=performance.now(), child=spawn(file,args,{cwd:scratch,env:{...cleanEnv,...options.env},stdio:['ignore','pipe','pipe'],windowsVerbatimArguments:options.verbatim||false})
  let output='',errors='';child.stdout.on('data',b=>output=(output+b).slice(-100000));child.stderr.on('data',b=>errors=(errors+b).slice(-100000))
  child.stdout.on('error',()=>{});child.stderr.on('error',()=>{})
  let timer, timedOut=false
  const done=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}))})
  try {
    const result=await Promise.race([done,new Promise((_,no)=>{timer=setTimeout(()=>{timedOut=true;no(Error('Owned command deadline exceeded'))},options.timeout||90000)})])
    if(options.record) { report.commands.push({label:options.record,pid:child.pid,...result,timedOut,elapsedMs:Math.round(performance.now()-started)});save() }
    assert.equal(result.signal,null);assert.equal(result.code,0,options.record||'Command failed: '+errors)
    return output.trim()
  } finally {
    clearTimeout(timer)
    if(timedOut && child.exitCode===null && Number.isInteger(child.pid)) {
      report.forceTerminated=true;save()
      spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{timeout:10000,stdio:'ignore'})
    }
  }
}
async function ps(script, env={}) {
  return command('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();"+script],{env,timeout:20000})
}
async function registrations() {
  const raw=await ps(`$all=@();foreach($scope in @('HKCU','HKLM')){foreach($tail in @('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')){Get-ItemProperty ($scope+':\\'+$tail+'\\*') -ErrorAction SilentlyContinue | Where-Object {($_.DisplayName -eq '记事本' -or $_.DisplayName -like '记事本 *')} | ForEach-Object {$all+=@{scope=$scope;key=$_.PSChildName;version=$_.DisplayVersion;location=$_.InstallLocation;uninstall=$_.UninstallString}}}};ConvertTo-Json -InputObject @($all) -Compress`)
  return JSON.parse(raw)
}
async function shellLinks() {
  const raw=await ps(`$w=New-Object -ComObject WScript.Shell;$links=@();foreach($folder in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))){$p=Join-Path $folder '记事本.lnk';if(Test-Path -LiteralPath $p){$s=$w.CreateShortcut($p);$links+=@{path=$p;target=$s.TargetPath}}};ConvertTo-Json -InputObject @($links) -Compress`)
  return JSON.parse(raw)
}
async function checkInstalled(version) {
  for(const file of [appExe,path.join(installDir,'resources','app.asar'),path.join(installDir,'resources','bin','notepad-server.exe')])assert.ok(existsSync(file),'Missing installed payload')
  const pe=JSON.parse(await ps(`$v=(Get-Item -LiteralPath $env:NP_TEST_EXE).VersionInfo;@{file=$v.FileVersion;product=$v.ProductVersion}|ConvertTo-Json -Compress`,{NP_TEST_EXE:appExe}))
  for(const value of [pe.product,pe.file]) { assert.match(value,/^\d+\.\d+\.\d+(?:\.0)?$/);assert.equal(value.split('.').slice(0,3).join('.'),version) }
  const reg=await registrations();assert.equal(reg.length,1);assert.equal(reg[0].scope,'HKCU');assert.equal(reg[0].version,version)
  assert.equal(reg[0].uninstall.toLowerCase(), ('\"'+path.join(installDir,'Uninstall 记事本.exe')+'\" /currentuser').toLowerCase())
  const links=await shellLinks();assert.ok(links.length>=1,'No installed shortcut')
  for(const link of links)assert.equal(path.resolve(link.target).toLowerCase(),appExe.toLowerCase())
  report.snapshots.push({phase:'installed-'+version,pe,registration:reg,links,asarSHA256:sha(readFileSync(path.join(installDir,'resources','app.asar')))});save()
}
async function install(which,label) {
  assert.ok(!appChild,'Must close application before installer operation')
  await command(path.join(root,'.installer-input',which,`Notepad-${RELEASES[which].version}-Setup.exe`),nsisArgs(scratch,installDir),{verbatim:true,record:label})
  await checkInstalled(RELEASES[which].version)
}
async function uninstall(label) {
  assert.ok(!appChild,'Must close application before uninstall')
  const original=path.join(installDir,'Uninstall 记事本.exe');assert.ok(existsSync(original),'Uninstaller missing')
  const owned=path.join(scratch,`owned-uninstaller-${++sequence}.exe`)
  copyFileSync(original,owned);assert.equal(sha(readFileSync(owned)),sha(readFileSync(original)))
  // Run an exact copy outside INSTDIR with _?= to wait for the actual uninstaller,
  // not the temporary bootstrap parent. No --delete-app-data option is used.
  await command(owned,nsisArgs(scratch,installDir,true),{verbatim:true,record:label})
  assert.equal(existsSync(appExe),false);assert.equal(existsSync(path.join(installDir,'resources','app.asar')),false)
  assert.deepEqual(await registrations(),[]);assert.deepEqual(await shellLinks(),[])
}
function snapshotData() {
  assert.ok(existsSync(path.join(dataDir,'data.db')),'Real database missing')
  const files=[]
  const walk=(folder,relative='')=>{for(const name of readdirSync(folder).sort()){const abs=path.join(folder,name),stat=lstatSync(abs);assert.equal(stat.isSymbolicLink(),false);const key=(relative?relative+'/':'')+name;if(stat.isDirectory())walk(abs,key);else{assert.equal(stat.isFile(),true);files.push({path:key,bytes:stat.size,sha256:sha(readFileSync(abs))})}}}
  walk(dataDir);return files
}
function unchanged(before,label) {
  const after=snapshotData();assert.deepEqual(after,before,'Data changed during '+label)
  report.dataComparisons.push({label,equal:true,files:after.length,digest:sha(JSON.stringify(after))});save()
}
async function connect(url) {
  const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.protocol,'ws:')
  const ws=new WebSocket(url),pending=new Map();let next=0
  await new Promise((yes,no)=>{const t=setTimeout(()=>no(Error('Debugger connect timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(t);yes()},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);no(Error('Debugger failed'))},{once:true})})
  const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Debugger disconnected'))}pending.clear()}
  ws.addEventListener('close',fail);ws.addEventListener('error',fail)
  ws.addEventListener('message',e=>{let m;try{m=JSON.parse(String(e.data))}catch{fail();return}const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)})
  return {close:()=>ws.close(),send(method,params={}){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Debugger command timed out'))},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}}
}
async function evaluate(expression) {const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result?.value}
async function api(route,init={}) {
  const r=await fetch(apiBase+route,{...init,headers:{Origin:'null','Content-Type':'application/json'},signal:AbortSignal.timeout(4000)})
  assert.equal(r.status,200);const b=await r.json();assert.equal(b.code,0,JSON.stringify(b));return b.data
}
async function click(selector) {
  const p=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert.ok(p,'Missing real UI control '+selector)
  for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1})
}
async function launch(version) {
  await freePort(27121);const port=await freePort(),profile=path.join(scratch,'profile-'+(++sequence))
  appChild=spawn(appExe,[`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{cwd:installDir,env:cleanEnv,stdio:['ignore','pipe','pipe']})
  appChild.stdout.on('data',captureTrace);appChild.stderr.on('data',captureTrace)
  appChild.stdout.on('error',captureTrace);appChild.stderr.on('error',captureTrace)
  appExited=new Promise((yes,no)=>{appChild.once('exit',(code,signal)=>yes({code,signal}));appChild.once('error',no)});void appExited.catch(()=>{})
  const page=await until(async()=>{const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)});return(await r.json()).find(p=>p.type==='page'&&p.url.startsWith('file:')&&p.url.includes('index.html'))},'Installed renderer did not load')
  cdp=await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable');await cdp.send('Page.enable');await cdp.send('Network.enable')
  await until(()=>evaluate("!!document.querySelector('.workspace-sidebar')"),'Installed App did not initialize')
  const diag=await api('/api/diagnostics');assert.equal(path.resolve(diag.data_dir).toLowerCase(),dataDir.toLowerCase())
  const app=await evaluate('window.electronAPI.appDiagnostics()');assert.equal(app.version,version);assert.equal(app.packaged,true)
  return app
}
async function closeApp() {
  const native=await windowSession.inspect(appChild.pid),title=await evaluate('document.title'),pid=appChild.pid
  await windowSession.close(selectDesktopMainWindow(native,pid,title))
  let timer
  try{const result=await Promise.race([appExited,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('Native close did not finish')),15000)})]);assert.equal(result.code,0);assert.equal(result.signal,null);report.appExits.push({...result,pid,nativeClose:true})}finally{clearTimeout(timer)}
  cdp.close();cdp=null;appChild=null
  await until(async()=>{try{await freePort(27121);return true}catch{return false}},'Installed backend did not stop',5000);save()
}
async function capture(name) {const bytes=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64');writeFileSync(path.join(out,name),bytes);report.screenshots.push({filename:name,bytes:bytes.length,sha256:sha(bytes)});save()}
async function openNote(id,marker) {await until(()=>evaluate(`!!document.querySelector('[data-file-id="${id}"]')`),'Retained note missing');await click(`[data-file-id="${id}"]`);await until(()=>evaluate(`document.querySelector('.editor-input')?.innerText.includes(${JSON.stringify(marker)})`),'Retained body not rendered')}
async function editAndSave(id) {
  await click('.editor-input[contenteditable="true"]')
  for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:'End',windowsVirtualKeyCode:35,modifiers:2})
  await cdp.send('Input.insertText',{text:' upgraded-native-save'})
  for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:'s',windowsVirtualKeyCode:83,modifiers:2})
  await until(async()=>(await api('/api/files/'+id)).content.includes('upgraded-native-save'),'Upgraded app failed to persist actual UI input')
  await until(()=>evaluate("!document.querySelector('.save-state')"),'Save status did not settle')
}
try {
  assert.equal(existsSync(dataDir),false,'Refusing to touch preexisting default Notepad data')
  assert.deepEqual(await registrations(),[],'Refusing preexisting application registration')
  assert.deepEqual(await shellLinks(),[],'Refusing preexisting application shortcuts')
  report.installers={}
  for(const [which,expected] of Object.entries(RELEASES))report.installers[which]=verifyInstaller(readFileSync(path.join(root,'.installer-input',which,`Notepad-${expected.version}-Setup.exe`)),expected)
  mark('pinned-installers-verified')
  windowSession=createDesktopWindowSession();await windowSession.ready

  await install('current','fresh-install-current');mark('fresh-current-install')
  await launch(RELEASES.current.version)
  const a=await api('/api/files',{method:'POST',body:JSON.stringify({title:'Installer original A.md',content:desktopNote('安装验证','first installed note')})})
  const b=await api('/api/files',{method:'POST',body:JSON.stringify({title:'Installer original B.md',content:desktopNote('安装验证','second installed note')})})
  await verifyTrashWorkspaceDesktop({evaluate,click,cdp,until,api,out,noteIDs:[a.id,b.id]})
  await closeApp();mark('installed-app-trash-workflow')
  const fresh=snapshotData();await uninstall('fresh-uninstall-current');unchanged(fresh,'fresh-uninstall');mark('fresh-uninstall-preserves-default-data')
  // Preserve, never erase, the first scenario's generated data before the clean
  // old-version scenario. Both locations were created by this hosted-runner test.
  const retained = dataDir+'-installer-'+path.basename(scratch);assert.equal(existsSync(retained),false);renameSync(dataDir,retained)

  await install('previous','install-previous')
  await launch(RELEASES.previous.version)
  const oldNote=await api('/api/files',{method:'POST',body:JSON.stringify({title:'保留的升级笔记.md',content:desktopNote('升级前','old-version-persisted-body')})})
  await cdp.send('Page.reload',{ignoreCache:true});await openNote(oldNote.id,'old-version-persisted-body');await closeApp()
  mkdirSync(path.join(dataDir,'uploads'),{recursive:true});writeFileSync(path.join(dataDir,'uploads','installer-preserved.txt'),'synthetic attachment for upgrade/uninstall\n',{flag:'wx'})
  mkdirSync(path.join(dataDir,'backups'),{recursive:true});copyFileSync(path.join(dataDir,'data.db'),path.join(dataDir,'backups','installer-preserved.db'))
  const oldData=snapshotData();mark('previous-version-installed-and-seeded')

  await install('current','upgrade-to-current');unchanged(oldData,'upgrade-before-launch');mark('upgrade-preserves-default-data-before-launch')
  await launch(RELEASES.current.version);assert.equal((await api('/api/files/'+oldNote.id)).content,oldNote.content)
  await openNote(oldNote.id,'old-version-persisted-body');await editAndSave(oldNote.id);await capture('installed-upgrade-saved.png');const updated=(await api('/api/files/'+oldNote.id)).content
  await closeApp();mark('upgraded-app-reads-and-saves')
  const afterUpgrade=snapshotData();await install('current','repair-current-version');unchanged(afterUpgrade,'same-version-reinstall')
  await launch(RELEASES.current.version);assert.equal((await api('/api/files/'+oldNote.id)).content,updated);await openNote(oldNote.id,'upgraded-native-save');await closeApp();mark('same-version-reinstall-preserves-data')

  const beforeUninstall=snapshotData();await uninstall('uninstall-upgraded-current');unchanged(beforeUninstall,'uninstall-upgraded');mark('uninstall-removes-program-and-registration')
  await install('current','reinstall-current');unchanged(beforeUninstall,'reinstall-before-launch')
  await launch(RELEASES.current.version);assert.equal((await api('/api/files/'+oldNote.id)).content,updated);await openNote(oldNote.id,'upgraded-native-save');await capture('installed-reinstall-recovered.png');await closeApp();mark('reinstall-recovers-retained-data')
  const finalData=snapshotData();await uninstall('final-uninstall');unchanged(finalData,'final-uninstall');mark('final-uninstall-preserves-data')
  assert.equal(await windowSession.dispose(),true);windowSession=null;await freePort(27121);report.cleanupComplete=true;mark('owned-processes-exited')
  report.complete=true;report.finishedAt=new Date().toISOString();validateLifecycleReport(report);save()
} catch(error) {
  report.complete=false;report.error=String(error?.stack||error);save();throw error
} finally {
  if(appChild && appChild.exitCode===null) {
    report.complete=false;report.forceTerminated=true
    if(Number.isInteger(appChild.pid))spawnSync('taskkill.exe',['/PID',String(appChild.pid),'/T','/F'],{timeout:10000,stdio:'ignore'})
  }
  cdp?.close();if(windowSession)await windowSession.dispose()
  writeFileSync(path.join(out,'installed-app.log'),trace);save()
}
console.log('Actual NSIS install / upgrade / reinstall / uninstall lifecycle passed.')
