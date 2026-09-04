@echo off
title XYRO - AI Coding Agent

REM Try to find Node.js in common locations
where node >nul 2>&1 && goto :run

REM Check common install locations
if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
    goto :run
)
if exist "%LOCALAPPDATA%\Programs\node\node.exe" (
    set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
    goto :run
)
if exist "C:\Users\legra\Desktop\pawapay-test-server\node-v22.13.1-win-x64\node.exe" (
    set "PATH=C:\Users\legra\Desktop\pawapay-test-server\node-v22.13.1-win-x64;%PATH%"
    goto :run
)

echo Node.js not found! Please install from https://nodejs.org
pause
exit /b 1

:run
cd /d "%~dp0"
node dist/index.js %*
