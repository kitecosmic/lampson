# lampson.ps1 — launcher Windows. Cada proyecto es un WORKSPACE con su propio proceso; un hub en :8080 los sirve a todos.
#
#   cd C:\mi\proyecto ; lampson                 # terminal sobre este workspace (lo registra y lo arranca si hace falta)
#   cd C:\mi\proyecto ; lampson --web           # abre http://127.0.0.1:8080/w/<slug>/ en el navegador
#   lampson --workspace C:\otro\proyecto        # elegir la carpeta explícitamente
#   lampson --hub start|stop|status|logs        # el servicio residente (workspaces + tareas programadas)
#   lampson --install | --uninstall             # arrancar el hub al iniciar sesión (Tarea Programada)
#   lampson --domain lampson.midominio.com --email vos@midominio.com   # HTTPS con tu dominio (opcional) · --domain off
#   lampson --pair [https://tu-dominio]                                # QR en la terminal para emparejar el celular
#   lampson --agent plan · --yolo|--strict|--ask · --update · --help
#   lampson run [--agent ID] [--thread T | --session ID] [--json] [--yolo|--strict|--ask] "mensaje"   # sin interfaz
#   lampson run --stdio      # modo local: un proceso abierto, un pedido JSON por línea (lo usa el SDK)
#   lampson key add [--agent ID[,ID]] [--name NOMBRE] [--rate N] [--callback URL] · key list · key remove <id>   # API keys /v1
#   lampson mcp serve [--agent ID[,ID]] [--workspace RUTA]     # Lampson como servidor MCP (stdio) para otros agentes
#   lampson channel list · channel on|off <canal> · channel setup <canal>   # canales (Telegram, Chatwoot…)
#   lampson plugin list · plugin on|off <nombre>              # encender plugins sin interfaz (VPS por SSH, scripts)
#   lampson objective add "…" --agent ID | --team ID [--budget N] [--round S] · objective list · show <id> · reply <id> "…" [--approve|--deny] · cancel <id>   # objetivos
#   lampson team list                                         # equipos de agentes y quién reporta a quién
#
# Cómo funciona (ver SPEC-WORKSPACES.md): .lampson\ws\<slug>\ es el cwd del proceso del workspace, con una junction
# `workspace` al proyecto y junctions a lib/public/skills/plugins/memory de esta instalación. El registro y los procesos
# los maneja lib/workspaces.syn vía cli.syn; este script solo resuelve la carpeta, llama a cli.syn y abre lo pedido.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$caller = (Get-Location).Path

