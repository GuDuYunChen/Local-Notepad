// Preserve exact shortcut bytes when native validation fails. No assertions or
// installer/application behaviors are replaced by this evidence-only wrapper.
import { assertHostedWindows } from './installer-lifecycle-core.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
assertHostedWindows(process.env,process.platform)
try { await import('./check-windows-installer-lifecycle.mjs') }
catch (error) {
 const out=path.resolve('test-results/installer-lifecycle');mkdirSync(out,{recursive:true})
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
