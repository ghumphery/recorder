Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = 'c:\Users\humphery\coding\recoder\backup\backup-202606292216.zip'
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entries = $zip.Entries
Write-Host "Total entries: $($entries.Count)"
$totalSize = ($entries | Measure-Object -Property Length -Sum).Sum
Write-Host ("Total uncompressed: {0:N0} bytes" -f $totalSize)
$topDirs = $entries | ForEach-Object {
  $parts = $_.FullName -split '[/\\]'
  if ($parts.Count -gt 1) { $parts[0] } else { '' }
} | Sort-Object -Unique
Write-Host "=== Top-level folders ==="
$topDirs | ForEach-Object { Write-Host "  $_" }
$zip.Dispose()