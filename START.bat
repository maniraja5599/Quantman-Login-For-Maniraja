@echo off
title FiFTO - Quantman Login Automation
color 0A

echo =========================================
echo   FiFTO - Quantman Broker Login
echo =========================================
echo.

cd /d "%~dp0"

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Install from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if node_modules exists
if not exist "node_modules\" (
    echo [1/3] Installing dependencies...
    call npm install
    echo.
    echo [2/3] Installing Playwright Chromium...
    call npx playwright install chromium
    echo.
) else (
    echo [OK] Dependencies already installed.
)

:: Kill any existing server on port 3333
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3333 ^| findstr LISTENING 2^>nul') do (
    echo [INFO] Stopping old server (PID: %%a)...
    taskkill /PID %%a /F >nul 2>nul
)

echo [3/3] Starting FiFTO server...
echo.
echo   Dashboard: http://localhost:3333
echo   Press Ctrl+C to stop the server.
echo.

:: Open browser after 2 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3333"

:: Start server (stays in foreground so user can see logs)
node server.js
