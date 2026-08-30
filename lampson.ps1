# lampson.ps1 — launcher Windows. Cada proyecto es un WORKSPACE con su propio proceso; un hub en :8080 los sirve a todos.
#
#   cd C:\mi\proyecto ; lampson                 # terminal sobre este workspace (lo registra y lo arranca si hace falta)
#   cd C:\mi\proyecto ; lampson --web           # abre http://127.0.0.1:8080/w/<slug>/ en el navegador
#   lampson --workspace C:\otro\proyecto        # elegir la carpeta explícitamente
#   lampson --hub start|stop|status|logs        # el servicio residente (workspaces + tareas programadas)
#   lampson --install | --uninstall             # arrancar el hub al iniciar sesión (Tarea Programada)
#   lampson --agent plan · --yolo|--strict|--ask · --update · --help
#
# Cómo funciona (ver SPEC-WORKSPACES.md): .lampson\ws\<slug>\ es el cwd del proceso del workspace, con una junction
# `workspace` al proyecto y junctions a lib/public/skills/lamps/memory de esta instalación. El registro y los procesos
# los maneja lib/workspaces.syn vía cli.syn; este script solo resuelve la carpeta, llama a cli.syn y abre lo pedido.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$caller = (Get-Location).Path

# --- args: acepta --flag y -Flag, sin distinguir mayúsculas ---
$Workspace = ""; $Web = $false; $Agent = ""; $Perm = ""; $Hub = ""; $Install = ""
$i = 0
while ($i -lt $args.Count) {
    $a = [string]$args[$i]
    switch -Regex ($a.ToLower()) {
        '^--?(web|w)$'          { $Web = $true }
        '^--?(hub|daemon|d)$'   { $i++; $Hub = if ($i -lt $args.Count) { ([string]$args[$i]).ToLower() } else { "status" } }
        '^--?install$'          { $Install = "install" }
        '^--?uninstall$'        { $Install = "uninstall" }
        '^--?(workspace|ws)$'   { $i++; $Workspace = [string]$args[$i] }
        '^--?(agent|a)$'        { $i++; $Agent = [string]$args[$i] }
        '^--?(yolo|y|dangerously-skip-permissions)$' { $Perm = "yolo" }
        '^--?(strict|s)$'       { $Perm = "strict" }
        '^--?(ask)$'            { $Perm = "ask" }
        '^--?(permission|p)$'   { $i++; $Perm = ([string]$args[$i]).ToLower() }
        '^--?(update|u)$'       { Write-Host "actualizando Lampson en $here"; git -C $here pull --ff-only origin main; Write-Host ("lampson " + (git -C $here rev-parse --short HEAD)); exit $LASTEXITCODE }
        '^--?(help|h|\?)$'      { Get-Content $PSCommandPath | Select-Object -Skip 1 -First 8 | ForEach-Object { $_.TrimStart('#',' ') }; exit 0 }
        default                 { if ($Workspace -eq "" -and -not $a.StartsWith("-")) { $Workspace = $a } else { Write-Error "argumento desconocido: $a (probá lampson --help)"; exit 1 } }
    }
    $i++
}

# skills externas globales (npx skills add -g → ~/.agents/skills; Claude Code → ~/.claude/skills), montadas bajo .lampson\
# (una capability no puede apuntar a HOME); los workspaces las ven por su junction .lampson\global
$skillMounts = @{ "skills-global" = (Join-Path $HOME ".agents\skills"); "skills-claude" = (Join-Path $HOME ".claude\skills") }
New-Item -ItemType Directory -Force (Join-Path $here ".lampson") | Out-Null
foreach ($k in $skillMounts.Keys) {
    $link = Join-Path $here ".lampson\$k"; $src = $skillMounts[$k]
    if (-not (Test-Path -LiteralPath $link) -and (Test-Path -LiteralPath $src -PathType Container)) { New-Item -ItemType Junction -Path $link -Target $src | Out-Null }
}

function Invoke-Cli([string]$cmd, [string]$ws) {
    # cli.syn imprime la respuesta como la ÚLTIMA línea (JSON)
    $env:LAMPSON_CMD = $cmd; if ($ws -ne "") { $env:LAMPSON_WORKSPACE = $ws }
    $out = & synsema run cli.syn 2>&1
    if ($LASTEXITCODE -ne 0) { $out | ForEach-Object { Write-Host $_ }; throw "cli.syn falló ($cmd)" }
    $lines = @($out | ForEach-Object { [string]$_ })
    $lines | Select-Object -SkipLast 1 | ForEach-Object { Write-Host $_ }
    return ($lines[-1] | ConvertFrom-Json)
}

