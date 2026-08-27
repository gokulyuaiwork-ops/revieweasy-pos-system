Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir

batPath = strScriptDir & "\Run-Background-Service.bat"

' Run bat file via cmd.exe with hidden window (0) and async non-blocking (False)
WshShell.Run "cmd.exe /c """ & batPath & """", 0, False

Set WshShell = Nothing
Set fso = Nothing
