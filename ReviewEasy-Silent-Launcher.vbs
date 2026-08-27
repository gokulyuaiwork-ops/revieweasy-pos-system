Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir

' Check if standalone EXE exists, otherwise run node server via cmd.exe
If fso.FileExists(strScriptDir & "\dist\ReviewEasy-POS-Agent.exe") Then
    strCommand = """" & strScriptDir & "\dist\ReviewEasy-POS-Agent.exe"""
Else
    strCommand = "cmd.exe /c node src\server.js"
End If

' 0 = Hide window completely (Runs silently in background with ZERO terminal popup)
WshShell.Run strCommand, 0, False

Set WshShell = Nothing
Set fso = Nothing
