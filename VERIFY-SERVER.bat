@echo off
title FiFTO - Verify Server Status
color 0A

:: Check if server is running on port 3333
curl -s http://localhost:3333/api/status >nul 2>nul
if %errorlevel% equ 0 (
    echo ========================================================
    echo  [OK] FiFTO Server is running in the background!
    echo ========================================================
    echo.
    echo  Dashboard URL:  http://localhost:3333
    echo  Docs URL:       http://localhost:3333/docs
    echo.
    echo  To stop the background server:
    echo  1. Open Task Manager and end "Node.js JavaScript Runtime".
    echo  2. Or run: taskkill /F /IM node.exe
    echo ========================================================
) else (
    echo ========================================================
    echo  [WARNING] FiFTO Server is NOT running.
    echo ========================================================
    echo.
    echo  Double-click "start-hidden.vbs" to start it in the background.
    echo  Or double-click "RUN-ALL.bat" to run it in a visible window.
    echo ========================================================
)
echo.
pause
