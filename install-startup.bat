@echo off
title FiFTO - Install Auto-Start
color 0A
cd /d "%~dp0"

echo ========================================================
echo  Installing FiFTO to Windows Startup Folder
echo ========================================================
echo.

:: Create shortcut in Windows Startup folder using PowerShell
powershell -Command ^
  $wshell = New-Object -ComObject WScript.Shell; ^
  $shortcut = $wshell.CreateShortcut([Environment]::GetFolderPath('Startup') + '\FiFTO-Server.lnk'); ^
  $shortcut.TargetPath = '%~dp0start-hidden.vbs'; ^
  $shortcut.WorkingDirectory = '%~dp0'; ^
  $shortcut.WindowStyle = 7; ^
  $shortcut.Description = 'FiFTO Broker Login Server'; ^
  $shortcut.Save()

if %errorlevel% equ 0 (
    echo [OK] Startup shortcut created successfully!
    echo.
    echo  FiFTO will now start automatically every time you log in to Windows.
    echo  To remove it later, delete "FiFTO-Server.lnk" from:
    echo    shell:startup
) else (
    echo [ERROR] Failed to create startup shortcut.
)

echo.
echo Tip: To start the server right now, double-click "start-hidden.vbs"
echo.
pause
