# common.sh — helpers de shell de proc.sh (kill_tree para pids AJENOS; Windows/Git Bash, Linux, macOS)
#
# Windows (MSYS/Git Bash): hay DOS árboles. El de MSYS (bash → bash) no lo ve taskkill /T, así que se
# recorre PPID→PID con `ps`; y cada bash puede tener descendientes NATIVOS (npm.cmd → cmd → node → node)
# que MSYS no ve pero Windows sí: por eso a cada WINPID se le hace `taskkill /T /F` (árbol nativo).
# Sin el /T, un `npm run dev` lanzado desde bash sobrevivía al timeout con el puerto tomado (2026-08-27).
# Linux/macOS: `pgrep -P` para descender y kill -9. (Probado en Windows; unix escrito con cuidado, sin probar.)
is_win() { case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

kill_tree() {
    local root="$1" k
    if is_win; then
        for k in $(ps 2>/dev/null | awk -v p="$root" 'NR>1 && $2==p {print $1}'); do kill_tree "$k"; done
        local w; w="$(ps 2>/dev/null | awk -v p="$root" 'NR>1 && $1==p {print $4}')"
        if [ -n "$w" ] && command -v taskkill >/dev/null 2>&1; then taskkill //T //F //PID "$w" >/dev/null 2>&1; fi
        kill -9 "$root" 2>/dev/null
    else
        for k in $(pgrep -P "$root" 2>/dev/null); do kill_tree "$k"; done
        kill -9 "$root" 2>/dev/null
    fi
}

# ¿el PID sigue siendo NUESTRO proceso (y no otro que reutilizó el número tras un reinicio)?
# Windows: el WINPID guardado en el pidfile debe coincidir con el actual. (Antes se exigía que el
# COMMAND fuera "bash": falso negativo, porque `bash -c "a && npm run dev"` hace exec del último comando
# y ps pasa a mostrar cmd/node → el process tool declaraba "EXITED" a un servidor vivo, 2026-08-27.)
# Unix: comparamos el instante de arranque guardado en el pidfile.
pid_alive() {
    local pid="$1" stamp="$2"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if is_win; then
        local w; w="$(ps -p "$pid" 2>/dev/null | awk 'NR>1 {print $4; exit}')"
        [ -n "$w" ] || return 1
        if [ -n "$stamp" ]; then [ "$w" = "$stamp" ] || return 1; fi
    else
        if [ -n "$stamp" ]; then
            local now; now="$(ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' ')"
            [ "$now" = "$stamp" ] || return 1
        fi
    fi
    return 0
}

proc_stamp() {
    if is_win; then ps -p "$1" 2>/dev/null | awk 'NR>1 {print $4; exit}'; else ps -o lstart= -p "$1" 2>/dev/null | tr -s ' '; fi
}

abs() { case "$1" in /*|?:*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