# --- args: acepta --flag y -Flag, sin distinguir mayúsculas ---
$Workspace = ""; $Web = $false; $Agent = ""; $Perm = ""; $Hub = ""; $Install = ""; $Domain = $null; $Email = ""; $Pair = $null
$Run = $false; $Message = @(); $Thread = ""; $Session = ""; $Json = $false; $Key = ""; $KeyName = ""; $KeyId = ""; $McpServe = $false; $ChannelCmd = ""; $ChannelName = ""; $Stdio = $false; $KeyRate = ""; $KeyCallbacks = @(); $PluginCmd = ""; $PluginName = ""; $ObjCmd = ""; $ObjId = ""; $ObjTeam = ""; $ObjBudget = ""; $ObjRound = ""; $ObjDecision = ""; $TeamCmd = ""
$i = 0
# `lampson run …`: subcomando sin interfaz (run.syn, spec/engine.md); las palabras sueltas son el mensaje
if ($args.Count -gt 0 -and ([string]$args[0]).ToLower() -eq "run") { $Run = $true; $i = 1 }
# `lampson key add|list|remove …`: API keys (también corre run.syn, con LAMPSON_KEY_CMD)
# `lampson mcp serve …`: servidor MCP por stdio (run.syn con LAMPSON_MCP_SERVE)
if ($args.Count -gt 1 -and ([string]$args[0]).ToLower() -eq "mcp" -and ([string]$args[1]).ToLower() -eq "serve") { $Run = $true; $McpServe = $true; $i = 2 }
# `lampson channel list|on|off|setup <canal>` (run.syn con LAMPSON_CHANNEL_CMD)
# `lampson plugin list|on|off <nombre>` (run.syn con LAMPSON_PLUGIN_CMD)
if ($args.Count -gt 0 -and ([string]$args[0]).ToLower() -eq "plugin") { $Run = $true; $PluginCmd = $(if ($args.Count -gt 1) { ([string]$args[1]).ToLower() } else { "list" }); $i = 2 }
if ($args.Count -gt 0 -and ([string]$args[0]).ToLower() -eq "channel") { $Run = $true; $ChannelCmd = $(if ($args.Count -gt 1) { ([string]$args[1]).ToLower() } else { "list" }); $i = 2 }
# `lampson objective add|list|show|reply|cancel` y `lampson team list` (run.syn con LAMPSON_OBJ_CMD / LAMPSON_TEAM_CMD)
if ($args.Count -gt 0 -and ([string]$args[0]).ToLower() -eq "objective") { $Run = $true; $ObjCmd = $(if ($args.Count -gt 1) { ([string]$args[1]).ToLower() } else { "list" }); $i = 2 }
if ($args.Count -gt 0 -and ([string]$args[0]).ToLower() -eq "team") { $Run = $true; $TeamCmd = "list"; $i = $(if ($args.Count -gt 1) { 2 } else { 1 }) }
if ($args.Count -gt 0 -and ([string]$args[0]).ToLower() -eq "key") { $Run = $true; $Key = $(if ($args.Count -gt 1) { ([string]$args[1]).ToLower() } else { "help" }); $i = 2 }
while ($i -lt $args.Count) {
    $a = [string]$args[$i]
    switch -Regex ($a.ToLower()) {
        '^--?(web|w)$'          { $Web = $true }
        '^--?(hub|daemon|d)$'   { $i++; $Hub = if ($i -lt $args.Count) { ([string]$args[$i]).ToLower() } else { "status" } }
        '^--?domain$'           { if ($i + 1 -lt $args.Count -and -not ([string]$args[$i + 1]).StartsWith("-")) { $i++; $Domain = [string]$args[$i] } else { $Domain = "" } }
        '^--?email$'            { $i++; $Email = [string]$args[$i] }
        '^--?pair$'             { if ($i + 1 -lt $args.Count -and -not ([string]$args[$i + 1]).StartsWith("-")) { $i++; $Pair = [string]$args[$i] } else { $Pair = "" } }
        '^--?install$'          { $Install = "install" }
        '^--?uninstall$'        { $Install = "uninstall" }
        '^--?(workspace|ws)$'   { $i++; $Workspace = [string]$args[$i] }
        '^--?(agent|a)$'        { $i++; $Agent = [string]$args[$i] }
        '^--?(yolo|y|dangerously-skip-permissions)$' { $Perm = "yolo" }
        '^--?(strict|s)$'       { $Perm = "strict" }
        '^--?(ask)$'            { $Perm = "ask" }
        '^--?(permission|p)$'   { $i++; $Perm = ([string]$args[$i]).ToLower() }
        '^--?thread$'           { $i++; $Thread = [string]$args[$i] }
        '^--?session$'          { $i++; $Session = [string]$args[$i] }
        '^--?json$'             { $Json = $true }
        '^--?stdio$'            { $Stdio = $true }
        '^--?name$'             { $i++; $KeyName = [string]$args[$i] }
        '^--?rate$'             { $i++; $KeyRate = [string]$args[$i] }
        '^--?callback$'         { $i++; $KeyCallbacks += [string]$args[$i] }
        '^--?team$'             { $i++; $ObjTeam = [string]$args[$i] }
        '^--?budget$'           { $i++; $ObjBudget = [string]$args[$i] }
        '^--?round$'            { $i++; $ObjRound = [string]$args[$i] }
        '^--?approve$'          { $ObjDecision = "approve" }
        '^--?deny$'             { $ObjDecision = "deny" }
        '^--?(update|u)$'       { Write-Host "actualizando Lampson en $here"; git -C $here pull --ff-only origin main; Write-Host ("lampson " + (git -C $here rev-parse --short HEAD)); exit $LASTEXITCODE }
        '^--?(help|h|\?)$'      { Get-Content $PSCommandPath | Select-Object -Skip 1 -First 9 | ForEach-Object { $_.TrimStart('#',' ') }; exit 0 }
        default                 { if ($ObjCmd -ne "" -and $ObjId -eq "" -and @("show", "reply", "cancel") -contains $ObjCmd -and -not $a.StartsWith("-")) { $ObjId = $a } elseif ($ObjCmd -ne "" -and -not $a.StartsWith("-")) { $Message += $a } elseif ($ChannelCmd -ne "" -and -not $a.StartsWith("-")) { $ChannelName = $a } elseif ($PluginCmd -ne "" -and -not $a.StartsWith("-")) { $PluginName = $a } elseif ($Key -ne "" -and -not $a.StartsWith("-")) { $KeyId = $a } elseif ($Run -and -not $a.StartsWith("-")) { $Message += $a } elseif ($Workspace -eq "" -and -not $a.StartsWith("-")) { $Workspace = $a } else { Write-Error "argumento desconocido: $a (probá lampson --help)"; exit 1 } }
    }
    $i++
}

