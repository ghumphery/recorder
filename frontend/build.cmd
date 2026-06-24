@echo off
set PATH=C:\Program Files (x86)\NSIS;%PATH%
cd /d "%~dp0"
npm run electron:build
