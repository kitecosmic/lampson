# lampson.ps1 — launcher Windows. Monta el proyecto como ./workspace (junction) y arranca.
#
#   cd C:\mi\proyecto ; lampson                 # el directorio ACTUAL es el workspace (REPL)
#   cd C:\mi\proyecto ; lampson --web           # servidor web en http://127.0.0.1:8080  (también -Web)
#   lampson --workspace C:\otro\proyecto        # elegir la ubicación explícitamente     (también -Workspace)
#   lampson --agent plan                        # perfil inicial: build | plan | review | explore
#   lampson --yolo | --strict | --ask            # permisos para comandos peligrosos (--dangerously-skip-permissions = --yolo)
#   lampson --daemon start|stop|status|logs|restart   # proceso residente (web + tareas programadas + aprobaciones)
#   lampson --update                            # actualizar Lampson (git pull) y salir
#   lampson --help
#
# Por qué una junction: el scope file("./*") de Synsema v0.6.7 equivale a "*" (disco entero); el scope
# file("workspace/*") sí confina. Montar el proyecto bajo un nombre literal es lo que hace real el
# least-privilege de las tools (mismo modelo mental que `docker -v proyecto:/workspace`).
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$caller = (Get-Location).Path
$mount = Join-Path $here "workspace"

# --- args: acepta --flag y -Flag, sin distinguir mayúsculas ---
$Workspace = ""; $Web = $false; $Agent = ""; $Perm = ""; $Daemon = ""
$i = 0
while ($i -lt $args.Count) {
    $a = [string]$args[$i]
    switch -Regex ($a.ToLower()) {
        '^--?(web|w)$'          { $Web = $true }
        '^--?(daemon|d)$'       { $i++; $Daemon = if ($i -lt $args.Count) { ([string]$args[$i]).ToLower() } else { "status" } }
        '^--?(workspace|ws)$'   { $i++; $Workspace = [string]$args[$i] }
        '^--?(agent|a)$'        { $i++; $Agent = [string]$args[$i] }
        '^--?(yolo|y|dangerously-skip-permissions)$' { $Perm = "yolo" }
        '^--?(strict|s)$'       { $Perm = "strict" }
        '^--?(ask)$'            { $Perm = "ask" }
        '^--?(permission|p)$'   { $i++; $Perm = ([string]$args[$i]).ToLower() }
        '^--?(update|u)$'       { Write-Host "actualizando Lampson en $here"; git -C $here pull --ff-only origin main; Write-Host ("lampson " + (git -C $here rev-parse --short HEAD)); exit $LASTEXITCODE }
        '^--?(help|h|\?)$'      { Get-Content $PSCommandPath | Select-Object -Skip 1 -First 10 | ForEach-Object { $_.TrimStart('#',' ') }; exit 0 }
        default                 { if ($Workspace -eq "" -and -not $a.StartsWith("-")) { $Workspace = $a } else { Write-Error "argumento desconocido: $a (probá lampson --help)"; exit 1 } }
    }
    $i++
}

