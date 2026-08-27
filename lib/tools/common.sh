# common.sh — helpers de shell compartidos por bash_wrapper.sh y proc.sh (Windows/Git Bash, Linux, macOS)
#
# Windows (MSYS/Git Bash): el árbol de procesos de MSYS no coincide con el de Windows y taskkill /T no
# lo ve, así que se recorre PPID→PID con `ps` (columna WINPID) y se mata cada uno con taskkill.
# Linux/macOS: `pgrep -P` para descender y kill -9. (Probado en Windows; unix escrito con cuidado, sin probar.)
is_win() { case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

kill_tree() {
    local root="$1" k
    if is_win; then
        for k in $(ps 2>/dev/null | awk -v p="$root" 'NR>1 && $2==p {print $1}'); do kill_tree "$k"; done
        local w; w="$(ps 2>/dev/null | awk -v p="$root" 'NR>1 && $1==p {print $4}')"
        if [ -n "$w" ] && command -v taskkill >/dev/null 2>&1; then taskkill //F //PID "$w" >/dev/null 2>&1; fi
        kill -9 "$root" 2>/dev/null
    else
        for k in $(pgrep -P "$root" 2>/dev/null); do kill_tree "$k"; done
        kill -9 "$root" 2>/dev/null
    fi
}

# ¿el PID sigue siendo NUESTRO proceso (y no otro que reutilizó el número tras un reinicio)?
# Windows: debe ser un bash de MSYS. Unix: comparamos el instante de arranque guardado en el pidfile.
pid_alive() {
    local pid="$1" stamp="$2"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if is_win; then
        ps -p "$pid" 2>/dev/null | awk 'NR>1' | grep -q "bash" || return 1
    else
        if [ -n "$stamp" ]; then
            local now; now="$(ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' ')"
            [ "$now" = "$stamp" ] || return 1
        fi
    fi
    return 0
}

proc_stamp() {
    if is_win; then echo ""; else ps -o lstart= -p "$1" 2>/dev/null | tr -s ' '; fi
}

abs() { case "$1" in /*|?:*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
