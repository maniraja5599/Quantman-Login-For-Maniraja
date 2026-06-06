Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\Projects\Quantman Login For Maniraja"
WshShell.Run "node server.js", 0, False
