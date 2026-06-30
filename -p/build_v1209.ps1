# v1.20.9 編譯腳本
Set-Location 'C:\Users\humphery\coding\recoder\frontend'
$env:CSC_LINK = 'C:\Certs\recorder_selfsign.pfx'
$env:CSC_KEY_PASSWORD = 'RecorderSelfSign2026'
$logPath = 'C:\Users\humphery\AppData\Local\Temp\electron_builder_v1209b.log'
$errPath = 'C:\Users\humphery\AppData\Local\Temp\electron_builder_v1209b_err.log'
& '.\node_modules\.bin\electron-builder.cmd' --win portable --config.directories.output=dist-electron-build5 2>&1 | Out-File -FilePath $logPath -Encoding utf8
"END_OK" | Out-File -FilePath "$logPath.done" -Encoding utf8
