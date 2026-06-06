@echo off
title FiFTO - Start Server
color 0E
cd /d "%~dp0"

:: Check if server is running
curl -s http://localhost:3333/api/status >nul 2>nul
if %errorlevel% equ 0 goto :run

echo [1/2] Starting server...
echo.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3333 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%a /F >nul 2>nul
)
start /B node server.js >nul 2>&1

echo [2/2] Waiting for server...
setlocal enabledelayedexpansion
for /l %%i in (1,1,15) do (
    >nul timeout /t 1 /nobreak
    curl -s http://localhost:3333/api/status >nul 2>nul
    if !errorlevel! equ 0 (
        endlocal
        goto :run
    )
)
endlocal
echo [ERROR] Server did not start. Check for errors.
pause
exit /b 1

:run
echo [OK] Server is running.
start http://localhost:3333
echo.
echo Dashboard opened. Click "Run now" on the page to start brokers.
echo.
pause
