# tests/run.ps1 — corre los tests unitarios sobre un workspace DESCARTABLE.
#
#   .\tests\run.ps1
#
# Los tests de tools escriben y borran dentro de workspace/. Este script monta una carpeta temporal
# (con el marcador .lampson-test-workspace que unit.test.syn exige), corre `synsema test` y vuelve a
# montar el proyecto que estaba antes. Así los tests nunca tocan un proyecto real.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$mount = Join-Path $here "workspace"
$tmp = Join-Path ([IO.Path]::GetTempPath()) "lampson-test-workspace"

$previous = $null
if (Test-Path -LiteralPath $mount) {
    $item = Get-Item -LiteralPath $mount -Force
    if ($item.LinkType -ne "Junction") { Write-Error "./workspace existe y no es una junction; movelo antes de correr los tests"; exit 1 }
    $previous = $item.Target; if ($previous -is [array]) { $previous = $previous[0] }
    $item.Delete()
}
New-Item -ItemType Directory -Force $tmp | Out-Null
Get-ChildItem -LiteralPath $tmp -Force | Remove-Item -Recurse -Force
New-Item -ItemType File (Join-Path $tmp ".lampson-test-workspace") | Out-Null
New-Item -ItemType Junction -Path $mount -Target $tmp | Out-Null

Push-Location $here
try {
    $env:LAMPSON_WORKSPACE = $tmp
    synsema test unit.test.syn
    $code = $LASTEXITCODE
    # procesos gestionados: supervisor-agente + proc_spawn — corre con `run` (el swarm no existe bajo `test`)
    synsema run proc_test.syn
    if ($LASTEXITCODE -ne 0) { $code = 1 }
} finally {
    # residuos de los tests fuera del workspace: notas de memoria del slug de prueba y sesiones test-*
    Get-ChildItem -LiteralPath (Join-Path $here "memory") -Directory -Filter "lampson-test-workspace-*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $here ".lampson\sessions") -Filter "test-*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
    Get-ChildItem -LiteralPath (Join-Path $here ".lampson\proc") -Filter "t_demo.*" -ErrorAction SilentlyContinue | Remove-Item -Force
    Pop-Location
    (Get-Item -LiteralPath $mount -Force).Delete()
    if ($previous -and (Test-Path -LiteralPath $previous)) { New-Item -ItemType Junction -Path $mount -Target $previous | Out-Null }
}
exit $code
