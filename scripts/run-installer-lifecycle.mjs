// Validate exact existing test source, correct its native shortcut reader and
// additionally launch the real installed .lnk. No product/installer is modified.
import { assertHostedWindows } from './installer-lifecycle-core.mjs'
import { prepareShellVerifiedLifecycle,validateShortcutCompletion,gitBlob } from './installer-shell-core.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
assertHostedWindows(process.env,process.platform)
const out=path.resolve('test-results/installer-lifecycle');mkdirSync(out,{recursive:true})
execFileSync(process.execPath,['--test','scripts/installer-shell-core.node.mjs'],{stdio:'inherit',timeout:30000})
const original=readFileSync(new URL('./check-windows-installer-lifecycle.mjs',import.meta.url),'utf8')
const prepared=prepareShellVerifiedLifecycle(original)
writeFileSync(new URL('./check-windows-installer-lifecycle.shell.mjs',import.meta.url),prepared,{flag:'wx'})
writeFileSync(path.join(out,'shortcut-verifier-source.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,originalBlob:gitBlob(original.replace(/\r\n/g,'\n')),preparedBlob:gitBlob(prepared),productionModified:false},null,2))
try {
 await import('./check-windows-installer-lifecycle.shell.mjs')
 validateShortcutCompletion(JSON.parse(readFileSync(path.join(out,'installation.json'),'utf8')))
}
catch (error) {
 const reportFile=path.join(out,'installation.json')
 if(existsSync(reportFile)){const report=JSON.parse(readFileSync(reportFile,'utf8'));report.complete=false;report.error=String(error.stack||error);writeFileSync(reportFile,JSON.stringify(report,null,2))}
 try {
  const script=`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$w=New-Object -ComObject WScript.Shell;$shell=New-Object -ComObject Shell.Application;$a=@();foreach($d in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))){$p=Join-Path $d '记事本.lnk';if(Test-Path -LiteralPath $p){$ln=$w.CreateShortcut($p);$item=$shell.NameSpace($d).ParseName('记事本.lnk');$a+=@{path=$p;wshTarget=$ln.TargetPath;shellTarget=$item.GetLink.Path;arguments=$ln.Arguments;workingDirectory=$ln.WorkingDirectory;icon=$ln.IconLocation}}};ConvertTo-Json -InputObject @($a) -Compress`
  const links=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:20000}))
  for(let i=0;i<links.length;i++) {
   const link=links[i];if(!existsSync(link.path))continue
   const bytes=readFileSync(link.path),filename=`installed-shortcut-${i}.lnk`
   writeFileSync(path.join(out,filename),bytes)
   link.file={filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
  }
  writeFileSync(path.join(out,'shortcut-diagnostics.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,links},null,2))
 } catch (diagnosticError) {writeFileSync(path.join(out,'shortcut-diagnostic-error.txt'),String(diagnosticError.stack||diagnosticError))}
 throw error
}
