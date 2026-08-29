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
    # los tests NUNCA usan .lampson/config.json (proveedor/key reales): solo .env y estas variables
    $prevNoCfg = $env:LAMPSON_NO_CONFIG; $env:LAMPSON_NO_CONFIG = "1"
    synsema test unit.test.syn
    $code = $LASTEXITCODE
    # procesos gestionados: supervisor-agente + proc_spawn — corre con `run` (el swarm no existe bajo `test`)
    synsema run proc_test.syn
    if ($LASTEXITCODE -ne 0) { $code = 1 }
    # editor de línea (lib/line.syn) manejado por un PTY real: menú de /, Tab, argumentos
    synsema run tty_test.syn
    if ($LASTEXITCODE -ne 0) { $code = 1 }
    # cliente MCP contra tests/mock_mcp.js (node)
    $env:LAMPSON_MCP_CONFIG = ".lampson/tmp/mcp_test.json"
    synsema run mcp_test.syn
    if ($LASTEXITCODE -ne 0) { $code = 1 }
    $env:LAMPSON_MCP_CONFIG = ""
    # cliente LSP contra tests/mock_lsp.js (node, framing Content-Length)
    $env:LAMPSON_LSP_CONFIG = ".lampson/tmp/lsp_test.json"
    synsema run lsp_test.syn
    if ($LASTEXITCODE -ne 0) { $code = 1 }
    $env:LAMPSON_LSP_CONFIG = ""
    # subagentes (delegate) contra el mock LLM: el script arranca el mock en :8765
    $saved = @{}; foreach ($k in "LAMPSON_PROVIDER","LAMPSON_WIRE","LAMPSON_BASE_URL","LAMPSON_API_KEY") { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
    $env:LAMPSON_PROVIDER = "openai"; $env:LAMPSON_WIRE = "openai"; $env:LAMPSON_BASE_URL = "http://127.0.0.1:8765/v1"; $env:LAMPSON_API_KEY = "x"
    synsema run agents_test.syn
    if ($LASTEXITCODE -ne 0) { $code = 1 }
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    $env:LAMPSON_NO_CONFIG = $prevNoCfg
} finally {
    # residuos de los tests fuera del workspace: notas de memoria del slug de prueba y sesiones test-*
    Get-ChildItem -LiteralPath (Join-Path $here "memory") -Directory -Filter "lampson-test-workspace-*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $here ".lampson\sessions") -Filter "test-*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
    Get-ChildItem -LiteralPath (Join-Path $here ".lampson\proc") -Filter "t_demo.*" -ErrorAction SilentlyContinue | Remove-Item -Force
    Get-ChildItem -LiteralPath (Join-Path $here ".lampson\agents") -Filter "explore-*" -ErrorAction SilentlyContinue | Remove-Item -Force
    Get-ChildItem -LiteralPath (Join-Path $here ".lampson\todo") -Filter "lampson-test-workspace-*" -ErrorAction SilentlyContinue | Remove-Item -Force
    Get-ChildItem -LiteralPath (Join-Path $here ".lampson\spill") -Filter "call-*" -ErrorAction SilentlyContinue | Remove-Item -Force
    Pop-Location
    (Get-Item -LiteralPath $mount -Force).Delete()
    if ($previous -and (Test-Path -LiteralPath $previous)) { New-Item -ItemType Junction -Path $mount -Target $previous | Out-Null }
}
exit $code