# --- resolver el proyecto: explícito > directorio actual (si no es el propio lampson) > montado previo ---
if ($Workspace -eq "" -and $caller -ne $here) { $Workspace = $caller }
if ($Workspace -ne "") {
    if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { Write-Error "el workspace no existe o no es un directorio: $Workspace"; exit 1 }
    $target = (Resolve-Path -LiteralPath $Workspace).Path
    $home_ = [Environment]::GetFolderPath("UserProfile")
    if ($target.TrimEnd('\') -eq $home_.TrimEnd('\') -or $target -match '^[A-Za-z]:\\?$') {
        Write-Error "'$target' es tu carpeta personal / la raíz del disco, no un proyecto. Entrá al repo (cd) y volvé a correr lampson, o usá --workspace C:\ruta\al\proyecto"; exit 1
    }
    if ($target -eq $here) { Write-Error "no montes el propio directorio de lampson como workspace desde fuera; usá --workspace"; exit 1 }
    if (Test-Path -LiteralPath $mount) {
        $item = Get-Item -LiteralPath $mount -Force
        if ($item.LinkType -ne "Junction") { Write-Error "./workspace existe y no es una junction; movelo antes de montar otro proyecto"; exit 1 }
        # un daemon/web corriendo sobre OTRO proyecto (latido reciente del scheduler) quedaría apuntando a este: aviso
        $prev = $item.Target; if ($prev -is [array]) { $prev = $prev[0] }
        $hb = Join-Path $here ".lampson\schedules.heartbeat"
        if ($prev -and $prev.TrimEnd('\').ToLower() -ne $target.TrimEnd('\').ToLower() -and (Test-Path -LiteralPath $hb) -and ((Get-Date) - (Get-Item -LiteralPath $hb).LastWriteTime).TotalSeconds -lt 90) {
            Write-Host "AVISO: hay un lampson (web/daemon) corriendo sobre $prev; al montar $target sus tareas programadas quedan en pausa. Paralo o reinicialo desde su carpeta: lampson --daemon restart" -ForegroundColor Yellow
        }
        $item.Delete()
    }
    New-Item -ItemType Junction -Path $mount -Target $target | Out-Null
} elseif (-not (Test-Path -LiteralPath $mount)) {
    Write-Error "no hay workspace: corré lampson desde el directorio del proyecto, o lampson --workspace C:\ruta"; exit 1
}
$target = (Get-Item -LiteralPath $mount -Force).Target
if ($target -is [array]) { $target = $target[0] }

# --- skills externas globales (npx skills add -g → ~/.agents/skills; las de Claude Code → ~/.claude/skills) ---
# Se montan como junction bajo .lampson/ porque una capability no puede apuntar a una ruta dinámica (HOME).
$skillMounts = @{ "skills-global" = (Join-Path $HOME ".agents\skills"); "skills-claude" = (Join-Path $HOME ".claude\skills") }
New-Item -ItemType Directory -Force (Join-Path $here ".lampson") | Out-Null
foreach ($k in $skillMounts.Keys) {
    $link = Join-Path $here ".lampson\$k"; $src = $skillMounts[$k]
    if (Test-Path -LiteralPath $link) { $li = Get-Item -LiteralPath $link -Force; if ($li.LinkType -eq "Junction") { $li.Delete() } }
    if (Test-Path -LiteralPath $src -PathType Container) { New-Item -ItemType Junction -Path $link -Target $src | Out-Null }
}

# --- arrancar desde el directorio de lampson (ahí viven .env, lib/, skills/, .lampson/) ---
# Push/Pop: si PowerShell ejecuta este .ps1 en la shell del usuario (pasa cuando lampson.ps1 y lampson.cmd
# comparten nombre en el PATH), el cwd del usuario debe quedar como estaba al salir.
Push-Location $here
try {
    $env:LAMPSON_WORKSPACE = $target
    if ($Agent -ne "") { $env:LAMPSON_AGENT = $Agent }
    if ($Perm -ne "") { $env:LAMPSON_PERMISSION = $Perm }
    if ($Daemon -ne "") {
        # proceso residente: web.syn en background (synsema daemon, sin config del sistema; para producción,
        # systemd/NSSM con `synsema serve web.syn`). Ejecuta las tareas programadas y atiende aprobaciones por link.
        if ($Daemon -notmatch '^(start|stop|status|logs|restart)$') { Write-Error "uso: lampson --daemon start|stop|status|logs|restart"; exit 1 }
        if ($Daemon -eq "start" -or $Daemon -eq "restart") { Write-Host "Lampson daemon · workspace: $target · http://127.0.0.1:8080" }
        synsema daemon $Daemon web.syn
    } elseif ($Web) {
        Write-Host "Lampson web · workspace: $target"
        Write-Host "abrí http://127.0.0.1:8080   (Ctrl+C para parar)"
        synsema serve web.syn
    } else {
        synsema run chat.syn
    }
} finally {
    Pop-Location
}
