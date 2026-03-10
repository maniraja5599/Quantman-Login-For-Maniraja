$ws = New-Object -ComObject WScript.Shell

$s1 = $ws.CreateShortcut("$env:USERPROFILE\Desktop\FiFTO - Start.lnk")
$s1.TargetPath = "$PSScriptRoot\START.bat"
$s1.WorkingDirectory = $PSScriptRoot
$s1.Description = "Start FiFTO Server and open dashboard"
$s1.Save()

$s2 = $ws.CreateShortcut("$env:USERPROFILE\Desktop\FiFTO - Run All.lnk")
$s2.TargetPath = "$PSScriptRoot\RUN-ALL.bat"
$s2.WorkingDirectory = $PSScriptRoot
$s2.Description = "Run all broker logins instantly"
$s2.Save()

Write-Host "Desktop shortcuts created!" -ForegroundColor Green
Write-Host "  - FiFTO - Start.lnk"
Write-Host "  - FiFTO - Run All.lnk"
