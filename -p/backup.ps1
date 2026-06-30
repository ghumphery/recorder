$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

$root = 'c:\Users\humphery\coding\recoder'
$ts = Get-Date -Format 'yyyyMMddHHmm'
$backupName = "backup-$ts.zip"
$backupPath = Join-Path $root 'backup'
$zipPath = Join-Path $backupPath $backupName

if (-not (Test-Path $backupPath)) { New-Item -ItemType Directory -Path $backupPath | Out-Null }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# 排除清單（依 workrule.md 規範）
$excludeDirPrefixes = @(
  '\node_modules\', '\dist-electron\', '\dist-electron-build\',
  '\dist-electron-build2\', '\dist-electron-build3\', '\dist\',
  '\.git\', '\whisper_cpp\', '\model\', '\model_bak\', '\ffmpeg\',
  '\backup\', '\-p\'
)

# 收集要打包的檔案（絕對路徑）
$filesToZip = New-Object System.Collections.Generic.List[string]
$rootWithSep = $root + '\'
Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
  $abs = $_.FullName
  # 計算相對路徑（使用 \ 分隔）
  $rel = $abs.Substring($rootWithSep.Length)
  $skip = $false
  foreach ($prefix in $excludeDirPrefixes) {
    if ($rel.StartsWith($prefix.TrimStart('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
      $skip = $true; break
    }
  }
  if (-not $skip) { $filesToZip.Add($abs) }
}

Write-Host ("Files to include: {0}" -f $filesToZip.Count)

# 建立 zip
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
foreach ($abs in $filesToZip) {
  $relInZip = $abs.Substring($rootWithSep.Length).Replace('\','/')
  try {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $abs, $relInZip, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  } catch {
    Write-Warning ("Skip: {0} ({1})" -f $relInZip, $_.Exception.Message)
  }
}
$zip.Dispose()

Get-Item $zipPath | Select-Object Name, Length, LastWriteTime | Format-Table