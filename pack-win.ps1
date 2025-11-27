$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'package.json')) { Write-Host '请在项目根目录运行脚本' -ForegroundColor Red; exit 1 }
try { node -v > $null } catch { Write-Host '未检测到 Node.js，请安装后重试' -ForegroundColor Red; exit 1 }
try { npm -v > $null } catch { Write-Host '未检测到 npm，请安装后重试' -ForegroundColor Red; exit 1 }
try { go version > $null } catch { Write-Host '未检测到 Go 环境，请安装 Go 后重试' -ForegroundColor Red; exit 1 }
Write-Host '安装依赖…' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) { npm install }
Write-Host '开始打包…' -ForegroundColor Cyan
npm run build
$exeFiles = Get-ChildItem -Path 'dist' -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue
if ($exeFiles.Count -gt 0) {
  $first = $exeFiles[0].FullName
  Write-Host ("生成安装包：" + $first) -ForegroundColor Green
  Start-Process explorer.exe (Split-Path $first)
} else {
  Write-Host '未找到生成的 exe，请检查构建输出（dist 目录）' -ForegroundColor Yellow
}
