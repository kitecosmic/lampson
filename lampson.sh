#!/usr/bin/env bash
# lampson.sh — launcher unix. El directorio ACTUAL es el workspace (o --workspace /ruta).
#   cd /mi/proyecto && lampson            # REPL   (con lampson/ en el PATH)
#   cd /mi/proyecto && lampson --web      # servidor web en http://127.0.0.1:8080
#   lampson --workspace /otro/proyecto [--web] [--agent plan]
#   lampson --daemon start|stop|status|logs|restart   # proceso residente (web + tareas programadas + aprobaciones)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
caller="$(pwd)"
ws=""; web=0; daemon=""
while [ $# -gt 0 ]; do
    case "$1" in
        --web) web=1 ;;
        --daemon) shift; daemon="${1:-status}" ;;
        --workspace) shift; ws="$1" ;;
        --agent) shift; export LAMPSON_AGENT="$1" ;;
        --yolo|--dangerously-skip-permissions) export LAMPSON_PERMISSION=yolo ;;
        --strict) export LAMPSON_PERMISSION=strict ;;
        --ask) export LAMPSON_PERMISSION=ask ;;
        --update) echo "actualizando Lampson en $here"; git -C "$here" pull --ff-only origin main; echo "lampson $(git -C "$here" rev-parse --short HEAD)"; exit $? ;;
        *) echo "uso: lampson [--web] [--daemon start|stop|status|logs|restart] [--workspace RUTA] [--agent PERFIL] [--yolo|--strict|--ask] [--update]" >&2; exit 1 ;;
    esac
    shift
done
[ -z "$ws" ] && [ "$caller" != "$here" ] && ws="$caller"
if [ -n "$ws" ]; then
    [ -d "$ws" ] || { echo "el workspace no existe o no es un directorio: $ws" >&2; exit 1; }
    ws="$(cd "$ws" && pwd)"
    if [ -e "$here/workspace" ] && [ ! -L "$here/workspace" ]; then echo "./workspace existe y no es un symlink" >&2; exit 1; fi
    # un daemon/web corriendo sobre OTRO proyecto (latido reciente del scheduler) quedaría apuntando a este: aviso
    if [ -L "$here/workspace" ] && [ -f "$here/.lampson/schedules.heartbeat" ]; then
        prev="$(readlink -f "$here/workspace")"
        if [ "$prev" != "$ws" ] && [ $(( $(date +%s) - $(stat -c %Y "$here/.lampson/schedules.heartbeat") )) -lt 90 ]; then
            echo "AVISO: hay un lampson (web/daemon) corriendo sobre $prev; al montar $ws sus tareas programadas quedan en pausa. Paralo o reinicialo desde su carpeta: lampson --daemon restart" >&2
        fi
    fi
    rm -f "$here/workspace"; ln -s "$ws" "$here/workspace"
elif [ ! -e "$here/workspace" ]; then
    echo "no hay workspace: corré lampson desde el directorio del proyecto, o --workspace /ruta" >&2; exit 1
fi
export LAMPSON_WORKSPACE="$(readlink -f "$here/workspace")"
# skills externas globales (npx skills add -g → ~/.agents/skills; Claude Code → ~/.claude/skills), montadas bajo .lampson/
mkdir -p "$here/.lampson"
for pair in "skills-global:$HOME/.agents/skills" "skills-claude:$HOME/.claude/skills"; do
    link="$here/.lampson/${pair%%:*}"; src="${pair#*:}"
    [ -L "$link" ] && rm -f "$link"
    [ -d "$src" ] && ln -s "$src" "$link"
done
echo "workspace -> $LAMPSON_WORKSPACE"
cd "$here"
if [ -n "$daemon" ]; then
    # proceso residente en background (synsema daemon: sin arranque al boot ni reinicio; para producción, systemd
    # con `synsema serve web.syn`). Ejecuta las tareas programadas y atiende aprobaciones por link.
    case "$daemon" in start|stop|status|logs|restart) ;; *) echo "uso: lampson --daemon start|stop|status|logs|restart" >&2; exit 1 ;; esac
    exec synsema daemon "$daemon" web.syn
elif [ "$web" = 1 ]; then echo "web: http://127.0.0.1:8080"; exec synsema serve web.syn; else exec synsema run chat.syn; fi
