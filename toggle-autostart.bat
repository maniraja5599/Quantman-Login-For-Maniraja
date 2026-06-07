@echo off
title FiFTO - Toggle Auto-Start
cd /d "%~dp0"

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP%\FiFTO-Server.lnk

if exist "%SHORTCUT%" goto :disable

:enable
echo.
echo  Enabling auto-start...
powershell -ExecutionPolicy Bypass -Command ^
  $wshell = New-Object -ComObject WScript.Shell; ^
  $s = $wshell.CreateShortcut('%SHORTCUT%'); ^
  $s.TargetPath = '%~dp0start-hidden.vbs'; ^
  $s.WorkingDirectory = '%~dp0'; ^
  $s.WindowStyle = 7; ^
  $s.Description = 'FiFTO Broker Login Server'; ^
  $s.Save()
if exist "%SHORTCUT%" (echo  [ON] Auto-start enabled. Server will start at login. & color 0A) else (echo  [FAILED] & color 0C)
goto :end

:disable
echo.
echo  Disabling auto-start...
del "%SHORTCUT%" /f /q >nul 2>nul
if not exist "%SHORTCUT%" (echo  [OFF] Auto-start disabled. Server will NOT start at login. & color 0E) else (echo  [FAILED] & color 0C)
goto :end

:end
echo.
echo  Startup shortcut: %SHORTCUT%
echo.
pause