# motor mínimo: el hub y los workspaces declaran `trust proxy` (Synsema 0.6.42+; ver lib/origin.syn). Con uno viejo el
# hub ni arranca: mejor decirlo acá que dejar un 502
$MinEngine = [version]"0.6.42"
$engine = ((& synsema --version 2>$null) -replace '^\D*', '').Trim()
if (-not ($engine -as [version]) -or [version]$engine -lt $MinEngine) { Write-Error "lampson necesita synsema $MinEngine o más nuevo (tenés '$engine'): synsema update"; exit 1 }

# skills externas globales (npx skills add -g → ~/.agents/skills; Claude Code → ~/.claude/skills), montadas bajo .lampson\
# (una capability no puede apuntar a HOME); los workspaces las ven por su junction .lampson\global
$skillMounts = @{ "skills-global" = (Join-Path $HOME ".agents\skills"); "skills-claude" = (Join-Path $HOME ".claude\skills") }
New-Item -ItemType Directory -Force (Join-Path $here ".lampson") | Out-Null
foreach ($k in $skillMounts.Keys) {
    $link = Join-Path $here ".lampson\$k"; $src = $skillMounts[$k]
    if (-not (Test-Path -LiteralPath $link) -and (Test-Path -LiteralPath $src -PathType Container)) { New-Item -ItemType Junction -Path $link -Target $src | Out-Null }
}
# 2026-09: las "lámparas" globales pasaron a llamarse plugins (plugins\). git renombra las del repo; las carpetas que
# vos pusiste en lamps\ se mueven una vez, y la carpeta vieja se borra solo si quedó vacía.
$oldLamps = Join-Path $here "lamps"
if (Test-Path -LiteralPath $oldLamps -PathType Container) {
    $newPlugins = Join-Path $here "plugins"; New-Item -ItemType Directory -Force $newPlugins | Out-Null
    foreach ($d in Get-ChildItem -LiteralPath $oldLamps -Directory -Force) {
        if (-not (Test-Path -LiteralPath (Join-Path $newPlugins $d.Name))) { Move-Item -LiteralPath $d.FullName -Destination $newPlugins; Write-Host "lampson: lamps\$($d.Name) → plugins\$($d.Name) (las lámparas ahora son plugins)" }
    }
    if (-not (Get-ChildItem -LiteralPath $oldLamps -Force)) { Remove-Item -LiteralPath $oldLamps -Force }
}

function Invoke-Cli([string]$cmd, [string]$ws) {
    # cli.syn imprime la respuesta como la ÚLTIMA línea (JSON)
    $env:LAMPSON_CMD = $cmd; if ($ws -ne "") { $env:LAMPSON_WORKSPACE = $ws }
    $out = & synsema run cli.syn 2>&1
    if ($LASTEXITCODE -ne 0) { $out | ForEach-Object { Write-Host $_ }; throw "cli.syn falló ($cmd)" }
    $lines = @($out | ForEach-Object { [string]$_ })
    # en `lampson run` la salida es del programa que llama (JSONL): lo informativo va a stderr
    $lines | Select-Object -SkipLast 1 | ForEach-Object { if ($Run) { [Console]::Error.WriteLine($_) } else { Write-Host $_ } }
    return ($lines[-1] | ConvertFrom-Json)
}

