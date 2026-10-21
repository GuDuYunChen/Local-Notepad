import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const BASE_VERIFIER_BLOB = '8fc01373d8b1f664e2efe243d9a28b1948de340f'
export const gitBlob = text => { const b=Buffer.from(text); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex') }
export function validateShortcutRecords(links, expected) {
  assert.ok(Array.isArray(links) && links.length >= 1, 'No installed shortcut')
  assert.ok(path.win32.isAbsolute(expected))
  const same = value => typeof value === 'string' && value.length > 0 && path.win32.isAbsolute(value) && path.win32.normalize(value).toLowerCase() === path.win32.normalize(expected).toLowerCase()
  for (const link of links) {
    assert.equal(link.reader, 'Shell.Application')
    assert.ok(typeof link.path === 'string' && path.win32.isAbsolute(link.path) && /\.lnk$/i.test(link.path))
    assert.ok(same(link.target), 'Native Shell shortcut target does not match installed executable')
    if (link.wshTarget !== '') assert.ok(same(link.wshTarget), 'Shortcut readers disagree')
  }
  assert.equal(new Set(links.map(x => x.path.toLowerCase())).size,links.length)
  return true
}
export function replaceUnique(source, before, after) {
  assert.equal(source.split(before).length,2,'Verifier source anchor is missing or ambiguous')
  return source.replace(before,after)
}
const OLD_READER = 'async function shellLinks() {\n  const raw=await ps(`$w=New-Object -ComObject WScript.Shell;$links=@();foreach($folder in @([Environment]::GetFolderPath(\'DesktopDirectory\'),[Environment]::GetFolderPath(\'Programs\'))){$p=Join-Path $folder \'记事本.lnk\';if(Test-Path -LiteralPath $p){$s=$w.CreateShortcut($p);$links+=@{path=$p;target=$s.TargetPath}}};ConvertTo-Json -InputObject @($links) -Compress`)\n  return JSON.parse(raw)\n}'
export const SHELL_READER = `async function shellLinks() {
  const raw=await ps(\`$w=New-Object -ComObject WScript.Shell;$shell=New-Object -ComObject Shell.Application;$links=@();foreach($folder in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))){$p=Join-Path $folder '记事本.lnk';if(Test-Path -LiteralPath $p){$item=$shell.NameSpace($folder).ParseName('记事本.lnk');if($null -eq $item -or -not $item.IsLink){throw 'Invalid native shortcut'};$s=$item.GetLink;$links+=@{path=$p;target=$s.Path;reader='Shell.Application';wshTarget=$w.CreateShortcut($p).TargetPath}}};ConvertTo-Json -InputObject @($links) -Compress\`)
  const links=JSON.parse(raw)
  if(links.length)validateShortcutRecords(links,appExe)
  return links
}`
export const SHORTCUT_PROBE = `
async function checkShortcutLaunch() {
  assert.ok(!appChild)
  await freePort(27121)
  const links=await shellLinks()
  validateShortcutRecords(links,appExe)
  const link=links[0],started=JSON.parse(await ps(\`$p=Start-Process -FilePath $env:NP_TEST_LINK -PassThru;$null=$p.Handle;@{pid=$p.Id;executable=$p.Path}|ConvertTo-Json -Compress\`,{NP_TEST_LINK:link.path}))
  assert.ok(Number.isInteger(started.pid) && started.pid>0)
  appChild={pid:started.pid,exitCode:null}
  assert.equal(path.resolve(started.executable).toLowerCase(),appExe.toLowerCase())
  report.shortcutLaunch={complete:false,path:link.path,target:link.target,pid:started.pid};save()
  const ready=requireOwnedPath(scratch,path.join(scratch,'shortcut-watcher-ready'))
  const script=\`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$p=[Diagnostics.Process]::GetProcessById([int]$env:NP_TEST_PID);$null=$p.Handle;[IO.File]::WriteAllText($env:NP_TEST_READY,'ready');$p.WaitForExit();$p.Refresh();@{code=$p.ExitCode;pid=$p.Id}|ConvertTo-Json -Compress\`
  appExited=command('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{NP_TEST_PID:String(started.pid),NP_TEST_READY:ready},timeout:60000}).then(raw=>JSON.parse(raw))
  void appExited.catch(()=>{})
  await until(()=>existsSync(ready),'Shortcut process watcher did not attach',10000)
  await until(()=>api('/api/health'),'Shortcut-started backend did not become healthy')
  const native=await until(async()=>{const ws=await windowSession.inspect(started.pid);const match=ws.filter(w=>w.pid===started.pid&&w.visible===true&&w.cls==='Chrome_WidgetWin_1'&&w.title&&w.childText?.includes('Chrome Legacy Window'));return match.length===1?{ws,title:match[0].title}:null},'Shortcut-started main window was not uniquely identified')
  await windowSession.close(selectDesktopMainWindow(native.ws,started.pid,native.title))
  let timer,result
  try {result=await Promise.race([appExited,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('Shortcut native close did not finish')),15000)})])}finally{clearTimeout(timer)}
  assert.equal(result.pid,started.pid);assert.equal(result.code,0)
  appChild.exitCode=result.code;appChild=null
  await until(async()=>{try{await freePort(27121);return true}catch{return false}},'Shortcut-started backend did not stop',5000)
  report.shortcutLaunch={...report.shortcutLaunch,complete:true,code:result.code,nativeClose:true,backendStopped:true}
  report.appExits.push({pid:started.pid,code:result.code,signal:null,nativeClose:true,viaShortcut:true});save()
}
`
export function prepareShellVerifiedLifecycle(raw) {
  const source=raw.replace(/\r\n/g,'\n')
  assert.equal(gitBlob(source),BASE_VERIFIER_BLOB,'Unexpected installer verifier source; refusing partial patch')
  let result=replaceUnique(source,OLD_READER,SHELL_READER+SHORTCUT_PROBE)
  result=replaceUnique(result,"  await install('current','fresh-install-current');mark('fresh-current-install')", "  await install('current','fresh-install-current');mark('fresh-current-install')\n  await checkShortcutLaunch()")
  return "import { validateShortcutRecords } from './installer-shell-core.mjs'\n"+result
}
export function validateShortcutCompletion(report) {
  assert.equal(report.complete,true)
  const launch=report.shortcutLaunch
  assert.equal(launch.complete,true);assert.equal(launch.nativeClose,true);assert.equal(launch.backendStopped,true)
  assert.equal(launch.code,0);assert.ok(Number.isInteger(launch.pid)&&launch.pid>0)
  assert.ok(report.appExits.some(e=>e.pid===launch.pid&&e.viaShortcut===true&&e.nativeClose===true&&e.code===0))
  for (const snapshot of report.snapshots) validateShortcutRecords(snapshot.links,launch.target)
  return true
}