Push-Location $here
try {
    $env:LAMPSON_HOME = $here
    # --- hub / servicio ---
    if ($Hub -ne "") {
        switch ($Hub) {
            "start"   { $r = Invoke-Cli "hub-start" ""; Write-Host "hub: http://127.0.0.1:8080" }
            "stop"    { $r = Invoke-Cli "hub-stop" ""; Write-Host "hub y workspaces parados" }
            "status"  { $r = Invoke-Cli "hub-status" ""; Write-Host ("hub " + $(if ($r.alive) { "● vivo · http://127.0.0.1:8080" } else { "○ parado" })); foreach ($w in $r.workspaces) { Write-Host ("  " + $(if ($w.alive) { "●" } else { "○" }) + " " + $w.name + "  " + $w.path + "  " + $w.policy) } }
            "logs"    { if (Test-Path ".lampson\hub.log") { Get-Content ".lampson\hub.log" -Tail 40 } else { Write-Host "sin log todavía" } }
            "restart" { $null = Invoke-Cli "hub-stop" ""; Start-Sleep 1; $null = Invoke-Cli "hub-start" ""; Write-Host "hub reiniciado" }
            default   { Write-Error "uso: lampson --hub start|stop|status|logs|restart"; exit 1 }
        }
        exit 0
    }
    # --- arranque al iniciar sesión: Tarea Programada que corre el hub (synsema daemon, --watch) ---
    if ($Install -eq "install") {
        $cmd = "cmd /c cd /d `"$here`" && set LAMPSON_HOME=$here && synsema serve hub.syn > .lampson\hub.log 2>&1"
        schtasks /Create /F /TN "Lampson hub" /SC ONLOGON /TR $cmd | Out-Null
        Write-Host "instalado: el hub de Lampson arranca al iniciar sesión (Tarea Programada «Lampson hub»). Arrancándolo ahora…"
        $null = Invoke-Cli "hub-start" ""
        exit 0
    }
    if ($Install -eq "uninstall") { schtasks /Delete /F /TN "Lampson hub" | Out-Null; Write-Host "quitado el arranque al iniciar sesión (el hub sigue corriendo hasta lampson --hub stop)"; exit 0 }

    # --- resolver el proyecto: explícito > directorio actual (si no es el propio lampson) ---
    if ($Workspace -eq "" -and $caller -ne $here) { $Workspace = $caller }
    if ($Workspace -eq "") { Write-Error "corré lampson desde la carpeta del proyecto, o lampson --workspace C:\ruta (lampson --hub status lista los workspaces)"; exit 1 }
    if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { Write-Error "el workspace no existe o no es un directorio: $Workspace"; exit 1 }
    $target = (Resolve-Path -LiteralPath $Workspace).Path
    $home_ = [Environment]::GetFolderPath("UserProfile")
    if ($target.TrimEnd('\') -eq $home_.TrimEnd('\') -or $target -match '^[A-Za-z]:\\?$') {
        Write-Error "'$target' es tu carpeta personal / la raíz del disco, no un proyecto. Entrá al repo (cd) y volvé a correr lampson, o usá --workspace C:\ruta\al\proyecto"; exit 1
    }
    if ($target -eq $here) { Write-Error "no montes el propio directorio de lampson como workspace"; exit 1 }

    # registrar/preparar el workspace y asegurar hub + proceso
    $r = Invoke-Cli "ensure" $target
    $wsDir = Join-Path $here ($r.dir -replace '/', '\')
    if ($Web) {
        Write-Host ("Lampson web · " + $r.url + "   (workspace " + $r.slug + $(if ($r.alive) { " ● vivo" } else { " ○ arrancando" }) + ")")
        Start-Process $r.url
        exit 0
    }
    # terminal: chat.syn dentro del directorio del workspace (misma junction `workspace` que el proceso web)
    Push-Location $wsDir
    try {
        $env:LAMPSON_WORKSPACE = $target; $env:LAMPSON_WS = $r.slug; $env:LAMPSON_PORT = [string]$r.port
        if ($Agent -ne "") { $env:LAMPSON_AGENT = $Agent }
        if ($Perm -ne "") { $env:LAMPSON_PERMISSION = $Perm }
        $envFile = Join-Path $here ".env"
        if (Test-Path -LiteralPath $envFile) { synsema run --env-file $envFile chat.syn } else { synsema run chat.syn }
    } finally { Pop-Location }
} finally {
    Pop-Location
}