# synsema escribe UTF-8; PowerShell decodifica lo que CAPTURA (Invoke-Cli) con la página de códigos de la consola
# (CP850 en Windows en español): «dirección» salía «direcci├│n». UTF-8 mientras corre el script, y se restaura al salir.
$prevOutEnc = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Push-Location $here
try {
    $env:LAMPSON_HOME = $here
    # --- dominio propio (opcional): lampson --domain [dominio|off] [--email vos@dominio] ---
    if ($null -ne $Domain) {
        $env:LAMPSON_DOMAIN = $Domain; $env:LAMPSON_EMAIL = $Email
        $r = Invoke-Cli "domain" ""
        exit 0
    }
    # --- emparejar un celular desde la terminal (VPS por SSH): lampson --pair [https://tu-dominio] ---
    if ($null -ne $Pair) {
        $env:LAMPSON_PAIR_URL = $Pair
        $r = Invoke-Cli "pair" ""
        if ($r.error) { exit 1 }
        $mins = [math]::Round([double]$r.expires_in / 60)
        Write-Host ""
        Write-Host "Apuntá la cámara del celular a este QR y tocá «Crear passkey» (vale $mins minutos, un solo uso):"
        Write-Host ""
        if (Get-Command node -ErrorAction SilentlyContinue) { node (Join-Path $here "lib\tools\qr.js") $r.link } else { Write-Host "  (sin Node no puedo dibujar el QR: abrí el link de abajo en el celular)" }
        Write-Host ""
        Write-Host ("  o abrí en el celular: " + $r.link)
        Write-Host ("  después entrás con la huella en " + $r.public_url)
        exit 0
    }
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
    # --- arranque al iniciar sesión: Tarea Programada; sin permiso para crearla, un .vbs en la carpeta Inicio ---
    $startupVbs = Join-Path ([Environment]::GetFolderPath("Startup")) "lampson-hub.vbs"
    if ($Install -eq "install") {
        $cmd = "cmd /c cd /d `"$here`" && set LAMPSON_HOME=$here&& synsema serve hub.syn > .lampson\hub.log 2>&1"
        $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        $out = schtasks /Create /F /TN "Lampson hub" /SC ONLOGON /TR $cmd 2>&1
        $ErrorActionPreference = $prev
        if ($LASTEXITCODE -eq 0) {
            Write-Host "instalado: el hub de Lampson arranca al iniciar sesión (Tarea Programada «Lampson hub»). Arrancándolo ahora…"
        } else {
            $q = $cmd.Replace('"', '""')
            $vbs = "' Lampson hub: lo arranca Windows al iniciar sesion. Quitar con: lampson --uninstall`r`nCreateObject(""WScript.Shell"").Run ""$q"", 0, False`r`n"
            try {
                [IO.File]::WriteAllText($startupVbs, $vbs, [Text.Encoding]::ASCII)
                Write-Host "instalado: el hub de Lampson arranca al iniciar sesión (carpeta Inicio: $startupVbs — la Tarea Programada pidió permisos de administrador). Arrancándolo ahora…"
            } catch {
                Write-Error ("no pude instalar el arranque: schtasks dijo «" + ($out -join " ") + "» y la carpeta Inicio falló: " + $_.Exception.Message); exit 1
            }
        }
        $null = Invoke-Cli "hub-start" ""
        exit 0
    }
    if ($Install -eq "uninstall") {
        $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        schtasks /Delete /F /TN "Lampson hub" 2>&1 | Out-Null
        $ErrorActionPreference = $prev
        if (Test-Path $startupVbs) { Remove-Item $startupVbs -Force }
        Write-Host "quitado el arranque al iniciar sesión (el hub sigue corriendo hasta lampson --hub stop)"; exit 0
    }

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
    # `run`, `key`, `channel` y `mcp serve` no necesitan servidor: solo la carpeta del workspace (sin hub)
    $r = Invoke-Cli $(if ($Run) { "prepare" } else { "ensure" }) $target
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
        # juez de computer use (⚙ → Computer use): el runtime lo lee del entorno al arrancar
        if ($r.judge_provider) { $env:SYNSEMA_JUDGE_PROVIDER = $r.judge_provider }
        if ($r.judge_model) { $env:SYNSEMA_JUDGE_MODEL = $r.judge_model }
        if ($r.judge_key) { $env:TYPESAFE_API_KEY = $r.judge_key }
        $envFile = Join-Path $here ".env"
        $entry = "chat.syn"
        if ($Run) {
            # sin interfaz: los permisos los fija el flag, o el agente (run.syn: strict si el agente no dice nada)
            $entry = "run.syn"
            $env:LAMPSON_MESSAGE = ($Message -join " "); $env:LAMPSON_RUN_PERMISSION = $Perm
            $env:LAMPSON_THREAD = $Thread; $env:LAMPSON_SESSION = $Session; $env:LAMPSON_RUN_JSON = $(if ($Json) { "1" } else { "" })
            $env:LAMPSON_KEY_CMD = $Key; $env:LAMPSON_KEY_NAME = $KeyName; $env:LAMPSON_KEY_ID = $KeyId; $env:LAMPSON_KEY_AGENTS = $Agent
            $env:LAMPSON_KEY_RATE = $KeyRate; $env:LAMPSON_KEY_CALLBACKS = ($KeyCallbacks -join ",")
            $env:LAMPSON_MCP_SERVE = $(if ($McpServe) { "1" } else { "" }); $env:LAMPSON_MCP_AGENTS = $(if ($McpServe) { $Agent } else { "" })
            $env:LAMPSON_CHANNEL_CMD = $ChannelCmd; $env:LAMPSON_CHANNEL_NAME = $ChannelName; $env:LAMPSON_PLUGIN_CMD = $PluginCmd; $env:LAMPSON_PLUGIN_NAME = $PluginName
            $env:LAMPSON_RUN_STDIO = $(if ($Stdio) { "1" } else { "" })
            $env:LAMPSON_OBJ_CMD = $ObjCmd; $env:LAMPSON_OBJ_ID = $ObjId; $env:LAMPSON_OBJ_AGENT = $(if ($ObjCmd -ne "") { $Agent } else { "" }); $env:LAMPSON_OBJ_TEAM = $ObjTeam
            $env:LAMPSON_OBJ_BUDGET = $ObjBudget; $env:LAMPSON_OBJ_ROUND = $ObjRound; $env:LAMPSON_OBJ_DECISION = $ObjDecision; $env:LAMPSON_TEAM_CMD = $TeamCmd
        }
        if (Test-Path -LiteralPath $envFile) { synsema run --env-file $envFile $entry } else { synsema run $entry }
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
        # `lampson` corre este script dentro de TU sesión de PowerShell: lo de `run`/`key` no debe quedar en el entorno
        # (un LAMPSON_SESSION que queda haría que el próximo `lampson` retome esa sesión sin pedirlo)
        if ($Run) { foreach ($v in "LAMPSON_MESSAGE","LAMPSON_RUN_PERMISSION","LAMPSON_THREAD","LAMPSON_SESSION","LAMPSON_RUN_JSON","LAMPSON_KEY_CMD","LAMPSON_KEY_NAME","LAMPSON_KEY_ID","LAMPSON_KEY_AGENTS","LAMPSON_MCP_SERVE","LAMPSON_MCP_AGENTS","LAMPSON_CHANNEL_CMD","LAMPSON_CHANNEL_NAME","LAMPSON_PLUGIN_CMD","LAMPSON_PLUGIN_NAME","LAMPSON_RUN_STDIO","LAMPSON_KEY_RATE","LAMPSON_KEY_CALLBACKS","LAMPSON_OBJ_CMD","LAMPSON_OBJ_ID","LAMPSON_OBJ_AGENT","LAMPSON_OBJ_TEAM","LAMPSON_OBJ_BUDGET","LAMPSON_OBJ_ROUND","LAMPSON_OBJ_DECISION","LAMPSON_TEAM_CMD") { Remove-Item "Env:$v" -ErrorAction SilentlyContinue } }
    }
} finally {
    Pop-Location
    try { [Console]::OutputEncoding = $prevOutEnc } catch {}
}
if ($Run) { exit $exitCode }
