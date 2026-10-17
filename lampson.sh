#!/usr/bin/env bash
# lampson.sh — launcher unix. Cada proyecto es un WORKSPACE con su propio proceso; un hub en :8080 los sirve a todos.
#   cd /mi/proyecto && lampson            # terminal sobre este workspace
#   cd /mi/proyecto && lampson --web      # abre http://127.0.0.1:8080/w/<slug>/
#   lampson --hub start|stop|status|logs|restart · --install (systemd --user) · --uninstall
#   lampson --domain lampson.midominio.com --email vos@midominio.com   # HTTPS propio (opcional) · --domain off
#   lampson --pair [https://tu-dominio]                                # QR en la terminal para emparejar el celular
#   lampson --workspace /ruta [--agent plan] [--yolo|--strict|--ask] · --update
#   lampson run [--agent ID] [--thread T | --session ID] [--json] [--yolo|--strict|--ask] "mensaje"   # sin interfaz
#       (sin mensaje lo lee de stdin; --json = eventos JSONL; ver spec/engine.md y run.syn)
#   lampson run --stdio      # modo local: un proceso abierto, un pedido JSON por línea (lo usa el SDK)
#   lampson key add [--agent ID[,ID]] [--name NOMBRE] [--rate N] [--callback URL] · key list · key remove <id>   # API keys /v1
#   lampson mcp serve [--agent ID[,ID]] [--workspace RUTA]     # Lampson como servidor MCP (stdio) para otros agentes
#   lampson channel list · channel on|off <canal> · channel setup <canal>   # canales (Telegram, Chatwoot…)
#   lampson objective add "…" --agent ID | --team ID [--budget N] [--round S] · objective list · show <id> · reply <id> "…" [--approve|--deny] · cancel <id>   # objetivos
#   lampson team list                                         # equipos de agentes y quién reporta a quién
set -euo pipefail
# se lo llama por el symlink `lampson` (~/.local/bin): la carpeta es donde vive el script de verdad
here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
caller="$(pwd)"
ws=""; web=0; hub=""; install=""; domain="-"; email=""; pair_url="-"
run=0; msg=""; perm_flag=""; key=""; key_name=""; key_id=""; mcp_serve=""; ch_cmd=""; ch_name=""
obj_cmd=""; obj_id=""; obj_team=""; obj_budget=""; obj_round=""; obj_decision=""; team_cmd=""
# `lampson run …`: subcomando sin interfaz (run.syn); las palabras sueltas son el mensaje, no el workspace
if [ "${1:-}" = run ]; then run=1; shift; fi
# `lampson key add|list|remove …`: API keys (también corre run.syn, con LAMPSON_KEY_CMD)
# `lampson mcp serve …`: servidor MCP por stdio (run.syn con LAMPSON_MCP_SERVE)
if [ "${1:-}" = mcp ] && [ "${2:-}" = serve ]; then run=1; mcp_serve=1; shift 2; fi
# `lampson channel list|on|off|setup <canal>` (run.syn con LAMPSON_CHANNEL_CMD)
if [ "${1:-}" = channel ]; then run=1; ch_cmd="${2:-list}"; shift; [ $# -gt 0 ] && shift; fi
if [ "${1:-}" = key ]; then run=1; key="${2:-help}"; shift; [ $# -gt 0 ] && shift; fi
# `lampson objective add|list|show|reply|cancel` y `lampson team list` (run.syn con LAMPSON_OBJ_CMD / LAMPSON_TEAM_CMD)
if [ "${1:-}" = objective ]; then run=1; obj_cmd="${2:-list}"; shift; [ $# -gt 0 ] && shift; fi
if [ "${1:-}" = team ]; then run=1; team_cmd=list; shift; [ $# -gt 0 ] && shift; fi
while [ $# -gt 0 ]; do
    case "$1" in
        --web) web=1 ;;
        --hub|--daemon) shift; hub="${1:-status}" ;;
        --domain) if [ $# -gt 1 ] && [ "${2#-}" = "$2" ]; then shift; domain="$1"; else domain=""; fi ;;
        --pair) if [ $# -gt 1 ] && [ "${2#-}" = "$2" ]; then shift; pair_url="$1"; else pair_url=""; fi ;;
        --email) shift; email="${1:-}" ;;
        --install) install=install ;;
        --uninstall) install=uninstall ;;
        --workspace) shift; ws="$1" ;;
        --agent) shift; export LAMPSON_AGENT="$1" ;;
        --yolo|--dangerously-skip-permissions) export LAMPSON_PERMISSION=yolo; perm_flag=yolo ;;
        --strict) export LAMPSON_PERMISSION=strict; perm_flag=strict ;;
        --ask) export LAMPSON_PERMISSION=ask; perm_flag=ask ;;
        --thread) shift; export LAMPSON_THREAD="$1" ;;
        --session) shift; export LAMPSON_SESSION="$1" ;;
        --json) export LAMPSON_RUN_JSON=1 ;;
        --stdio) export LAMPSON_RUN_STDIO=1 ;;
        --name) shift; key_name="$1" ;;
        --rate) shift; export LAMPSON_KEY_RATE="$1" ;;
        --callback) shift; export LAMPSON_KEY_CALLBACKS="${LAMPSON_KEY_CALLBACKS:+$LAMPSON_KEY_CALLBACKS,}$1" ;;
        --team) shift; obj_team="$1" ;;
        --budget) shift; obj_budget="$1" ;;
        --round) shift; obj_round="$1" ;;
        --approve) obj_decision=approve ;;
        --deny) obj_decision=deny ;;
        --update) echo "actualizando Lampson en $here"; git -C "$here" pull --ff-only origin main; echo "lampson $(git -C "$here" rev-parse --short HEAD)"; exit $? ;;
        -*) echo "uso: lampson run [--agent ID] [--thread T|--session ID] [--json] [--yolo|--strict|--ask] [mensaje]" >&2; echo "uso: lampson [--web] [--hub start|stop|status|logs|restart] [--domain DOMINIO|off [--email EMAIL]] [--pair [URL]] [--install|--uninstall] [--workspace RUTA] [--agent PERFIL] [--yolo|--strict|--ask] [--update]" >&2; exit 1 ;;
        *) if [ -n "$obj_cmd" ] && [ -z "$obj_id" ] && { [ "$obj_cmd" = show ] || [ "$obj_cmd" = reply ] || [ "$obj_cmd" = cancel ]; }; then obj_id="$1"; elif [ -n "$obj_cmd" ]; then msg="${msg:+$msg }$1"; elif [ -n "$ch_cmd" ]; then ch_name="$1"; elif [ -n "$key" ]; then key_id="$1"; elif [ "$run" = 1 ]; then msg="${msg:+$msg }$1"; else ws="$1"; fi ;;
    esac
    shift
