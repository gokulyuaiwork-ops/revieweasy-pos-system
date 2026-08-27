Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir

' Run node server in background with 0 (hidden window) and False (non-blocking)
strCommand = "cmd.exe /c cd /d """ & strScriptDir & """ && node src\server.js"
WshShell.Run strCommand, 0, False

Set WshShell = Nothing
Set fso = Nothing
