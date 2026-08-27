# bash_wrapper.sh — ejecuta el comando del agente con un plazo REAL, mata el árbol al vencer y
# devuelve la salida por ARCHIVO (no por el pipe).
#
# Por qué existe (Synsema v0.6.7):
#   1. `run()` espera el EOF del pipe de stdout. En Windows cada proceso hijo hereda TODOS los handles,
#      así que un servidor lanzado en background (aunque redirijas sus fds) mantiene vivo el pipe y
#      `run()` se cuelga para siempre — incluso pasado su timeout.
#   2. El timeout de `run()` mata solo al hijo directo; los nietos (node, sleep…) sobreviven.
# Solución: cerrar stdout/stderr/stdin ANTES de lanzar nada, escribir el resultado en $OUTFILE, y matar
# el árbol al vencer el plazo (ver common.sh: Windows y unix).
#
# Uso: bash lib/tools/bash_wrapper.sh <timeout_s> <outfile>
#   env: LAMPSON_CMD = comando · LAMPSON_WS = cwd (default workspace)
. "$(dirname "$0")/common.sh"
T="${1:-120}"
OUTFILE="$(abs "$2")"
exec > /dev/null 2>&1 < /dev/null
cd "${LAMPSON_WS:-workspace}" || { echo "[cannot cd to workspace]" > "$OUTFILE"; exit 0; }
OUT="$(mktemp)"
CMDF="$(mktemp)"
printf '%s\n' "$LAMPSON_CMD" > "$CMDF"
( bash "$CMDF" ) > "$OUT" 2>&1 < /dev/null &
PID=$!
WAITED=0
while kill -0 "$PID" 2>/dev/null && [ "$WAITED" -lt "$((T * 10))" ]; do
    sleep 0.1
    WAITED=$((WAITED + 1))
done
if kill -0 "$PID" 2>/dev/null; then
    kill_tree "$PID"
    CODE=124
    TIMED_OUT=1
else
    wait "$PID"; CODE=$?
    TIMED_OUT=0
fi
{
    if [ "$TIMED_OUT" = 1 ]; then
        echo "ERROR: timeout after ${T}s — the command and its child processes were killed. For servers/watchers use the process tool. Output so far:"
    fi
    cat "$OUT"
    if [ "$TIMED_OUT" != 1 ] && [ "$CODE" != 0 ]; then
        echo "[exit code $CODE]"
    fi
} > "$OUTFILE"
rm -f "$OUT" "$CMDF"
exit 0
