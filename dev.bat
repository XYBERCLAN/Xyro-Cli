@echo off
set PATH=%PATH%;C:\Users\legra\Desktop\pawapay-test-server\node-v22.13.1-win-x64
cd /d "%~dp0"
node node_modules/typescript/bin/tsx src/index.ts %*
