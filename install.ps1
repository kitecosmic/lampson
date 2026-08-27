# install.ps1 — agrega el directorio de lampson al PATH del usuario (una sola vez).
# Después: abrir una terminal nueva, `cd` a cualquier repo y escribir `lampson` o `lampson -Web`.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -contains $here) {
    Write-Host "ya estaba en el PATH: $here"
} else {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$here", "User")
    Write-Host "agregado al PATH del usuario: $here"
}
$env:Path = "$env:Path;$here"
Write-Host "probá en una terminal NUEVA:  cd C:\algun\repo ; lampson"
