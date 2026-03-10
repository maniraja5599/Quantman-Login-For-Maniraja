@echo off
title FiFTO - Run All Brokers
color 0E

echo =========================================
echo   FiFTO - Running All Broker Logins
echo =========================================
echo.

cd /d "%~dp0"

:: Check if server is running
curl -s http://localhost:3333/api/status >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Server is not running!
    echo         Double-click START.bat first.
    echo.
    pause
    exit /b 1
)

echo [INFO] Server is running. Triggering all broker logins...
echo.

:: Trigger Run All via API
node -e "fetch('http://localhost:3333/api/automation/run-now',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>{console.log('');if(d.summary){Object.entries(d.summary.brokers||{}).forEach(([k,v])=>{console.log('  '+k+': '+(v.success?'SUCCESS':'FAILED - '+(v.error||v.step||'unknown')))});console.log('');console.log('  Result: '+(d.summary.success?'All brokers logged in!':'Some brokers failed.'))}else{console.log('  '+JSON.stringify(d))}}).catch(e=>console.log('  Error: '+e.message))"

echo.
echo =========================================
echo   Done! Check dashboard for details.
echo =========================================
echo.
pause
