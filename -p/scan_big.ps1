$excludeDirNames = @('node_modules', 'dist-electron', 'dist-electron-build', 'dist-electron-build2', 'dist-electron-build3', 'dist', '.git', 'whisper_cpp', 'model', 'model_bak', 'ffmpeg', 'backup', '-p')
$root = 'c:\Users\humphery\coding\recoder'
$big = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
  $rel = $_.FullName.Substring($root.Length).TrimStart('\','/')
  $skip = $false
  foreach ($ex in $excludeDirNames) {
    if ($rel -like "$ex\*" -or $rel -like "$ex/\*") { $skip = $true; break }
  }
  -not $skip
} | Sort-Object Length -Descending | Select-Object -First 10 FullName, Length | Format-Table -AutoSize
$big