done
export LAMPSON_HOME="$here"
# motor mínimo: el hub y los workspaces declaran `trust proxy` (Synsema 0.6.42+; ver lib/origin.syn)
min_engine="0.6.42"
engine="$(synsema --version 2>/dev/null | sed 's/^[^0-9]*//')"
if [ -z "$engine" ] || [ "$(printf '%s\n%s\n' "$min_engine" "$engine" | sort -V | head -n1)" != "$min_engine" ]; then
    echo "lampson necesita synsema $min_engine o más nuevo (tenés '${engine:-ninguno}'): synsema update" >&2; exit 1
fi
# skills externas globales, montadas bajo .lampson/ (los workspaces las ven por .lampson/global)
mkdir -p "$here/.lampson"
for pair in "skills-global:$HOME/.agents/skills" "skills-claude:$HOME/.claude/skills"; do
    link="$here/.lampson/${pair%%:*}"; src="${pair#*:}"
    [ -e "$link" ] || { [ -d "$src" ] && ln -s "$src" "$link"; } || true
done
# 2026-09: las "lámparas" globales pasaron a llamarse plugins (plugins/). git renombra las del repo; las carpetas
# que vos pusiste en lamps/ se mueven una vez, y la carpeta vieja se borra solo si quedó vacía.
if [ -d "$here/lamps" ]; then
    mkdir -p "$here/plugins"
    for d in "$here"/lamps/*/; do [ -d "$d" ] || continue; n="$(basename "$d")"; [ -e "$here/plugins/$n" ] || { mv "$d" "$here/plugins/$n" && echo "lampson: lamps/$n → plugins/$n (las lámparas ahora son plugins)"; }; done
    rmdir "$here/lamps" 2>/dev/null || true
fi
cli() { # última línea = JSON
    local out; out="$(cd "$here" && LAMPSON_CMD="$1" LAMPSON_WORKSPACE="${2:-}" synsema run cli.syn)" || { echo "$out" >&2; exit 1; }
    echo "$out" | sed '$d' >&2 || true
    echo "$out" | tail -n 1
}
json() { node -e "const j=JSON.parse(process.argv[1]);const v=j[process.argv[2]];console.log(typeof v==='object'?JSON.stringify(v):v)" "$1" "$2" 2>/dev/null || python3 -c "import json,sys;print(json.loads(sys.argv[1])[sys.argv[2]])" "$1" "$2"; }
unit="$HOME/.config/systemd/user/lampson-hub.service"
# systemd no hereda el PATH de la sesión (~/.local/bin, donde se instala synsema, no está): sin estas dos líneas el hub
# arranca pero no puede encender ningún workspace ni los agentes encuentran node, git, claude…
write_unit() {
    mkdir -p "$(dirname "$unit")"
    cat > "$unit" <<EOF
[Unit]
Description=Lampson hub (workspaces, tareas programadas, proxy)
After=network.target
[Service]
WorkingDirectory=$here
Environment=LAMPSON_HOME=$here
Environment="LAMPSON_SYNSEMA=$(command -v synsema)"
Environment="PATH=$(dirname "$(command -v synsema)"):$PATH"
ExecStart=$(command -v synsema) serve hub.syn
Restart=always
RestartSec=3
TimeoutStopSec=20
[Install]
WantedBy=default.target
EOF
}
# una unit de antes de ese arreglo se reescribe sola (una vez) y el hub se reinicia con el PATH bueno
if [ "$install" = "" ] && [ -f "$unit" ] && ! grep -q LAMPSON_SYNSEMA "$unit"; then
    write_unit
    systemctl --user daemon-reload && systemctl --user restart lampson-hub.service && echo "lampson: servicio del hub actualizado (PATH del motor)" >&2 || true
fi
# dominio propio (opcional): HTTPS automático con Let's Encrypt delante del hub
if [ "$domain" != "-" ]; then
    (cd "$here" && LAMPSON_CMD=domain LAMPSON_DOMAIN="$domain" LAMPSON_EMAIL="$email" synsema run cli.syn | sed '$d')
    exit 0
fi
# emparejar un celular desde la terminal (VPS por SSH): lampson --pair [https://tu-dominio]
if [ "$pair_url" != "-" ]; then
    r="$(cd "$here" && LAMPSON_CMD=pair LAMPSON_PAIR_URL="$pair_url" synsema run cli.syn)" || { echo "$r" >&2; exit 1; }
    echo "$r" | sed '$d'
    r="$(echo "$r" | tail -n 1)"
    link="$(json "$r" link)"
    case "$link" in https://*|http://*) ;; *) exit 1 ;; esac
    secs="$(json "$r" expires_in)"
    echo ""
    echo "Apuntá la cámara del celular a este QR y tocá «Crear passkey» (vale $(( ${secs%.*} / 60 )) minutos, un solo uso):"
    echo ""
    if command -v node >/dev/null 2>&1; then node "$here/lib/tools/qr.js" "$link"; else echo "  (sin Node no puedo dibujar el QR: abrí el link de abajo en el celular)"; fi
    echo ""
    echo "  o abrí en el celular: $link"
    echo "  después entrás con la huella en $(json "$r" public_url)"
    exit 0
fi
if [ -n "$hub" ]; then
    case "$hub" in
        start) cli hub-start >/dev/null; echo "hub: http://127.0.0.1:8080" ;;
        stop) cli hub-stop >/dev/null; echo "hub y workspaces parados" ;;
        status) r="$(cli hub-status)"; echo "hub $( [ "$(json "$r" alive)" = "true" ] && echo '● vivo · http://127.0.0.1:8080' || echo '○ parado')"; (cd "$here" && LAMPSON_CMD=list synsema run cli.syn | sed '$d') ;;
        logs) [ -f "$here/.lampson/hub.log" ] && tail -n 40 "$here/.lampson/hub.log" || echo "sin log todavía" ;;
        restart) cli hub-stop >/dev/null; sleep 1; cli hub-start >/dev/null; echo "hub reiniciado" ;;
        *) echo "uso: lampson --hub start|stop|status|logs|restart" >&2; exit 1 ;;
    esac
    exit 0
fi
if [ "$install" = install ]; then
    write_unit
    (cd "$here" && LAMPSON_CMD=hub-stop synsema run cli.syn >/dev/null 2>&1 || true)
    systemctl --user daemon-reload && systemctl --user enable --now lampson-hub.service && echo "instalado: systemd --user lampson-hub.service (arranca con tu sesión; 'loginctl enable-linger $USER' para que viva sin sesión abierta)"
    exit 0
fi
if [ "$install" = uninstall ]; then systemctl --user disable --now lampson-hub.service || true; rm -f "$unit"; systemctl --user daemon-reload; echo "quitado"; exit 0; fi
# --- proyecto ---
[ -z "$ws" ] && [ "$caller" != "$here" ] && ws="$caller"
[ -n "$ws" ] || { echo "corré lampson desde la carpeta del proyecto, o --workspace /ruta (lampson --hub status lista los workspaces)" >&2; exit 1; }
[ -d "$ws" ] || { echo "el workspace no existe o no es un directorio: $ws" >&2; exit 1; }
ws="$(cd "$ws" && pwd -P)"
[ "$ws" = "$HOME" ] || [ "$ws" = "/" ] && { echo "'$ws' no es un proyecto" >&2; exit 1; }
# `run`, `key`, `channel` y `mcp serve` no necesitan servidor: solo la carpeta del workspace (sin hub)
r="$(cli "$([ "$run" = 1 ] && echo prepare || echo ensure)" "$ws")"
slug="$(json "$r" slug)"; port="$(json "$r" port)"; url="$(json "$r" url)"; dir="$(json "$r" dir)"
if [ "$web" = 1 ]; then
    echo "Lampson web · $url   (workspace $slug)"
    (xdg-open "$url" >/dev/null 2>&1 || open "$url" >/dev/null 2>&1 || true)
    exit 0
fi
cd "$here/$dir"
export LAMPSON_WORKSPACE="$ws" LAMPSON_WS="$slug" LAMPSON_PORT="$port"
# juez de computer use (⚙ → Computer use): el runtime lo lee del entorno al arrancar
jp="$(json "$r" judge_provider)"; jm="$(json "$r" judge_model)"; jk="$(json "$r" judge_key)"
[ -n "$jp" ] && export SYNSEMA_JUDGE_PROVIDER="$jp"
[ -n "$jm" ] && export SYNSEMA_JUDGE_MODEL="$jm"
[ -n "$jk" ] && export TYPESAFE_API_KEY="$jk"
entry=chat.syn
if [ "$run" = 1 ]; then
    # sin interfaz: los permisos los fija el flag, o el agente (run.syn: strict si el agente no dice nada)
    entry=run.syn; export LAMPSON_MESSAGE="$msg" LAMPSON_RUN_PERMISSION="$perm_flag"
    export LAMPSON_KEY_CMD="$key" LAMPSON_KEY_NAME="$key_name" LAMPSON_KEY_ID="$key_id" LAMPSON_KEY_AGENTS="${LAMPSON_AGENT:-}"
    export LAMPSON_CHANNEL_CMD="$ch_cmd" LAMPSON_CHANNEL_NAME="$ch_name"
    export LAMPSON_OBJ_CMD="$obj_cmd" LAMPSON_OBJ_ID="$obj_id" LAMPSON_OBJ_AGENT="$([ -n "$obj_cmd" ] && echo "${LAMPSON_AGENT:-}")" LAMPSON_OBJ_TEAM="$obj_team"
    export LAMPSON_OBJ_BUDGET="$obj_budget" LAMPSON_OBJ_ROUND="$obj_round" LAMPSON_OBJ_DECISION="$obj_decision" LAMPSON_TEAM_CMD="$team_cmd"
    export LAMPSON_MCP_SERVE="$mcp_serve" LAMPSON_MCP_AGENTS="$([ -n "$mcp_serve" ] && echo "${LAMPSON_AGENT:-}")"
fi
if [ -f "$here/.env" ]; then exec synsema run --env-file "$here/.env" "$entry"; else exec synsema run "$entry"; fi
