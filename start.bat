@echo off
set PATH=%PATH%;C:\Users\legra\Desktop\pawapay-test-server\node-v22.13.1-win-x64
cd /d "%~dp0"
node dist/index.js %*
