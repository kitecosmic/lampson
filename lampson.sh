#!/usr/bin/env bash
# lampson.sh — launcher unix. Cada proyecto es un WORKSPACE con su propio proceso; un hub en :8080 los sirve a todos.
#   cd /mi/proyecto && lampson            # terminal sobre este workspace
#   cd /mi/proyecto && lampson --web      # abre http://127.0.0.1:8080/w/<slug>/
#   lampson --hub start|stop|status|logs|restart · --install (systemd --user) · --uninstall
#   lampson --workspace /ruta [--agent plan] [--yolo|--strict|--ask] · --update
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
caller="$(pwd)"
ws=""; web=0; hub=""; install=""
while [ $# -gt 0 ]; do
    case "$1" in
        --web) web=1 ;;
        --hub|--daemon) shift; hub="${1:-status}" ;;
        --install) install=install ;;
        --uninstall) install=uninstall ;;
        --workspace) shift; ws="$1" ;;
        --agent) shift; export LAMPSON_AGENT="$1" ;;
        --yolo|--dangerously-skip-permissions) export LAMPSON_PERMISSION=yolo ;;
        --strict) export LAMPSON_PERMISSION=strict ;;
        --ask) export LAMPSON_PERMISSION=ask ;;
        --update) echo "actualizando Lampson en $here"; git -C "$here" pull --ff-only origin main; echo "lampson $(git -C "$here" rev-parse --short HEAD)"; exit $? ;;
        -*) echo "uso: lampson [--web] [--hub start|stop|status|logs|restart] [--install|--uninstall] [--workspace RUTA] [--agent PERFIL] [--yolo|--strict|--ask] [--update]" >&2; exit 1 ;;
        *) ws="$1" ;;
    esac
    shift
done
export LAMPSON_HOME="$here"
# skills externas globales, montadas bajo .lampson/ (los workspaces las ven por .lampson/global)
mkdir -p "$here/.lampson"
for pair in "skills-global:$HOME/.agents/skills" "skills-claude:$HOME/.claude/skills"; do
    link="$here/.lampson/${pair%%:*}"; src="${pair#*:}"
    [ -e "$link" ] || { [ -d "$src" ] && ln -s "$src" "$link"; } || true
done
cli() { # última línea = JSON
    local out; out="$(cd "$here" && LAMPSON_CMD="$1" LAMPSON_WORKSPACE="${2:-}" synsema run cli.syn)" || { echo "$out" >&2; exit 1; }
    echo "$out" | sed '$d' >&2 || true
    echo "$out" | tail -n 1
}
json() { node -e "const j=JSON.parse(process.argv[1]);const v=j[process.argv[2]];console.log(typeof v==='object'?JSON.stringify(v):v)" "$1" "$2" 2>/dev/null || python3 -c "import json,sys;print(json.loads(sys.argv[1])[sys.argv[2]])" "$1" "$2"; }
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
    unit="$HOME/.config/systemd/user/lampson-hub.service"; mkdir -p "$(dirname "$unit")"
    cat > "$unit" <<EOF
[Unit]
Description=Lampson hub (workspaces, tareas programadas, proxy)
After=network.target
[Service]
WorkingDirectory=$here
Environment=LAMPSON_HOME=$here
ExecStart=$(command -v synsema) serve hub.syn
Restart=always
RestartSec=3
TimeoutStopSec=20
[Install]
WantedBy=default.target
EOF
    (cd "$here" && LAMPSON_CMD=hub-stop synsema run cli.syn >/dev/null 2>&1 || true)
    systemctl --user daemon-reload && systemctl --user enable --now lampson-hub.service && echo "instalado: systemd --user lampson-hub.service (arranca con tu sesión; 'loginctl enable-linger $USER' para que viva sin sesión abierta)"
    exit 0
fi
if [ "$install" = uninstall ]; then systemctl --user disable --now lampson-hub.service || true; rm -f "$HOME/.config/systemd/user/lampson-hub.service"; systemctl --user daemon-reload; echo "quitado"; exit 0; fi
# --- proyecto ---
[ -z "$ws" ] && [ "$caller" != "$here" ] && ws="$caller"
[ -n "$ws" ] || { echo "corré lampson desde la carpeta del proyecto, o --workspace /ruta (lampson --hub status lista los workspaces)" >&2; exit 1; }
[ -d "$ws" ] || { echo "el workspace no existe o no es un directorio: $ws" >&2; exit 1; }
ws="$(cd "$ws" && pwd -P)"
[ "$ws" = "$HOME" ] || [ "$ws" = "/" ] && { echo "'$ws' no es un proyecto" >&2; exit 1; }
r="$(cli ensure "$ws")"
slug="$(json "$r" slug)"; port="$(json "$r" port)"; url="$(json "$r" url)"; dir="$(json "$r" dir)"
if [ "$web" = 1 ]; then
    echo "Lampson web · $url   (workspace $slug)"
    (xdg-open "$url" >/dev/null 2>&1 || open "$url" >/dev/null 2>&1 || true)
    exit 0
fi
cd "$here/$dir"
export LAMPSON_WORKSPACE="$ws" LAMPSON_WS="$slug" LAMPSON_PORT="$port"
if [ -f "$here/.env" ]; then exec synsema run --env-file "$here/.env" chat.syn; else exec synsema run chat.syn; fi
