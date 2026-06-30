# 備份腳本 v1.20.8 - 排除 dist-electron-build*, node_modules, .git, backup, whisper_cpp/build, whisper_cpp/build_cuda
$ErrorActionPreference = 'SilentlyContinue'
$root = 'C:\Users\humphery\coding\recoder'
$dest = Join-Path $root 'backup\backup-202606301115.zip'

# 確保 backup 目錄存在
if (!(Test-Path (Join-Path $root 'backup'))) { New-Item -ItemType Directory -Path (Join-Path $root 'backup') -Force | Out-Null }

# 若已存在先移除
if (Test-Path $dest) { Remove-Item $dest -Force; Write-Host 'Removed existing zip' }

# 準備來源（先以 Copy-Item 排除大資料夾到 staging 目錄，再壓縮；或者用 .NET ZipFile API 逐檔加入）
$staging = Join-Path $env:TEMP 'recoder_backup_staging'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$excludeDirs = @('node_modules', '.git', 'backup', 'dist-electron-build', 'dist-electron-build2', 'dist-electron-build3', 'dist-electron-build4', 'build', 'build_cuda', 'win-unpacked')

# 複製頂層目錄（排除）
$topDirs = @('frontend', 'model', 'whisper_cli', 'assets', '-p', 'whisper_cpp')
foreach ($d in $topDirs) {
  $src = Join-Path $root $d
  if (!(Test-Path $src)) { continue }
  $dst = Join-Path $staging $d
  Write-Host "Copying $d ..."
  robocopy $src $dst /MIR /XD $excludeDirs /XF '*.log' '*.tmp' /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
}

# 複製頂層檔案（.md, .json, LICENSE, security.md 等）
Write-Host 'Copying top-level files ...'
Get-ChildItem $root -File -Force | Where-Object { $_.Name -notin @('LICENSE') -and $_.Extension -in @('.md', '.json', '.txt') } | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $staging $_.Name) -Force
}
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $staging 'LICENSE') -Force

# 計算 staging 內總大小
$staged = Get-ChildItem $staging -Recurse -File -ErrorAction SilentlyContinue
$totalBytes = ($staged | Measure-Object -Property Length -Sum).Sum
$totalFiles = $staged.Count
Write-Host ("Staged files: {0}, Total: {1} MB" -f $totalFiles, [math]::Round($totalBytes/1MB, 2))

# 使用 .NET ZipFile 壓縮
Add-Type -AssemblyName System.IO.Compression.FileSystem
Write-Host "Creating zip: $dest"
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $dest, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# 清理 staging
Remove-Item $staging -Recurse -Force

# 報告
if (Test-Path $dest) {
  $info = Get-Item $dest
  Write-Host ("DONE: {0} ({1} MB)" -f $info.Name, [math]::Round($info.Length/1MB, 2))
} else {
  Write-Host 'FAILED: zip not created'
}