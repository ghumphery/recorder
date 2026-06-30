Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('c:\Users\humphery\coding\recoder\backup\backup-202606292232.zip')
$entry = $zip.Entries | Where-Object { $_.FullName -eq 'frontend/src/App.vue' } | Select-Object -First 1
$reader = New-Object System.IO.StreamReader($entry.Open())
$content = $reader.ReadToEnd()
$reader.Close()
$zip.Dispose()
$hasOld = $content.Contains('() => {')
$hasNew = $content.Contains('(data) => {')
$hasInitListener = $content.Contains('initTranscribeEventListener')
Write-Host ("App.vue size: {0}" -f $content.Length)
Write-Host ("Contains initTranscribeEventListener: {0}" -f $hasInitListener)
Write-Host ("Contains old buggy callback `() => {`: {0}" -f $hasOld)
Write-Host ("Contains new fixed callback `(data) => {`: {0}" -f $hasNew)
if ($hasNew) { Write-Host 'PASS: Fix verified in backup' } else { Write-Host 'FAIL: Fix NOT in backup' }