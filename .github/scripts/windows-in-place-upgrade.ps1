param([switch]$CurrentCandidate)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$oldVersion='4.248.0';$newVersion='4.248.1';$candidateInput=$null
$oldExpected='36d2218c5a835e35e25a7f4fcaf87498092c6ed39a6b1a7b7bdea210d377de4d'
$newExpected='0e57088336dbf042913cd1a4e1a430b04af31e59fa6f6017a72611a868892a1d'
$installName='notepad-upgrade-install';$outputName='test-results\in-place-upgrade'
if($CurrentCandidate){
 $verified=& node (Join-Path $root 'scripts\current-upgrade-input.mjs')
 if($LASTEXITCODE -ne 0){throw 'Current candidate installer input verification failed.'}
 $candidateInput=($verified -join [Environment]::NewLine)|ConvertFrom-Json
 if(!$candidateInput.inputVerified){throw 'Current candidate installer has no verified build identity.'}
 $oldVersion=$candidateInput.previousVersion;$newVersion=$candidateInput.current.version
 $oldExpected='0e57088336dbf042913cd1a4e1a430b04af31e59fa6f6017a72611a868892a1d'
 $newExpected=$candidateInput.current.sha256
 $old=Get-Item -LiteralPath (Join-Path $root '.installer-input\4.248.1\Notepad-4.248.1-Setup.exe')
 $new=Get-Item -LiteralPath (Join-Path $root ('release\'+$candidateInput.current.filename))
 $installName='notepad-current-upgrade-install';$outputName='test-results\current-in-place-upgrade'
}else{
 $old=Get-ChildItem (Join-Path $root '.installer-input\4.248.0') -Filter 'Notepad-4.248.0-Setup.exe' -File | Select-Object -First 1
 $new=Get-ChildItem (Join-Path $root '.installer-input\4.248.1') -Filter 'Notepad-4.248.1-Setup.exe' -File | Select-Object -First 1
}
if(!$old -or !$new){throw 'Both versioned installers are required.'}
$oldHash=(Get-FileHash $old.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$newHash=(Get-FileHash $new.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if($oldHash -ne $oldExpected){throw "$oldVersion SHA mismatch: $oldHash"}
if($newHash -ne $newExpected){throw "$newVersion SHA mismatch: $newHash"}
$install=Join-Path $env:RUNNER_TEMP $installName
$data=Join-Path $env:APPDATA 'Notepad'
$out=Join-Path $root $outputName
New-Item -ItemType Directory -Force $out|Out-Null
if(Test-Path $install){Remove-Item $install -Recurse -Force}
if(Test-Path $data){throw "Refusing to overwrite existing profile data: $data"}
$r=[ordered]@{complete=$false;status='running';scope='in-place-upgrade-only';fullLifecycleTested=$false;currentCandidateMode=[bool]$CurrentCandidate;versions=@($oldVersion,$newVersion);installerSha256=@{old=$oldHash;new=$newHash};checks=[System.Collections.Generic.List[string]]::new();backendExitCodes=[System.Collections.Generic.List[int]]::new();startedAt=[DateTime]::UtcNow.ToString('o')}
if($CurrentCandidate){$r.candidateInput=$candidateInput}
$http=[System.Net.Http.HttpClient]::new();$s=$null;$gui=$null;$safeCleanup=$true
function Install-App($exe){$p=Start-Process $exe -ArgumentList @('/S',"/D=$install") -PassThru -Wait;if($p.ExitCode -ne 0){throw "Installer exit $($p.ExitCode): $exe"}}
function Start-Api([int]$port){
 $exe=Join-Path $install 'resources\bin\notepad-server.exe';if(!(Test-Path $exe)){throw "Missing backend $exe"}
 $i=[Diagnostics.ProcessStartInfo]::new();$i.FileName=$exe;$i.WorkingDirectory=$install;$i.UseShellExecute=$false;$i.CreateNoWindow=$true;$i.RedirectStandardInput=$true
 $i.Environment['NOTEPAD_DATA']=$data;$i.Environment['NOTEPAD_PARENT_STDIN']='1';$i.Environment['PORT']=[string]$port
 $p=[Diagnostics.Process]::new();$p.StartInfo=$i
 if(!$p.Start()){throw 'Backend process failed to start.'};$base="http://127.0.0.1:$port";$deadline=[DateTime]::UtcNow.AddSeconds(15)
 while([DateTime]::UtcNow -lt $deadline){if($p.HasExited){throw "Backend exited $($p.ExitCode) during startup."};try{$h=Invoke-RestMethod "$base/api/health" -TimeoutSec 2;if($h.code -eq 0){return @{p=$p;base=$base}}}catch{Start-Sleep -Milliseconds 150}}
 $p.StandardInput.Close();$null=$p.WaitForExit(10000);throw 'Backend health check timed out.'
}
function Stop-Api($x){if(!$x.p.HasExited){$x.p.StandardInput.Close()};if(!$x.p.WaitForExit(15000)){throw 'Backend did not close on parent-stdin EOF.'};$r.backendExitCodes.Add([int]$x.p.ExitCode);if($x.p.ExitCode -ne 0){throw "Backend exit code $($x.p.ExitCode)."}}
function Read-Note($x,$id){$v=Invoke-RestMethod "$($x.base)/api/files/$id" -TimeoutSec 5;if($v.code -ne 0 -or !$v.data){throw "Cannot read retained note $id"};return $v.data}
function Check-Db($x){$v=Invoke-RestMethod "$($x.base)/api/diagnostics" -TimeoutSec 5;if($v.code -ne 0 -or $v.data.integrity -ne 'ok'){throw 'SQLite integrity diagnostic failed.'}}
try{
 Install-App $old.FullName
 if(!(Test-Path (Join-Path $install 'resources\bin\notepad-server.exe'))){throw "${oldVersion} package is incomplete."}
 $r.checks.Add("${oldVersion}-installed")
 $s=Start-Api 27161;Check-Db $s
 $fixture=Join-Path $env:RUNNER_TEMP 'upgrade-fixture.png'
 [IO.File]::WriteAllBytes($fixture,[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII='))
 $fixtureHash=(Get-FileHash $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
 $u=Invoke-RestMethod "$($s.base)/api/upload" -Method Post -Form @{file=Get-Item $fixture} -TimeoutSec 15
 if($u.code -ne 0 -or !$u.data.url){throw "${oldVersion} attachment upload failed."}
 $url=[string]$u.data.url;$bytes=$http.GetByteArrayAsync("$($s.base)$url").GetAwaiter().GetResult()
 $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($hash -ne $fixtureHash){throw 'Uploaded attachment failed exact-byte verification.'}
 $marker='UPGRADE-PRESERVE-'+[Guid]::NewGuid().ToString('N')
 $content=[string]::Join([Environment]::NewLine,@('# Upgrade retention fixture','',$marker,'',"![attachment]($url)"))
 $body=@{title='Upgrade retention fixture';content=$content;is_folder=$false;parent_id=''}|ConvertTo-Json -Compress
 $c=Invoke-RestMethod "$($s.base)/api/files" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
 if($c.code -ne 0 -or !$c.data.id){throw "${oldVersion} note creation failed."};$id=[string]$c.data.id
 if((Read-Note $s $id).content -ne $content){throw "${oldVersion} note read-back failed."}
 $r.noteId=$id;$r.attachmentSha256=$hash;$r.checks.Add("${oldVersion}-note-and-attachment-created-and-read-back")
 Stop-Api $s;$s=$null
 if(!(Test-Path (Join-Path $data 'data.db'))){throw "Default APPDATA database missing after ${oldVersion} shutdown."}
 $r.checks.Add("${oldVersion}-clean-shutdown")
 # Same install directory; deliberately no previous-version uninstall between installers.
 if($CurrentCandidate){
  $candidateHash=(Get-FileHash $new.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if($candidateHash -ne $newExpected -or (Get-Item -LiteralPath $new.FullName).Length -ne $candidateInput.current.bytes){throw 'Current candidate installer changed after verified input selection.'}
 }
 Install-App $new.FullName
 $app=Get-ChildItem $install -Filter '*.exe' -File|Where-Object{$_.Name -notlike 'Uninstall*'}|Select-Object -First 1
 if(!$app -or !(Test-Path (Join-Path $install 'resources\bin\notepad-server.exe'))){throw "${newVersion} package is incomplete."}
 $ver=[Diagnostics.FileVersionInfo]::GetVersionInfo($app.FullName)
 if($CurrentCandidate){
  $installedVersions=@($newVersion,($newVersion+'.0'))
  if($ver.ProductVersion -notin $installedVersions -or $ver.FileVersion -notin $installedVersions){throw "Installed candidate version mismatch: $($ver.ProductVersion) / $($ver.FileVersion)"}
 }elseif(($ver.ProductVersion+$ver.FileVersion) -notmatch '4\.248\.1'){throw "Installed app version mismatch: $($ver.ProductVersion) / $($ver.FileVersion)"}
 $r.checks.Add("${newVersion}-installed-over-${oldVersion}-without-uninstall")
 $s=Start-Api 27162;Check-Db $s;$note=Read-Note $s $id
 if($note.title -ne 'Upgrade retention fixture' -or $note.content -notmatch [regex]::Escape($marker) -or $note.content -notmatch [regex]::Escape($url)){throw "${newVersion} did not preserve original note content."}
 $bytes=$http.GetByteArrayAsync("$($s.base)$url").GetAwaiter().GetResult();$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($hash -ne $fixtureHash){throw "${newVersion} attachment bytes differ from ${oldVersion}."}
 $r.checks.Add("${newVersion}-reads-original-note-and-attachment")
 $updated=$note.content+[Environment]::NewLine+[Environment]::NewLine+($marker+"-SAVED-BY-${newVersion}")
 $payload=@{content=$updated}|ConvertTo-Json -Compress
 $saved=Invoke-RestMethod "$($s.base)/api/files/$id" -Method Put -ContentType 'application/json' -Body $payload -TimeoutSec 10
 if($saved.code -ne 0 -or (Read-Note $s $id).content -ne $updated){throw "${newVersion} update/read-back failed."}
 $r.checks.Add("${newVersion}-write-and-read-back")
 Stop-Api $s;$s=$null
 $s=Start-Api 27163;Check-Db $s
 if((Read-Note $s $id).content -ne $updated){throw "${newVersion} saved content did not survive restart."}
 $bytes=$http.GetByteArrayAsync("$($s.base)$url").GetAwaiter().GetResult();$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($hash -ne $fixtureHash){throw 'Attachment did not survive upgraded backend restart.'}
 $r.checks.Add("${newVersion}-restart-retains-note-and-attachment")
 Stop-Api $s;$s=$null

 # Launch the actual upgraded Electron executable against the normal default backend port/profile.
 $gui=Start-Process -FilePath $app.FullName -ArgumentList @('--remote-debugging-port=27164') -PassThru
 $guiBase='http://127.0.0.1:27121';$cdp='http://127.0.0.1:27164/json/list';$deadline=[DateTime]::UtcNow.AddSeconds(30);$page=$null
 while([DateTime]::UtcNow -lt $deadline){
   if($gui.HasExited){throw "Upgraded desktop exited during startup: $($gui.ExitCode)"}
   try{
     $health=Invoke-RestMethod "$guiBase/api/health" -TimeoutSec 2
     $targets=Invoke-RestMethod $cdp -TimeoutSec 2
     $page=$targets|Where-Object{$_.type -eq 'page' -and $_.url -match 'dist/index\.html'}|Select-Object -First 1
     if($health.code -eq 0 -and $page){break}
   }catch{Start-Sleep -Milliseconds 250}
 }
 if(!$page){throw 'Upgraded Electron window did not load the packaged renderer and local backend.'}
 $guiNote=Invoke-RestMethod "$guiBase/api/files/$id" -TimeoutSec 5
 if($guiNote.code -ne 0 -or $guiNote.data.content -ne $updated){throw 'The launched upgraded desktop did not read the retained upgraded note.'}
 if($CurrentCandidate){
  & node (Join-Path $root 'scripts\upgraded-renderer-ready.mjs') prepare --socket $page.webSocketDebuggerUrl --url $page.url --note $id --marker ($marker+"-SAVED-BY-${newVersion}") --deadline ($deadline.ToString('o')) --out $out --pid $gui.Id --exe $app.FullName
  if($LASTEXITCODE -ne 0){throw 'The actual upgraded renderer was not ready before the original desktop startup deadline.'}
  $readyFile=Join-Path $out 'renderer-prepare.json'
  $r.rendererReadiness=@{file='renderer-prepare.json';bytes=(Get-Item $readyFile).Length;sha256=(Get-FileHash $readyFile -Algorithm SHA256).Hash.ToLowerInvariant()}
 }
 $r.checks.Add("${newVersion}-installed-electron-window-loads-retained-note")
 # Electron may not expose a Win32 MainWindowHandle on a hosted runner. Request the
 # supported Chromium Browser.close command over its loopback DevTools endpoint.
 $versionInfo=Invoke-RestMethod 'http://127.0.0.1:27164/json/version' -TimeoutSec 5
 $browserSocket=[string]$versionInfo.webSocketDebuggerUrl
 if([string]::IsNullOrWhiteSpace($browserSocket)){throw 'Electron DevTools browser WebSocket endpoint is missing.'}
 if($CurrentCandidate){
 $r.desktopClose=[ordered]@{method='Browser.close';processBudgetMs=20000;commandId=1;sent=$false;ack=$null;startedAt=[DateTime]::UtcNow.ToString('o')}
 $ws=[System.Net.WebSockets.ClientWebSocket]::new();$receive=$null;$buffer=[byte[]]::new(8192)
 try{
   $ws.ConnectAsync([Uri]$browserSocket,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
   $receive=$ws.ReceiveAsync([ArraySegment[byte]]::new($buffer),[Threading.CancellationToken]::None)
   $command=[Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Browser.close"}')
   $segment=[ArraySegment[byte]]::new($command)
   $ws.SendAsync($segment,[System.Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
   $r.desktopClose.sent=$true
   # Keep the command transport alive and receive its actual response while the
   # original process-exit gate runs. Do not inject a quit approval or retry.
 if(-not $gui.WaitForExit(20000)){
   $r.quitDiagnostics=[ordered]@{cdpCommand='Browser.close';sent=$true;nativeProcessId=$gui.Id;webSocketState=[string]$ws.State}
   try{
     $targetsAfter=Invoke-RestMethod $cdp -TimeoutSec 3
     $r.quitDiagnostics.cdpTargetsAfter=@($targetsAfter|ForEach-Object{@{type=$_.type;url=$_.url}})
   }catch{$r.quitDiagnostics.cdpAfterError=$_.Exception.Message}
   try{
     $healthAfter=Invoke-RestMethod "$guiBase/api/health" -TimeoutSec 2
     $r.quitDiagnostics.backendHealthCode=$healthAfter.code
   }catch{$r.quitDiagnostics.backendHealthError=$_.Exception.Message}
   throw 'Upgraded Electron app did not exit after CDP Browser.close.'
 }
   $r.desktopClose.exitCode=[int]$gui.ExitCode
   if($gui.ExitCode -ne 0){throw "Upgraded desktop did not exit cleanly: $($gui.ExitCode)"}
 }finally{
   if($receive -and $receive.IsCompletedSuccessfully){
    $frame=$receive.GetAwaiter().GetResult();$payload=[Text.Encoding]::UTF8.GetString($buffer,0,$frame.Count)
    $r.desktopClose.ack=@{complete=$frame.EndOfMessage;messageType=[string]$frame.MessageType;text=$payload}
   }elseif($receive -and $receive.IsFaulted){$r.desktopClose.ack=@{error=$receive.Exception.GetBaseException().Message}}
   else{$r.desktopClose.ack=@{pending=$true}}
   $r.desktopClose.finishedAt=[DateTime]::UtcNow.ToString('o');$ws.Dispose()
 }
 }else{
 $ws=[System.Net.WebSockets.ClientWebSocket]::new()
 try{
   $ws.ConnectAsync([Uri]$browserSocket,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
   $command=[Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Browser.close"}')
   $segment=[ArraySegment[byte]]::new($command)
   $ws.SendAsync($segment,[System.Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
 # Keep the CDP connection alive while Chromium dispatches Browser.close. Closing
 # the client socket immediately after SendAsync can race delivery on Windows.
 # This still requires the original real process exit within 20 seconds.
 if(-not $gui.WaitForExit(20000)){
   $r.quitDiagnostics=[ordered]@{cdpCommand='Browser.close';sent=$true;nativeProcessId=$gui.Id;webSocketState=[string]$ws.State}
   try{
     $targetsAfter=Invoke-RestMethod $cdp -TimeoutSec 3
     $r.quitDiagnostics.cdpTargetsAfter=@($targetsAfter|ForEach-Object{@{type=$_.type;url=$_.url}})
   }catch{$r.quitDiagnostics.cdpAfterError=$_.Exception.Message}
   try{
     $healthAfter=Invoke-RestMethod "$guiBase/api/health" -TimeoutSec 2
     $r.quitDiagnostics.backendHealthCode=$healthAfter.code
   }catch{$r.quitDiagnostics.backendHealthError=$_.Exception.Message}
   throw 'Upgraded Electron app did not exit after CDP Browser.close.'
 }
 }finally{$ws.Dispose()}
 }
 $stopped=$false;$stopDeadline=[DateTime]::UtcNow.AddSeconds(10)
 while([DateTime]::UtcNow -lt $stopDeadline){
   try{$null=Invoke-RestMethod "$guiBase/api/health" -TimeoutSec 1;Start-Sleep -Milliseconds 200}catch{$stopped=$true;break}
 }
 if(-not $stopped){throw 'Bundled backend remained alive after the upgraded desktop exited.'}
 $r.checks.Add("${newVersion}-desktop-normal-exit-stops-owned-backend")
 $r.complete=$true;$r.status='passed';$r.finishedAt=[DateTime]::UtcNow.ToString('o')
}catch{
 $failedUpgrade=$_
 $r.status='failed';$r.error=$_.Exception.Message;$r.finishedAt=[DateTime]::UtcNow.ToString('o')
 if($CurrentCandidate -and $gui -and -not $gui.HasExited -and $page){
  try{
   & node (Join-Path $root 'scripts\upgraded-renderer-ready.mjs') failure --socket $page.webSocketDebuggerUrl --url $page.url --note $id --marker ($marker+"-SAVED-BY-${newVersion}") --out $out --pid $gui.Id --exe $app.FullName
   $r.rendererDiagnosticExitCode=$LASTEXITCODE
  }catch{$r.rendererDiagnosticError=$_.Exception.Message}
 }
 throw $failedUpgrade
}
finally{
 if($gui -and -not $gui.HasExited){
   try{if($gui.CloseMainWindow()){$null=$gui.WaitForExit(20000)};if(-not $gui.HasExited){$safeCleanup=$false;$r.cleanupError='Upgraded desktop did not close; test profile preserved.'}}catch{$safeCleanup=$false;$r.cleanupError=$_.Exception.Message}
 }
 if($s){try{Stop-Api $s}catch{$safeCleanup=$false;$r.cleanupError=$_.Exception.Message}}
 $http.Dispose()
 if($safeCleanup){
   if(Test-Path $install){$un=Get-ChildItem $install -Filter 'Uninstall*.exe' -File|Select-Object -First 1;if($un){$p=Start-Process $un.FullName -ArgumentList '/S' -PassThru -Wait;if($p.ExitCode -ne 0){$r.cleanupError='Upgrade runner cleanup uninstall failed.';$safeCleanup=$false}}}
   if($safeCleanup -and (Test-Path $data)){Remove-Item $data -Recurse -Force}
 }
 $r.cleanupComplete=$safeCleanup
 $r|ConvertTo-Json -Depth 8|Set-Content (Join-Path $out 'upgrade-report.json') -Encoding utf8
}
if(!$r.complete -or !$r.cleanupComplete){throw 'In-place upgrade acceptance or isolated runner cleanup incomplete.'}
Write-Host ($r|ConvertTo-Json -Depth 8)
