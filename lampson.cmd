@echo off
rem lampson.cmd — shim para usar `lampson` desde cualquier carpeta (cmd o PowerShell) una vez en el PATH.
rem El directorio actual pasa a ser el workspace (ver lampson.ps1).
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0lampson.ps1" %*
