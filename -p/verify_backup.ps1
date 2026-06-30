Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = 'c:\Users\humphery\coding\recoder\backup\backup-202606292232.zip'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)
Write-Host ("Entries: {0}" -f $zip.Entries.Count)
Write-Host "=== Key files ==="
$zip.Entries | Where-Object { $_.FullName -match 'App\.vue' -or $_.FullName -match 'package\.json' -or $_.FullName -match 'modify_record\.md' -or $_.FullName -match 'Product_Design_Guidelines' } | ForEach-Object { Write-Host $_.FullName }
$zip.Dispose()