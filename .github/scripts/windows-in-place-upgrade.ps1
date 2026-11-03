$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$old=Get-ChildItem (Join-Path $root '.installer-input\4.248.0') -Filter 'Notepad-4.248.0-Setup.exe' -File | Select-Object -First 1
$new=Get-ChildItem (Join-Path $root '.installer-input\4.248.1') -Filter 'Notepad-4.248.1-Setup.exe' -File | Select-Object -First 1
if(!$old -or !$new){throw 'Both versioned installers are required.'}
$oldHash=(Get-FileHash $old.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$newHash=(Get-FileHash $new.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if($oldHash -ne '36d2218c5a835e35e25a7f4fcaf87498092c6ed39a6b1a7b7bdea210d377de4d'){throw "4.248.0 SHA mismatch: $oldHash"}
if($newHash -ne '0e57088336dbf042913cd1a4e1a430b04af31e59fa6f6017a72611a868892a1d'){throw "4.248.1 SHA mismatch: $newHash"}
$install=Join-Path $env:RUNNER_TEMP 'notepad-upgrade-install'
$data=Join-Path $env:APPDATA 'Notepad'
$out=Join-Path $root 'test-results\in-place-upgrade'
New-Item -ItemType Directory -Force $out|Out-Null
if(Test-Path $install){Remove-Item $install -Recurse -Force}
if(Test-Path $data){throw "Refusing to overwrite existing profile data: $data"}
$r=[ordered]@{complete=$false;status='running';versions=@('4.248.0','4.248.1');installerSha256=@{old=$oldHash;new=$newHash};checks=[System.Collections.Generic.List[string]]::new();backendExitCodes=[System.Collections.Generic.List[int]]::new();startedAt=[DateTime]::UtcNow.ToString('o')}
$http=[Net.Http.HttpClient]::new();$s=$null;$gui=$null;$safeCleanup=$true
function Install-App($exe){$p=Start-Process $exe -ArgumentList @('/S',"/D=$install") -PassThru -Wait;if($p.ExitCode -ne 0){throw "Installer exit $($p.ExitCode): $exe"}}
function Start-Api([int]$port){
 $exe=Join-Path $install 'resources\bin\notepad-server.exe';if(!(Test-Path $exe)){throw "Missing backend $exe"}
 $i=[Diagnostics.ProcessStartInfo]::new();$i.FileName=$exe;$i.WorkingDirectory=$install;$i.UseShellExecute=$false;$i.CreateNoWindow=$true;$i.RedirectStandardInput=$true;$i.RedirectStandardError=$true
 $i.Environment['NOTEPAD_DATA']=$data;$i.Environment['NOTEPAD_PARENT_STDIN']='1';$i.Environment['PORT']=[string]$port
 $p=[Diagnostics.Process]::new();$p.StartInfo=$i;$err=[Text.StringBuilder]::new();$null=$p.add_ErrorDataReceived({if($_.Data){[void]$err.AppendLine($_.Data)}})
 if(!$p.Start()){throw 'Backend process failed to start.'};$p.BeginErrorReadLine();$base="http://127.0.0.1:$port";$deadline=[DateTime]::UtcNow.AddSeconds(15)
 while([DateTime]::UtcNow -lt $deadline){if($p.HasExited){throw "Backend exited $($p.ExitCode): $($err.ToString())"};try{$h=Invoke-RestMethod "$base/api/health" -TimeoutSec 2;if($h.code -eq 0){return @{p=$p;base=$base;err=$err}}}catch{Start-Sleep -Milliseconds 150}}
 $p.StandardInput.Close();$null=$p.WaitForExit(10000);throw 'Backend health check timed out.'
}
function Stop-Api($x){if(!$x.p.HasExited){$x.p.StandardInput.Close()};if(!$x.p.WaitForExit(15000)){throw 'Backend did not close on parent-stdin EOF.'};$r.backendExitCodes.Add([int]$x.p.ExitCode);if($x.p.ExitCode -ne 0){throw "Backend exit $($x.p.ExitCode): $($x.err.ToString())"}}
function Read-Note($x,$id){$v=Invoke-RestMethod "$($x.base)/api/files/$id" -TimeoutSec 5;if($v.code -ne 0 -or !$v.data){throw "Cannot read retained note $id"};return $v.data}
function Check-Db($x){$v=Invoke-RestMethod "$($x.base)/api/diagnostics" -TimeoutSec 5;if($v.code -ne 0 -or $v.data.integrity -ne 'ok'){throw 'SQLite integrity diagnostic failed.'}}
try{
 Install-App $old.FullName
 if(!(Test-Path (Join-Path $install 'resources\bin\notepad-server.exe'))){throw '4.248.0 package is incomplete.'}
 $r.checks.Add('4.248.0-installed')
 $s=Start-Api 27161;Check-Db $s
 $fixture=Join-Path $env:RUNNER_TEMP 'upgrade-fixture.png'
 [IO.File]::WriteAllBytes($fixture,[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII='))
 $fixtureHash=(Get-FileHash $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
 $u=Invoke-RestMethod "$($s.base)/api/upload" -Method Post -Form @{file=Get-Item $fixture} -TimeoutSec 15
 if($u.code -ne 0 -or !$u.data.url){throw '4.248.0 attachment upload failed.'}
 $url=[string]$u.data.url;$bytes=$http.GetByteArrayAsync("$($s.base)$url").GetAwaiter().GetResult()
 $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($hash -ne $fixtureHash){throw 'Uploaded attachment failed exact-byte verification.'}
 $marker='UPGRADE-PRESERVE-'+[Guid]::NewGuid().ToString('N')
 $content=[string]::Join([Environment]::NewLine,@('# Upgrade retention fixture','',$marker,'',"![attachment]($url)"))
 $body=@{title='Upgrade retention fixture';content=$content;is_folder=$false;parent_id=''}|ConvertTo-Json -Compress
 $c=Invoke-RestMethod "$($s.base)/api/files" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
 if($c.code -ne 0 -or !$c.data.id){throw '4.248.0 note creation failed.'};$id=[string]$c.data.id
 if((Read-Note $s $id).content -ne $content){throw '4.248.0 note read-back failed.'}
 $r.noteId=$id;$r.attachmentSha256=$hash;$r.checks.Add('4.248.0-note-and-attachment-created-and-read-back')
 Stop-Api $s;$s=$null
 if(!(Test-Path (Join-Path $data 'data.db'))){throw 'Default APPDATA database missing after 4.248.0 shutdown.'}
 $r.checks.Add('4.248.0-clean-shutdown')
 # Same install directory; deliberately no 4.248.0 uninstall between installers.
 Install-App $new.FullName
 $app=Get-ChildItem $install -Filter '*.exe' -File|Where-Object{$_.Name -notlike 'Uninstall*'}|Select-Object -First 1
 if(!$app -or !(Test-Path (Join-Path $install 'resources\bin\notepad-server.exe'))){throw '4.248.1 package is incomplete.'}
 $ver=[Diagnostics.FileVersionInfo]::GetVersionInfo($app.FullName)
 if(($ver.ProductVersion+$ver.FileVersion) -notmatch '4\.248\.1'){throw "Installed app version mismatch: $($ver.ProductVersion) / $($ver.FileVersion)"}
 $r.checks.Add('4.248.1-installed-over-4.248.0-without-uninstall')
 $s=Start-Api 27162;Check-Db $s;$note=Read-Note $s $id
 if($note.title -ne 'Upgrade retention fixture' -or $note.content -notmatch [regex]::Escape($marker) -or $note.content -notmatch [regex]::Escape($url)){throw '4.248.1 did not preserve original note content.'}
 $bytes=$http.GetByteArrayAsync("$($s.base)$url").GetAwaiter().GetResult();$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($hash -ne $fixtureHash){throw '4.248.1 attachment bytes differ from 4.248.0.'}
 $r.checks.Add('4.248.1-reads-original-note-and-attachment')
 $updated=$note.content+[Environment]::NewLine+[Environment]::NewLine+($marker+'-SAVED-BY-4.248.1')
 $payload=@{content=$updated}|ConvertTo-Json -Compress
 $saved=Invoke-RestMethod "$($s.base)/api/files/$id" -Method Put -ContentType 'application/json' -Body $payload -TimeoutSec 10
 if($saved.code -ne 0 -or (Read-Note $s $id).content -ne $updated){throw '4.248.1 update/read-back failed.'}
 $r.checks.Add('4.248.1-write-and-read-back')
 Stop-Api $s;$s=$null
 $s=Start-Api 27163;Check-Db $s
 if((Read-Note $s $id).content -ne $updated){throw '4.248.1 saved content did not survive restart.'}
 $bytes=$http.GetByteArrayAsync("$($s.base)$url").GetAwaiter().GetResult();$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
 if($hash -ne $fixtureHash){throw 'Attachment did not survive upgraded backend restart.'}
 $r.checks.Add('4.248.1-restart-retains-note-and-attachment')
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
 $r.checks.Add('4.248.1-installed-electron-window-loads-retained-note')
 if(-not $gui.CloseMainWindow()){throw 'Could not request a normal close of the upgraded Electron window.'}
 if(-not $gui.WaitForExit(20000)){throw 'Upgraded Electron app did not exit normally after WM_CLOSE.'}
 $stopped=$false;$stopDeadline=[DateTime]::UtcNow.AddSeconds(10)
 while([DateTime]::UtcNow -lt $stopDeadline){
   try{$null=Invoke-RestMethod "$guiBase/api/health" -TimeoutSec 1;Start-Sleep -Milliseconds 200}catch{$stopped=$true;break}
 }
 if(-not $stopped){throw 'Bundled backend remained alive after the upgraded desktop exited.'}
 $r.checks.Add('4.248.1-desktop-normal-exit-stops-owned-backend')
 $r.complete=$true;$r.status='passed';$r.finishedAt=[DateTime]::UtcNow.ToString('o')
}catch{$r.status='failed';$r.error=$_.Exception.Message;$r.finishedAt=[DateTime]::UtcNow.ToString('o');throw}
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
if(!$r.complete){throw 'In-place upgrade acceptance incomplete.'}
Write-Host ($r|ConvertTo-Json -Depth 8)
