# proc.sh — procesos de larga duración gestionados por lampson (servidores, watchers)
#
#   bash lib/tools/proc.sh start <logfile> <pidfile>   (env: LAMPSON_CMD, LAMPSON_WS)
#   bash lib/tools/proc.sh alive <pidfile>             → yes | no
#   bash lib/tools/proc.sh stop  <pidfile>
#   bash lib/tools/proc.sh ports                       → "port pid name" por línea (>=1024, sin sistema)
#   bash lib/tools/proc.sh info <pid>                  → línea de comando del proceso
#
# start cierra stdout/stderr/stdin ANTES de lanzar (Windows hereda handles: si no, el pipe de Synsema
# queda abierto y run() se cuelga), lanza el comando con su salida en <logfile> y guarda "PID|stamp".
. "$(dirname "$0")/common.sh"
ACTION="$1"
case "$ACTION" in
    start)
        LOG="$(abs "$2")"; PIDF="$(abs "$3")"
        exec > /dev/null 2>&1 < /dev/null
        cd "${LAMPSON_WS:-workspace}" || exit 0
        if is_win || ! command -v setsid >/dev/null 2>&1; then
            bash -c "$LAMPSON_CMD" > "$LOG" 2>&1 < /dev/null &
        else
            setsid bash -c "$LAMPSON_CMD" > "$LOG" 2>&1 < /dev/null &
        fi
        PID=$!
        sleep 0.2
        echo "$PID|$(proc_stamp "$PID")" > "$PIDF"
        ;;
    alive)
        IFS='|' read -r PID STAMP < "$(abs "$2")" 2>/dev/null
        if pid_alive "$PID" "$STAMP"; then echo yes; else echo no; fi
        ;;
    stop)
        PIDF="$(abs "$2")"; IFS='|' read -r PID STAMP < "$PIDF" 2>/dev/null
        if pid_alive "$PID" "$STAMP"; then
            kill_tree "$PID"
            is_win || kill -9 -- "-$PID" 2>/dev/null   # grupo de sesión (setsid) en unix
        fi
        echo stopped
        ;;
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
