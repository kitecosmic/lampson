# proc.sh — consultas al sistema que Synsema no tiene nativas (puertos, línea de comando, matar un pid ajeno)
#
#   bash lib/tools/proc.sh ports        → "port pid name" por línea (>=1024, sin sistema)
#   bash lib/tools/proc.sh info <pid>   → línea de comando del proceso
#   bash lib/tools/proc.sh kill <pid>   → mata el árbol de un pid AJENO (huérfano de otra herramienta)
#
# Los procesos gestionados (start/stop/alive) ya NO pasan por acá: viven en un agente supervisor con
# proc_spawn / proc_close (lib/tools/proc.syn, v0.6.9: tree-kill nativo). 2026-08-27.
. "$(dirname "$0")/common.sh"
ACTION="$1"
case "$ACTION" in
    ports)
        if is_win; then
            # netstat + tasklist → "port pid name"
            tasklist //FO CSV //NH 2>/dev/null | awk -F'","' '{gsub(/"/,"",$1); gsub(/"/,"",$2); print $2" "$1}' > /tmp/lampson_tl.$$
            netstat -ano 2>/dev/null | awk '/LISTENING/ {n=split($2,a,":"); print a[n]" "$NF}' | sort -u -k1,1n | while read -r port pid; do
                name="$(awk -v p="$pid" '$1==p {print $2; exit}' /tmp/lampson_tl.$$)"
                echo "$port $pid ${name:-?}"
            done
            rm -f /tmp/lampson_tl.$$
        elif command -v ss >/dev/null 2>&1; then
            ss -ltnpH 2>/dev/null | awk '{n=split($4,a,":"); port=a[n]; name="?"; pid="?"; if (match($0,/users:\(\("[^"]+",pid=[0-9]+/)) { s=substr($0,RSTART,RLENGTH); gsub(/users:\(\("/,"",s); split(s,b,"\",pid="); name=b[1]; pid=b[2] } print port" "pid" "name}' | sort -u -k1,1n
        elif command -v lsof >/dev/null 2>&1; then
            lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {n=split($9,a,":"); print a[n]" "$2" "$1}' | sort -u -k1,1n
        fi
        ;;
    info)
        # línea de comando de un pid (para saber QUÉ escucha en un puerto)
        PID="$2"
        if is_win; then
            powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=$PID').CommandLine" 2>/dev/null | tr -d '\r'
        else
            ps -o args= -p "$PID" 2>/dev/null
        fi
        ;;
    kill)
        PID="$2"
        if is_win; then taskkill //T //F //PID "$PID" >/dev/null 2>&1; else kill_tree "$PID"; fi
        echo "killed $PID"
        ;;
esac
exit 0
